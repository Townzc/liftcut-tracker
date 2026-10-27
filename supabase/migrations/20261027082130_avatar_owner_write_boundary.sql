begin;
-- Older projects may have bucket-only PERMISSIVE policies. Another permissive
-- owner policy would be ORed with them; these restrictions must apply as AND.
-- Public avatar reads and access rules for other buckets are unchanged.
create policy avatar_scope_insert on storage.objects as restrictive for insert to authenticated
  with check(bucket_id<>'avatars' or
    (strpos(name,'/')>0 and split_part(name,'/',1)=(select auth.uid())::text));
create policy avatar_scope_update on storage.objects as restrictive for update to authenticated
  using(bucket_id<>'avatars' or
    (strpos(name,'/')>0 and split_part(name,'/',1)=(select auth.uid())::text))
  with check(bucket_id<>'avatars' or
    (strpos(name,'/')>0 and split_part(name,'/',1)=(select auth.uid())::text));
create policy avatar_scope_delete on storage.objects as restrictive for delete to authenticated
  using(bucket_id<>'avatars' or
    (strpos(name,'/')>0 and split_part(name,'/',1)=(select auth.uid())::text));

-- Previously issued signed-upload tokens execute through Storage's admin path.
-- Storage supplies the token's owner metadata even when it bypasses RLS. Reject
-- a foreign signer at INSERT/UPDATE; null-owner trusted admin uploads remain valid.
-- Lifecycle/pending/deleted-owner protection remains in account_avatar_write.
create function account_private.guard_avatar_object_owner() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.bucket_id='avatars' and (
    (new.owner_id is not null and new.owner_id<>split_part(new.name,'/',1)) or
    (new.owner is not null and new.owner::text<>split_part(new.name,'/',1))
  ) then
    raise exception 'AVATAR_OWNER_MISMATCH' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function account_private.guard_avatar_object_owner() from public,anon,authenticated,service_role;
create trigger account_avatar_object_owner before insert or update on storage.objects
  for each row execute function account_private.guard_avatar_object_owner();
-- No DELETE trigger: trusted Storage API cleanup must remain possible.
commit;
