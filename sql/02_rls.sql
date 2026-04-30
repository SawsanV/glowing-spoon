-- =========================================================
-- Total Battle tracker — Row Level Security (RLS) policies
-- Run this AFTER 01_schema.sql
-- =========================================================

-- Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.group_settings enable row level security;
alter table public.captain_snapshots enable row level security;
alter table public.hero_snapshots enable row level security;
alter table public.artifact_snapshots enable row level security;

-- ---------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------
-- Anyone signed in can read all profiles (so the leaderboard / compare view works)
create policy "profiles readable by authed users"
  on public.profiles for select
  to authenticated
  using (true);

-- Users can update their own profile (e.g. change username)
create policy "users update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Admins can update any profile (e.g. promote/demote)
create policy "admins update any profile"
  on public.profiles for update
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- Admins can delete profiles (kicks them from the group)
create policy "admins delete profiles"
  on public.profiles for delete
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- ---------------------------------------------------------
-- Group settings — admins read/write, others read-only
-- ---------------------------------------------------------
create policy "all authed read settings"
  on public.group_settings for select
  to authenticated
  using (true);

create policy "admins update settings"
  on public.group_settings for update
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- ---------------------------------------------------------
-- Snapshot tables — same pattern: read all, write own only
-- ---------------------------------------------------------

-- CAPTAINS
create policy "all authed read captains"
  on public.captain_snapshots for select
  to authenticated
  using (true);

create policy "users insert own captains"
  on public.captain_snapshots for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "users delete own captains"
  on public.captain_snapshots for delete
  to authenticated
  using (auth.uid() = user_id);

create policy "admins delete any captains"
  on public.captain_snapshots for delete
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- HERO
create policy "all authed read hero"
  on public.hero_snapshots for select
  to authenticated
  using (true);

create policy "users insert own hero"
  on public.hero_snapshots for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "users delete own hero"
  on public.hero_snapshots for delete
  to authenticated
  using (auth.uid() = user_id);

create policy "admins delete any hero"
  on public.hero_snapshots for delete
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- ARTIFACTS
create policy "all authed read artifacts"
  on public.artifact_snapshots for select
  to authenticated
  using (true);

create policy "users insert own artifacts"
  on public.artifact_snapshots for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "users delete own artifacts"
  on public.artifact_snapshots for delete
  to authenticated
  using (auth.uid() = user_id);

create policy "admins delete any artifacts"
  on public.artifact_snapshots for delete
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
