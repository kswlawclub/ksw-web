-- Stores how many teams qualify from each cup group.

alter table public.competition_groups
  add column if not exists qualifiers_count integer not null default 2;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'competition_groups_qualifiers_count_check'
      and conrelid = 'public.competition_groups'::regclass
  ) then
    alter table public.competition_groups
      add constraint competition_groups_qualifiers_count_check
      check (qualifiers_count >= 0);
  end if;
end $$;
