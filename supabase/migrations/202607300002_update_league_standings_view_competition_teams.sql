-- Rebuild standings from competition_teams instead of legacy team ownership.
-- Preserves the public.league_standings_view column contract used by Home,
-- Competition Detail, LeagueTable, and standings snapshot RPCs.

create or replace view public.league_standings_view as
with valid_matches as (
  select
    m.id,
    m.league_id,
    m.home_team_id,
    m.away_team_id,
    m.home_score,
    m.away_score
  from public.matches m
  where m.status in ('finished', 'completed')
    and m.home_score is not null
    and m.away_score is not null
    and m.home_team_id <> m.away_team_id
    and exists (
      select 1
      from public.competition_teams home_participant
      where home_participant.competition_id = m.league_id
        and home_participant.team_id = m.home_team_id
    )
    and exists (
      select 1
      from public.competition_teams away_participant
      where away_participant.competition_id = m.league_id
        and away_participant.team_id = m.away_team_id
    )
),
participant_set as (
  select
    ct.competition_id as league_id,
    ct.team_id,
    t.name as team_name,
    t.short_name,
    t.logo_url,
    t.is_ksw
  from public.competition_teams ct
  join public.teams t
    on t.id = ct.team_id
  where ct.is_active = true
     or exists (
       select 1
       from valid_matches vm
       where vm.league_id = ct.competition_id
         and (
           vm.home_team_id = ct.team_id
           or vm.away_team_id = ct.team_id
         )
     )
),
team_match_rows as (
  select
    vm.league_id,
    vm.home_team_id as team_id,
    1 as played,
    case when vm.home_score > vm.away_score then 1 else 0 end as won,
    case when vm.home_score = vm.away_score then 1 else 0 end as drawn,
    case when vm.home_score < vm.away_score then 1 else 0 end as lost,
    vm.home_score as goals_for,
    vm.away_score as goals_against
  from valid_matches vm

  union all

  select
    vm.league_id,
    vm.away_team_id as team_id,
    1 as played,
    case when vm.away_score > vm.home_score then 1 else 0 end as won,
    case when vm.away_score = vm.home_score then 1 else 0 end as drawn,
    case when vm.away_score < vm.home_score then 1 else 0 end as lost,
    vm.away_score as goals_for,
    vm.home_score as goals_against
  from valid_matches vm
),
aggregated as (
  select
    ps.team_id,
    ps.league_id,
    ps.team_name,
    ps.short_name,
    ps.logo_url,
    ps.is_ksw,
    coalesce(sum(tmr.played), 0)::integer as played,
    coalesce(sum(tmr.won), 0)::integer as won,
    coalesce(sum(tmr.drawn), 0)::integer as drawn,
    coalesce(sum(tmr.lost), 0)::integer as lost,
    coalesce(sum(tmr.goals_for), 0)::integer as goals_for,
    coalesce(sum(tmr.goals_against), 0)::integer as goals_against
  from participant_set ps
  left join team_match_rows tmr
    on tmr.league_id = ps.league_id
   and tmr.team_id = ps.team_id
  group by
    ps.team_id,
    ps.league_id,
    ps.team_name,
    ps.short_name,
    ps.logo_url,
    ps.is_ksw
)
select
  team_id,
  league_id,
  team_name,
  short_name,
  logo_url,
  is_ksw,
  played,
  won,
  drawn,
  lost,
  goals_for,
  goals_against,
  (goals_for - goals_against)::integer as goal_difference,
  ((won * 3) + drawn)::integer as points
from aggregated;

grant select on public.league_standings_view to anon, authenticated;

-- Read-only verification after applying this migration:
--
-- 1) Status distribution:
-- select status, count(*)::integer as match_count
-- from public.matches
-- group by status
-- order by status;
--
-- 2) Active participants should be 4 for the production verification competition:
-- select count(*)::integer as active_participants
-- from public.competition_teams
-- where competition_id = '70bcecbb-e339-4e59-9fe3-0f16bcd0c3d3'
--   and is_active = true;
--
-- 3) Standings rows should match eligible participant rows:
-- select count(*)::integer as standings_rows
-- from public.league_standings_view
-- where league_id = '70bcecbb-e339-4e59-9fe3-0f16bcd0c3d3';
--
-- 4) Scheduled matches should not affect played/points:
-- select team_id, played, points
-- from public.league_standings_view
-- where league_id = '70bcecbb-e339-4e59-9fe3-0f16bcd0c3d3'
-- order by team_name;
--
-- 5) Scheduled match count for comparison:
-- select count(*)::integer as scheduled_matches
-- from public.matches
-- where league_id = '70bcecbb-e339-4e59-9fe3-0f16bcd0c3d3'
--   and status = 'scheduled';
--
-- 6) No duplicate standings rows:
-- select league_id, team_id, count(*)::integer as row_count
-- from public.league_standings_view
-- group by league_id, team_id
-- having count(*) > 1;
--
-- 7) Active participants missing from standings:
-- select ct.team_id
-- from public.competition_teams ct
-- where ct.competition_id = '70bcecbb-e339-4e59-9fe3-0f16bcd0c3d3'
--   and ct.is_active = true
-- except
-- select standings.team_id
-- from public.league_standings_view standings
-- where standings.league_id = '70bcecbb-e339-4e59-9fe3-0f16bcd0c3d3';
--
-- 8) Standings rows that are not assigned participants:
-- select standings.team_id
-- from public.league_standings_view standings
-- where standings.league_id = '70bcecbb-e339-4e59-9fe3-0f16bcd0c3d3'
-- except
-- select ct.team_id
-- from public.competition_teams ct
-- where ct.competition_id = '70bcecbb-e339-4e59-9fe3-0f16bcd0c3d3';
--
-- 9) View definition dependency check:
-- select pg_get_viewdef('public.league_standings_view'::regclass, true) as view_definition;
