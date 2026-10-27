begin;
-- Server-only preparation. The API must verify identity + explicit confirmation
-- before calling begin_account_deletion; this migration enables no deletion UI.
create schema account_private;
revoke all on schema account_private from public,anon,authenticated;
grant usage on schema account_private to authenticated,service_role;
create table account_private.deletions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  request_id uuid not null unique,
  started_at timestamptz not null default now()
);
alter table account_private.deletions enable row level security;
alter table account_private.deletions force row level security;
revoke all on account_private.deletions from public,anon,authenticated,service_role;

-- No client-supplied identity is trusted here: only the server service role can
-- execute this function. No table grants let it bypass the upload barrier.
create function account_private.begin_deletion(target uuid, request uuid, session uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existing uuid;
begin
  if target is null or request is null then raise exception 'INVALID_DELETION_REQUEST' using errcode='22023'; end if;
  -- Match Auth DELETE's row-before-advisory ordering; do not deadlock its FK.
  perform 1 from auth.users where id=target for key share;
  if not found then raise exception 'ACCOUNT_NOT_FOUND' using errcode='23503'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target::text,718));
  select request_id into existing from account_private.deletions where user_id=target;
  if session is not null then
    perform 1 from auth.sessions s where s.id=session and s.user_id=target
      and (s.not_after is null or s.not_after>clock_timestamp()) for key share;
    if not found then raise exception 'ACTIVE_SESSION_REQUIRED' using errcode='42501'; end if;
  elsif existing is null then
    raise exception 'ACTIVE_SESSION_REQUIRED' using errcode='42501';
  end if;
  if existing is not null and existing<>request then raise exception 'DELETION_REQUEST_CONFLICT' using errcode='23505'; end if;
  if existing is null then insert into account_private.deletions(user_id,request_id) values(target,request); end if;
  return jsonb_build_object('requestId',request,'status','pending');
end $$;
revoke all on function account_private.begin_deletion(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function account_private.begin_deletion(uuid,uuid,uuid) to service_role;
create function public.begin_account_deletion(target uuid, request uuid, session uuid default null) returns jsonb
language sql security invoker set search_path='' as $$
  select account_private.begin_deletion(target,request,session)
$$;
revoke all on function public.begin_account_deletion(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_account_deletion(uuid,uuid,uuid) to service_role;
-- NULL session is only for the server's verified resume receipt, never initiation.
-- Status allows a reauthenticated user to recover a lost local request identifier.
create function account_private.deletion_status(target uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('requestId',request_id,'status','pending') from account_private.deletions where user_id=target
$$;
revoke all on function account_private.deletion_status(uuid) from public,anon,authenticated;
grant execute on function account_private.deletion_status(uuid) to service_role;
create function public.account_deletion_status(target uuid) returns jsonb
language sql stable security invoker set search_path='' as $$select account_private.deletion_status(target)$$;
revoke all on function public.account_deletion_status(uuid) from public,anon,authenticated;
grant execute on function public.account_deletion_status(uuid) to service_role;

-- Stateless JWT validity is insufficient after sign-out/deletion. Serialize with
-- begin_deletion: an upload finishes before the barrier, or is rejected after it.
-- VOLATILE ensures the queries after waiting observe the newly committed state.
create function account_private.avatar_write_allowed() returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); session_id text:=auth.jwt()->>'session_id';
begin
  if owner_id is null or session_id is null then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text,718));
  return exists(select 1 from auth.sessions s where s.id::text=session_id and s.user_id=owner_id
    and (s.not_after is null or s.not_after>clock_timestamp()))
    and not exists(select 1 from account_private.deletions where user_id=owner_id);
end $$;
revoke all on function account_private.avatar_write_allowed() from public,anon;
grant execute on function account_private.avatar_write_allowed() to authenticated;
create policy avatar_live_insert on storage.objects as restrictive for insert to authenticated
  with check(bucket_id<>'avatars' or account_private.avatar_write_allowed());
create policy avatar_live_update on storage.objects as restrictive for update to authenticated
  using(bucket_id<>'avatars' or account_private.avatar_write_allowed())
  with check(bucket_id<>'avatars' or account_private.avatar_write_allowed());
create policy avatar_live_delete on storage.objects as restrictive for delete to authenticated
  using(bucket_id<>'avatars' or account_private.avatar_write_allowed());

-- Runs/proposals form a cycle; ordinary application roles must remain append-only.
-- Trigger authority is deliberately limited to OLD.id from an Auth user deletion.
-- Auth + database cleanup share one transaction. Storage is cleaned by its API
-- first: SQL must never delete storage.objects metadata instead of the files.
create function account_private.erase_user_ledger() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_table_schema<>'auth' or tg_table_name<>'users' or tg_op<>'DELETE' then
    raise exception 'AUTH_DELETE_ONLY';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(old.id::text,718));
  if exists(select 1 from storage.objects where bucket_id='avatars' and split_part(name,'/',1)=old.id::text) then
    raise exception 'ACCOUNT_STORAGE_NOT_EMPTY' using errcode='23503';
  end if;
  update agent_private.runs set current_proposal=null where user_id=old.id;
  delete from agent_private.receipts where user_id=old.id;
  delete from agent_private.events where user_id=old.id;
  delete from agent_private.execution_keys where user_id=old.id;
  delete from agent_private.proposals where user_id=old.id;
  delete from agent_private.runs where user_id=old.id;
  return old;
end $$;
revoke all on function account_private.erase_user_ledger() from public,anon,authenticated,service_role;
create trigger account_delete_ledger before delete on auth.users
  for each row execute function account_private.erase_user_ledger();
commit;
