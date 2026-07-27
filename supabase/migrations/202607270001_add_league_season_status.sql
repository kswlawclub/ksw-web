alter table public.leagues
  add column if not exists season_status text not null default 'active';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'leagues_season_status_check'
      and conrelid = 'public.leagues'::regclass
  ) then
    alter table public.leagues
      add constraint leagues_season_status_check
      check (season_status in ('upcoming', 'active', 'completed'));
  end if;
end;
$$;
