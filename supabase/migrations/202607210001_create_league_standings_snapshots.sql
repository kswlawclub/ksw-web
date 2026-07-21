create table if not exists public.league_standings_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null,
  league_id uuid references public.leagues(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  position integer not null check (position > 0),
  played integer not null default 0 check (played >= 0),
  won integer not null default 0 check (won >= 0),
  drawn integer not null default 0 check (drawn >= 0),
  lost integer not null default 0 check (lost >= 0),
  goals_for integer not null default 0 check (goals_for >= 0),
  goals_against integer not null default 0 check (goals_against >= 0),
  goal_difference integer not null default 0,
  points integer not null default 0 check (points >= 0),
  matchday integer check (matchday is null or matchday > 0),
  created_at timestamp with time zone not null default now(),
  unique (snapshot_id, team_id)
);

create index if not exists league_standings_snapshots_created_at_idx
  on public.league_standings_snapshots (created_at desc);

create index if not exists league_standings_snapshots_league_created_at_idx
  on public.league_standings_snapshots (league_id, created_at desc);

create index if not exists league_standings_snapshots_team_created_at_idx
  on public.league_standings_snapshots (team_id, created_at desc);

grant select on public.league_standings_snapshots to anon, authenticated;
