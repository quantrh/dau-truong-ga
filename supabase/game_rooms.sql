-- Supabase-backed ephemeral online rooms for Đấu Trường Gà.
-- Direct browser access is intentionally disabled; use the rooster-rooms Edge Function.

create table if not exists public.game_rooms (
  code text primary key check (code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'),
  match_id text not null,
  peer_key text not null,
  host_hash text not null unique,
  host_name text not null,
  host_seen bigint not null,
  host_ready boolean not null default false,
  host_seq bigint not null default 0,
  host_payload jsonb not null default '{}'::jsonb,
  guest_hash text unique,
  guest_name text,
  guest_seen bigint,
  guest_ready boolean not null default false,
  guest_seq bigint not null default 0,
  guest_payload jsonb not null default '{}'::jsonb,
  status text not null default 'waiting' check (status in ('waiting','playing','closed')),
  created_at bigint not null,
  updated_at bigint not null,
  expires_at bigint not null
);

create index if not exists game_rooms_expiry_idx on public.game_rooms(expires_at);
create index if not exists game_rooms_status_idx on public.game_rooms(status, updated_at);

alter table public.game_rooms enable row level security;
revoke all on public.game_rooms from anon, authenticated;

comment on table public.game_rooms is
  'Ephemeral two-player rooster game rooms. Access is only through the rooster-rooms Edge Function; browser roles have no direct table privileges.';
