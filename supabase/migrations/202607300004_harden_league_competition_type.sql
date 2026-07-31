-- Harden the competition format contract used by public.leagues.
-- Keeps existing records intact while giving new records a safe legacy default.

alter table public.leagues
  add column if not exists competition_type text;

alter table public.leagues
  alter column competition_type set default 'league';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'leagues_competition_type_check'
      and conrelid = 'public.leagues'::regclass
  ) then
    alter table public.leagues
      add constraint leagues_competition_type_check
      check (
        competition_type is null
        or competition_type in ('league', 'cup', 'friendly', 'tournament')
      ) not valid;
  end if;
end $$;
