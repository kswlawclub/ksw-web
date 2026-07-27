alter table public.leagues
  add column if not exists slug text,
  add column if not exists short_description text,
  add column if not exists description text,
  add column if not exists cover_image_url text,
  add column if not exists edition_number integer,
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists location text,
  add column if not exists display_order integer not null default 0,
  add column if not exists is_featured boolean not null default false,
  add column if not exists is_published boolean not null default true;

create unique index if not exists leagues_slug_unique_idx
  on public.leagues (slug)
  where slug is not null;

update public.leagues
set slug = 'thai-lawyers-league-season-6'
where slug is null
  and name = 'Thai Lawyers League Season 6'
  and season = 'Season 6';
