-- Hosted Supabase owns auth and may not allow postgres to grant schema USAGE
-- to a custom role. RLS resolves auth.uid() when policies are created, but a
-- PL/pgSQL trigger resolves its SQL as the caller at execution time.
-- Match auth.uid()'s subject contract without reading auth tables or granting
-- additional privileges. JWT verification and owner RLS remain unchanged.
create or replace function agent_private.serialize_plan_write() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare subject uuid;
begin
  subject := coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
  if subject is not null then
    perform pg_advisory_xact_lock(hashtextextended(subject::text, 713));
  end if;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;
