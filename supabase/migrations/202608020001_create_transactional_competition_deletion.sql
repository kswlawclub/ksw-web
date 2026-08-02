-- Delete one competition and only its owned records. This migration is additive:
-- it does not broaden existing foreign-key cascade behavior.

do $$
declare
  required_table text;
begin
  foreach required_table in array array[
    'public.leagues',
    'public.matches',
    'public.league_standings_snapshots',
    'public.competition_teams',
    'public.competition_groups',
    'public.competition_knockout_matches',
    'public.competition_knockout_configs',
    'public.competition_bracket_nodes'
  ] loop
    if to_regclass(required_table) is null then
      raise exception 'Required table % is missing; competition deletion RPC was not created.', required_table;
    end if;
  end loop;
end $$;

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

revoke all on function public.delete_competition_cascade_v1(uuid, boolean) from public;
revoke all on function public.delete_competition_cascade_v1(uuid, boolean) from anon;
revoke all on function public.delete_competition_cascade_v1(uuid, boolean) from authenticated;
grant execute on function public.delete_competition_cascade_v1(uuid, boolean) to service_role;
