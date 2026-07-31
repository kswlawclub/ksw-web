-- Add Cup knockout bracket slot structure without creating match progression.

create table if not exists public.competition_knockout_matches (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null,
  bracket_size integer not null,
  round_index integer not null,
  round_key text not null,
  round_label text not null,
  match_order integer not null,
  home_source_type text not null default 'unassigned',
  home_group_id uuid,
  home_group_rank integer,
  home_team_id uuid,
  home_source_round_index integer,
  home_source_match_order integer,
  away_source_type text not null default 'unassigned',
  away_group_id uuid,
  away_group_rank integer,
  away_team_id uuid,
  away_source_round_index integer,
  away_source_match_order integer,
  is_manual_edited boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint competition_knockout_matches_competition_fk
    foreign key (competition_id)
    references public.leagues(id)
    on delete cascade,
  constraint competition_knockout_matches_home_group_fk
    foreign key (home_group_id)
    references public.competition_groups(id)
    on delete restrict,
  constraint competition_knockout_matches_away_group_fk
    foreign key (away_group_id)
    references public.competition_groups(id)
    on delete restrict,
  constraint competition_knockout_matches_home_team_fk
    foreign key (home_team_id)
    references public.teams(id)
    on delete restrict,
  constraint competition_knockout_matches_away_team_fk
    foreign key (away_team_id)
    references public.teams(id)
    on delete restrict,
  constraint competition_knockout_matches_bracket_size_check
    check (bracket_size in (4, 8, 16, 32, 64)),
  constraint competition_knockout_matches_round_check
    check (round_index >= 1 and match_order >= 1),
  constraint competition_knockout_matches_source_type_check
    check (
      home_source_type in ('group_rank', 'manual_team', 'bye', 'match_winner', 'unassigned')
      and away_source_type in ('group_rank', 'manual_team', 'bye', 'match_winner', 'unassigned')
    ),
  constraint competition_knockout_matches_not_double_bye_check
    check (not (home_source_type = 'bye' and away_source_type = 'bye')),
  constraint competition_knockout_matches_home_source_check
    check (
      (home_source_type = 'group_rank' and home_group_id is not null and home_group_rank is not null and home_team_id is null and home_source_round_index is null and home_source_match_order is null)
      or (home_source_type = 'manual_team' and home_team_id is not null and home_group_id is null and home_group_rank is null and home_source_round_index is null and home_source_match_order is null)
      or (home_source_type = 'match_winner' and home_source_round_index is not null and home_source_match_order is not null and home_group_id is null and home_group_rank is null and home_team_id is null)
      or (home_source_type in ('bye', 'unassigned') and home_group_id is null and home_group_rank is null and home_team_id is null and home_source_round_index is null and home_source_match_order is null)
    ),
  constraint competition_knockout_matches_away_source_check
    check (
      (away_source_type = 'group_rank' and away_group_id is not null and away_group_rank is not null and away_team_id is null and away_source_round_index is null and away_source_match_order is null)
      or (away_source_type = 'manual_team' and away_team_id is not null and away_group_id is null and away_group_rank is null and away_source_round_index is null and away_source_match_order is null)
      or (away_source_type = 'match_winner' and away_source_round_index is not null and away_source_match_order is not null and away_group_id is null and away_group_rank is null and away_team_id is null)
      or (away_source_type in ('bye', 'unassigned') and away_group_id is null and away_group_rank is null and away_team_id is null and away_source_round_index is null and away_source_match_order is null)
    )
);

comment on table public.competition_knockout_matches is
  'Cup knockout bracket slot structure. This stores slot sources only and does not progress winners automatically.';

create unique index if not exists competition_knockout_matches_position_idx
  on public.competition_knockout_matches (competition_id, round_index, match_order);

create index if not exists competition_knockout_matches_competition_order_idx
  on public.competition_knockout_matches (competition_id, bracket_size, round_index, match_order);

grant select, insert, update, delete
on table public.competition_knockout_matches
to service_role;
