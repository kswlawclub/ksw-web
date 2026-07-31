-- Add the Cup group-stage data foundation.
-- Competition membership stays in public.competition_teams; matches remain linked by matches.league_id.

create table if not exists public.competition_groups (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null,
  name text not null,
  label text,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint competition_groups_competition_fk
    foreign key (competition_id)
    references public.leagues(id)
    on delete cascade,
  constraint competition_groups_name_check
    check (length(btrim(name)) > 0)
);

comment on table public.competition_groups is
  'Cup group-stage groups scoped to one competition.';

create unique index if not exists competition_groups_competition_name_unique_idx
  on public.competition_groups (competition_id, lower(btrim(name)));

create index if not exists competition_groups_competition_order_idx
  on public.competition_groups (competition_id, sort_order, name);

alter table public.competition_teams
  add column if not exists group_id uuid;

comment on column public.competition_teams.group_id is
  'Nullable Cup group assignment for a competition participant.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'competition_teams_group_fk'
      and conrelid = 'public.competition_teams'::regclass
  ) then
    alter table public.competition_teams
      add constraint competition_teams_group_fk
      foreign key (group_id)
      references public.competition_groups(id)
      on delete set null;
  end if;
end $$;

create index if not exists competition_teams_competition_group_idx
  on public.competition_teams (competition_id, group_id, display_order);

grant select, insert, update, delete
on table public.competition_groups
to service_role;

grant select
on table public.competition_teams
to service_role;

grant update (group_id)
on table public.competition_teams
to service_role;
