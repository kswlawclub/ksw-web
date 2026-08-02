-- Persisted Matchweek workflow for opt-in Standard League competitions only.
-- Original structural Matchweek remains public.matches.matchweek; this table records
-- its organiser-facing readiness state without changing legacy league records.
create table if not exists public.competition_league_matchweeks (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.leagues(id) on delete cascade,
  fixture_version integer not null check (fixture_version >= 1),
  matchweek integer not null check (matchweek >= 1),
  status text not null default 'unconfigured',
  confirmed_at timestamptz null,
  confirmed_by uuid null,
  confirmed_by_label text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint competition_league_matchweeks_identity_unique unique (competition_id, fixture_version, matchweek),
  constraint competition_league_matchweeks_status_check check (status in ('unconfigured', 'draft', 'confirmed', 'completed')),
  constraint competition_league_matchweeks_confirmation_check check (status <> 'confirmed' or confirmed_at is not null)
);

comment on table public.competition_league_matchweeks is
  'Persisted scheduling readiness for each Standard League structural Matchweek. Does not permit rescheduling across matches.';

create index if not exists competition_league_matchweeks_competition_version_idx
  on public.competition_league_matchweeks (competition_id, fixture_version, matchweek);

revoke all on table public.competition_league_matchweeks from public, anon, authenticated;
grant select, insert, update, delete on table public.competition_league_matchweeks to service_role;
