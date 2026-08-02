-- Matchweek confirmation locks pairings; schedule details may be added later.
create or replace function public.confirm_standard_league_matchweek_v1(
  p_competition_id uuid, p_fixture_version integer, p_matchweek integer, p_confirmed_by_label text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_type text; v_status text; v_fixture_status text; v_version integer; v_count integer;
begin
  select competition_type, season_status into v_type, v_status from public.leagues where id = p_competition_id for update;
  if not found then raise exception 'competition_not_found'; end if;
  if v_type is distinct from 'league' then raise exception 'standard_league_requires_league_competition'; end if;
  if v_status = 'completed' then raise exception 'competition_completed'; end if;
  select fixture_status, fixture_version into v_fixture_status, v_version from public.competition_league_configs where competition_id = p_competition_id and template_key = 'standard_league' for update;
  if not found or v_fixture_status <> 'confirmed' or v_version <> p_fixture_version then raise exception 'invalid_standard_league_fixture_version'; end if;
  select count(*) into v_count from public.matches where league_id = p_competition_id and league_fixture_version = p_fixture_version and matchweek = p_matchweek;
  if p_matchweek < 1 or v_count = 0 then raise exception 'matchweek_not_found'; end if;
  if exists (select 1 from public.matches where league_id = p_competition_id and league_fixture_version = p_fixture_version and matchweek = p_matchweek and (home_team_id is null or away_team_id is null or home_team_id = away_team_id or status in ('finished', 'completed'))) then raise exception 'matchweek_pairing_invalid'; end if;
  insert into public.competition_league_matchweeks (competition_id, fixture_version, matchweek, status, confirmed_at, confirmed_by_label, updated_at)
  values (p_competition_id, p_fixture_version, p_matchweek, 'confirmed', now(), nullif(btrim(p_confirmed_by_label), ''), now())
  on conflict (competition_id, fixture_version, matchweek) do update set status = 'confirmed', confirmed_at = excluded.confirmed_at, confirmed_by = null, confirmed_by_label = excluded.confirmed_by_label, updated_at = excluded.updated_at;
  return jsonb_build_object('competition_id', p_competition_id, 'fixture_version', p_fixture_version, 'matchweek', p_matchweek, 'match_count', v_count, 'status', 'confirmed');
end;
$$;

create or replace function public.save_standard_league_matchweek_draft_v1(
  p_competition_id uuid, p_fixture_version integer, p_matchweek integer, p_updates jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_type text; v_status text; v_fixture_status text; v_version integer; v_count integer; v_updates integer; v_pairing_changed boolean; v_current_status text;
begin
  select competition_type, season_status into v_type, v_status from public.leagues where id = p_competition_id for update;
  if not found then raise exception 'competition_not_found'; end if;
  if v_type is distinct from 'league' or v_status = 'completed' then raise exception 'invalid_league_draft_state'; end if;
  select fixture_status, fixture_version into v_fixture_status, v_version from public.competition_league_configs where competition_id = p_competition_id and template_key = 'standard_league' for update;
  if not found or v_fixture_status <> 'confirmed' or v_version <> p_fixture_version then raise exception 'invalid_standard_league_fixture_version'; end if;
  select count(*) into v_count from public.matches where league_id=p_competition_id and league_fixture_version=p_fixture_version and matchweek=p_matchweek;
  select jsonb_array_length(p_updates) into v_updates;
  if p_matchweek < 1 or jsonb_typeof(p_updates) <> 'array' or v_count = 0 or v_updates <> v_count then raise exception 'invalid_matchweek_draft_payload'; end if;
  if exists (with u as (select * from jsonb_to_recordset(p_updates) as x("awayTeamId" uuid,"homeTeamId" uuid,"matchDate" timestamptz,"matchId" uuid,"venue" text)) select 1 from u group by "matchId" having count(*) > 1) then raise exception 'duplicate_matchweek_draft_match'; end if;
  if exists (with u as (select * from jsonb_to_recordset(p_updates) as x("awayTeamId" uuid,"homeTeamId" uuid,"matchDate" timestamptz,"matchId" uuid,"venue" text)) select 1 from u left join public.matches m on m.id=u."matchId" and m.league_id=p_competition_id and m.league_fixture_version=p_fixture_version and m.matchweek=p_matchweek where m.id is null or u."homeTeamId" is null or u."awayTeamId" is null or u."homeTeamId"=u."awayTeamId" or m.status in ('finished','completed') or m.home_score is not null or m.away_score is not null) then raise exception 'matchweek_draft_cannot_change_started_match'; end if;
  select exists(with u as (select * from jsonb_to_recordset(p_updates) as x("awayTeamId" uuid,"homeTeamId" uuid,"matchDate" timestamptz,"matchId" uuid,"venue" text)) select 1 from u join public.matches m on m.id=u."matchId" where u."homeTeamId"<>m.home_team_id or u."awayTeamId"<>m.away_team_id) into v_pairing_changed;
  select status into v_current_status from public.competition_league_matchweeks where competition_id=p_competition_id and fixture_version=p_fixture_version and matchweek=p_matchweek for update;
  update public.matches m set home_team_id=u."homeTeamId", away_team_id=u."awayTeamId", match_date=u."matchDate", venue=nullif(btrim(u."venue"),'') from jsonb_to_recordset(p_updates) as u("awayTeamId" uuid,"homeTeamId" uuid,"matchDate" timestamptz,"matchId" uuid,"venue" text) where m.id=u."matchId";
  insert into public.competition_league_matchweeks (competition_id,fixture_version,matchweek,status,updated_at) values (p_competition_id,p_fixture_version,p_matchweek,case when coalesce(v_current_status,'unconfigured')='confirmed' and not v_pairing_changed then 'confirmed' else 'draft' end,now()) on conflict (competition_id,fixture_version,matchweek) do update set status=case when competition_league_matchweeks.status='confirmed' and not v_pairing_changed then 'confirmed' else 'draft' end, confirmed_at=case when competition_league_matchweeks.status='confirmed' and not v_pairing_changed then competition_league_matchweeks.confirmed_at else null end, confirmed_by=case when competition_league_matchweeks.status='confirmed' and not v_pairing_changed then competition_league_matchweeks.confirmed_by else null end, confirmed_by_label=case when competition_league_matchweeks.status='confirmed' and not v_pairing_changed then competition_league_matchweeks.confirmed_by_label else null end, updated_at=excluded.updated_at;
  return jsonb_build_object('competition_id',p_competition_id,'fixture_version',p_fixture_version,'matchweek',p_matchweek,'status',case when coalesce(v_current_status,'unconfigured')='confirmed' and not v_pairing_changed then 'confirmed' else 'draft' end);
end;
$$;
