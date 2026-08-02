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
  approval_status text not null default 'draft',
  approved_by uuid,
  approved_by_label text,
  approved_at timestamptz,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint competition_knockout_partitions_key_unique unique (competition_id, partition_key),
  constraint competition_knockout_partitions_entrant_count_check
    check (entrant_count is null or entrant_count between 2 and 64),
  constraint competition_knockout_partitions_bracket_capacity_check
    check (bracket_capacity is null or bracket_capacity in (2, 4, 8, 16, 32, 64)),
  constraint competition_knockout_partitions_status_check
    check (status in ('draft', 'reviewed', 'fixtures_created', 'active', 'completed')),
  constraint competition_knockout_partitions_approval_status_check
    check (approval_status in ('draft', 'approved')),
  constraint competition_knockout_partitions_approval_check
    check (approval_status <> 'approved' or approved_at is not null)
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

-- Writes both Council Cup partitions atomically after the server action validates
-- every entrant against the approved qualification snapshot and participant list.
create or replace function public.save_council_division_partitions_v1(
  p_competition_id uuid,
  p_approval_status text,
  p_partitions jsonb,
  p_approved_by_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  partition_row jsonb;
  partition_key_value text;
begin
  if p_approval_status not in ('draft', 'approved') then
    raise exception 'invalid council division approval status';
  end if;

  if jsonb_typeof(p_partitions) <> 'array' or jsonb_array_length(p_partitions) <> 2 then
    raise exception 'Council Cup requires exactly two division partitions';
  end if;

  if not exists (
    select 1 from public.competition_knockout_configs
    where competition_id = p_competition_id and qualification_status = 'approved'
  ) then
    raise exception 'approved qualification snapshot is required';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_partitions) as partition_value,
      jsonb_array_elements(partition_value -> 'entries') as entry_value
    group by entry_value ->> 'teamId'
    having count(*) > 1
  ) then
    raise exception 'a team cannot be assigned to multiple Council divisions';
  end if;

  update public.competition_knockout_configs
  set template_key = 'council_two_division', updated_at = now()
  where competition_id = p_competition_id;

  for partition_row in select value from jsonb_array_elements(p_partitions)
  loop
    partition_key_value := partition_row ->> 'partitionKey';
    if partition_key_value not in ('division_1', 'division_2') then
      raise exception 'invalid Council division partition key';
    end if;

    insert into public.competition_knockout_partitions (
      competition_id,
      partition_key,
      partition_label,
      entrant_count,
      bracket_capacity,
      qualification_snapshot,
      pairing_snapshot,
      approval_status,
      approved_by_label,
      approved_at,
      status,
      updated_at
    ) values (
      p_competition_id,
      partition_key_value,
      partition_row ->> 'partitionLabel',
      (partition_row ->> 'entrantCount')::integer,
      (partition_row ->> 'bracketCapacity')::integer,
      coalesce(partition_row -> 'entries', '[]'::jsonb),
      coalesce(partition_row -> 'pairingSnapshot', '[]'::jsonb),
      p_approval_status,
      case when p_approval_status = 'approved' then p_approved_by_label else null end,
      case when p_approval_status = 'approved' then now() else null end,
      'draft',
      now()
    )
    on conflict (competition_id, partition_key) do update set
      partition_label = excluded.partition_label,
      entrant_count = excluded.entrant_count,
      bracket_capacity = excluded.bracket_capacity,
      qualification_snapshot = excluded.qualification_snapshot,
      pairing_snapshot = excluded.pairing_snapshot,
      approval_status = excluded.approval_status,
      approved_by = null,
      approved_by_label = excluded.approved_by_label,
      approved_at = excluded.approved_at,
      updated_at = now();
  end loop;

  return jsonb_build_object('ok', true, 'approvalStatus', p_approval_status);
end;
$$;

create or replace function public.reopen_council_division_partitions_v1(p_competition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.competition_bracket_nodes
    where competition_id = p_competition_id
      and partition_key in ('division_1', 'division_2')
  ) then
    raise exception 'Council division brackets already exist';
  end if;

  if exists (
    select 1
    from public.matches
    where league_id = p_competition_id
      and competition_stage = 'knockout'
      and knockout_partition_key in ('division_1', 'division_2')
  ) then
    raise exception 'Council division matches already exist';
  end if;

  update public.competition_knockout_partitions
  set approval_status = 'draft', approved_by = null, approved_by_label = null, approved_at = null, updated_at = now()
  where competition_id = p_competition_id
    and partition_key in ('division_1', 'division_2');

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.save_council_division_partitions_v1(uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.reopen_council_division_partitions_v1(uuid) from public, anon, authenticated;
grant execute on function public.save_council_division_partitions_v1(uuid, text, jsonb, text) to service_role;
grant execute on function public.reopen_council_division_partitions_v1(uuid) to service_role;
