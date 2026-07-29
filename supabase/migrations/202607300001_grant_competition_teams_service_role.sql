-- Grants required for server actions managing competition participants.

grant select, insert, update
on table public.competition_teams
to service_role;
