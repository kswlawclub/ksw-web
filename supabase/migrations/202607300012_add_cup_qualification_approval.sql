-- Stores the approved cup qualification result before a V2 knockout tree is created.
alter table public.competition_knockout_configs
  add column if not exists extra_rank_enabled boolean not null default false,
  add column if not exists extra_rank smallint,
  add column if not exists extra_qualifier_count smallint not null default 0,
  add column if not exists cross_group_tiebreak_mode text not null default 'points_gd_gf_wins',
  add column if not exists qualification_status text not null default 'pending',
  add column if not exists qualification_approved_by uuid,
  add column if not exists qualification_approved_by_label text,
  add column if not exists qualification_approved_at timestamptz,
  add column if not exists qualification_snapshot jsonb not null default '[]'::jsonb;

alter table public.competition_knockout_configs
  drop constraint if exists competition_knockout_configs_qualification_status_check,
  drop constraint if exists competition_knockout_configs_qualification_approval_check,
  drop constraint if exists competition_knockout_configs_extra_qualifier_check;

alter table public.competition_knockout_configs
  add constraint competition_knockout_configs_qualification_status_check
    check (qualification_status in ('pending', 'approved')),
  add constraint competition_knockout_configs_qualification_approval_check
    check (qualification_status <> 'approved' or qualification_approved_at is not null),
  add constraint competition_knockout_configs_extra_qualifier_check
    check (
      extra_qualifier_count >= 0
      and (not extra_rank_enabled or (extra_rank is not null and extra_rank >= 1 and extra_qualifier_count > 0))
      and (extra_rank_enabled or (extra_rank is null and extra_qualifier_count = 0))
    );

alter table public.competition_bracket_nodes
  add column if not exists home_source_best_order smallint,
  add column if not exists away_source_best_order smallint;

alter table public.competition_bracket_nodes
  drop constraint if exists competition_bracket_nodes_source_type_check,
  drop constraint if exists competition_bracket_nodes_home_source_shape_check,
  drop constraint if exists competition_bracket_nodes_away_source_shape_check;

alter table public.competition_bracket_nodes
  add constraint competition_bracket_nodes_source_type_check
    check (
      home_source_type in ('group_rank', 'best_ranked', 'manual_team', 'bye', 'node_winner', 'unassigned')
      and away_source_type in ('group_rank', 'best_ranked', 'manual_team', 'bye', 'node_winner', 'unassigned')
    ),
  add constraint competition_bracket_nodes_home_source_shape_check
    check (
      (home_source_type = 'group_rank' and home_source_group_id is not null and home_source_rank is not null and home_source_team_id is null and home_source_node_id is null and home_source_best_order is null)
      or (home_source_type = 'best_ranked' and home_source_group_id is null and home_source_rank is not null and home_source_team_id is not null and home_source_node_id is null and home_source_best_order is not null)
      or (home_source_type = 'manual_team' and home_source_team_id is not null and home_source_group_id is null and home_source_rank is null and home_source_node_id is null and home_source_best_order is null)
      or (home_source_type = 'node_winner' and home_source_node_id is not null and home_source_group_id is null and home_source_rank is null and home_source_team_id is null and home_source_best_order is null)
      or (home_source_type in ('bye', 'unassigned') and home_source_group_id is null and home_source_rank is null and home_source_team_id is null and home_source_node_id is null and home_source_best_order is null)
    ),
  add constraint competition_bracket_nodes_away_source_shape_check
    check (
      (away_source_type = 'group_rank' and away_source_group_id is not null and away_source_rank is not null and away_source_team_id is null and away_source_node_id is null and away_source_best_order is null)
      or (away_source_type = 'best_ranked' and away_source_group_id is null and away_source_rank is not null and away_source_team_id is not null and away_source_node_id is null and away_source_best_order is not null)
      or (away_source_type = 'manual_team' and away_source_team_id is not null and away_source_group_id is null and away_source_rank is null and away_source_node_id is null and away_source_best_order is null)
      or (away_source_type = 'node_winner' and away_source_node_id is not null and away_source_group_id is null and away_source_rank is null and away_source_team_id is null and away_source_best_order is null)
      or (away_source_type in ('bye', 'unassigned') and away_source_group_id is null and away_source_rank is null and away_source_team_id is null and away_source_node_id is null and away_source_best_order is null)
    );
