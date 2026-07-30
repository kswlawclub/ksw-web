-- READ-ONLY POST-M9 HEALTH AUDIT - SAFE FOR SUPABASE SQL EDITOR
-- Current schema assumption: canonical team participation lives in public.competition_teams.
-- This file must remain SELECT-only. It does not modify schema or data.

-- Section A: Schema objects expected after M9.
select
  'legacy_team_competition_column_removed' as check_name,
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'teams'
      and column_name = 'league_id'
  ) as passed;

select
  'legacy_team_competition_fk_removed' as check_name,
  not exists (
    select 1
    from pg_constraint
    where conname = 'teams_league_id_fkey'
  ) as passed;

select
  'competition_teams_table_exists' as check_name,
  to_regclass('public.competition_teams') is not null as passed;

-- Section B: Standings view should be rebuilt from competition_teams.
with view_object as (
  select to_regclass('public.league_standings_view') as view_oid
),
view_definition as (
  select
    view_oid is not null as view_exists,
    coalesce(pg_get_viewdef(view_oid, true), '') as definition
  from view_object
)
select
  'league_standings_view_definition' as check_name,
  view_exists,
  definition ilike '%competition_teams%' as uses_competition_teams,
  definition not ilike '%t.league_id%' as avoids_old_team_alias_join,
  definition not ilike '%teams.league_id%' as avoids_old_qualified_column
from view_definition;

-- Section C: Junction integrity.
select
  'junction_row_counts' as section,
  count(*) as total_rows,
  count(*) filter (where is_active = true) as active_rows,
  count(*) filter (where is_active = false) as inactive_rows,
  count(*) filter (where competition_id is null) as null_competition_id_rows,
  count(*) filter (where team_id is null) as null_team_id_rows
from public.competition_teams;

select
  'orphan_team_references' as check_name,
  count(*) as row_count
from public.competition_teams ct
left join public.teams t on t.id = ct.team_id
where t.id is null;

select
  'orphan_competition_references' as check_name,
  count(*) as row_count
from public.competition_teams ct
left join public.leagues l on l.id = ct.competition_id
where l.id is null;

select
  'duplicate_competition_team_pairs' as check_name,
  competition_id,
  team_id,
  count(*) as row_count
from public.competition_teams
group by competition_id, team_id
having count(*) > 1
order by row_count desc, competition_id, team_id;

-- Section D: Competition participant summary.
select
  l.id as competition_id,
  l.name,
  count(ct.team_id) filter (where ct.is_active = true) as active_participants,
  count(ct.team_id) filter (where ct.is_active = false) as inactive_participants,
  count(ct.team_id) as total_participants
from public.leagues l
left join public.competition_teams ct on ct.competition_id = l.id
group by l.id, l.name
order by l.name, l.id;

-- Section E: Canonical teams assigned to more than one competition.
select
  t.id as team_id,
  t.name,
  count(ct.competition_id) as assignment_count,
  count(ct.competition_id) filter (where ct.is_active = true) as active_assignment_count
from public.teams t
join public.competition_teams ct on ct.team_id = t.id
group by t.id, t.name
having count(ct.competition_id) > 1
order by assignment_count desc, t.name;

-- Section F: Standings coverage.
-- Policy B note: standings may include inactive participants if they have a valid counted match.
with active_participants as (
  select competition_id, count(*) as active_participant_count
  from public.competition_teams
  where is_active = true
  group by competition_id
),
standings_rows as (
  select league_id as competition_id, count(*) as standings_row_count
  from public.league_standings_view
  group by league_id
)
select
  l.id as competition_id,
  l.name,
  coalesce(ap.active_participant_count, 0) as active_participant_count,
  coalesce(sr.standings_row_count, 0) as standings_row_count,
  coalesce(sr.standings_row_count, 0) - coalesce(ap.active_participant_count, 0) as standings_minus_active_participants
from public.leagues l
left join active_participants ap on ap.competition_id = l.id
left join standings_rows sr on sr.competition_id = l.id
order by l.name, l.id;

-- Section G: RLS, policies, and grants for participant-related tables.
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('teams', 'competition_teams')
order by c.relname;

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('teams', 'competition_teams')
order by tablename, policyname;

select
  table_schema,
  table_name,
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('teams', 'competition_teams')
order by table_name, grantee, privilege_type;

-- Section H: Known production expectations. These are comparisons only; they do not raise errors.
with expectations as (
  select
    '50bd508f-dbd3-47a4-b005-e02213155d5f'::uuid as competition_id,
    'Thai Lawyers League'::text as label,
    13::bigint as expected_active,
    null::bigint as expected_total,
    null::bigint as expected_standings
  union all
  select
    '70bcecbb-e339-4e59-9fe3-0f16bcd0c3d3'::uuid,
    'ฟุตบอลวันรพี'::text,
    4::bigint,
    7::bigint,
    4::bigint
),
actuals as (
  select
    e.competition_id,
    e.label,
    e.expected_active,
    e.expected_total,
    e.expected_standings,
    count(ct.team_id) filter (where ct.is_active = true) as actual_active,
    count(ct.team_id) as actual_total,
    (
      select count(*)
      from public.league_standings_view standings
      where standings.league_id = e.competition_id
    ) as actual_standings
  from expectations e
  left join public.competition_teams ct on ct.competition_id = e.competition_id
  group by e.competition_id, e.label, e.expected_active, e.expected_total, e.expected_standings
)
select
  label,
  competition_id,
  expected_active,
  actual_active,
  actual_active = expected_active as active_matches_expectation,
  expected_total,
  actual_total,
  expected_total is null or actual_total = expected_total as total_matches_expectation,
  expected_standings,
  actual_standings,
  expected_standings is null or actual_standings = expected_standings as standings_matches_expectation
from actuals
order by label;
