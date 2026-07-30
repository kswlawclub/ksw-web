-- Competition membership now lives in public.competition_teams.
-- Drop the legacy one-competition pointer from canonical teams without CASCADE.

alter table public.teams
  drop constraint if exists teams_league_id_fkey;

alter table public.teams
  drop column if exists league_id;
