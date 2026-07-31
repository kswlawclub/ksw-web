-- Adds group-stage fixture metadata while preserving existing match history.

alter table public.matches
  add column if not exists group_id uuid,
  add column if not exists competition_stage text not null default 'regular',
  add column if not exists fixture_source text not null default 'manual';

alter table public.matches
  alter column match_date drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'matches_group_id_fkey'
      and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches
      add constraint matches_group_id_fkey
      foreign key (group_id)
      references public.competition_groups(id)
      on delete restrict;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'matches_competition_stage_check'
      and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches
      add constraint matches_competition_stage_check
      check (competition_stage in ('regular', 'group', 'knockout'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'matches_fixture_source_check'
      and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches
      add constraint matches_fixture_source_check
      check (fixture_source in ('manual', 'generated'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'matches_group_stage_requires_group_check'
      and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches
      add constraint matches_group_stage_requires_group_check
      check (
        (competition_stage <> 'group' and group_id is null)
        or (competition_stage = 'group' and group_id is not null)
      );
  end if;
end $$;

create unique index if not exists matches_group_single_round_pair_unique_idx
  on public.matches (
    league_id,
    group_id,
    least(home_team_id::text, away_team_id::text),
    greatest(home_team_id::text, away_team_id::text)
  )
  where group_id is not null
    and competition_stage = 'group';

create index if not exists matches_group_stage_idx
  on public.matches (league_id, group_id, competition_stage, match_date);
