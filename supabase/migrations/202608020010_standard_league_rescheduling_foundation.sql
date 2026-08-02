-- Original matchweek remains structural; scheduled_matchweek is the effective competition week.
alter table public.matches add column if not exists scheduled_matchweek integer null, add column if not exists reschedule_reason text null, add column if not exists rescheduled_at timestamptz null, add column if not exists rescheduled_by uuid null;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'matches_scheduled_matchweek_check') then alter table public.matches add constraint matches_scheduled_matchweek_check check (scheduled_matchweek is null or scheduled_matchweek between 1 and 99); end if; end $$;
comment on column public.matches.matchweek is 'Original structural Standard League Matchweek; never changed by rescheduling.';
comment on column public.matches.scheduled_matchweek is 'Effective Standard League Matchweek; null means use matchweek.';
create table if not exists public.competition_league_match_reschedules (id uuid primary key default gen_random_uuid(), competition_id uuid not null references public.leagues(id) on delete cascade, match_id uuid not null references public.matches(id) on delete cascade, fixture_version integer null, original_matchweek integer not null, from_scheduled_matchweek integer not null, to_scheduled_matchweek integer not null, reason text not null check (btrim(reason) <> ''), changed_by uuid null, changed_by_label text null, changed_at timestamptz not null default now());
create index if not exists competition_league_match_reschedules_competition_idx on public.competition_league_match_reschedules(competition_id, changed_at desc);
create index if not exists competition_league_match_reschedules_match_idx on public.competition_league_match_reschedules(match_id, changed_at desc);
revoke all on table public.competition_league_match_reschedules from public, anon, authenticated;
grant select, insert, delete on table public.competition_league_match_reschedules to service_role;
create or replace function public.reschedule_standard_league_match_v1(p_competition_id uuid,p_match_id uuid,p_target_matchweek integer,p_reason text,p_acknowledge_conflict boolean default false,p_changed_by uuid default null,p_changed_by_label text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare m public.matches%rowtype; v_type text; v_status text; v_version integer; v_current integer; v_conflicts jsonb; h public.competition_league_match_reschedules%rowtype;
begin
 select competition_type,season_status into v_type,v_status from public.leagues where id=p_competition_id for update; if not found or v_type <> 'league' then raise exception 'invalid_standard_league'; end if; if v_status='completed' then raise exception 'competition_completed'; end if;
 select fixture_version into v_version from public.competition_league_configs where competition_id=p_competition_id and template_key='standard_league' and fixture_status='confirmed' for update; if not found then raise exception 'fixture_not_confirmed'; end if;
 select * into m from public.matches where id=p_match_id and league_id=p_competition_id and league_fixture_version=v_version for update; if not found then raise exception 'match_not_in_fixture_set'; end if; if m.status in ('finished','completed') then raise exception 'match_finished'; end if; if p_target_matchweek not between 1 and 99 or btrim(coalesce(p_reason,''))='' then raise exception 'invalid_reschedule_request'; end if;
 v_current:=coalesce(m.scheduled_matchweek,m.matchweek); if p_target_matchweek=v_current then return jsonb_build_object('success',false,'code','no_change'); end if;
 select coalesce(jsonb_agg(jsonb_build_object('match_id',id,'home_team_id',home_team_id,'away_team_id',away_team_id)),'[]'::jsonb) into v_conflicts from public.matches where league_id=p_competition_id and league_fixture_version=v_version and id<>p_match_id and coalesce(scheduled_matchweek,matchweek)=p_target_matchweek and (home_team_id in (m.home_team_id,m.away_team_id) or away_team_id in (m.home_team_id,m.away_team_id));
 if v_conflicts<>'[]'::jsonb and not p_acknowledge_conflict then return jsonb_build_object('success',false,'code','team_conflict','conflicts',v_conflicts); end if;
 update public.matches set scheduled_matchweek=p_target_matchweek,reschedule_reason=btrim(p_reason),rescheduled_at=now(),rescheduled_by=p_changed_by where id=m.id;
 insert into public.competition_league_match_reschedules(competition_id,match_id,fixture_version,original_matchweek,from_scheduled_matchweek,to_scheduled_matchweek,reason,changed_by,changed_by_label) values(p_competition_id,m.id,v_version,m.matchweek,v_current,p_target_matchweek,btrim(p_reason),p_changed_by,nullif(btrim(p_changed_by_label),'')) returning * into h;
 insert into public.competition_league_matchweeks(competition_id,fixture_version,matchweek,status,updated_at) values(p_competition_id,v_version,v_current,'draft',now()),(p_competition_id,v_version,p_target_matchweek,'draft',now()) on conflict(competition_id,fixture_version,matchweek) do update set status='draft',confirmed_at=null,confirmed_by=null,confirmed_by_label=null,updated_at=excluded.updated_at;
 return jsonb_build_object('success',true,'original_matchweek',m.matchweek,'previous_effective_matchweek',v_current,'new_effective_matchweek',p_target_matchweek,'history',to_jsonb(h),'conflicts_acknowledged',p_acknowledge_conflict);
end; $$;
revoke all on function public.reschedule_standard_league_match_v1(uuid,uuid,integer,text,boolean,uuid,text) from public,anon,authenticated;
grant execute on function public.reschedule_standard_league_match_v1(uuid,uuid,integer,text,boolean,uuid,text) to service_role;

-- Effective Matchweek replacements. Structural matches.matchweek is never updated.
create or replace function public.confirm_standard_league_matchweek_v1(p_competition_id uuid,p_fixture_version integer,p_matchweek integer,p_confirmed_by_label text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_count integer; v_type text; v_status text;
begin
 select competition_type,season_status into v_type,v_status from public.leagues where id=p_competition_id for update;
 if not found or v_type<>'league' or v_status='completed' then raise exception 'invalid_league_confirmation'; end if;
 if not exists(select 1 from public.competition_league_configs where competition_id=p_competition_id and template_key='standard_league' and fixture_status='confirmed' and fixture_version=p_fixture_version for update) then raise exception 'invalid_standard_league_fixture_version'; end if;
 select count(*) into v_count from public.matches where league_id=p_competition_id and league_fixture_version=p_fixture_version and coalesce(scheduled_matchweek,matchweek)=p_matchweek;
 if p_matchweek not between 1 and 99 or v_count=0 then raise exception 'matchweek_not_found'; end if;
 if exists(select 1 from public.matches where league_id=p_competition_id and league_fixture_version=p_fixture_version and coalesce(scheduled_matchweek,matchweek)=p_matchweek and (home_team_id is null or away_team_id is null or home_team_id=away_team_id or status in ('finished','completed'))) then raise exception 'matchweek_pairing_invalid'; end if;
 insert into public.competition_league_matchweeks(competition_id,fixture_version,matchweek,status,confirmed_at,confirmed_by_label,updated_at) values(p_competition_id,p_fixture_version,p_matchweek,'confirmed',now(),nullif(btrim(p_confirmed_by_label),''),now()) on conflict(competition_id,fixture_version,matchweek) do update set status='confirmed',confirmed_at=excluded.confirmed_at,confirmed_by=null,confirmed_by_label=excluded.confirmed_by_label,updated_at=excluded.updated_at;
 return jsonb_build_object('competition_id',p_competition_id,'fixture_version',p_fixture_version,'matchweek',p_matchweek,'match_count',v_count,'status','confirmed');
end; $$;

-- The existing draft RPC retains its pairing/safety validation, scoped by effective week.
create or replace function public.save_standard_league_matchweek_draft_v1(p_competition_id uuid,p_fixture_version integer,p_matchweek integer,p_updates jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_count integer; v_updates integer; v_pairing_changed boolean; v_current_status text;
begin
 if not exists(select 1 from public.leagues where id=p_competition_id and competition_type='league' and season_status<>'completed' for update) then raise exception 'invalid_league_draft_state'; end if;
 if not exists(select 1 from public.competition_league_configs where competition_id=p_competition_id and template_key='standard_league' and fixture_status='confirmed' and fixture_version=p_fixture_version for update) then raise exception 'invalid_standard_league_fixture_version'; end if;
 select count(*) into v_count from public.matches where league_id=p_competition_id and league_fixture_version=p_fixture_version and coalesce(scheduled_matchweek,matchweek)=p_matchweek; select jsonb_array_length(p_updates) into v_updates;
 if p_matchweek not between 1 and 99 or jsonb_typeof(p_updates)<>'array' or v_count=0 or v_updates<>v_count then raise exception 'invalid_matchweek_draft_payload'; end if;
 if exists(with u as(select * from jsonb_to_recordset(p_updates) as x("awayTeamId" uuid,"homeTeamId" uuid,"matchDate" timestamptz,"matchId" uuid,"venue" text)) select 1 from u left join public.matches m on m.id=u."matchId" and m.league_id=p_competition_id and m.league_fixture_version=p_fixture_version and coalesce(m.scheduled_matchweek,m.matchweek)=p_matchweek where m.id is null or u."homeTeamId" is null or u."awayTeamId" is null or u."homeTeamId"=u."awayTeamId" or m.status in ('finished','completed') or m.home_score is not null or m.away_score is not null) then raise exception 'invalid_matchweek_draft_match'; end if;
 select exists(with u as(select * from jsonb_to_recordset(p_updates) as x("awayTeamId" uuid,"homeTeamId" uuid,"matchDate" timestamptz,"matchId" uuid,"venue" text)) select 1 from u join public.matches m on m.id=u."matchId" where u."homeTeamId"<>m.home_team_id or u."awayTeamId"<>m.away_team_id) into v_pairing_changed;
 select status into v_current_status from public.competition_league_matchweeks where competition_id=p_competition_id and fixture_version=p_fixture_version and matchweek=p_matchweek for update;
 update public.matches m set home_team_id=u."homeTeamId",away_team_id=u."awayTeamId",match_date=u."matchDate",venue=nullif(btrim(u."venue"),'') from jsonb_to_recordset(p_updates) as u("awayTeamId" uuid,"homeTeamId" uuid,"matchDate" timestamptz,"matchId" uuid,"venue" text) where m.id=u."matchId" and coalesce(m.scheduled_matchweek,m.matchweek)=p_matchweek;
 insert into public.competition_league_matchweeks(competition_id,fixture_version,matchweek,status,updated_at) values(p_competition_id,p_fixture_version,p_matchweek,case when coalesce(v_current_status,'unconfigured')='confirmed' and not v_pairing_changed then 'confirmed' else 'draft' end,now()) on conflict(competition_id,fixture_version,matchweek) do update set status=case when competition_league_matchweeks.status='confirmed' and not v_pairing_changed then 'confirmed' else 'draft' end,confirmed_at=case when competition_league_matchweeks.status='confirmed' and not v_pairing_changed then competition_league_matchweeks.confirmed_at else null end,confirmed_by=null,confirmed_by_label=case when competition_league_matchweeks.status='confirmed' and not v_pairing_changed then competition_league_matchweeks.confirmed_by_label else null end,updated_at=excluded.updated_at;
 return jsonb_build_object('competition_id',p_competition_id,'fixture_version',p_fixture_version,'matchweek',p_matchweek,'match_count',v_count,'status',case when coalesce(v_current_status,'unconfigured')='confirmed' and not v_pairing_changed then 'confirmed' else 'draft' end);
end; $$;


-- Explicit reschedule-history deletion is required for auditable competition cleanup.
create or replace function public.delete_competition_cascade_v1(
  p_competition_id uuid,
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_competition public.leagues%rowtype;
  v_matches_count integer := 0;
  v_reschedule_history_count integer := 0;
  v_snapshots_count integer := 0;
  v_participants_count integer := 0;
  v_groups_count integer := 0;
  v_legacy_knockout_count integer := 0;
  v_configs_count integer := 0;
  v_nodes_count integer := 0;
  v_deleted_nodes integer := 0;
  v_step_deleted integer := 0;
begin
  select *
  into v_competition
  from public.leagues
  where id = p_competition_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'code', 'not_found',
      'competition_id', p_competition_id,
      'deleted', jsonb_build_object()
    );
  end if;

  select count(*) into v_reschedule_history_count from public.competition_league_match_reschedules where competition_id = p_competition_id;
  select count(*) into v_matches_count from public.matches where league_id = p_competition_id;
  select count(*) into v_snapshots_count from public.league_standings_snapshots where league_id = p_competition_id;
  select count(*) into v_participants_count from public.competition_teams where competition_id = p_competition_id;
  select count(*) into v_groups_count from public.competition_groups where competition_id = p_competition_id;
  select count(*) into v_legacy_knockout_count from public.competition_knockout_matches where competition_id = p_competition_id;
  select count(*) into v_configs_count from public.competition_knockout_configs where competition_id = p_competition_id;
  select count(*) into v_nodes_count from public.competition_bracket_nodes where competition_id = p_competition_id;

  if p_dry_run then
    return jsonb_build_object(
      'success', true,
      'dry_run', true,
      'competition_id', v_competition.id,
      'competition_name', v_competition.name,
      'deleted', jsonb_build_object(
        'competition_league_match_reschedules', v_reschedule_history_count,
        'matches', v_matches_count,
        'league_standings_snapshots', v_snapshots_count,
        'competition_teams', v_participants_count,
        'competition_groups', v_groups_count,
        'competition_knockout_matches', v_legacy_knockout_count,
        'competition_knockout_configs', v_configs_count,
        'competition_bracket_nodes', v_nodes_count,
        'leagues', 1
      )
    );
  end if;

  -- Preserve an explicit auditable deletion count before match FK cleanup.
  delete from public.competition_league_match_reschedules where competition_id = p_competition_id;
  get diagnostics v_reschedule_history_count = row_count;

  -- Matches must go first: group matches intentionally restrict deletion of their group.
  delete from public.matches where league_id = p_competition_id;
  get diagnostics v_matches_count = row_count;

  -- A V2 node can reference a previous node. Delete terminal nodes first so
  -- each statement respects the existing RESTRICT foreign keys.
  loop
    delete from public.competition_bracket_nodes as node
    where node.competition_id = p_competition_id
      and not exists (
        select 1
        from public.competition_bracket_nodes as dependent
        where dependent.home_source_node_id = node.id
           or dependent.away_source_node_id = node.id
      );
    get diagnostics v_step_deleted = row_count;
    v_deleted_nodes := v_deleted_nodes + v_step_deleted;
    exit when v_step_deleted = 0;
  end loop;

  if exists (select 1 from public.competition_bracket_nodes where competition_id = p_competition_id) then
    raise exception using
      errcode = '23503',
      message = 'Competition bracket nodes still have external dependencies.';
  end if;

  delete from public.competition_knockout_matches where competition_id = p_competition_id;
  get diagnostics v_legacy_knockout_count = row_count;

  delete from public.competition_knockout_configs where competition_id = p_competition_id;
  get diagnostics v_configs_count = row_count;

  delete from public.competition_groups where competition_id = p_competition_id;
  get diagnostics v_groups_count = row_count;

  delete from public.competition_teams where competition_id = p_competition_id;
  get diagnostics v_participants_count = row_count;

  delete from public.league_standings_snapshots where league_id = p_competition_id;
  get diagnostics v_snapshots_count = row_count;

  delete from public.leagues where id = p_competition_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Competition disappeared during deletion.';
  end if;

  return jsonb_build_object(
    'success', true,
    'dry_run', false,
    'competition_id', v_competition.id,
    'competition_name', v_competition.name,
    'deleted', jsonb_build_object(
      'competition_league_match_reschedules', v_reschedule_history_count,
      'matches', v_matches_count,
      'league_standings_snapshots', v_snapshots_count,
      'competition_teams', v_participants_count,
      'competition_groups', v_groups_count,
      'competition_knockout_matches', v_legacy_knockout_count,
      'competition_knockout_configs', v_configs_count,
      'competition_bracket_nodes', v_deleted_nodes,
      'leagues', 1
    )
  );
end;
$$;
revoke all on function public.delete_competition_cascade_v1(uuid, boolean) from public, anon, authenticated;
grant execute on function public.delete_competition_cascade_v1(uuid, boolean) to service_role;
