-- Online match progression/reward upgrade for Đấu Trường Gà.

alter table public.game_rooms
  add column if not exists match_mode text not null default 'balanced',
  add column if not exists host_owner_id uuid,
  add column if not exists guest_owner_id uuid,
  add column if not exists host_rooster_id uuid,
  add column if not exists guest_rooster_id uuid,
  add column if not exists host_rooster_name text,
  add column if not exists guest_rooster_name text,
  add column if not exists host_power integer not null default 100,
  add column if not exists guest_power integer not null default 100,
  add column if not exists rewarded_at bigint;

alter table public.game_matches add column if not exists room_match_key text;
create unique index if not exists game_matches_room_match_key_uidx
  on public.game_matches(room_match_key)
  where room_match_key is not null;

alter table public.game_rooms drop constraint if exists game_rooms_match_mode_check;
alter table public.game_rooms add constraint game_rooms_match_mode_check
  check (match_mode in ('balanced','progression'));

create or replace function public.game_award_match(
  p_room_code text,
  p_room_match_key text,
  p_match_mode text,
  p_host_owner_id uuid,
  p_guest_owner_id uuid,
  p_host_rooster_id uuid,
  p_guest_rooster_id uuid,
  p_host_power integer,
  p_guest_power integer,
  p_winner_index integer,
  p_host_wins integer,
  p_guest_wins integer,
  p_started_at timestamptz,
  p_ended_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_match_id uuid;
  v_owner_id uuid;
  v_rooster_id uuid;
  v_reward_type text;
  v_quantity integer;
  v_existing public.game_reward_ledger%rowtype;
begin
  if p_winner_index not in (0,1) then
    return jsonb_build_object('awarded',false,'reason','draw');
  end if;

  insert into public.game_matches(
    room_code,room_match_key,match_mode,
    host_owner_id,guest_owner_id,host_rooster_id,guest_rooster_id,
    winner_owner_id,winner_rooster_id,host_power,guest_power,
    started_at,ended_at
  )
  values(
    p_room_code,p_room_match_key,
    case when p_match_mode='progression' then 'progression' else 'balanced' end,
    p_host_owner_id,p_guest_owner_id,p_host_rooster_id,p_guest_rooster_id,
    case when p_winner_index=0 then p_host_owner_id else p_guest_owner_id end,
    case when p_winner_index=0 then p_host_rooster_id else p_guest_rooster_id end,
    greatest(100,least(130,coalesce(p_host_power,100))),
    greatest(100,least(130,coalesce(p_guest_power,100))),
    p_started_at,p_ended_at
  )
  on conflict (room_match_key) where room_match_key is not null
  do update set ended_at=excluded.ended_at
  returning id into v_match_id;

  select * into v_existing
  from public.game_reward_ledger
  where match_id=v_match_id
  limit 1;

  if found then
    return jsonb_build_object('awarded',true,'rewardType',v_existing.reward_type,'quantity',v_existing.quantity,'duplicate',true);
  end if;

  v_owner_id := case when p_winner_index=0 then p_host_owner_id else p_guest_owner_id end;
  v_rooster_id := case when p_winner_index=0 then p_host_rooster_id else p_guest_rooster_id end;
  if v_owner_id is null or v_rooster_id is null then
    return jsonb_build_object('awarded',false,'reason','no_profile');
  end if;

  if p_match_mode='progression'
     and ((p_winner_index=0 and p_host_wins>=2 and p_guest_wins=0)
       or (p_winner_index=1 and p_guest_wins>=2 and p_host_wins=0)) then
    v_reward_type := 'hen'; v_quantity := 1;
  elsif p_match_mode='progression' then
    v_reward_type := 'grasshopper'; v_quantity := 1;
  else
    v_reward_type := 'grain'; v_quantity := 3;
  end if;

  insert into public.game_reward_ledger(owner_id,rooster_id,match_id,reward_type,quantity,reason)
  values(v_owner_id,v_rooster_id,v_match_id,v_reward_type,v_quantity,'match_reward');

  if v_reward_type='grain' then
    update public.game_roosters set grain_count=grain_count+v_quantity,updated_at=now()
      where id=v_rooster_id and owner_id=v_owner_id;
  elsif v_reward_type='grasshopper' then
    update public.game_roosters set grasshopper_count=grasshopper_count+v_quantity,updated_at=now()
      where id=v_rooster_id and owner_id=v_owner_id;
  else
    update public.game_roosters set hen_count=hen_count+v_quantity,updated_at=now()
      where id=v_rooster_id and owner_id=v_owner_id;
  end if;

  return jsonb_build_object('awarded',true,'rewardType',v_reward_type,'quantity',v_quantity,'duplicate',false);
end;
$$;

revoke all on function public.game_award_match(
  text,text,text,uuid,uuid,uuid,uuid,integer,integer,integer,integer,integer,timestamptz,timestamptz
) from public, anon, authenticated;
grant execute on function public.game_award_match(
  text,text,text,uuid,uuid,uuid,uuid,integer,integer,integer,integer,integer,timestamptz,timestamptz
) to service_role;
