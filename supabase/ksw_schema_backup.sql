-- KSW L.C. Supabase schema backup
-- Recreates public demo schema, standings view, grants, and seed data.

create extension if not exists pgcrypto;

drop view if exists public.league_standings_view;

drop table if exists public.news cascade;
drop table if exists public.gallery_images cascade;
drop table if exists public.sponsors cascade;
drop table if exists public.team_members cascade;
drop table if exists public.people cascade;
drop table if exists public.matches cascade;
drop table if exists public.teams cascade;
drop table if exists public.leagues cascade;

create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  season text,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references public.leagues(id) on delete set null,
  name text not null,
  short_name text,
  logo_url text,
  is_ksw boolean not null default false,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now()
);

create table public.people (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  display_name text,
  role text,
  photo_url text,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now()
);

create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  squad_number integer,
  position text,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  unique (team_id, person_id)
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  match_date timestamp with time zone not null,
  home_team_id uuid not null references public.teams(id) on delete cascade,
  away_team_id uuid not null references public.teams(id) on delete cascade,
  home_score integer,
  away_score integer,
  venue text,
  status text not null default 'scheduled',
  match_type text not null default 'league',
  created_at timestamp with time zone not null default now(),
  check (home_team_id <> away_team_id),
  check (home_score is null or home_score >= 0),
  check (away_score is null or away_score >= 0)
);

create table public.sponsors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  logo_url text,
  website_url text,
  tier text,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now()
);

create table public.gallery_images (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references public.matches(id) on delete set null,
  title text,
  image_url text not null,
  alt_text text,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now()
);

create table public.news (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  excerpt text,
  body text,
  cover_image_url text,
  published_at timestamp with time zone,
  is_published boolean not null default false,
  created_at timestamp with time zone not null default now()
);

create view public.league_standings_view as
with team_match_stats as (
  select
    t.id as team_id,
    t.league_id,
    t.name as team_name,
    t.short_name,
    t.logo_url,
    t.is_ksw,
    m.id as match_id,
    case
      when m.status = 'completed' and (m.home_team_id = t.id or m.away_team_id = t.id) then 1
      else 0
    end as played,
    case
      when m.status = 'completed' and m.home_team_id = t.id and m.home_score > m.away_score then 1
      when m.status = 'completed' and m.away_team_id = t.id and m.away_score > m.home_score then 1
      else 0
    end as won,
    case
      when m.status = 'completed' and (m.home_team_id = t.id or m.away_team_id = t.id) and m.home_score = m.away_score then 1
      else 0
    end as drawn,
    case
      when m.status = 'completed' and m.home_team_id = t.id and m.home_score < m.away_score then 1
      when m.status = 'completed' and m.away_team_id = t.id and m.away_score < m.home_score then 1
      else 0
    end as lost,
    case
      when m.status = 'completed' and m.home_team_id = t.id then coalesce(m.home_score, 0)
      when m.status = 'completed' and m.away_team_id = t.id then coalesce(m.away_score, 0)
      else 0
    end as goals_for,
    case
      when m.status = 'completed' and m.home_team_id = t.id then coalesce(m.away_score, 0)
      when m.status = 'completed' and m.away_team_id = t.id then coalesce(m.home_score, 0)
      else 0
    end as goals_against
  from public.teams t
  left join public.matches m
    on m.league_id = t.league_id
   and (m.home_team_id = t.id or m.away_team_id = t.id)
  where t.is_active = true
)
select
  team_id,
  league_id,
  team_name,
  short_name,
  logo_url,
  is_ksw,
  sum(played)::integer as played,
  sum(won)::integer as won,
  sum(drawn)::integer as drawn,
  sum(lost)::integer as lost,
  sum(goals_for)::integer as goals_for,
  sum(goals_against)::integer as goals_against,
  (sum(goals_for) - sum(goals_against))::integer as goal_difference,
  ((sum(won) * 3) + sum(drawn))::integer as points
from team_match_stats
group by team_id, league_id, team_name, short_name, logo_url, is_ksw;

grant usage on schema public to anon, authenticated;
grant select on public.leagues to anon, authenticated;
grant select on public.teams to anon, authenticated;
grant select on public.people to anon, authenticated;
grant select on public.team_members to anon, authenticated;
grant select on public.matches to anon, authenticated;
grant select on public.sponsors to anon, authenticated;
grant select on public.gallery_images to anon, authenticated;
grant select on public.news to anon, authenticated;
grant select on public.league_standings_view to anon, authenticated;

with inserted_league as (
  insert into public.leagues (name, season)
  values ('Thai Lawyers League Season 6', 'Season 6')
  returning id
),
inserted_teams as (
  insert into public.teams (league_id, name, short_name, is_ksw)
  select id, 'KSW L.C.', 'KSW', true from inserted_league
  union all
  select id, 'Justice United', 'JUTD', false from inserted_league
  union all
  select id, 'Lawyer All Stars', 'LAS', false from inserted_league
  union all
  select id, 'Bangkok Lawyers FC', 'BLFC', false from inserted_league
  returning id, name, league_id
),
inserted_matches as (
  insert into public.matches (
    league_id,
    match_date,
    home_team_id,
    away_team_id,
    home_score,
    away_score,
    venue,
    status,
    match_type
  )
  select
    l.id,
    now() - interval '21 days',
    ksw.id,
    justice.id,
    2,
    1,
    'Khlong Sam Wa Stadium',
    'completed',
    'league'
  from inserted_league l
  join inserted_teams ksw on ksw.name = 'KSW L.C.'
  join inserted_teams justice on justice.name = 'Justice United'
  union all
  select
    l.id,
    now() - interval '14 days',
    allstars.id,
    bangkok.id,
    1,
    1,
    'Bangkok Lawyers Ground',
    'completed',
    'league'
  from inserted_league l
  join inserted_teams allstars on allstars.name = 'Lawyer All Stars'
  join inserted_teams bangkok on bangkok.name = 'Bangkok Lawyers FC'
  union all
  select
    l.id,
    now() + interval '7 days',
    ksw.id,
    allstars.id,
    null,
    null,
    'Khlong Sam Wa Stadium',
    'scheduled',
    'league'
  from inserted_league l
  join inserted_teams ksw on ksw.name = 'KSW L.C.'
  join inserted_teams allstars on allstars.name = 'Lawyer All Stars'
  union all
  select
    l.id,
    now() + interval '14 days',
    bangkok.id,
    justice.id,
    null,
    null,
    'Bangkok Lawyers Ground',
    'scheduled',
    'league'
  from inserted_league l
  join inserted_teams bangkok on bangkok.name = 'Bangkok Lawyers FC'
  join inserted_teams justice on justice.name = 'Justice United'
  returning id
)
insert into public.sponsors (name, tier, sort_order, website_url)
values
  ('KSW Legal Group', 'Main Partner', 10, 'https://example.com/ksw-legal-group'),
  ('Bangkok Law Network', 'Gold Partner', 20, 'https://example.com/bangkok-law-network'),
  ('Justice Sportswear', 'Kit Partner', 30, 'https://example.com/justice-sportswear'),
  ('Legal Coffee Club', 'Community Partner', 40, 'https://example.com/legal-coffee-club');
