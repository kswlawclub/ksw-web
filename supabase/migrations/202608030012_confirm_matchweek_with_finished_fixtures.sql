-- Finished fixtures remain valid, immutable members of an effective Matchweek.
create or replace function public.confirm_standard_league_matchweek_v1(
  p_competition_id uuid,
  p_fixture_version integer,
  p_matchweek integer,
  p_confirmed_by_label text default null,
  p_editable_fixtures jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effective_match_count integer;
  v_editable_match_count integer;
  v_payload_count integer;
  v_competition_type text;
  v_season_status text;
begin
  if p_matchweek not between 1 and 99 or jsonb_typeof(p_editable_fixtures) <> 'array' then
    raise exception 'invalid_matchweek';
  end if;

  select competition_type, season_status
  into v_competition_type, v_season_status
  from public.leagues
  where id = p_competition_id
  for update;

  if not found or v_competition_type <> 'league' or v_season_status = 'completed' then
    raise exception 'invalid_league_confirmation';
  end if;

  if not exists (
    select 1
    from public.competition_league_configs
    where competition_id = p_competition_id
      and template_key = 'standard_league'
      and fixture_status = 'confirmed'
      and fixture_version = p_fixture_version
    for update
  ) then
    raise exception 'invalid_standard_league_fixture_version';
  end if;

  select count(*)
  into v_effective_match_count
  from public.matches
  where league_id = p_competition_id
    and league_fixture_version = p_fixture_version
    and coalesce(scheduled_matchweek, matchweek) = p_matchweek;

  if v_effective_match_count = 0 then
    raise exception 'matchweek_empty';
  end if;

  if exists (
    select 1
    from public.matches
    where league_id = p_competition_id
      and league_fixture_version = p_fixture_version
      and coalesce(scheduled_matchweek, matchweek) = p_matchweek
      and (home_team_id is null or away_team_id is null or home_team_id = away_team_id)
  ) then
    raise exception 'fixture_set_invalid';
  end if;

  if exists (
    select 1
    from (
      select least(home_team_id::text, away_team_id::text) as first_team_id,
             greatest(home_team_id::text, away_team_id::text) as second_team_id
      from public.matches
      where league_id = p_competition_id
        and league_fixture_version = p_fixture_version
        and coalesce(scheduled_matchweek, matchweek) = p_matchweek
    ) as effective_pairs
    group by first_team_id, second_team_id
    having count(*) > 1
  ) then
    raise exception 'fixture_set_invalid';
  end if;

  select count(*)
  into v_editable_match_count
  from public.matches
  where league_id = p_competition_id
    and league_fixture_version = p_fixture_version
    and coalesce(scheduled_matchweek, matchweek) = p_matchweek
    and status not in ('finished', 'completed');

  if exists (
    select 1
    from jsonb_to_recordset(p_editable_fixtures) as payload(
      "matchId" uuid,
      "homeTeamId" uuid,
      "awayTeamId" uuid
    )
    group by "matchId"
    having count(*) > 1
  ) then
    raise exception 'fixture_set_invalid';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_editable_fixtures) as payload(
      "matchId" uuid,
      "homeTeamId" uuid,
      "awayTeamId" uuid
    )
    join public.matches fixture on fixture.id = payload."matchId"
    where fixture.league_id = p_competition_id
      and fixture.league_fixture_version = p_fixture_version
      and coalesce(fixture.scheduled_matchweek, fixture.matchweek) = p_matchweek
      and fixture.status in ('finished', 'completed')
  ) then
    raise exception 'finished_fixture_modified';
  end if;

  select jsonb_array_length(p_editable_fixtures)
  into v_payload_count;

  if v_payload_count <> v_editable_match_count then
    raise exception 'editable_fixture_missing';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_editable_fixtures) as payload(
      "matchId" uuid,
      "homeTeamId" uuid,
      "awayTeamId" uuid
    )
    left join public.matches fixture on fixture.id = payload."matchId"
      and fixture.league_id = p_competition_id
      and fixture.league_fixture_version = p_fixture_version
      and coalesce(fixture.scheduled_matchweek, fixture.matchweek) = p_matchweek
      and fixture.status not in ('finished', 'completed')
    where fixture.id is null
      or payload."homeTeamId" is null
      or payload."awayTeamId" is null
      or payload."homeTeamId" <> fixture.home_team_id
      or payload."awayTeamId" <> fixture.away_team_id
  ) then
    raise exception 'fixture_set_invalid';
  end if;

  insert into public.competition_league_matchweeks (
    competition_id,
    fixture_version,
    matchweek,
    status,
    confirmed_at,
    confirmed_by_label,
    updated_at
  ) values (
    p_competition_id,
    p_fixture_version,
    p_matchweek,
    'confirmed',
    now(),
    nullif(btrim(p_confirmed_by_label), ''),
    now()
  ) on conflict (competition_id, fixture_version, matchweek) do update set
    status = 'confirmed',
    confirmed_at = excluded.confirmed_at,
    confirmed_by = null,
    confirmed_by_label = excluded.confirmed_by_label,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'competition_id', p_competition_id,
    'fixture_version', p_fixture_version,
    'matchweek', p_matchweek,
    'match_count', v_effective_match_count,
    'editable_match_count', v_editable_match_count,
    'status', 'confirmed'
  );
end;
$$;

revoke all on function public.confirm_standard_league_matchweek_v1(uuid, integer, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.confirm_standard_league_matchweek_v1(uuid, integer, integer, text, jsonb) to service_role;
