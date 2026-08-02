-- Atomic schedule-draft persistence for one Standard League Matchweek.
create or replace function public.save_standard_league_matchweek_draft_v1(
  p_competition_id uuid,
  p_fixture_version integer,
  p_matchweek integer,
  p_updates jsonb
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
  v_update_count integer;
begin
  select competition_type, season_status into v_competition_type, v_season_status from public.leagues where id = p_competition_id for update;
  if not found then raise exception 'competition_not_found'; end if;
  if v_competition_type is distinct from 'league' then raise exception 'standard_league_requires_league_competition'; end if;
  if v_season_status = 'completed' then raise exception 'competition_completed'; end if;

  select fixture_status, fixture_version into v_fixture_status, v_fixture_version from public.competition_league_configs where competition_id = p_competition_id and template_key = 'standard_league' for update;
  if not found or v_fixture_status <> 'confirmed' or v_fixture_version <> p_fixture_version then raise exception 'invalid_standard_league_fixture_version'; end if;
  if p_matchweek < 1 or jsonb_typeof(p_updates) <> 'array' then raise exception 'invalid_matchweek_draft_payload'; end if;

  select count(*) into v_match_count from public.matches where league_id = p_competition_id and league_fixture_version = p_fixture_version and matchweek = p_matchweek;
  select jsonb_array_length(p_updates) into v_update_count;
  if v_match_count = 0 then raise exception 'matchweek_not_found'; end if;
  if v_update_count <> v_match_count then raise exception 'matchweek_draft_requires_every_fixture'; end if;

  if exists (with updates as (select * from jsonb_to_recordset(p_updates) as u("awayTeamId" uuid, "homeTeamId" uuid, "matchDate" timestamptz, "matchId" uuid, "venue" text)) select 1 from updates group by "matchId" having count(*) > 1) then raise exception 'duplicate_matchweek_draft_match'; end if;
  if exists (with updates as (select * from jsonb_to_recordset(p_updates) as u("awayTeamId" uuid, "homeTeamId" uuid, "matchDate" timestamptz, "matchId" uuid, "venue" text)) select 1 from updates u left join public.matches m on m.id = u."matchId" and m.league_id = p_competition_id and m.league_fixture_version = p_fixture_version and m.matchweek = p_matchweek where u."matchId" is null or u."homeTeamId" is null or u."awayTeamId" is null or u."homeTeamId" = u."awayTeamId" or m.id is null) then raise exception 'invalid_matchweek_draft_match'; end if;
  if exists (with updates as (select * from jsonb_to_recordset(p_updates) as u("awayTeamId" uuid, "homeTeamId" uuid, "matchDate" timestamptz, "matchId" uuid, "venue" text)) select 1 from updates u join public.matches m on m.id = u."matchId" where not ((u."homeTeamId" = m.home_team_id and u."awayTeamId" = m.away_team_id) or (u."homeTeamId" = m.away_team_id and u."awayTeamId" = m.home_team_id)) or (m.home_score is not null or m.away_score is not null or m.status in ('finished', 'completed'))) then raise exception 'matchweek_draft_cannot_change_started_match'; end if;

  update public.matches m
  set home_team_id = u."homeTeamId", away_team_id = u."awayTeamId", match_date = u."matchDate", venue = nullif(btrim(u."venue"), '')
  from jsonb_to_recordset(p_updates) as u("awayTeamId" uuid, "homeTeamId" uuid, "matchDate" timestamptz, "matchId" uuid, "venue" text)
  where m.id = u."matchId" and m.league_id = p_competition_id and m.league_fixture_version = p_fixture_version and m.matchweek = p_matchweek;

  insert into public.competition_league_matchweeks (competition_id, fixture_version, matchweek, status, confirmed_at, confirmed_by, confirmed_by_label, updated_at)
  values (p_competition_id, p_fixture_version, p_matchweek, 'draft', null, null, null, now())
  on conflict (competition_id, fixture_version, matchweek) do update
  set status = 'draft', confirmed_at = null, confirmed_by = null, confirmed_by_label = null, updated_at = excluded.updated_at;

  return jsonb_build_object('competition_id', p_competition_id, 'fixture_version', p_fixture_version, 'matchweek', p_matchweek, 'match_count', v_match_count, 'status', 'draft');
end;
$$;

revoke all on function public.save_standard_league_matchweek_draft_v1(uuid, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function public.save_standard_league_matchweek_draft_v1(uuid, integer, integer, jsonb) to service_role;
