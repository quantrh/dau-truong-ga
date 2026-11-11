-- Rooster Arena progression schema.
-- Client users may read their own data and rename/create a rooster.
-- Match results and rewards are server-authoritative: no client INSERT/UPDATE grants.

create table if not exists public.game_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.game_roosters (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 24),
  grain_count integer not null default 0 check (grain_count >= 0),
  grasshopper_count integer not null default 0 check (grasshopper_count >= 0),
  hen_count integer not null default 0 check (hen_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists game_roosters_owner_idx on public.game_roosters(owner_id);

create table if not exists public.game_matches (
  id uuid primary key default gen_random_uuid(),
  room_code text,
  match_mode text not null check (match_mode in ('balanced','progression')),
  host_owner_id uuid references auth.users(id) on delete set null,
  guest_owner_id uuid references auth.users(id) on delete set null,
  host_rooster_id uuid references public.game_roosters(id) on delete set null,
  guest_rooster_id uuid references public.game_roosters(id) on delete set null,
  winner_owner_id uuid references auth.users(id) on delete set null,
  winner_rooster_id uuid references public.game_roosters(id) on delete set null,
  host_power integer not null default 100 check (host_power between 100 and 130),
  guest_power integer not null default 100 check (guest_power between 100 and 130),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists game_matches_host_idx on public.game_matches(host_owner_id, created_at desc);
create index if not exists game_matches_guest_idx on public.game_matches(guest_owner_id, created_at desc);

create table if not exists public.game_reward_ledger (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  rooster_id uuid not null references public.game_roosters(id) on delete cascade,
  match_id uuid references public.game_matches(id) on delete set null,
  reward_type text not null check (reward_type in ('grain','grasshopper','hen')),
  quantity integer not null check (quantity > 0 and quantity <= 100),
  reason text not null default 'match_reward',
  created_at timestamptz not null default now()
);
create index if not exists game_reward_owner_idx on public.game_reward_ledger(owner_id, created_at desc);
create index if not exists game_reward_rooster_idx on public.game_reward_ledger(rooster_id, created_at desc);

alter table public.game_profiles enable row level security;
alter table public.game_roosters enable row level security;
alter table public.game_matches enable row level security;
alter table public.game_reward_ledger enable row level security;

drop policy if exists "game profiles own select" on public.game_profiles;
create policy "game profiles own select" on public.game_profiles for select to authenticated using ((select auth.uid()) = id);
drop policy if exists "game profiles own insert" on public.game_profiles;
create policy "game profiles own insert" on public.game_profiles for insert to authenticated with check ((select auth.uid()) = id);
drop policy if exists "game profiles own update" on public.game_profiles;
create policy "game profiles own update" on public.game_profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "game roosters own select" on public.game_roosters;
create policy "game roosters own select" on public.game_roosters for select to authenticated using ((select auth.uid()) = owner_id);
drop policy if exists "game roosters own insert" on public.game_roosters;
create policy "game roosters own insert" on public.game_roosters for insert to authenticated with check ((select auth.uid()) = owner_id and grain_count = 0 and grasshopper_count = 0 and hen_count = 0);
drop policy if exists "game roosters own rename" on public.game_roosters;
create policy "game roosters own rename" on public.game_roosters for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

drop policy if exists "game rewards own select" on public.game_reward_ledger;
create policy "game rewards own select" on public.game_reward_ledger for select to authenticated using ((select auth.uid()) = owner_id);

drop policy if exists "game matches participants select" on public.game_matches;
create policy "game matches participants select" on public.game_matches for select to authenticated using ((select auth.uid()) = host_owner_id or (select auth.uid()) = guest_owner_id);

revoke all on public.game_profiles, public.game_roosters, public.game_matches, public.game_reward_ledger from anon;
revoke all on public.game_profiles, public.game_roosters, public.game_matches, public.game_reward_ledger from authenticated;
grant select, insert, update on public.game_profiles to authenticated;
grant select on public.game_roosters to authenticated;
grant insert(owner_id,name) on public.game_roosters to authenticated;
grant update(name) on public.game_roosters to authenticated;
grant select on public.game_matches, public.game_reward_ledger to authenticated;

create or replace view public.game_rooster_stats with (security_invoker = true) as
select r.id,r.owner_id,r.name,r.grain_count,r.grasshopper_count,r.hen_count,
  (r.grain_count + r.grasshopper_count * 5 + r.hen_count * 20) as reward_score,
  least(130,100 + floor(sqrt((r.grain_count + r.grasshopper_count * 5 + r.hen_count * 20)::numeric) * 2)::integer) as power_rating,
  r.updated_at
from public.game_roosters r;
grant select on public.game_rooster_stats to authenticated;

comment on table public.game_reward_ledger is 'Immutable reward ledger. Only the trusted match server should insert rewards and update rooster totals.';
comment on column public.game_matches.match_mode is 'balanced ignores accumulated power; progression applies capped power ratings.';
