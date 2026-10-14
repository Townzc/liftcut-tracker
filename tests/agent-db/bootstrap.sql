-- ONLY for an empty, disposable local test database (not a Supabase migration).
-- auth.uid models the documented Postgres identity contract; this is not GoTrue.
do $$ begin
  if current_database() not like 'liftcut_p1_%' then raise exception 'Test database required'; end if;
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
    nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'sub')::uuid$$;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid,bucket_id text,name text);
alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
