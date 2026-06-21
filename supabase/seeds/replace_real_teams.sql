-- Replace demo teams with the 13 real KSW league teams.
-- Safe to run repeatedly.

begin;

with existing_league as (
  select id
  from public.leagues
  where name = 'Thai Lawyers League Season 6'
  order by created_at
  limit 1
),
target_league as (
  insert into public.leagues (name, season, is_active)
  select 'Thai Lawyers League Season 6', 'Season 6', true
  where not exists (select 1 from existing_league)
  returning id
),
league_row as (
  select id
  from existing_league
  union
  select id
  from target_league
  limit 1
),
old_teams as (
  select id
  from public.teams
  where league_id = (select id from league_row)
),
deleted_gallery as (
  delete from public.gallery_images
  where match_id in (
    select id
    from public.matches
    where league_id = (select id from league_row)
       or home_team_id in (select id from old_teams)
       or away_team_id in (select id from old_teams)
  )
),
deleted_matches as (
  delete from public.matches
  where league_id = (select id from league_row)
     or home_team_id in (select id from old_teams)
     or away_team_id in (select id from old_teams)
),
deleted_members as (
  delete from public.team_members
  where team_id in (select id from old_teams)
),
deleted_teams as (
  delete from public.teams
  where id in (select id from old_teams)
)
insert into public.teams (league_id, name, short_name, logo_url, is_ksw, is_active)
select
  (select id from league_row),
  team_name,
  short_name,
  logo_url,
  is_ksw,
  true
from (
  values
    ('สโมสรทนายความจังหวัดชลบุรี', 'CHON', '/team-logos/chonburi-lawyer.png', false),
    ('ทนายความมหานคร', 'MHL', '/team-logos/mahanakorn-lawyer.png', false),
    ('ทนายความจังหวัดมีนบุรี', 'MIN', '/team-logos/minburi-lawyer.png', false),
    ('ชมรมทนายรัชดา', 'RAT', '/team-logos/ratchada-lawyers.png', false),
    ('ทนายความกรุงเทพ BKK Lawyer', 'BKK', '/team-logos/bkk-lawyer.png', false),
    ('ทนายเมืองชล', 'MCH', '/team-logos/muangchon-lawyer.png', false),
    ('สโมสรฟุตบอลทนายความมีนบุรี', 'MBC', '/team-logos/minburi-club.png', false),
    ('ชมรมทนายความอาสา', 'VOL', '/team-logos/lawyer-volunteer.png', false),
    ('Lawyer Club', 'LWC', '/team-logos/lawyer-club.png', false),
    ('ชมรมทนายความภาคอีสาน', 'NE', '/team-logos/northeast-lawyer.png', false),
    ('ชมรมทนายความคลองสามวา (KSW L.C.)', 'KSW', '/team-logos/ksw-lc.png', true),
    ('สภาทนายความภาค 1', 'R1', '/team-logos/region-1-lawyer.png', false),
    ('Lawyer All Stars', 'LAS', '/team-logos/lawyer-all-stars.png', false)
) as real_teams(team_name, short_name, logo_url, is_ksw);

commit;
