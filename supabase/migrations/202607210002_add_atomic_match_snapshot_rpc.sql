alter table public.league_standings_snapshots
  add column if not exists snapshot_batch uuid,
  add column if not exists snapshot_reason text,
  add column if not exists source_match_id uuid references public.matches(id) on delete set null;

update public.league_standings_snapshots
set snapshot_batch = snapshot_id
where snapshot_batch is null;

create index if not exists league_standings_snapshots_league_batch_idx
  on public.league_standings_snapshots (league_id, snapshot_batch);

create index if not exists league_standings_snapshots_source_match_idx
  on public.league_standings_snapshots (source_match_id);

create or replace function public.create_league_standings_snapshot(
  p_league_id uuid,
  p_snapshot_reason text,
  p_source_match_id uuid default null,
  p_snapshot_batch uuid default gen_random_uuid()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.league_standings_snapshots (
    snapshot_id,
    snapshot_batch,
    league_id,
    team_id,
    position,
    played,
    won,
    drawn,
    lost,
    goals_for,
    goals_against,
    goal_difference,
    points,
    matchday,
    snapshot_reason,
    source_match_id
  )
  select
    p_snapshot_batch,
    p_snapshot_batch,
    ranked.league_id,
    ranked.team_id,
    ranked.position,
    ranked.played,
    ranked.won,
    ranked.drawn,
    ranked.lost,
    ranked.goals_for,
    ranked.goals_against,
    ranked.goal_difference,
    ranked.points,
    null,
    p_snapshot_reason,
    p_source_match_id
  from (
    select
      standings.team_id,
      standings.league_id,
      standings.played,
      standings.won,
      standings.drawn,
      standings.lost,
      standings.goals_for,
      standings.goals_against,
      standings.goal_difference,
      standings.points,
      (row_number() over (
        order by
          standings.points desc,
          standings.goal_difference desc,
          standings.goals_for desc,
          standings.team_id asc
      ))::integer as position
    from public.league_standings_view standings
    where standings.league_id = p_league_id
  ) ranked;

  return p_snapshot_batch;
end;
$$;

create or replace function public.admin_create_match_with_standings_snapshot(
  p_league_id uuid,
  p_match_date timestamp with time zone,
  p_home_team_id uuid,
  p_away_team_id uuid,
  p_home_score integer,
  p_away_score integer,
  p_venue text,
  p_status text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match_id uuid;
begin
  if p_status = 'finished' then
    perform public.create_league_standings_snapshot(
      p_league_id,
      'match_create_finished',
      null,
      gen_random_uuid()
    );
  end if;

  insert into public.matches (
    league_id,
    match_date,
    home_team_id,
    away_team_id,
    home_score,
    away_score,
    venue,
    status
  )
  values (
    p_league_id,
    p_match_date,
    p_home_team_id,
    p_away_team_id,
    p_home_score,
    p_away_score,
    p_venue,
    p_status
  )
  returning id into v_match_id;

  return v_match_id;
end;
$$;

create or replace function public.admin_update_match_with_standings_snapshot(
  p_match_id uuid,
  p_league_id uuid,
  p_match_date timestamp with time zone,
  p_home_team_id uuid,
  p_away_team_id uuid,
  p_home_score integer,
  p_away_score integer,
  p_venue text,
  p_status text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.matches%rowtype;
  v_snapshot_batch uuid;
  v_standings_affecting_change boolean;
begin
  select *
  into v_existing
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'Match % not found', p_match_id;
  end if;

  v_standings_affecting_change =
    (v_existing.status = 'finished' or p_status = 'finished')
    and (
      v_existing.league_id is distinct from p_league_id
      or v_existing.home_team_id is distinct from p_home_team_id
      or v_existing.away_team_id is distinct from p_away_team_id
      or v_existing.home_score is distinct from p_home_score
      or v_existing.away_score is distinct from p_away_score
      or v_existing.status is distinct from p_status
    );

  if v_standings_affecting_change then
    v_snapshot_batch = gen_random_uuid();

    if v_existing.status = 'finished' then
      perform public.create_league_standings_snapshot(
        v_existing.league_id,
        'match_update_before_change',
        p_match_id,
        v_snapshot_batch
      );
    end if;

    if p_status = 'finished'
      and not (v_existing.status = 'finished' and p_league_id is not distinct from v_existing.league_id)
    then
      perform public.create_league_standings_snapshot(
        p_league_id,
        'match_update_before_change',
        p_match_id,
        v_snapshot_batch
      );
    end if;
  end if;

  update public.matches
  set
    league_id = p_league_id,
    match_date = p_match_date,
    home_team_id = p_home_team_id,
    away_team_id = p_away_team_id,
    home_score = p_home_score,
    away_score = p_away_score,
    venue = p_venue,
    status = p_status
  where id = p_match_id;

  return p_match_id;
end;
$$;

create or replace function public.admin_delete_match_with_standings_snapshot(
  p_match_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.matches%rowtype;
begin
  select *
  into v_existing
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'Match % not found', p_match_id;
  end if;

  if v_existing.status = 'finished' then
    perform public.create_league_standings_snapshot(
      v_existing.league_id,
      'match_delete_before_change',
      p_match_id,
      gen_random_uuid()
    );
  end if;

  delete from public.matches
  where id = p_match_id;

  return p_match_id;
end;
$$;

revoke all on function public.create_league_standings_snapshot(uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_create_match_with_standings_snapshot(uuid, timestamp with time zone, uuid, uuid, integer, integer, text, text) from public, anon, authenticated;
revoke all on function public.admin_update_match_with_standings_snapshot(uuid, uuid, timestamp with time zone, uuid, uuid, integer, integer, text, text) from public, anon, authenticated;
revoke all on function public.admin_delete_match_with_standings_snapshot(uuid) from public, anon, authenticated;

grant execute on function public.create_league_standings_snapshot(uuid, text, uuid, uuid) to service_role;
grant execute on function public.admin_create_match_with_standings_snapshot(uuid, timestamp with time zone, uuid, uuid, integer, integer, text, text) to service_role;
grant execute on function public.admin_update_match_with_standings_snapshot(uuid, uuid, timestamp with time zone, uuid, uuid, integer, integer, text, text) to service_role;
grant execute on function public.admin_delete_match_with_standings_snapshot(uuid) to service_role;
