-- fidelis database schema
-- Run once in Supabase: SQL Editor → New query → paste this whole file → Run.

create extension if not exists pgcrypto;

-- ---------- Saved trips (anonymous share links + signed-in "My trips") ----------
create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete set null,
  title text not null default 'Trip',
  destination text,
  data jsonb not null,
  constraint trips_data_size check (pg_column_size(data) < 100000)
);

alter table public.trips enable row level security;

-- Anyone (including anonymous visitors) may save a trip — as themselves or ownerless.
create policy "insert own or anonymous" on public.trips
  for insert with check (user_id is null or user_id = auth.uid());

-- Owners can list and read their own trips ("My trips").
create policy "owners read own" on public.trips
  for select using (user_id = auth.uid());

-- Owners can delete their own trips.
create policy "owners delete own" on public.trips
  for delete using (user_id = auth.uid());

-- Public share-link access goes through this function: knowing the id = having
-- the link. The table itself is never publicly listable.
create or replace function public.get_trip(trip_id uuid)
returns jsonb
language sql security definer stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', id, 'title', title, 'destination', destination,
    'data', data, 'created_at', created_at
  )
  from public.trips where id = trip_id;
$$;
grant execute on function public.get_trip(uuid) to anon, authenticated;

-- ---------- Email waitlist ----------
create table if not exists public.waitlist (
  email text primary key,
  created_at timestamptz not null default now()
);

alter table public.waitlist enable row level security;

-- Write-only from the site: anyone may join, nobody can read the list via the API.
create policy "anyone may join" on public.waitlist
  for insert with check (true);
