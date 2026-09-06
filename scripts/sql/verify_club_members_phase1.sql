-- Run immediately after Member Foundation Phase 1, before staff imports or role edits.
-- Run the WHOLE script as postgres/table owner; it returns one compact result row.
-- Column/query probes use LIMIT 0. Row probes return only internal counts/booleans.
-- No member values are returned. No writes, policy changes, or Storage access occur.
-- SQL role simulation is not an HTTP/PostgREST end-to-end test.

-- Keep privileged and public row-count probes on the same snapshot.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;

DO $verify$
DECLARE
  member_table oid := to_regclass('public.club_members');
  audit_role name := current_user;
  public_columns CONSTANT text[] := ARRAY[
    'id', 'nickname', 'photo_url', 'shirt_number', 'birth_year_be',
    'is_active', 'lineup_enabled', 'created_at', 'membership_type', 'club_role'
  ];
  table_privileges text[] := ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  checks jsonb := '{}'::jsonb;
  details jsonb := '{}'::jsonb;
  role_details jsonb := '{}'::jsonb;
  role_report jsonb;
  failed_checks jsonb;
  spec record;
  role_name text;
  role_oid oid;
  column_name text;
  public_column_list text;
  all_column_list text;
  private_columns text[];
  remaining_table_privileges text[];
  missing_select_columns text[];
  unexpected_select_columns text[];
  write_column_count integer;
  grantable_column_count integer;
  can_audit_all_rows boolean := false;
  row_backfill_ok boolean := false;
  schema_ok boolean;
  constraint_ok boolean;
  policy_ok boolean;
  query_ok boolean;
  queries_ok boolean;
  denials_ok boolean;
  visible_inactive boolean;
  active_count bigint;
  visible_active_count bigint;
  probe_errors jsonb;
  service_ok boolean;
  service_select_ok boolean := false;
BEGIN
  IF current_setting('transaction_read_only') <> 'on'
    OR current_setting('transaction_isolation') <> 'repeatable read' THEN
    RAISE EXCEPTION 'Verifier requires a REPEATABLE READ, READ ONLY transaction.';
  END IF;
  IF current_setting('server_version_num')::integer >= 170000 THEN
    table_privileges := array_append(table_privileges, 'MAINTAIN');
  END IF;
  checks := checks || jsonb_build_object('club_members_exists', member_table IS NOT NULL);

  IF member_table IS NOT NULL THEN
    SELECT r.rolsuper OR r.rolbypassrls OR (c.relowner = r.oid AND NOT c.relforcerowsecurity)
      INTO can_audit_all_rows
      FROM pg_class c JOIN pg_roles r ON r.rolname = audit_role WHERE c.oid = member_table;
    checks := checks || jsonb_build_object(
      'audit_can_see_all_rows', COALESCE(can_audit_all_rows, false),
      'rls_enabled', (SELECT relrowsecurity FROM pg_class WHERE oid = member_table),
      'sensitive_columns_exist', (
        SELECT count(*) = 2 FROM pg_attribute
        WHERE attrelid = member_table AND attname IN ('phone', 'lawyer_license_no') AND NOT attisdropped
      )
    );

    FOR spec IN
      SELECT * FROM (VALUES
        ('membership_type', 'ordinary', 'club_members_membership_type_check',
          $check$(membership_type = ANY (ARRAY['ordinary'::text, 'extraordinary'::text]))$check$),
        ('club_role', 'member', 'club_members_club_role_check',
          $check$(club_role = ANY (ARRAY['member'::text, 'staff'::text, 'coach'::text, 'assistant_coach'::text]))$check$)
      ) AS expected(column_name, default_value, constraint_name, expression)
    LOOP
      SELECT EXISTS (
        SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = member_table AND a.attname = spec.column_name AND NOT a.attisdropped
          AND a.atttypid = 'text'::regtype AND a.attnotnull AND a.attgenerated = '' AND a.attidentity = ''
          AND pg_get_expr(d.adbin, d.adrelid) = quote_literal(spec.default_value) || '::text'
      ) INTO schema_ok;
      SELECT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conrelid = member_table AND c.conname = spec.constraint_name AND c.contype = 'c' AND c.convalidated
          AND regexp_replace(pg_get_expr(c.conbin, c.conrelid), '[[:space:]]', '', 'g')
            = regexp_replace(spec.expression, '[[:space:]]', '', 'g')
      ) INTO constraint_ok;
      checks := checks || jsonb_build_object(
        spec.column_name || '.type_default_not_null', schema_ok,
        spec.column_name || '.validated_check', constraint_ok
      );
    END LOOP;

    BEGIN
      EXECUTE $backfill$
        SELECT NOT EXISTS (
          SELECT 1 FROM public.club_members
          WHERE membership_type IS DISTINCT FROM 'ordinary' OR club_role IS DISTINCT FROM 'member'
        )
      $backfill$ INTO row_backfill_ok;
      EXECUTE 'SELECT count(*) FROM public.club_members WHERE is_active IS TRUE' INTO active_count;
    EXCEPTION WHEN OTHERS THEN
      details := details || jsonb_build_object('backfill_error_sqlstate', SQLSTATE);
      row_backfill_ok := false;
    END;
    checks := checks || jsonb_build_object('phase1_rows_backfilled', row_backfill_ok AND can_audit_all_rows);

    SELECT string_agg(format('%I', name), ', ' ORDER BY ord)
      INTO public_column_list FROM unnest(public_columns) WITH ORDINALITY AS names(name, ord);
    SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum),
      COALESCE(array_agg(a.attname::text ORDER BY a.attnum) FILTER (WHERE NOT (a.attname::text = ANY(public_columns))), ARRAY[]::text[])
      INTO all_column_list, private_columns FROM pg_attribute a
      WHERE a.attrelid = member_table AND a.attnum > 0 AND NOT a.attisdropped;

    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      SELECT oid INTO role_oid FROM pg_roles WHERE rolname = role_name;
      checks := checks || jsonb_build_object(role_name || '.exists', role_oid IS NOT NULL);
      IF role_oid IS NULL THEN CONTINUE; END IF;

      remaining_table_privileges := ARRAY(
        SELECT p FROM unnest(table_privileges) AS privileges(p) WHERE has_table_privilege(role_oid, member_table, p)
      );
      missing_select_columns := ARRAY(
        SELECT name FROM unnest(public_columns) AS names(name)
        WHERE NOT EXISTS (
          SELECT 1 FROM pg_attribute a WHERE a.attrelid = member_table AND a.attname = name AND NOT a.attisdropped
            AND has_column_privilege(role_oid, member_table, a.attnum, 'SELECT')
        )
      );
      unexpected_select_columns := ARRAY(
        SELECT a.attname::text FROM pg_attribute a
        WHERE a.attrelid = member_table AND a.attnum > 0 AND NOT a.attisdropped
          AND NOT (a.attname::text = ANY(public_columns)) AND has_column_privilege(role_oid, member_table, a.attnum, 'SELECT')
        ORDER BY a.attnum
      );
      SELECT count(*) INTO write_column_count FROM pg_attribute a
        CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'REFERENCES']) AS privileges(p)
        WHERE a.attrelid = member_table AND a.attnum > 0 AND NOT a.attisdropped
          AND has_column_privilege(role_oid, member_table, a.attnum, p);
      SELECT count(*) INTO grantable_column_count FROM pg_attribute a
        WHERE a.attrelid = member_table AND a.attnum > 0 AND NOT a.attisdropped
          AND has_column_privilege(role_oid, member_table, a.attnum, 'SELECT WITH GRANT OPTION');

      -- Prove an active-only SELECT boundary without relying on a policy name.
      -- Unknown expressions fail conservatively unless an active-only restrictive policy bounds them.
      WITH applicable AS (
        SELECT p.polpermissive,
          regexp_replace(COALESCE(pg_get_expr(p.polqual, p.polrelid), ''), '[[:space:]()]', '', 'g')
            IN ('is_active', 'is_active=true', 'true=is_active', 'is_activeISTRUE') AS active_only
        FROM pg_policy p WHERE p.polrelid = member_table AND p.polcmd IN ('r', '*')
          AND (0::oid = ANY(p.polroles) OR EXISTS (
            SELECT 1 FROM unnest(p.polroles) AS policy_roles(id)
            WHERE CASE WHEN id = 0::oid THEN false ELSE pg_has_role(role_oid, id, 'USAGE') END
          ))
      )
      SELECT COALESCE(bool_or(polpermissive), false) AND (
        NOT COALESCE(bool_or(polpermissive AND NOT active_only), false)
        OR COALESCE(bool_or(NOT polpermissive AND active_only), false)
      ) INTO policy_ok FROM applicable;

      checks := checks || jsonb_build_object(
        role_name || '.table_privileges_revoked', cardinality(remaining_table_privileges) = 0,
        role_name || '.public_allowlist_exact', cardinality(missing_select_columns) = 0 AND cardinality(unexpected_select_columns) = 0,
        role_name || '.no_column_writes_or_grant_options', write_column_count = 0 AND grantable_column_count = 0,
        role_name || '.no_rls_bypass', (SELECT NOT rolsuper AND NOT rolbypassrls FROM pg_roles WHERE oid = role_oid),
        role_name || '.schema_usage', has_schema_privilege(role_oid, 'public', 'USAGE'),
        role_name || '.active_only_policy', policy_ok
      );
      role_report := jsonb_build_object(
        'remaining_table_privileges', remaining_table_privileges,
        'missing_select_columns', missing_select_columns,
        'unexpected_select_columns', unexpected_select_columns,
        'column_write_privilege_count', write_column_count,
        'grantable_select_column_count', grantable_column_count
      );
      queries_ok := true;
      denials_ok := true;
      probe_errors := '{}'::jsonb;

      BEGIN
        PERFORM set_config('request.jwt.claims', jsonb_build_object('role', role_name)::text, true);
        PERFORM set_config('request.jwt.claim.role', role_name, true);
        PERFORM set_config('request.jwt.claim.sub', '', true);
        PERFORM set_config('request.headers', '{}', true);
        EXECUTE format('SET LOCAL ROLE %I', role_name);

        -- Exact public SELECT / WHERE / ORDER shapes, with no member values returned.
        FOR spec IN
          SELECT * FROM (VALUES
            ('team', $team$
              SELECT id, nickname, photo_url FROM public.club_members
              WHERE is_active = true ORDER BY created_at DESC LIMIT 0
            $team$),
            ('lineup', $lineup$
              SELECT id, nickname, photo_url, shirt_number, birth_year_be, is_active, lineup_enabled
              FROM public.club_members WHERE is_active = true AND lineup_enabled = true
              ORDER BY nickname ASC LIMIT 0
            $lineup$),
            ('public_allowlist', format('SELECT %s FROM public.club_members LIMIT 0', public_column_list))
          ) AS shapes(name, query)
        LOOP
          query_ok := true;
          BEGIN
            EXECUTE spec.query;
          EXCEPTION WHEN OTHERS THEN
            query_ok := false;
            probe_errors := probe_errors || jsonb_build_object(spec.name, SQLSTATE);
          END;
          queries_ok := queries_ok AND query_ok;
        END LOOP;

        -- A missing column or other error is NOT accepted as a privacy denial.
        FOREACH column_name IN ARRAY private_columns LOOP
          BEGIN
            EXECUTE format('SELECT %I FROM public.club_members LIMIT 0', column_name);
            denials_ok := false;
            probe_errors := probe_errors || jsonb_build_object(column_name, 'unexpected_select_success');
          EXCEPTION WHEN OTHERS THEN
            IF SQLSTATE <> '42501' THEN
              denials_ok := false;
              probe_errors := probe_errors || jsonb_build_object(column_name, SQLSTATE);
            END IF;
          END;
        END LOOP;
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.club_members WHERE is_active IS NOT TRUE)' INTO visible_inactive;
        EXECUTE 'SELECT count(*) FROM public.club_members WHERE is_active IS TRUE' INTO visible_active_count;
        EXECUTE format('SET LOCAL ROLE %I', audit_role);
        checks := checks || jsonb_build_object(
          role_name || '.runtime_query_shapes', queries_ok,
          role_name || '.private_columns_denied_42501', denials_ok,
          role_name || '.rls_row_visibility', NOT visible_inactive AND visible_active_count = active_count AND can_audit_all_rows
        );
      EXCEPTION WHEN OTHERS THEN
        checks := checks || jsonb_build_object(
          role_name || '.runtime_query_shapes', false,
          role_name || '.private_columns_denied_42501', false,
          role_name || '.rls_row_visibility', false
        );
        probe_errors := probe_errors || jsonb_build_object('role_probe_unavailable', SQLSTATE);
      END;
      role_details := role_details || jsonb_build_object(role_name, role_report || jsonb_build_object('probe_errors', probe_errors));
    END LOOP;

    SELECT oid INTO role_oid FROM pg_roles WHERE rolname = 'service_role';
    checks := checks || jsonb_build_object('service_role.exists', role_oid IS NOT NULL);
    IF role_oid IS NOT NULL THEN
      SELECT bool_and(has_table_privilege(role_oid, member_table, p)) INTO service_ok
        FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS privileges(p);
      checks := checks || jsonb_build_object(
        'service_role.full_admin_privileges', service_ok AND has_schema_privilege(role_oid, 'public', 'USAGE'),
        'service_role.bypass_rls', (SELECT rolbypassrls FROM pg_roles WHERE oid = role_oid)
      );
      BEGIN
        EXECUTE 'SET LOCAL ROLE service_role';
        EXECUTE format('SELECT %s FROM public.club_members LIMIT 0', all_column_list);
        EXECUTE format('SET LOCAL ROLE %I', audit_role);
        service_select_ok := true;
      EXCEPTION WHEN OTHERS THEN
        details := details || jsonb_build_object('service_role_probe_error_sqlstate', SQLSTATE);
      END;
      checks := checks || jsonb_build_object('service_role.all_columns_selectable', service_select_ok);
      details := details || jsonb_build_object('service_role_privileges', (
        SELECT jsonb_object_agg(p, has_table_privilege(role_oid, member_table, p))
        FROM unnest(table_privileges) AS privileges(p)
      ));
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(key ORDER BY key), '[]'::jsonb) INTO failed_checks
    FROM jsonb_each(checks) WHERE value IS DISTINCT FROM 'true'::jsonb;
  details := details || jsonb_build_object(
    'public_safe_columns', public_columns,
    'roles', role_details,
    'scope', 'Immediate Phase 1 only; no staff imports yet. No member values returned.',
    'service_privilege_preservation', 'Migration asserts exact before/after privileges, including MAINTAIN when supported; verifier checks full admin access and reports current flags.'
  );
  PERFORM set_config('ksw_audit.phase1_verification', jsonb_build_object(
    'overall_pass', jsonb_array_length(failed_checks) = 0,
    'failed_checks', failed_checks,
    'details', details
  )::text, true);
END;
$verify$;

SELECT
  (report->>'overall_pass')::boolean AS overall_pass,
  report->'failed_checks' AS failed_checks,
  report->'details' AS details
FROM (SELECT current_setting('ksw_audit.phase1_verification')::jsonb AS report) result;

ROLLBACK;
