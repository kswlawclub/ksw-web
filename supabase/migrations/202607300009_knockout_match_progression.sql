-- Link knockout setup slots to real matches and store knockout winner metadata.

alter table public.competition_knockout_matches
  add column if not exists match_id uuid;

alter table public.matches
  add column if not exists penalty_home_score integer,
  add column if not exists penalty_away_score integer,
  add column if not exists manual_winner_team_id uuid,
  add column if not exists winner_team_id uuid;

alter table public.competition_knockout_matches
  drop constraint if exists competition_knockout_matches_match_fk;

alter table public.competition_knockout_matches
  add constraint competition_knockout_matches_match_fk
  foreign key (match_id)
  references public.matches(id)
  on delete set null;

alter table public.matches
  drop constraint if exists matches_manual_winner_team_fk;

alter table public.matches
  add constraint matches_manual_winner_team_fk
  foreign key (manual_winner_team_id)
  references public.teams(id)
  on delete restrict;

alter table public.matches
  drop constraint if exists matches_winner_team_fk;

alter table public.matches
  add constraint matches_winner_team_fk
  foreign key (winner_team_id)
  references public.teams(id)
  on delete restrict;

alter table public.matches
  drop constraint if exists matches_knockout_scores_check;

alter table public.matches
  add constraint matches_knockout_scores_check
  check (
    (penalty_home_score is null or (penalty_home_score >= 0 and penalty_home_score <= 999))
    and (penalty_away_score is null or (penalty_away_score >= 0 and penalty_away_score <= 999))
  );

alter table public.matches
  drop constraint if exists matches_knockout_winner_check;

alter table public.matches
  add constraint matches_knockout_winner_check
  check (
    (
      winner_team_id is null
      or winner_team_id = home_team_id
      or winner_team_id = away_team_id
    )
    and (
      manual_winner_team_id is null
      or manual_winner_team_id = home_team_id
      or manual_winner_team_id = away_team_id
    )
  );

create unique index if not exists competition_knockout_matches_match_id_idx
  on public.competition_knockout_matches (match_id)
  where match_id is not null;
