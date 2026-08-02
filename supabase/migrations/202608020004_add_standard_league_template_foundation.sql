-- Standard League foundation. Additive only: legacy league reads, standings view,
-- public loaders, Cup workflows, and existing matches remain unchanged.

create table if not exists public.competition_league_configs (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null unique references public.leagues(id) on delete cascade,
  template_key text not null default 'standard_league',
  legs smallint not null default 1,
  win_points smallint not null default 3,
  draw_points smallint not null default 1,
  loss_points smallint not null default 0,
  standings_policy_key text not null default 'standard_league_v1',
  fixture_status text not null default 'draft',
  fixture_version integer not null default 0,
  confirmed_at timestamptz null,
  confirmed_by uuid null,
  confirmed_by_label text null,
  champion_team_id uuid null references public.teams(id) on delete restrict,
  champion_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint competition_league_configs_template_key_check check (template_key = 'standard_league'),
  constraint competition_league_configs_legs_check check (legs in (1, 2)),
  constraint competition_league_configs_points_check check (win_points >= 0 and draw_points >= 0 and loss_points >= 0),
  constraint competition_league_configs_policy_check check (standings_policy_key in ('legacy_season6', 'standard_league_v1')),
  constraint competition_league_configs_fixture_status_check check (fixture_status in ('draft', 'confirmed')),
  constraint competition_league_configs_fixture_version_check check (fixture_version >= 0),
  constraint competition_league_configs_confirmation_check check (fixture_status <> 'confirmed' or confirmed_at is not null)
);

comment on table public.competition_league_configs is
  'Opt-in Standard League template configuration. Existing leagues are not backfilled.';

alter table public.matches
  add column if not exists league_leg smallint null,
  add column if not exists matchweek integer null,
  add column if not exists league_fixture_version integer null,
  add column if not exists league_fixture_key text null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'matches_league_leg_check' and conrelid = 'public.matches'::regclass) then
    alter table public.matches add constraint matches_league_leg_check check (league_leg is null or league_leg in (1, 2));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'matches_matchweek_check' and conrelid = 'public.matches'::regclass) then
    alter table public.matches add constraint matches_matchweek_check check (matchweek is null or matchweek >= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'matches_league_fixture_version_check' and conrelid = 'public.matches'::regclass) then
    alter table public.matches add constraint matches_league_fixture_version_check check (league_fixture_version is null or league_fixture_version >= 1);
  end if;
end $$;

create unique index if not exists matches_standard_league_fixture_identity_unique_idx
  on public.matches (league_id, league_fixture_version, league_leg, league_fixture_key)
  where league_fixture_version is not null
    and league_leg is not null
    and league_fixture_key is not null;

create index if not exists matches_standard_league_matchweek_idx
  on public.matches (league_id, league_fixture_version, matchweek)
  where league_fixture_version is not null;

create or replace function public.confirm_standard_league_fixtures_v1(
  p_competition_id uuid,
  p_fixture_version integer,
  p_expected_fixture_count integer,
  p_fixtures jsonb,
  p_confirmed_by_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_competition_type text;
  v_season_status text;
  v_config public.competition_league_configs%rowtype;
  v_team_count integer;
  v_expected_count integer;
  v_fixture_count integer;
  v_existing_count integer;
begin
  select competition_type, season_status
  into v_competition_type, v_season_status
  from public.leagues
  where id = p_competition_id
  for update;

  if not found then raise exception 'competition_not_found'; end if;
  if v_competition_type is distinct from 'league' then raise exception 'standard_league_requires_league_competition'; end if;
  if v_season_status = 'completed' then raise exception 'competition_completed'; end if;

  select * into v_config
  from public.competition_league_configs
  where competition_id = p_competition_id
  for update;

  if not found then raise exception 'league_config_not_found'; end if;
  if v_config.template_key <> 'standard_league' then raise exception 'invalid_league_template'; end if;

  if v_config.fixture_status = 'confirmed' then
    select count(*) into v_existing_count
    from public.matches
    where league_id = p_competition_id
      and league_fixture_version = v_config.fixture_version;
    return jsonb_build_object('created_count', 0, 'existing_count', v_existing_count, 'fixture_version', v_config.fixture_version);
  end if;

  if p_fixture_version <> v_config.fixture_version + 1 then raise exception 'invalid_fixture_version'; end if;
  if exists (select 1 from public.matches where league_id = p_competition_id) then raise exception 'existing_matches_prevent_standard_league_initialization'; end if;
  if jsonb_typeof(p_fixtures) <> 'array' then raise exception 'fixtures_must_be_an_array'; end if;

  select count(*) into v_team_count
  from public.competition_teams
  where competition_id = p_competition_id and is_active = true;
  if v_team_count < 2 then raise exception 'insufficient_active_participants'; end if;

  v_expected_count := v_team_count * (v_team_count - 1) / 2 * v_config.legs;
  select jsonb_array_length(p_fixtures) into v_fixture_count;
  if p_expected_fixture_count <> v_expected_count or v_fixture_count <> v_expected_count then raise exception 'invalid_fixture_count'; end if;

  if exists (
    with fixtures as (
      select * from jsonb_to_recordset(p_fixtures) as fixture(
        "awayTeamId" uuid, "fixtureKey" text, "homeTeamId" uuid, "leg" smallint, "matchweek" integer, "order" integer, "roundNumber" integer
      )
    )
    select 1 from fixtures
    where "homeTeamId" is null or "awayTeamId" is null or "homeTeamId" = "awayTeamId"
      or "fixtureKey" is null or btrim("fixtureKey") = ''
      or "leg" not in (1, 2) or "leg" > v_config.legs
      or "matchweek" < 1 or "roundNumber" < 1 or "order" < 1
  ) then raise exception 'invalid_fixture_shape'; end if;

  if exists (
    with fixtures as (
      select * from jsonb_to_recordset(p_fixtures) as fixture(
        "awayTeamId" uuid, "fixtureKey" text, "homeTeamId" uuid, "leg" smallint, "matchweek" integer, "order" integer, "roundNumber" integer
      )
    )
    select 1 from fixtures fixture
    left join public.competition_teams home_participant
      on home_participant.competition_id = p_competition_id and home_participant.team_id = fixture."homeTeamId" and home_participant.is_active = true
    left join public.competition_teams away_participant
      on away_participant.competition_id = p_competition_id and away_participant.team_id = fixture."awayTeamId" and away_participant.is_active = true
    where home_participant.team_id is null or away_participant.team_id is null
  ) then raise exception 'fixture_team_is_not_an_active_participant'; end if;

  if exists (
    with fixtures as (
      select * from jsonb_to_recordset(p_fixtures) as fixture(
        "awayTeamId" uuid, "fixtureKey" text, "homeTeamId" uuid, "leg" smallint, "matchweek" integer, "order" integer, "roundNumber" integer
      )
    )
    select 1 from fixtures
    group by "leg", least("homeTeamId"::text, "awayTeamId"::text), greatest("homeTeamId"::text, "awayTeamId"::text)
    having count(*) > 1
  ) then raise exception 'duplicate_pair_in_leg'; end if;

  insert into public.matches (
    league_id, competition_stage, fixture_source, match_date, home_team_id, away_team_id,
    home_score, away_score, venue, status, league_leg, matchweek, league_fixture_version, league_fixture_key
  )
  select
    p_competition_id, 'regular', 'generated', null, fixture."homeTeamId", fixture."awayTeamId",
    null, null, null, 'scheduled', fixture."leg", fixture."matchweek", p_fixture_version, fixture."fixtureKey"
  from jsonb_to_recordset(p_fixtures) as fixture(
    "awayTeamId" uuid, "fixtureKey" text, "homeTeamId" uuid, "leg" smallint, "matchweek" integer, "order" integer, "roundNumber" integer
  )
  order by fixture."order";

  update public.competition_league_configs
  set fixture_status = 'confirmed', fixture_version = p_fixture_version, confirmed_at = now(), confirmed_by_label = nullif(btrim(p_confirmed_by_label), ''), updated_at = now()
  where competition_id = p_competition_id;

  return jsonb_build_object('created_count', v_fixture_count, 'existing_count', 0, 'fixture_version', p_fixture_version);
end;
$$;

revoke all on table public.competition_league_configs from public, anon, authenticated;
grant select, insert, update, delete on table public.competition_league_configs to service_role;
revoke all on function public.confirm_standard_league_fixtures_v1(uuid, integer, integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.confirm_standard_league_fixtures_v1(uuid, integer, integer, jsonb, text) to service_role;
