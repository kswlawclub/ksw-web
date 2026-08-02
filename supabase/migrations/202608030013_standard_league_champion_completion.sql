-- Standard League champion confirmation audit and atomic season completion.
alter table public.competition_league_configs
  add column if not exists champion_confirmed_by uuid null,
  add column if not exists champion_confirmed_by_label text null,
  add column if not exists champion_resolution_reason text null;

create or replace function public.complete_standard_league_season_v1(
  p_competition_id uuid,
  p_champion_team_id uuid,
  p_completed_by uuid default null,
  p_completed_by_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_competition public.leagues%rowtype;
  v_config public.competition_league_configs%rowtype;
  v_expected_fixture_count integer;
  v_fixture_count integer;
begin
  select * into v_competition from public.leagues where id = p_competition_id for update;
  if not found then raise exception 'competition_not_found'; end if;
  if v_competition.competition_type <> 'league' then raise exception 'standard_league_requires_league_competition'; end if;
  if v_competition.season_status = 'completed' then raise exception 'competition_completed'; end if;

  select * into v_config from public.competition_league_configs
  where competition_id = p_competition_id and template_key = 'standard_league' for update;
  if not found or v_config.fixture_status <> 'confirmed' then raise exception 'fixture_not_confirmed'; end if;
  if v_config.champion_team_id is distinct from p_champion_team_id or v_config.champion_at is null or v_config.champion_confirmed_by_label is null then
    raise exception 'champion_not_confirmed';
  end if;

  perform 1 from public.matches
  where league_id = p_competition_id and league_fixture_version = v_config.fixture_version
  for update;

  select count(*) into v_expected_fixture_count
  from public.competition_teams where competition_id = p_competition_id and is_active = true;
  v_expected_fixture_count := v_expected_fixture_count * (v_expected_fixture_count - 1) / 2 * v_config.legs;

  select count(*) into v_fixture_count from public.matches
  where league_id = p_competition_id and league_fixture_version = v_config.fixture_version;
  if v_fixture_count <> v_expected_fixture_count or v_fixture_count = 0 then raise exception 'fixture_set_invalid'; end if;
  if exists (
    select 1 from public.matches
    where league_id = p_competition_id and league_fixture_version = v_config.fixture_version
      and (status not in ('finished', 'completed') or home_score is null or away_score is null)
  ) then raise exception 'fixtures_incomplete'; end if;
  if exists (
    select 1 from (
      select distinct coalesce(scheduled_matchweek, matchweek) as matchweek
      from public.matches where league_id = p_competition_id and league_fixture_version = v_config.fixture_version
    ) effective_weeks
    left join public.competition_league_matchweeks matchweeks
      on matchweeks.competition_id = p_competition_id
      and matchweeks.fixture_version = v_config.fixture_version
      and matchweeks.matchweek = effective_weeks.matchweek
    where matchweeks.status is distinct from 'completed'
  ) then raise exception 'matchweeks_incomplete'; end if;

  update public.competition_league_configs
  set champion_team_id = p_champion_team_id,
      champion_at = coalesce(champion_at, now()),
      champion_confirmed_by = p_completed_by,
      champion_confirmed_by_label = coalesce(nullif(btrim(p_completed_by_label), ''), champion_confirmed_by_label),
      updated_at = now()
  where competition_id = p_competition_id;
  update public.leagues set season_status = 'completed' where id = p_competition_id;

  return jsonb_build_object('success', true, 'competition_id', p_competition_id, 'champion_team_id', p_champion_team_id);
end;
$$;

revoke all on function public.complete_standard_league_season_v1(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.complete_standard_league_season_v1(uuid, uuid, uuid, text) to service_role;
