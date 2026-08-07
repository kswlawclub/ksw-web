-- Explicit public map links belong to the competition-level location.
alter table public.leagues
  add column if not exists location_maps_url text;
