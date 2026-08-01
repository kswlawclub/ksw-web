-- Competition Engine V2 schema foundation.
-- Additive only: legacy knockout setup and public.matches remain unchanged.

alter table public.leagues
  add column if not exists competition_engine_version smallint not null default 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'leagues_competition_engine_version_check'
      and conrelid = 'public.leagues'::regclass
  ) then
    alter table public.leagues
      add constraint leagues_competition_engine_version_check
      check (competition_engine_version in (1, 2));
  end if;
end $$;

create table if not exists public.competition_knockout_configs (
  competition_id uuid primary key,
  entrant_count integer,
  bracket_capacity integer,
  entry_mode text not null default 'bye',
  group_stage_enabled boolean not null default false,
  status text not null default 'draft',
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint competition_knockout_configs_competition_fk
    foreign key (competition_id)
    references public.leagues(id)
    on delete cascade,
  constraint competition_knockout_configs_entry_mode_check
    check (entry_mode in ('bye', 'preliminary', 'custom')),
  constraint competition_knockout_configs_status_check
    check (status in ('draft', 'reviewed', 'fixtures_created', 'active', 'completed')),
  constraint competition_knockout_configs_entrant_count_check
    check (entrant_count is null or (entrant_count >= 2 and entrant_count <= 64)),
  constraint competition_knockout_configs_bracket_capacity_check
    check (bracket_capacity is null or bracket_capacity in (2, 4, 8, 16, 32, 64)),
  constraint competition_knockout_configs_capacity_covers_entrants_check
    check (entrant_count is null or bracket_capacity is null or entrant_count <= bracket_capacity)
);

comment on table public.competition_knockout_configs is
  'Competition Engine V2 knockout configuration. Results remain in public.matches.';

create table if not exists public.competition_bracket_nodes (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null,
  round_index integer not null,
  round_label text not null,
  match_order integer not null,
  bracket_position integer not null,
  home_source_type text not null default 'unassigned',
  away_source_type text not null default 'unassigned',
  home_source_group_id uuid,
  home_source_rank integer,
  home_source_team_id uuid,
  home_source_node_id uuid,
  away_source_group_id uuid,
  away_source_rank integer,
  away_source_team_id uuid,
  away_source_node_id uuid,
  linked_match_id uuid,
  is_locked boolean not null default false,
  is_manual_edited boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint competition_bracket_nodes_competition_fk
    foreign key (competition_id)
    references public.leagues(id)
    on delete cascade,
  constraint competition_bracket_nodes_home_group_fk
    foreign key (home_source_group_id)
    references public.competition_groups(id)
    on delete restrict,
  constraint competition_bracket_nodes_away_group_fk
    foreign key (away_source_group_id)
    references public.competition_groups(id)
    on delete restrict,
  constraint competition_bracket_nodes_home_team_fk
    foreign key (home_source_team_id)
    references public.teams(id)
    on delete restrict,
  constraint competition_bracket_nodes_away_team_fk
    foreign key (away_source_team_id)
    references public.teams(id)
    on delete restrict,
  constraint competition_bracket_nodes_home_source_node_fk
    foreign key (home_source_node_id)
    references public.competition_bracket_nodes(id)
    on delete restrict,
  constraint competition_bracket_nodes_away_source_node_fk
    foreign key (away_source_node_id)
    references public.competition_bracket_nodes(id)
    on delete restrict,
  constraint competition_bracket_nodes_linked_match_fk
    foreign key (linked_match_id)
    references public.matches(id)
    on delete set null,
  constraint competition_bracket_nodes_position_check
    check (round_index >= 0 and match_order >= 1 and bracket_position >= 1),
  constraint competition_bracket_nodes_source_type_check
    check (
      home_source_type in ('group_rank', 'manual_team', 'bye', 'node_winner', 'unassigned')
      and away_source_type in ('group_rank', 'manual_team', 'bye', 'node_winner', 'unassigned')
    ),
  constraint competition_bracket_nodes_source_rank_check
    check (
      (home_source_rank is null or home_source_rank >= 1)
      and (away_source_rank is null or away_source_rank >= 1)
    ),
  constraint competition_bracket_nodes_no_self_source_check
    check (
      (home_source_node_id is null or home_source_node_id <> id)
      and (away_source_node_id is null or away_source_node_id <> id)
    ),
  constraint competition_bracket_nodes_home_source_shape_check
    check (
      (
        home_source_type = 'group_rank'
        and home_source_group_id is not null
        and home_source_rank is not null
        and home_source_team_id is null
        and home_source_node_id is null
      )
      or (
        home_source_type = 'manual_team'
        and home_source_team_id is not null
        and home_source_group_id is null
        and home_source_rank is null
        and home_source_node_id is null
      )
      or (
        home_source_type = 'node_winner'
        and home_source_node_id is not null
        and home_source_group_id is null
        and home_source_rank is null
        and home_source_team_id is null
      )
      or (
        home_source_type in ('bye', 'unassigned')
        and home_source_group_id is null
        and home_source_rank is null
        and home_source_team_id is null
        and home_source_node_id is null
      )
    ),
  constraint competition_bracket_nodes_away_source_shape_check
    check (
      (
        away_source_type = 'group_rank'
        and away_source_group_id is not null
        and away_source_rank is not null
        and away_source_team_id is null
        and away_source_node_id is null
      )
      or (
        away_source_type = 'manual_team'
        and away_source_team_id is not null
        and away_source_group_id is null
        and away_source_rank is null
        and away_source_node_id is null
      )
      or (
        away_source_type = 'node_winner'
        and away_source_node_id is not null
        and away_source_group_id is null
        and away_source_rank is null
        and away_source_team_id is null
      )
      or (
        away_source_type in ('bye', 'unassigned')
        and away_source_group_id is null
        and away_source_rank is null
        and away_source_team_id is null
        and away_source_node_id is null
      )
    )
);

comment on table public.competition_bracket_nodes is
  'Competition Engine V2 bracket topology nodes. Linked match results remain in public.matches.';

create unique index if not exists competition_bracket_nodes_position_unique_idx
  on public.competition_bracket_nodes (competition_id, round_index, match_order);

create unique index if not exists competition_bracket_nodes_linked_match_unique_idx
  on public.competition_bracket_nodes (linked_match_id)
  where linked_match_id is not null;

create index if not exists competition_bracket_nodes_competition_order_idx
  on public.competition_bracket_nodes (competition_id, round_index, match_order);

create index if not exists competition_bracket_nodes_competition_position_idx
  on public.competition_bracket_nodes (competition_id, bracket_position);

create index if not exists competition_bracket_nodes_home_source_node_idx
  on public.competition_bracket_nodes (home_source_node_id);

create index if not exists competition_bracket_nodes_away_source_node_idx
  on public.competition_bracket_nodes (away_source_node_id);

grant select, insert, update, delete
on table public.competition_knockout_configs
to service_role;

grant select, insert, update, delete
on table public.competition_bracket_nodes
to service_role;
