-- HISTORICAL PRE-M9 AUDIT ONLY.
-- This file references the legacy public.teams.league_id column.
-- Current post-M9 databases no longer contain that column.
-- Do not run this file against post-M9 databases; use the post-M9 health audit instead.

-- READ-ONLY AUDIT - SAFE FOR SUPABASE SQL EDITOR
-- This file does not modify schema or data.
-- Run Section 1 first. If public.competition_teams is missing, apply Phase M1 before running later sections.

-- Section 1: Phase M1 schema presence.
select
  to_regclass('public.competition_teams') is not null as table_exists;

select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'competition_teams'
order by ordinal_position;

select
  constraint_name,
  constraint_type
from information_schema.table_constraints
where table_schema = 'public'
  and table_name = 'competition_teams'
order by constraint_name;

select
  tc.constraint_name,
  kcu.column_name,
  ccu.table_schema as foreign_table_schema,
  ccu.table_name as foreign_table_name,
  ccu.column_name as foreign_column_name,
  rc.delete_rule
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_catalog = kcu.constraint_catalog
 and tc.constraint_schema = kcu.constraint_schema
 and tc.constraint_name = kcu.constraint_name
join information_schema.constraint_column_usage ccu
  on tc.constraint_catalog = ccu.constraint_catalog
 and tc.constraint_schema = ccu.constraint_schema
 and tc.constraint_name = ccu.constraint_name
join information_schema.referential_constraints rc
  on tc.constraint_catalog = rc.constraint_catalog
 and tc.constraint_schema = rc.constraint_schema
 and tc.constraint_name = rc.constraint_name
where tc.table_schema = 'public'
  and tc.table_name = 'competition_teams'
  and tc.constraint_type = 'FOREIGN KEY'
order by tc.constraint_name, kcu.ordinal_position;

select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'competition_teams'
order by indexname;

-- Section 2: Competition summary.
with legacy_team_counts as (
  select league_id as competition_id, count(*)::integer as legacy_team_count
  from public.teams
  where league_id is not null
  group by league_id
),
match_team_pairs as (
  select league_id as competition_id, home_team_id as team_id
  from public.matches
  union
  select league_id as competition_id, away_team_id as team_id
  from public.matches
),
match_team_counts as (
  select competition_id, count(distinct team_id)::integer as match_distinct_team_count
  from match_team_pairs
  group by competition_id
),
junction_counts as (
  select competition_id, count(*)::integer as existing_junction_count
  from public.competition_teams
  group by competition_id
),
proposed_pairs as (
  select league_id as competition_id, id as team_id
  from public.teams
  where league_id is not null
  union
  select league_id as competition_id, home_team_id as team_id
  from public.matches
  union
  select league_id as competition_id, away_team_id as team_id
  from public.matches
),
proposed_counts as (
  select competition_id, count(*)::integer as proposed_backfill_count
  from proposed_pairs
  group by competition_id
)
select
  l.id,
  l.name,
  l.season,
  to_jsonb(l)->>'competition_type' as competition_type,
  to_jsonb(l)->>'season_status' as season_status,
  l.is_active,
  (to_jsonb(l)->>'is_published')::boolean as is_published,
  to_jsonb(l)->>'start_date' as start_date,
  to_jsonb(l)->>'end_date' as end_date,
  coalesce(ltc.legacy_team_count, 0) as legacy_team_count,
  coalesce(mtc.match_distinct_team_count, 0) as match_distinct_team_count,
  coalesce(jc.existing_junction_count, 0) as existing_junction_count,
  coalesce(pc.proposed_backfill_count, 0) as proposed_backfill_count
from public.leagues l
left join legacy_team_counts ltc on ltc.competition_id = l.id
left join match_team_counts mtc on mtc.competition_id = l.id
left join junction_counts jc on jc.competition_id = l.id
left join proposed_counts pc on pc.competition_id = l.id
order by l.created_at desc, l.id;

-- Section 3: Proposed pair set.
with raw_pairs as (
  select league_id as competition_id, id as team_id, true as from_team_league, false as from_home_match, false as from_away_match
  from public.teams
  where league_id is not null
  union all
  select league_id as competition_id, home_team_id as team_id, false, true, false
  from public.matches
  union all
  select league_id as competition_id, away_team_id as team_id, false, false, true
  from public.matches
),
proposed_pairs as (
  select
    competition_id,
    team_id,
    bool_or(from_team_league) as from_team_league,
    bool_or(from_home_match) as from_home_match,
    bool_or(from_away_match) as from_away_match
  from raw_pairs
  group by competition_id, team_id
),
match_counts as (
  select
    p.competition_id,
    p.team_id,
    count(m.id)::integer as match_reference_count
  from proposed_pairs p
  left join public.matches m
    on m.league_id = p.competition_id
   and (m.home_team_id = p.team_id or m.away_team_id = p.team_id)
  group by p.competition_id, p.team_id
)
select
  p.competition_id,
  l.name as competition_name,
  p.team_id,
  t.name as team_name,
  p.from_team_league,
  p.from_home_match,
  p.from_away_match,
  ct.id is not null as already_in_junction,
  t.league_id as legacy_team_league_id,
  coalesce(mc.match_reference_count, 0) as match_reference_count
from proposed_pairs p
left join public.leagues l on l.id = p.competition_id
left join public.teams t on t.id = p.team_id
left join public.competition_teams ct
  on ct.competition_id = p.competition_id
 and ct.team_id = p.team_id
left join match_counts mc
  on mc.competition_id = p.competition_id
 and mc.team_id = p.team_id
order by l.created_at desc nulls last, l.name, t.name, p.competition_id, p.team_id;

-- Section 4A: Team legacy league mismatch with match competition.
select distinct
  t.id as team_id,
  t.name as team_name,
  t.league_id as legacy_team_league_id,
  m.league_id as match_competition_id,
  l.name as match_competition_name,
  count(m.id) over (partition by t.id, m.league_id)::integer as match_reference_count
from public.teams t
join public.matches m
  on m.home_team_id = t.id
  or m.away_team_id = t.id
left join public.leagues l on l.id = m.league_id
where t.league_id is not null
  and t.league_id <> m.league_id
order by t.name, m.league_id;

-- Section 4B: Team has no legacy competition but appears in matches.
select
  t.id as team_id,
  t.name as team_name,
  count(m.id)::integer as match_reference_count,
  array_agg(distinct m.league_id order by m.league_id) as match_competition_ids
from public.teams t
join public.matches m
  on m.home_team_id = t.id
  or m.away_team_id = t.id
where t.league_id is null
group by t.id, t.name
order by t.name;

-- Section 4C: Match references a missing team.
select
  m.id as match_id,
  m.league_id,
  m.home_team_id,
  ht.id is null as missing_home_team,
  m.away_team_id,
  at.id is null as missing_away_team
from public.matches m
left join public.teams ht on ht.id = m.home_team_id
left join public.teams at on at.id = m.away_team_id
where ht.id is null
   or at.id is null
order by m.match_date desc, m.id;

-- Section 4D: Match references a missing competition.
select
  m.id as match_id,
  m.league_id,
  m.match_date,
  m.home_team_id,
  m.away_team_id
from public.matches m
left join public.leagues l on l.id = m.league_id
where l.id is null
order by m.match_date desc, m.id;

-- Section 4E: Duplicate normalized team names.
with normalized as (
  select
    lower(btrim(name)) as normalized_name,
    id,
    name,
    short_name,
    league_id,
    is_ksw,
    logo_url
  from public.teams
)
select
  normalized_name,
  count(*)::integer as team_count,
  jsonb_agg(
    jsonb_build_object(
      'id', id,
      'name', name,
      'short_name', short_name,
      'league_id', league_id,
      'is_ksw', is_ksw,
      'logo_url', logo_url
    )
    order by name, id
  ) as teams
from normalized
where normalized_name <> ''
group by normalized_name
having count(*) > 1
order by team_count desc, normalized_name;

-- Section 4F: Duplicate normalized short names.
with normalized as (
  select
    lower(btrim(coalesce(short_name, ''))) as normalized_short_name,
    id,
    name,
    short_name,
    league_id,
    is_ksw,
    logo_url
  from public.teams
)
select
  normalized_short_name,
  count(*)::integer as team_count,
  jsonb_agg(
    jsonb_build_object(
      'id', id,
      'name', name,
      'short_name', short_name,
      'league_id', league_id,
      'is_ksw', is_ksw,
      'logo_url', logo_url
    )
    order by name, id
  ) as teams
from normalized
where normalized_short_name <> ''
group by normalized_short_name
having count(*) > 1
order by team_count desc, normalized_short_name;

-- Section 4G: KSW canonical team audit.
select
  t.id as team_id,
  t.name as team_name,
  t.short_name,
  t.league_id,
  t.is_active,
  count(distinct m.id)::integer as match_reference_count,
  count(distinct ct.competition_id)::integer as junction_usage_count,
  count(*) over ()::integer as ksw_team_count
from public.teams t
left join public.matches m
  on m.home_team_id = t.id
  or m.away_team_id = t.id
left join public.competition_teams ct on ct.team_id = t.id
where t.is_ksw = true
group by t.id, t.name, t.short_name, t.league_id, t.is_active
order by t.name, t.id;

-- Section 4H: Teams used in matches across multiple competitions.
select
  t.id as team_id,
  t.name as team_name,
  t.league_id as legacy_team_league_id,
  count(distinct m.league_id)::integer as match_competition_count,
  array_agg(distinct m.league_id order by m.league_id) as match_competition_ids,
  count(m.id)::integer as match_reference_count
from public.teams t
join public.matches m
  on m.home_team_id = t.id
  or m.away_team_id = t.id
group by t.id, t.name, t.league_id
having count(distinct m.league_id) > 1
order by match_competition_count desc, t.name;

-- Section 4I: Existing junction rows not supported by legacy or match sources.
with proposed_pairs as (
  select league_id as competition_id, id as team_id
  from public.teams
  where league_id is not null
  union
  select league_id as competition_id, home_team_id as team_id
  from public.matches
  union
  select league_id as competition_id, away_team_id as team_id
  from public.matches
)
select
  ct.id as competition_team_id,
  ct.competition_id,
  l.name as competition_name,
  ct.team_id,
  t.name as team_name,
  ct.is_active,
  ct.display_order,
  ct.created_at
from public.competition_teams ct
left join proposed_pairs p
  on p.competition_id = ct.competition_id
 and p.team_id = ct.team_id
left join public.leagues l on l.id = ct.competition_id
left join public.teams t on t.id = ct.team_id
where p.team_id is null
order by ct.created_at desc, ct.id;

-- Section 4J: Proposed pairs missing from junction.
with proposed_pairs as (
  select league_id as competition_id, id as team_id
  from public.teams
  where league_id is not null
  union
  select league_id as competition_id, home_team_id as team_id
  from public.matches
  union
  select league_id as competition_id, away_team_id as team_id
  from public.matches
)
select
  p.competition_id,
  l.name as competition_name,
  p.team_id,
  t.name as team_name,
  t.league_id as legacy_team_league_id
from proposed_pairs p
left join public.competition_teams ct
  on ct.competition_id = p.competition_id
 and ct.team_id = p.team_id
left join public.leagues l on l.id = p.competition_id
left join public.teams t on t.id = p.team_id
where ct.id is null
order by l.created_at desc nulls last, l.name, t.name, p.competition_id, p.team_id;

-- Section 5: Match status and standings compatibility.
select
  status,
  count(*)::integer as match_count
from public.matches
group by status
order by match_count desc, status;

select
  count(*) filter (where status = 'scheduled')::integer as scheduled_count,
  count(*) filter (where status = 'finished')::integer as finished_count,
  count(*) filter (where status = 'completed')::integer as completed_count,
  count(*) filter (where status not in ('scheduled', 'finished', 'completed'))::integer as unknown_status_count
from public.matches;

select
  to_regclass('public.league_standings_view') is not null as view_exists,
  pg_get_viewdef(to_regclass('public.league_standings_view'), true) as view_definition,
  position('teams' in lower(coalesce(pg_get_viewdef(to_regclass('public.league_standings_view'), true), ''))) > 0 as mentions_teams,
  position('league_id' in lower(coalesce(pg_get_viewdef(to_regclass('public.league_standings_view'), true), ''))) > 0 as mentions_league_id;

-- Section 6: Team reference and removal readiness.
select
  t.id as team_id,
  t.name as team_name,
  t.short_name,
  t.league_id as legacy_team_league_id,
  t.is_ksw,
  t.is_active,
  count(distinct m.id)::integer as match_reference_count,
  count(distinct ct.id)::integer as competition_teams_count,
  (count(distinct m.id) = 0 and count(distinct ct.id) = 0) as safe_to_hard_delete
from public.teams t
left join public.matches m
  on m.home_team_id = t.id
  or m.away_team_id = t.id
left join public.competition_teams ct on ct.team_id = t.id
group by t.id, t.name, t.short_name, t.league_id, t.is_ksw, t.is_active
order by match_reference_count desc, competition_teams_count desc, t.name;

-- Section 7: Backfill readiness metrics.
with proposed_pairs as (
  select league_id as competition_id, id as team_id
  from public.teams
  where league_id is not null
  union
  select league_id as competition_id, home_team_id as team_id
  from public.matches
  union
  select league_id as competition_id, away_team_id as team_id
  from public.matches
),
team_match_mismatches as (
  select distinct t.id as team_id, m.league_id as match_competition_id
  from public.teams t
  join public.matches m
    on m.home_team_id = t.id
    or m.away_team_id = t.id
  where t.league_id is not null
    and t.league_id <> m.league_id
),
missing_team_matches as (
  select m.id
  from public.matches m
  left join public.teams ht on ht.id = m.home_team_id
  left join public.teams at on at.id = m.away_team_id
  where ht.id is null
     or at.id is null
),
missing_competition_matches as (
  select m.id
  from public.matches m
  left join public.leagues l on l.id = m.league_id
  where l.id is null
),
duplicate_name_groups as (
  select lower(btrim(name)) as normalized_name
  from public.teams
  where lower(btrim(name)) <> ''
  group by lower(btrim(name))
  having count(*) > 1
),
duplicate_short_name_groups as (
  select lower(btrim(coalesce(short_name, ''))) as normalized_short_name
  from public.teams
  where lower(btrim(coalesce(short_name, ''))) <> ''
  group by lower(btrim(coalesce(short_name, '')))
  having count(*) > 1
),
missing_junction_pairs as (
  select p.competition_id, p.team_id
  from proposed_pairs p
  left join public.competition_teams ct
    on ct.competition_id = p.competition_id
   and ct.team_id = p.team_id
  where ct.id is null
)
select
  (select count(*) from public.teams)::integer as total_teams,
  (select count(*) from public.teams where league_id is not null)::integer as teams_with_legacy_league_id,
  (select count(*) from public.teams where league_id is null)::integer as teams_unassigned,
  (select count(*) from public.matches)::integer as total_matches,
  (select count(*) from proposed_pairs)::integer as proposed_unique_competition_team_pairs,
  (select count(*) from public.competition_teams)::integer as existing_junction_pairs,
  (select count(*) from missing_junction_pairs)::integer as missing_junction_pairs,
  (select count(*) from team_match_mismatches)::integer as conflict_pair_count,
  (select count(*) from duplicate_name_groups)::integer as duplicate_normalized_name_groups,
  (select count(*) from duplicate_short_name_groups)::integer as duplicate_short_name_groups,
  (select count(*) from public.teams where is_ksw = true)::integer as ksw_team_count,
  ((select count(*) from missing_team_matches) + (select count(*) from missing_competition_matches))::integer as orphan_count,
  (select count(*) from public.matches where status not in ('scheduled', 'finished', 'completed'))::integer as unknown_status_count;
