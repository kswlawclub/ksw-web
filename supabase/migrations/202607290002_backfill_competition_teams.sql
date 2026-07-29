-- Backfill canonical team participation from legacy team league assignments and match history.
-- Preserves existing competition_teams rows and leaves teams.league_id unchanged.

with proposed_pairs as (
  select
    league_id as competition_id,
    id as team_id
  from public.teams
  where league_id is not null

  union

  select
    league_id as competition_id,
    home_team_id as team_id
  from public.matches

  union

  select
    league_id as competition_id,
    away_team_id as team_id
  from public.matches
),
valid_pairs as (
  select
    proposed_pairs.competition_id,
    proposed_pairs.team_id
  from proposed_pairs
  join public.leagues
    on leagues.id = proposed_pairs.competition_id
  join public.teams
    on teams.id = proposed_pairs.team_id
)
insert into public.competition_teams (
  competition_id,
  team_id,
  is_active,
  display_order
)
select
  competition_id,
  team_id,
  true,
  0
from valid_pairs
on conflict (competition_id, team_id) do nothing;
