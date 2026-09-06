-- Run the whole script as postgres/table owner after Phase 5A. No writes or seeds.
-- Catalog contracts work on an empty table; existing-data probes return booleans only.
-- Role simulation checks database access, not an HTTP/PostgREST or Admin UI workflow.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;
SET LOCAL search_path = pg_catalog, public;

DO $verify$
DECLARE
  rating_table oid := to_regclass('public.club_member_football_ratings');
  member_table oid := to_regclass('public.club_members');
  updated_at_function oid := to_regprocedure('public.set_updated_at()');
  updated_at_body_pattern CONSTANT text := '^beginnew\.updated_at(:=|=)((pg_catalog\.)?(now|transaction_timestamp)\(\)|current_timestamp);returnnew;end;$';
  audit_role name := current_user;
  public_columns CONSTANT text[] := ARRAY[
    'id', 'nickname', 'photo_url', 'shirt_number', 'birth_year_be',
    'is_active', 'lineup_enabled', 'created_at', 'membership_type', 'club_role'
  ];
  stats CONSTANT text[] := ARRAY['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical',
    'gk_diving', 'gk_handling', 'gk_kicking', 'gk_reflexes', 'gk_speed', 'gk_positioning'];
  table_privileges text[] := ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  checks jsonb := '{}'::jsonb;
  details jsonb := '{}'::jsonb;
  failed_checks jsonb;
  spec record;
  role_name text;
  role_oid oid;
  column_name text;
  expression text;
  shape_expression text;
  overall_expression text;
  synthetic_row jsonb;
  probe_row jsonb;
  selected_stats text[];
  rating_kind text;
  stat_name text;
  shape_probes_ok boolean := true;
  overall_probes_ok boolean := true;
  probe_ok boolean;
  probe_overall integer;
  test_sum integer;
  remainder integer;
  expected_shape CONSTANT text := $shape$
    (rating_type = 'player'
      AND pace IS NOT NULL AND shooting IS NOT NULL AND passing IS NOT NULL
      AND dribbling IS NOT NULL AND defending IS NOT NULL AND physical IS NOT NULL
      AND gk_diving IS NULL AND gk_handling IS NULL AND gk_kicking IS NULL
      AND gk_reflexes IS NULL AND gk_speed IS NULL AND gk_positioning IS NULL)
    OR
    (rating_type = 'goalkeeper'
      AND gk_diving IS NOT NULL AND gk_handling IS NOT NULL AND gk_kicking IS NOT NULL
      AND gk_reflexes IS NOT NULL AND gk_speed IS NOT NULL AND gk_positioning IS NOT NULL
      AND pace IS NULL AND shooting IS NULL AND passing IS NULL
      AND dribbling IS NULL AND defending IS NULL AND physical IS NULL)
  $shape$;
  expected_overall CONSTANT text := $overall$
    CASE WHEN rating_type = 'player' THEN
      round((pace + shooting + passing + dribbling + defending + physical)::numeric / 6)::integer
    ELSE
      round((gk_diving + gk_handling + gk_kicking + gk_reflexes + gk_speed + gk_positioning)::numeric / 6)::integer
    END
  $overall$;
  normalize_pattern CONSTANT text := '[[:space:]()]|::(text|smallint|integer|numeric)';
  can_audit boolean;
  expected_visible_ids uuid[];
  actual_visible_ids uuid[];
  query_ok boolean;
  denials_ok boolean;
  privacy_ok boolean;
  policy_ok boolean;
  rows_ok boolean;
  member_id_att smallint;
  parent_id_att smallint;
BEGIN
  IF current_setting('transaction_read_only') <> 'on'
    OR current_setting('transaction_isolation') <> 'repeatable read' THEN
    RAISE EXCEPTION 'Verifier requires REPEATABLE READ, READ ONLY.';
  END IF;
  IF current_setting('server_version_num')::integer >= 170000 THEN
    table_privileges := array_append(table_privileges, 'MAINTAIN');
  END IF;
  checks := jsonb_build_object('rating_table_exists', rating_table IS NOT NULL, 'club_members_exists', member_table IS NOT NULL);
  checks := checks || jsonb_build_object(
    'existing_updated_at_function', updated_at_function IS NOT NULL,
    'existing_updated_at_function_compatible', EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
      WHERE p.oid = updated_at_function AND p.prokind = 'f' AND p.pronargs = 0
        AND p.prorettype = 'trigger'::regtype AND NOT p.proretset AND l.lanname = 'plpgsql'
        AND regexp_replace(lower(p.prosrc), '[[:space:]]', '', 'g') ~ updated_at_body_pattern
    ),
    'existing_member_updated_at_trigger', EXISTS (
      SELECT 1 FROM pg_trigger t WHERE t.tgrelid = member_table AND NOT t.tgisinternal
        AND t.tgname = 'set_club_members_updated_at' AND t.tgfoid = updated_at_function
        AND t.tgenabled IN ('O', 'A')
    )
  );

  IF rating_table IS NOT NULL AND member_table IS NOT NULL THEN
    SELECT bool_and(r.rolsuper OR r.rolbypassrls OR (c.relowner = r.oid AND NOT c.relforcerowsecurity))
      INTO can_audit FROM pg_class c CROSS JOIN pg_roles r
      WHERE c.oid IN (rating_table, member_table) AND r.rolname = audit_role;
    checks := checks || jsonb_build_object(
      'audit_can_see_all_rows', COALESCE(can_audit, false),
      'rating_rls_enabled', (SELECT relrowsecurity FROM pg_class WHERE oid = rating_table),
      'member_rls_enabled', (SELECT relrowsecurity FROM pg_class WHERE oid = member_table),
      'exact_column_count', (SELECT count(*) = 17 FROM pg_attribute WHERE attrelid = rating_table AND attnum > 0 AND NOT attisdropped)
    );

    FOR spec IN
      SELECT * FROM (VALUES
        ('member_id', 'uuid', true, ''), ('rating_type', 'text', true, ''),
        ('overall', 'integer', true, 's'), ('created_at', 'timestamp with time zone', true, ''),
        ('updated_at', 'timestamp with time zone', true, '')
      ) AS columns(name, sql_type, required, generated)
      UNION ALL SELECT name, 'smallint', false, '' FROM unnest(stats) AS names(name)
    LOOP
      checks := checks || jsonb_build_object('column.' || spec.name, EXISTS (
        SELECT 1 FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = rating_table AND a.attname = spec.name AND NOT a.attisdropped
          AND format_type(a.atttypid, a.atttypmod) = spec.sql_type AND a.attnotnull = spec.required
          AND a.attgenerated::text = spec.generated AND a.attidentity = ''
          AND CASE WHEN spec.name IN ('created_at', 'updated_at') THEN pg_get_expr(d.adbin, d.adrelid) = 'now()'
            WHEN spec.name = 'overall' THEN d.oid IS NOT NULL ELSE d.oid IS NULL END
      ));
    END LOOP;
    SELECT attnum INTO member_id_att FROM pg_attribute WHERE attrelid = rating_table AND attname = 'member_id' AND NOT attisdropped;
    SELECT attnum INTO parent_id_att FROM pg_attribute WHERE attrelid = member_table AND attname = 'id' AND NOT attisdropped;
    checks := checks || jsonb_build_object(
      'one_to_one_primary_key', EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_index i ON i.indexrelid = c.conindid
        WHERE c.conrelid = rating_table AND c.contype = 'p' AND c.conkey = ARRAY[member_id_att]
          AND c.convalidated AND NOT c.condeferrable AND i.indisvalid AND i.indisunique),
      'member_fk_restrict', EXISTS (SELECT 1 FROM pg_constraint c
        WHERE c.conrelid = rating_table AND c.contype = 'f' AND c.confrelid = member_table
          AND c.conkey = ARRAY[member_id_att] AND c.confkey = ARRAY[parent_id_att]
          AND c.confdeltype = 'r' AND c.confupdtype = 'a' AND c.convalidated AND NOT c.condeferrable)
    );

    FOR spec IN
      SELECT 'cmfr_rating_type' AS name, $type$rating_type = ANY (ARRAY['player'::text, 'goalkeeper'::text])$type$ AS expected
      UNION ALL SELECT 'cmfr_stat_shape', expected_shape
      UNION ALL SELECT 'cmfr_' || name || '_range', format('%I >= 1 AND %I <= 99', name, name) FROM unnest(stats) AS names(name)
    LOOP
      SELECT pg_get_expr(c.conbin, c.conrelid) INTO expression FROM pg_constraint c
        WHERE c.conrelid = rating_table AND c.conname = spec.name AND c.contype = 'c' AND c.convalidated;
      checks := checks || jsonb_build_object('constraint.' || spec.name,
        COALESCE(regexp_replace(expression, normalize_pattern, '', 'g') = regexp_replace(spec.expected, normalize_pattern, '', 'g'), false));
    END LOOP;
    SELECT pg_get_expr(d.adbin, d.adrelid) INTO expression FROM pg_attribute a
      JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = rating_table AND a.attname = 'overall' AND a.attgenerated = 's';
    checks := checks || jsonb_build_object('overall_exact_generated_expression',
      -- Preserve the numeric sum cast: removing it would silently allow integer division.
      COALESCE(replace(regexp_replace(expression, '[[:space:]()]|::text', '', 'g'), '/6::numeric', '/6')
        = regexp_replace(expected_overall, '[[:space:]()]|::text', '', 'g'), false));
    overall_expression := expression;
    SELECT pg_get_expr(c.conbin, c.conrelid) INTO shape_expression FROM pg_constraint c
      WHERE c.conrelid = rating_table AND c.conname = 'cmfr_stat_shape' AND c.contype = 'c' AND c.convalidated;
    BEGIN
      IF shape_expression IS NULL OR overall_expression IS NULL THEN
        shape_probes_ok := false;
        overall_probes_ok := false;
      ELSE
        -- Composite values only: jsonb_populate_record does not insert a table row.
        FOREACH rating_kind IN ARRAY ARRAY['player', 'goalkeeper'] LOOP
          selected_stats := CASE WHEN rating_kind = 'player' THEN stats[1:6] ELSE stats[7:12] END;
          synthetic_row := jsonb_build_object('rating_type', rating_kind);
          FOREACH stat_name IN ARRAY selected_stats LOOP
            synthetic_row := synthetic_row || jsonb_build_object(stat_name, 50);
          END LOOP;
          EXECUTE 'SELECT (' || shape_expression || ') IS TRUE FROM jsonb_populate_record(NULL::public.club_member_football_ratings, $1)'
            INTO probe_ok USING synthetic_row;
          shape_probes_ok := shape_probes_ok AND probe_ok;
          FOREACH stat_name IN ARRAY stats LOOP
            probe_row := synthetic_row || jsonb_build_object(stat_name, CASE WHEN stat_name = ANY(selected_stats) THEN NULL ELSE 50 END);
            -- NULL/unknown is accepted by SQL CHECK, so invalid shapes must be FALSE, not merely not TRUE.
            EXECUTE 'SELECT (' || shape_expression || ') IS FALSE FROM jsonb_populate_record(NULL::public.club_member_football_ratings, $1)'
              INTO probe_ok USING probe_row;
            shape_probes_ok := shape_probes_ok AND probe_ok;
          END LOOP;
          FOREACH test_sum IN ARRAY ARRAY[6, 7, 8, 9, 11, 12, 297, 591, 594] LOOP
            probe_row := jsonb_build_object('rating_type', rating_kind);
            remainder := test_sum - 6;
            FOREACH stat_name IN ARRAY selected_stats LOOP
              probe_row := probe_row || jsonb_build_object(stat_name, 1 + least(remainder, 98));
              remainder := greatest(remainder - 98, 0);
            END LOOP;
            EXECUTE 'SELECT ' || overall_expression || ' FROM jsonb_populate_record(NULL::public.club_member_football_ratings, $1)'
              INTO probe_overall USING probe_row;
            overall_probes_ok := overall_probes_ok AND (probe_overall IS NOT DISTINCT FROM round(test_sum::numeric / 6)::integer);
          END LOOP;
        END LOOP;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      shape_probes_ok := false;
      overall_probes_ok := false;
      details := details || jsonb_build_object('expression_probe_error_sqlstate', SQLSTATE);
    END;
    checks := checks || jsonb_build_object('stat_shape_synthetic_probes', shape_probes_ok, 'overall_synthetic_probes', overall_probes_ok);
    checks := checks || jsonb_build_object('timestamp_trigger',
      (SELECT count(*) = 1 FROM pg_trigger WHERE tgrelid = rating_table AND NOT tgisinternal)
      AND EXISTS (SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = rating_table AND NOT t.tgisinternal AND t.tgtype = 19 AND t.tgenabled = 'O'
          AND t.tgnargs = 0 AND t.tgqual IS NULL AND t.tgattr::text = ''
          AND t.tgname = 'club_member_football_ratings_updated_at' AND t.tgfoid = updated_at_function)
    );

    -- Exact sole SELECT policy, rather than just a name or a vacuous empty-table probe.
    SELECT count(*) = 1 AND bool_and(p.polcmd = 'r' AND p.polpermissive AND p.polwithcheck IS NULL
      AND ARRAY(SELECT id FROM unnest(p.polroles) AS roles(id) ORDER BY id)
        = ARRAY(SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated') ORDER BY oid)
      AND regexp_replace(pg_get_expr(p.polqual, p.polrelid), '[[:space:]()]', '', 'g')
        = 'EXISTSSELECT1FROMclub_membersmWHEREm.id=club_member_football_ratings.member_idANDm.is_activeISTRUE')
      INTO policy_ok FROM pg_policy p WHERE p.polrelid = rating_table;
    checks := checks || jsonb_build_object('rating_active_only_policy_contract', COALESCE(policy_ok, false));

    BEGIN
      -- Retain IDs internally to compare the complete visible set, never return them.
      EXECUTE 'SELECT COALESCE(array_agg(r.member_id ORDER BY r.member_id), ARRAY[]::uuid[]) FROM public.club_member_football_ratings r JOIN public.club_members m ON m.id = r.member_id WHERE m.is_active IS TRUE'
        INTO expected_visible_ids;
      EXECUTE 'SELECT NOT EXISTS (SELECT 1 FROM public.club_member_football_ratings WHERE overall IS DISTINCT FROM (' || expected_overall || '))' INTO rows_ok;
      checks := checks || jsonb_build_object('stored_overall_consistent', rows_ok AND can_audit);
    EXCEPTION WHEN OTHERS THEN
      checks := checks || jsonb_build_object('stored_overall_consistent', false);
      details := details || jsonb_build_object('owner_probe_error_sqlstate', SQLSTATE);
    END;

    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      SELECT oid INTO role_oid FROM pg_roles WHERE rolname = role_name;
      checks := checks || jsonb_build_object(role_name || '.exists', role_oid IS NOT NULL);
      IF role_oid IS NULL THEN CONTINUE; END IF;
      checks := checks || jsonb_build_object(
        role_name || '.schema_usage', has_schema_privilege(role_oid, 'public', 'USAGE'),
        role_name || '.rating_privileges_exact', (SELECT bool_and(has_table_privilege(role_oid, rating_table, p)
          IS NOT DISTINCT FROM (role_name = 'service_role' OR p = 'SELECT')) FROM unnest(table_privileges) AS privileges(p)),
        role_name || '.rls_role', (SELECT CASE WHEN role_name = 'service_role' THEN rolbypassrls
          ELSE NOT rolsuper AND NOT rolbypassrls AND oid <> (SELECT relowner FROM pg_class WHERE oid = rating_table) END FROM pg_roles WHERE oid = role_oid)
      );
      IF role_name <> 'service_role' THEN
        checks := checks || jsonb_build_object(role_name || '.no_rating_column_writes_or_grant', NOT EXISTS (
          SELECT 1 FROM pg_attribute a CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'REFERENCES', 'SELECT WITH GRANT OPTION']) AS privileges(p)
          WHERE a.attrelid = rating_table AND a.attnum > 0 AND NOT a.attisdropped
            AND has_column_privilege(role_oid, rating_table, a.attnum, p)
        ));
        -- Do not rerun Phase 1's obsolete ordinary-only backfill assertion after staff imports.
        SELECT NOT EXISTS (SELECT 1 FROM unnest(table_privileges) AS privileges(p) WHERE has_table_privilege(role_oid, member_table, p))
          AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = member_table AND a.attnum > 0 AND NOT a.attisdropped
            AND has_column_privilege(role_oid, member_table, a.attnum, 'SELECT') IS DISTINCT FROM (a.attname::text = ANY(public_columns)))
          AND NOT EXISTS (SELECT 1 FROM pg_attribute a CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'REFERENCES', 'SELECT WITH GRANT OPTION']) AS privileges(p)
            WHERE a.attrelid = member_table AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege(role_oid, member_table, a.attnum, p))
          AND (SELECT count(*) = cardinality(public_columns) FROM pg_attribute WHERE attrelid = member_table AND attname::text = ANY(public_columns) AND NOT attisdropped)
          AND (SELECT count(*) = 2 FROM pg_attribute WHERE attrelid = member_table AND attname IN ('phone', 'lawyer_license_no') AND NOT attisdropped)
          INTO privacy_ok;
        checks := checks || jsonb_build_object(role_name || '.member_privacy_exact', privacy_ok);

        WITH applicable AS (
          SELECT p.polpermissive, regexp_replace(COALESCE(pg_get_expr(p.polqual, p.polrelid), ''), '[[:space:]()]', '', 'g')
            IN ('is_active', 'is_active=true', 'true=is_active', 'is_activeISTRUE') AS active_only
          FROM pg_policy p WHERE p.polrelid = member_table AND p.polcmd IN ('r', '*')
            AND (0::oid = ANY(p.polroles) OR EXISTS (SELECT 1 FROM unnest(p.polroles) AS roles(id)
              WHERE CASE WHEN id = 0::oid THEN false ELSE pg_has_role(role_oid, id, 'USAGE') END))
        )
        SELECT COALESCE(bool_or(polpermissive), false) AND (
          NOT COALESCE(bool_or(polpermissive AND NOT active_only), false)
          OR COALESCE(bool_or(NOT polpermissive AND active_only), false)
        ) INTO policy_ok FROM applicable;
        checks := checks || jsonb_build_object(role_name || '.member_active_only_policy', policy_ok);
      ELSE
        checks := checks || jsonb_build_object('service_role.member_privileges_intact',
          (SELECT bool_and(has_table_privilege(role_oid, member_table, p)) FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS privileges(p)),
          'service_role.timestamp_function_access', has_function_privilege(role_oid, updated_at_function, 'EXECUTE'));
      END IF;

      query_ok := false;
      denials_ok := true;
      BEGIN
        PERFORM set_config('request.jwt.claims', jsonb_build_object('role', role_name)::text, true);
        PERFORM set_config('request.jwt.claim.role', role_name, true);
        PERFORM set_config('request.jwt.claim.sub', '', true);
        EXECUTE format('SET LOCAL ROLE %I', role_name);
        EXECUTE 'SELECT * FROM public.club_member_football_ratings LIMIT 0';
        IF role_name <> 'service_role' THEN
          EXECUTE 'SELECT COALESCE(array_agg(member_id ORDER BY member_id), ARRAY[]::uuid[]) FROM public.club_member_football_ratings' INTO actual_visible_ids;
          query_ok := actual_visible_ids IS NOT DISTINCT FROM expected_visible_ids AND can_audit AND expected_visible_ids IS NOT NULL;
          FOREACH column_name IN ARRAY ARRAY['phone', 'lawyer_license_no'] LOOP
            BEGIN
              EXECUTE format('SELECT %I FROM public.club_members LIMIT 0', column_name);
              denials_ok := false;
            EXCEPTION WHEN OTHERS THEN
              IF SQLSTATE <> '42501' THEN denials_ok := false; END IF;
            END;
          END LOOP;
        ELSE
          EXECUTE 'SELECT * FROM public.club_members LIMIT 0';
          query_ok := true;
        END IF;
        EXECUTE format('SET LOCAL ROLE %I', audit_role);
      EXCEPTION WHEN OTHERS THEN
        query_ok := false;
        denials_ok := false;
        details := details || jsonb_build_object(role_name || '.probe_error_sqlstate', SQLSTATE);
      END;
      checks := checks || jsonb_build_object(role_name || '.select_and_row_visibility_probe', COALESCE(query_ok, false));
      IF role_name <> 'service_role' THEN
        checks := checks || jsonb_build_object(role_name || '.sensitive_member_columns_denied_42501', denials_ok);
      END IF;
    END LOOP;
  END IF;

  SELECT COALESCE(jsonb_agg(key ORDER BY key), '[]'::jsonb) INTO failed_checks
    FROM jsonb_each(checks) WHERE value IS DISTINCT FROM 'true'::jsonb;
  details := details || jsonb_build_object('checks', checks,
    'updated_at_function', 'public.set_updated_at(); existing generic timestamp setter, shared with club_members. Unknown bodies require read-only review.',
    'scope', 'Phase 5A catalog + existing-row visibility only; no seeds, member values, or mutations.',
    'inactive_visibility', 'Exact active-only policy plus owner/public visible-ID set comparison, including an empty ratings table.',
    'public_safe_member_columns', public_columns);
  PERFORM set_config('ksw_audit.football_rating_verification', jsonb_build_object(
    'overall_pass', jsonb_array_length(failed_checks) = 0, 'failed_checks', failed_checks, 'details', details
  )::text, true);
END;
$verify$;

SELECT (report->>'overall_pass')::boolean AS overall_pass, report->'failed_checks' AS failed_checks, report->'details' AS details
FROM (SELECT current_setting('ksw_audit.football_rating_verification')::jsonb AS report) result;
ROLLBACK;
