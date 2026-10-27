begin;
-- Signed uploads use Storage's service role and bypass RLS. Enforce the owner
-- lifecycle at the write itself, including both owners when an object is moved.
-- No auth.users row lock here: authenticated UPDATE may already hold lock 718.
create function account_private.guard_avatar_write() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare prefixes text[]:=array[case when new.bucket_id='avatars' then split_part(new.name,'/',1) end];
  prefix text; owner_id uuid;
begin
  if tg_table_schema<>'storage' or tg_table_name<>'objects' or tg_op not in ('INSERT','UPDATE') then
    raise exception 'STORAGE_WRITE_ONLY';
  end if;
  if tg_op='UPDATE' and old.bucket_id='avatars' then
    prefixes:=array_append(prefixes,split_part(old.name,'/',1));
  end if;
  for prefix in select distinct p from unnest(prefixes) p where p is not null order by p loop
    if prefix !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'AVATAR_OWNER_REQUIRED' using errcode='42501';
    end if;
    owner_id:=prefix::uuid;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text,718));
    if not exists(select 1 from auth.users where id=owner_id)
      or exists(select 1 from account_private.deletions where user_id=owner_id) then
      raise exception 'AVATAR_OWNER_UNAVAILABLE' using errcode='42501';
    end if;
  end loop;
  return new;
end $$;
revoke all on function account_private.guard_avatar_write() from public,anon,authenticated,service_role;
create trigger account_avatar_write before insert or update on storage.objects
  for each row execute function account_private.guard_avatar_write();
commit;
