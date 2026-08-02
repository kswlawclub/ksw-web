-- Standard League preview overrides: validate and persist in the same fixture-confirmation transaction.
create or replace function public.confirm_standard_league_fixtures_v1(
  p_competition_id uuid,
  p_fixture_version integer,
  p_expected_fixture_count integer,
  p_fixtures jsonb,
  p_confirmed_by_label text,
  p_overrides jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_competition_type text;
  v_season_status text;
  v_config public.competition_league_configs%rowtype;
  v_team_count integer;
  v_expected_count integer;
  v_fixture_count integer;
  v_existing_count integer;
begin
  select competition_type, season_status into v_competition_type, v_season_status from public.leagues where id = p_competition_id for update;
  if not found then raise exception 'competition_not_found'; end if;
  if v_competition_type is distinct from 'league' then raise exception 'standard_league_requires_league_competition'; end if;
  if v_season_status = 'completed' then raise exception 'competition_completed'; end if;

  select * into v_config from public.competition_league_configs where competition_id = p_competition_id for update;
  if not found then raise exception 'league_config_not_found'; end if;
  if v_config.template_key <> 'standard_league' or v_config.legs <> 1 then raise exception 'invalid_standard_league_config'; end if;
  if v_config.fixture_status = 'confirmed' then
    select count(*) into v_existing_count from public.matches where league_id = p_competition_id and league_fixture_version = v_config.fixture_version;
    return jsonb_build_object('created_count', 0, 'existing_count', v_existing_count, 'fixture_version', v_config.fixture_version);
  end if;
  if p_fixture_version <> v_config.fixture_version + 1 then raise exception 'invalid_fixture_version'; end if;
  if exists (select 1 from public.matches where league_id = p_competition_id) then raise exception 'existing_matches_prevent_standard_league_initialization'; end if;
  if jsonb_typeof(p_fixtures) <> 'array' or jsonb_typeof(p_overrides) <> 'array' then raise exception 'invalid_fixture_payload'; end if;

  select count(*) into v_team_count from public.competition_teams where competition_id = p_competition_id and is_active = true;
  if v_team_count < 2 then raise exception 'insufficient_active_participants'; end if;
  v_expected_count := v_team_count * (v_team_count - 1) / 2;
  select jsonb_array_length(p_fixtures) into v_fixture_count;
  if p_expected_fixture_count <> v_expected_count or v_fixture_count <> v_expected_count then raise exception 'invalid_fixture_count'; end if;

  if exists (with fixtures as (select * from jsonb_to_recordset(p_fixtures) as f("awayTeamId" uuid, "fixtureKey" text, "homeTeamId" uuid, "leg" smallint, "matchweek" integer, "order" integer, "roundNumber" integer)) select 1 from fixtures where "homeTeamId" is null or "awayTeamId" is null or "homeTeamId" = "awayTeamId" or "fixtureKey" is null or btrim("fixtureKey") = '' or "leg" <> 1 or "matchweek" < 1 or "roundNumber" < 1 or "order" < 1) then raise exception 'invalid_fixture_shape'; end if;
  if exists (with fixtures as (select * from jsonb_to_recordset(p_fixtures) as f("awayTeamId" uuid, "fixtureKey" text, "homeTeamId" uuid, "leg" smallint, "matchweek" integer, "order" integer, "roundNumber" integer)) select 1 from fixtures group by least("homeTeamId"::text, "awayTeamId"::text), greatest("homeTeamId"::text, "awayTeamId"::text) having count(*) > 1) then raise exception 'duplicate_pair_in_leg'; end if;
  if exists (with fixtures as (select * from jsonb_to_recordset(p_fixtures) as f("awayTeamId" uuid, "fixtureKey" text, "homeTeamId" uuid, "leg" smallint, "matchweek" integer, "order" integer, "roundNumber" integer)) select 1 from fixtures f left join public.competition_teams h on h.competition_id = p_competition_id and h.team_id = f."homeTeamId" and h.is_active = true left join public.competition_teams a on a.competition_id = p_competition_id and a.team_id = f."awayTeamId" and a.is_active = true where h.team_id is null or a.team_id is null) then raise exception 'fixture_team_is_not_an_active_participant'; end if;

  if exists (with fixtures as (select * from jsonb_to_recordset(p_fixtures) as f("awayTeamId" uuid, "fixtureKey" text, "homeTeamId" uuid, "leg" smallint, "matchweek" integer, "order" integer, "roundNumber" integer)), overrides as (select * from jsonb_to_recordset(p_overrides) as o("awayTeamId" uuid, "fixtureKey" text, "homeTeamId" uuid, "matchDate" timestamptz, "venue" text)) select 1 from overrides o left join fixtures f on f."fixtureKey" = o."fixtureKey" where o."fixtureKey" is null or o."homeTeamId" is null or o."awayTeamId" is null or f."fixtureKey" is null or not ((o."homeTeamId" = f."homeTeamId" and o."awayTeamId" = f."awayTeamId") or (o."homeTeamId" = f."awayTeamId" and o."awayTeamId" = f."homeTeamId"))) then raise exception 'invalid_fixture_override'; end if;
  if exists (with overrides as (select * from jsonb_to_recordset(p_overrides) as o("awayTeamId" uuid, "fixtureKey" text, "homeTeamId" uuid, "matchDate" timestamptz, "venue" text)) select 1 from overrides group by "fixtureKey" having count(*) > 1) then raise exception 'duplicate_fixture_override'; end if;

  insert into public.matches (league_id, competition_stage, fixture_source, match_date, home_team_id, away_team_id, home_score, away_score, venue, status, league_leg, matchweek, league_fixture_version, league_fixture_key)
  select p_competition_id, 'regular', 'generated', o."matchDate", coalesce(o."homeTeamId", f."homeTeamId"), coalesce(o."awayTeamId", f."awayTeamId"), null, null, o."venue", 'scheduled', f."leg", f."matchweek", p_fixture_version, f."fixtureKey"
  from jsonb_to_recordset(p_fixtures) as f("awayTeamId" uuid, "fixtureKey" text, "homeTeamId" uuid, "leg" smallint, "matchweek" integer, "order" integer, "roundNumber" integer)
  left join jsonb_to_recordset(p_overrides) as o("awayTeamId" uuid, "fixtureKey" text, "homeTeamId" uuid, "matchDate" timestamptz, "venue" text) on o."fixtureKey" = f."fixtureKey"
  order by f."order";

  update public.competition_league_configs set fixture_status = 'confirmed', fixture_version = p_fixture_version, confirmed_at = now(), confirmed_by_label = nullif(btrim(p_confirmed_by_label), ''), updated_at = now() where competition_id = p_competition_id;
  return jsonb_build_object('created_count', v_fixture_count, 'existing_count', 0, 'fixture_version', p_fixture_version);
end;
$$;

revoke all on function public.confirm_standard_league_fixtures_v1(uuid, integer, integer, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.confirm_standard_league_fixtures_v1(uuid, integer, integer, jsonb, text, jsonb) to service_role;
