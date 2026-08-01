-- Cut over existing cup competitions to the V2 knockout workflow.
-- Legacy knockout setup and public match history remain available for rollback.

update public.leagues
set competition_engine_version = 2
where competition_type = 'cup'
  and competition_engine_version is distinct from 2;
