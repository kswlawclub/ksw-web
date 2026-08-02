-- Atomic Matchweek confirmation for the persisted Standard League workflow.
create or replace function public.confirm_standard_league_matchweek_v1(
  p_competition_id uuid,
  p_fixture_version integer,
  p_matchweek integer,
  p_confirmed_by_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_competition_type text;
  v_season_status text;
  v_fixture_status text;
  v_fixture_version integer;
  v_match_count integer;
begin
  select competition_type, season_status
  into v_competition_type, v_season_status
  from public.leagues
  where id = p_competition_id
  for update;
  if not found then raise exception 'competition_not_found'; end if;
  if v_competition_type is distinct from 'league' then raise exception 'standard_league_requires_league_competition'; end if;
  if v_season_status = 'completed' then raise exception 'competition_completed'; end if;

  select fixture_status, fixture_version
  into v_fixture_status, v_fixture_version
  from public.competition_league_configs
  where competition_id = p_competition_id and template_key = 'standard_league'
  for update;
  if not found or v_fixture_status <> 'confirmed' or v_fixture_version <> p_fixture_version then raise exception 'invalid_standard_league_fixture_version'; end if;
  if p_matchweek < 1 then raise exception 'invalid_matchweek'; end if;

  select count(*) into v_match_count
  from public.matches
  where league_id = p_competition_id
    and league_fixture_version = p_fixture_version
    and matchweek = p_matchweek;
  if v_match_count = 0 then raise exception 'matchweek_not_found'; end if;

  if exists (
    select 1
    from public.matches
    where league_id = p_competition_id
      and league_fixture_version = p_fixture_version
      and matchweek = p_matchweek
      and (home_team_id is null or away_team_id is null or home_team_id = away_team_id or match_date is null or venue is null or btrim(venue) = '' or status in ('finished', 'completed'))
  ) then raise exception 'matchweek_details_incomplete'; end if;

  insert into public.competition_league_matchweeks (
    competition_id, fixture_version, matchweek, status, confirmed_at, confirmed_by_label, updated_at
  ) values (
    p_competition_id, p_fixture_version, p_matchweek, 'confirmed', now(), nullif(btrim(p_confirmed_by_label), ''), now()
  ) on conflict (competition_id, fixture_version, matchweek) do update
  set status = 'confirmed', confirmed_at = excluded.confirmed_at, confirmed_by = null, confirmed_by_label = excluded.confirmed_by_label, updated_at = excluded.updated_at;

  return jsonb_build_object('competition_id', p_competition_id, 'fixture_version', p_fixture_version, 'matchweek', p_matchweek, 'match_count', v_match_count, 'status', 'confirmed');
end;
$$;

revoke all on function public.confirm_standard_league_matchweek_v1(uuid, integer, integer, text) from public, anon, authenticated;
grant execute on function public.confirm_standard_league_matchweek_v1(uuid, integer, integer, text) to service_role;
