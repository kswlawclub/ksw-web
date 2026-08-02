-- Foundation for reusable knockout templates and independently persisted brackets.
-- Existing KSW Standard records retain the implicit partition key "main".

alter table public.competition_knockout_configs
  add column if not exists template_key text not null default 'ksw_standard';

alter table public.competition_knockout_configs
  drop constraint if exists competition_knockout_configs_template_key_check;

alter table public.competition_knockout_configs
  add constraint competition_knockout_configs_template_key_check
    check (template_key in ('ksw_standard', 'council_two_division'));

create table if not exists public.competition_knockout_partitions (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.leagues(id) on delete cascade,
  partition_key text not null,
  partition_label text not null,
  entrant_count integer,
  bracket_capacity integer,
  qualification_snapshot jsonb not null default '[]'::jsonb,
  pairing_snapshot jsonb not null default '[]'::jsonb,
  champion_team_id uuid references public.teams(id) on delete restrict,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint competition_knockout_partitions_key_unique unique (competition_id, partition_key),
  constraint competition_knockout_partitions_entrant_count_check
    check (entrant_count is null or entrant_count between 2 and 64),
  constraint competition_knockout_partitions_bracket_capacity_check
    check (bracket_capacity is null or bracket_capacity in (2, 4, 8, 16, 32, 64)),
  constraint competition_knockout_partitions_status_check
    check (status in ('draft', 'reviewed', 'fixtures_created', 'active', 'completed'))
);

-- Give every existing V2 configuration its main bracket without rebuilding nodes or matches.
insert into public.competition_knockout_partitions (
  competition_id,
  partition_key,
  partition_label,
  entrant_count,
  bracket_capacity,
  qualification_snapshot,
  status
)
select
  competition_id,
  'main',
  'รอบน็อกเอาต์',
  entrant_count,
  bracket_capacity,
  qualification_snapshot,
  status
from public.competition_knockout_configs
on conflict (competition_id, partition_key) do nothing;

alter table public.competition_bracket_nodes
  add column if not exists partition_key text not null default 'main';

drop index if exists public.competition_bracket_nodes_position_unique_idx;

create unique index if not exists competition_bracket_nodes_partition_position_unique_idx
  on public.competition_bracket_nodes (competition_id, partition_key, round_index, match_order);

create index if not exists competition_bracket_nodes_partition_order_idx
  on public.competition_bracket_nodes (competition_id, partition_key, round_index, match_order);

alter table public.matches
  add column if not exists knockout_partition_key text;

create index if not exists matches_knockout_partition_idx
  on public.matches (league_id, knockout_partition_key)
  where competition_stage = 'knockout';

grant select, insert, update, delete on table public.competition_knockout_partitions to service_role;
