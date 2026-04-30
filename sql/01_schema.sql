-- =========================================================
-- Total Battle tracker — Supabase schema
-- Run this in: Supabase dashboard → SQL Editor → New query
-- =========================================================

-- Profiles table: one row per signed-up user, linked to auth.users
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (char_length(username) between 2 and 30),
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- Group settings (single row, controls signup code)
create table public.group_settings (
  id int primary key default 1,
  signup_code text not null,
  updated_at timestamptz not null default now(),
  constraint single_row check (id = 1)
);

-- Seed the single settings row with a placeholder code (CHANGE THIS LATER)
insert into public.group_settings (id, signup_code) values (1, 'change-me-now');

-- Captains: one user has many captains, each can be updated repeatedly (snapshots)
create table public.captain_snapshots (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  captain_name text not null,
  level int,
  power bigint,
  gear_notes text,
  recorded_at timestamptz not null default now()
);

create index captain_snapshots_user_idx on public.captain_snapshots(user_id, captain_name, recorded_at desc);

-- Hero: each user has one hero "identity", but many snapshots over time
create table public.hero_snapshots (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  hero_name text not null,
  level int,
  stars int,
  power bigint,
  gear_notes text,
  recorded_at timestamptz not null default now()
);

create index hero_snapshots_user_idx on public.hero_snapshots(user_id, recorded_at desc);

-- Artifacts: each user has multiple artifacts, snapshots over time
create table public.artifact_snapshots (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  artifact_name text not null,
  level int,
  stars int,
  notes text,
  recorded_at timestamptz not null default now()
);

create index artifact_snapshots_user_idx on public.artifact_snapshots(user_id, artifact_name, recorded_at desc);

-- =========================================================
-- Trigger: auto-create profile row when a new auth user confirms
-- =========================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
