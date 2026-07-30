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
  select team_id as id
  from public.competition_teams
  where competition_id = (select id from league_row)
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
deleted_competition_teams as (
  delete from public.competition_teams
  where competition_id = (select id from league_row)
     or team_id in (select id from old_teams)
),
deleted_teams as (
  delete from public.teams
  where id in (select id from old_teams)
),
real_teams as (
  values
    (1, 'สโมสรทนายความจังหวัดชลบุรี', 'CHON', '/team-logos/chonburi-lawyer.png', false),
    (2, 'ทนายความมหานคร', 'MHL', '/team-logos/mahanakorn-lawyer.png', false),
    (3, 'ทนายความจังหวัดมีนบุรี', 'MIN', '/team-logos/minburi-lawyer.png', false),
    (4, 'ชมรมทนายรัชดา', 'RAT', '/team-logos/ratchada-lawyers.png', false),
    (5, 'ทนายความกรุงเทพ BKK Lawyer', 'BKK', '/team-logos/bkk-lawyer.png', false),
    (6, 'ทนายเมืองชล', 'MCH', '/team-logos/muangchon-lawyer.png', false),
    (7, 'สโมสรฟุตบอลทนายความมีนบุรี', 'MBC', '/team-logos/minburi-club.png', false),
    (8, 'ชมรมทนายความอาสา', 'VOL', '/team-logos/lawyer-volunteer.png', false),
    (9, 'Lawyer Club', 'LWC', '/team-logos/lawyer-club.png', false),
    (10, 'ชมรมทนายความภาคอีสาน', 'NE', '/team-logos/northeast-lawyer.png', false),
    (11, 'ชมรมทนายความคลองสามวา (KSW L.C.)', 'KSW', '/team-logos/ksw-lc.png', true),
    (12, 'สภาทนายความภาค 1', 'R1', '/team-logos/region-1-lawyer.png', false),
    (13, 'Lawyer All Stars', 'LAS', '/team-logos/lawyer-all-stars.png', false)
) as real_teams(display_order, team_name, short_name, logo_url, is_ksw),
inserted_teams as (
  insert into public.teams (name, short_name, logo_url, is_ksw, is_active)
  select
    team_name,
    short_name,
    logo_url,
    is_ksw,
    true
  from real_teams
  order by display_order
  returning id, name
)
insert into public.competition_teams (competition_id, team_id, is_active, display_order)
select
  (select id from league_row),
  inserted_teams.id,
  true,
  real_teams.display_order
from inserted_teams
join real_teams on real_teams.team_name = inserted_teams.name
on conflict (competition_id, team_id) do update
set
  is_active = excluded.is_active,
  display_order = excluded.display_order;

commit;
