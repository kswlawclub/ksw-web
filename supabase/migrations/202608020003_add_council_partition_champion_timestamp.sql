alter table public.competition_knockout_partitions
  add column if not exists champion_at timestamptz null;

comment on column public.competition_knockout_partitions.champion_at is
  'Timestamp when the partition champion was resolved from its finished final match.';
