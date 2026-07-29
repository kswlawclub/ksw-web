create table public.competition_teams (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null,
  team_id uuid not null,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  constraint competition_teams_competition_fk
    foreign key (competition_id)
    references public.leagues(id)
    on delete cascade,
  constraint competition_teams_team_fk
    foreign key (team_id)
    references public.teams(id)
    on delete restrict,
  constraint competition_teams_competition_team_unique
    unique (competition_id, team_id),
  constraint competition_teams_display_order_check
    check (display_order >= 0)
);

comment on table public.competition_teams is
  'Links canonical teams to competitions; teams remains the master team registry and one team may join multiple competitions.';

create index competition_teams_competition_active_order_idx
  on public.competition_teams (competition_id, is_active, display_order);

create index competition_teams_team_idx
  on public.competition_teams (team_id);

grant select on public.competition_teams to anon, authenticated;
