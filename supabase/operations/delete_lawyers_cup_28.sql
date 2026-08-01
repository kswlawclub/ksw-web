-- One-time operational cleanup for the Lawyer's Cup 28 test competition.
-- Target only: 8e29eeef-6862-4f50-abad-c7f0bc6e09b2
-- Run the preflight block first. It always rolls back.

begin;

with target as (
  select '8e29eeef-6862-4f50-abad-c7f0bc6e09b2'::uuid as competition_id
)
select
  (select count(*) from public.leagues l join target t on t.competition_id = l.id) as leagues,
  (select count(*) from public.competition_teams ct join target t on t.competition_id = ct.competition_id) as competition_teams,
  (select count(*) from public.competition_groups cg join target t on t.competition_id = cg.competition_id) as competition_groups,
  (select count(*) from public.matches m join target t on t.competition_id = m.league_id) as matches,
  (select count(*) from public.competition_knockout_matches km join target t on t.competition_id = km.competition_id) as competition_knockout_matches,
  (select count(*) from public.competition_knockout_configs kc join target t on t.competition_id = kc.competition_id) as competition_knockout_configs,
  (select count(*) from public.competition_bracket_nodes bn join target t on t.competition_id = bn.competition_id) as competition_bracket_nodes,
  (select count(*) from public.league_standings_snapshots ss join target t on t.competition_id = ss.league_id) as league_standings_snapshots;

select
  conrelid::regclass as child_table,
  confdeltype as on_delete_code,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where contype = 'f'
  and (
    conrelid in (
      'public.competition_teams'::regclass,
      'public.competition_groups'::regclass,
      'public.matches'::regclass,
      'public.competition_knockout_matches'::regclass,
      'public.competition_knockout_configs'::regclass,
      'public.competition_bracket_nodes'::regclass,
      'public.league_standings_snapshots'::regclass
    )
    or confrelid in ('public.leagues'::regclass, 'public.competition_groups'::regclass)
  )
order by child_table::text, definition;

-- Proves the Production FK graph can cascade this exact target without committing data changes.
delete from public.leagues
where id = '8e29eeef-6862-4f50-abad-c7f0bc6e09b2'::uuid;

rollback;

-- Apply only after the preflight block succeeds and its counts are recorded.
begin;

delete from public.leagues
where id = '8e29eeef-6862-4f50-abad-c7f0bc6e09b2'::uuid
returning id, name;

commit;
