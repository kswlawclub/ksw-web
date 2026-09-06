-- Member Architecture Phase 1: run the entire script in Supabase SQL Editor.
-- Requires a catalog-reading role that can SET ROLE anon (normally postgres).
-- No member values, function bodies, storage object listings, or credentials are returned.
-- All role/JWT/report settings are transaction-local and discarded by ROLLBACK.

BEGIN TRANSACTION READ ONLY;

DO $audit$
DECLARE
  member_table oid := to_regclass('public.club_members');
  audit_role name := current_user;
  schema_report jsonb;
  bucket_report jsonb := jsonb_build_object('status', 'unavailable');
  probe_report jsonb;
  member_columns text[];
  column_name text;
  selectable_columns text[] := ARRAY[]::text[];
  column_errors jsonb := '{}'::jsonb;
  any_visible_rows boolean := NULL;
  visibility_error text := NULL;
BEGIN
  IF current_setting('transaction_read_only') <> 'on' THEN
    RAISE EXCEPTION 'Audit requires a READ ONLY transaction.';
  END IF;

  -- Keep optional Storage metadata failures separate from the member audit.
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    BEGIN
      EXECUTE $bucket$
        SELECT jsonb_build_object(
          'status', 'found',
          'id', b.id,
          'name', b.name,
          'public', to_jsonb(b)->'public',
          'file_size_limit', to_jsonb(b)->'file_size_limit',
          'allowed_mime_types', to_jsonb(b)->'allowed_mime_types'
        )
        FROM storage.buckets b
        WHERE b.id = 'member-photos'
      $bucket$ INTO bucket_report;
      bucket_report := COALESCE(bucket_report, jsonb_build_object('status', 'not_visible_or_missing'));
    EXCEPTION WHEN OTHERS THEN
      bucket_report := jsonb_build_object('status', 'unavailable', 'sqlstate', SQLSTATE);
    END;
  END IF;

  WITH audit_relations AS (
    SELECT c.*, n.nspname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.oid IN (
      member_table,
      to_regclass('storage.objects'),
      to_regclass('storage.buckets')
    )
  ), audit_roles AS (
    SELECT oid, rolname, rolsuper, rolinherit, rolbypassrls
    FROM pg_roles
    WHERE rolname IN ('anon', 'authenticated', 'service_role')
  ), columns AS (
    SELECT a.*, pg_get_expr(d.adbin, d.adrelid) AS default_expression
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = member_table AND a.attnum > 0 AND NOT a.attisdropped
  )
  SELECT jsonb_build_object(
    'server_version', current_setting('server_version'),
    'club_members_exists', member_table IS NOT NULL,
    'columns', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', a.attname,
        'type', format_type(a.atttypid, a.atttypmod),
        'nullable', NOT a.attnotnull,
        'default', a.default_expression,
        'identity', NULLIF(a.attidentity, ''),
        'generated', NULLIF(a.attgenerated, '')
      ) ORDER BY a.attnum)
      FROM columns a
    ), '[]'::jsonb),
    'constraints_and_foreign_keys', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', c.conname,
        'type', c.contype,
        'table', c.conrelid::regclass::text,
        'references', NULLIF(c.confrelid, 0)::regclass::text,
        'incoming_fk', c.contype = 'f' AND c.confrelid = member_table,
        'validated', c.convalidated,
        'definition', pg_get_constraintdef(c.oid)
      ) ORDER BY c.conrelid::regclass::text, c.conname)
      FROM pg_constraint c
      WHERE c.conrelid = member_table OR c.confrelid = member_table
    ), '[]'::jsonb),
    'indexes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', i.indexrelid::regclass::text,
        'valid', i.indisvalid,
        'ready', i.indisready,
        'definition', pg_get_indexdef(i.indexrelid)
      ) ORDER BY i.indexrelid::regclass::text)
      FROM pg_index i WHERE i.indrelid = member_table
    ), '[]'::jsonb),
    'triggers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', t.tgname,
        'enabled', t.tgenabled,
        'internal', t.tgisinternal,
        'function', t.tgfoid::regprocedure::text,
        'definition', pg_get_triggerdef(t.oid)
      ) ORDER BY t.tgname)
      FROM pg_trigger t WHERE t.tgrelid = member_table
    ), '[]'::jsonb),
    'dependent_objects', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'object', pg_describe_object(d.classid, d.objid, d.objsubid),
        'type', d.deptype,
        'column', a.attname
      ) ORDER BY d.classid, d.objid, d.objsubid, d.refobjsubid)
      FROM pg_depend d
      LEFT JOIN columns a ON a.attnum = d.refobjsubid
      WHERE d.refclassid = 'pg_class'::regclass AND d.refobjid = member_table
    ), '[]'::jsonb),
    -- ACLs are serialized, never expanded. NULL and empty ACL arrays are safe.
    -- Table defaults and explicit column grants are distinct; effective checks follow.
    'relations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'table', c.oid::regclass::text,
        'kind', c.relkind,
        'owner', pg_get_userbyid(c.relowner),
        'rls_enabled', c.relrowsecurity,
        'rls_forced', c.relforcerowsecurity,
        'acl', to_jsonb(COALESCE(c.relacl, acldefault('r', c.relowner))),
        'acl_uses_owner_default', c.relacl IS NULL
      ) ORDER BY c.nspname, c.relname)
      FROM audit_relations c
    ), '[]'::jsonb),
    'explicit_column_acls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('column', a.attname, 'acl', to_jsonb(a.attacl)) ORDER BY a.attnum)
      FROM columns a WHERE cardinality(a.attacl) > 0
    ), '[]'::jsonb),
    'policies', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'table', p.schemaname || '.' || p.tablename,
        'name', p.policyname,
        'roles', p.roles,
        'command', p.cmd,
        'permissive', p.permissive,
        'using', p.qual,
        'with_check', p.with_check
      ) ORDER BY p.schemaname, p.tablename, p.policyname)
      FROM pg_policies p
      WHERE (p.schemaname = 'public' AND p.tablename = 'club_members')
        OR (p.schemaname = 'storage' AND p.tablename IN ('objects', 'buckets'))
    ), '[]'::jsonb),
    'effective_privileges', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'role', r.rolname,
        'superuser', r.rolsuper,
        'inherit', r.rolinherit,
        'bypass_rls', r.rolbypassrls,
        'tables', (
          SELECT jsonb_agg(jsonb_build_object(
            'table', c.oid::regclass::text,
            'schema_usage', has_schema_privilege(r.oid, c.relnamespace, 'USAGE'),
            'select', has_table_privilege(r.oid, c.oid, 'SELECT'),
            'insert', has_table_privilege(r.oid, c.oid, 'INSERT'),
            'update', has_table_privilege(r.oid, c.oid, 'UPDATE'),
            'delete', has_table_privilege(r.oid, c.oid, 'DELETE')
          ) ORDER BY c.nspname, c.relname)
          FROM audit_relations c
        ),
        'member_columns_select', ARRAY(
          SELECT a.attname FROM columns a
          WHERE has_column_privilege(r.oid, member_table, a.attnum, 'SELECT') ORDER BY a.attnum
        ),
        'member_columns_insert', ARRAY(
          SELECT a.attname FROM columns a
          WHERE has_column_privilege(r.oid, member_table, a.attnum, 'INSERT') ORDER BY a.attnum
        ),
        'member_columns_update', ARRAY(
          SELECT a.attname FROM columns a
          WHERE has_column_privilege(r.oid, member_table, a.attnum, 'UPDATE') ORDER BY a.attnum
        )
      ) ORDER BY r.rolname)
      FROM audit_roles r
    ), '[]'::jsonb),
    'missing_roles', ARRAY(
      SELECT requested.role_name
      FROM (VALUES ('anon'), ('authenticated'), ('service_role')) requested(role_name)
      WHERE NOT EXISTS (SELECT 1 FROM audit_roles r WHERE r.rolname = requested.role_name)
    ),
    'member_photos_bucket', bucket_report,
    'limitations', jsonb_build_array(
      'Privilege flags are grants, not proof that RLS permits a row.',
      'All Storage policies are included: generic policies can apply to member-photos.',
      'Catalog dependencies do not cover application code or dynamic SQL in functions.'
    )
  ) INTO schema_report;

  IF member_table IS NULL THEN
    probe_report := jsonb_build_object('status', 'club_members_missing');
  ELSIF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    probe_report := jsonb_build_object('status', 'anon_role_missing');
  ELSE
    -- Collect names before changing role; an anon schema denial is a probe result.
    SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO member_columns
    FROM pg_attribute a
    WHERE a.attrelid = member_table AND a.attnum > 0 AND NOT a.attisdropped;

    BEGIN
      PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
      PERFORM set_config('request.jwt.claim.role', 'anon', true);
      PERFORM set_config('request.jwt.claim.sub', '', true);
      PERFORM set_config('request.headers', '{}', true);
      EXECUTE 'SET LOCAL ROLE anon';

      FOREACH column_name IN ARRAY COALESCE(member_columns, ARRAY[]::text[]) LOOP
        BEGIN
          -- LIMIT 0 checks the named column without returning any member value.
          EXECUTE format('SELECT %I FROM public.club_members LIMIT 0', column_name);
          selectable_columns := array_append(selectable_columns, column_name);
        EXCEPTION WHEN OTHERS THEN
          column_errors := column_errors || jsonb_build_object(column_name, SQLSTATE);
        END;
      END LOOP;

      BEGIN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.club_members)' INTO any_visible_rows;
      EXCEPTION WHEN OTHERS THEN
        visibility_error := SQLSTATE;
      END;

      EXECUTE format('SET LOCAL ROLE %I', audit_role);
      probe_report := jsonb_build_object(
        'status', 'checked',
        'selectable_columns', selectable_columns,
        'column_errors_sqlstate', column_errors,
        'any_visible_rows', any_visible_rows,
        'visibility_error_sqlstate', visibility_error,
        'sensitive_columns', jsonb_build_object(
          'phone', jsonb_build_object(
            'exists', 'phone' = ANY(COALESCE(member_columns, ARRAY[]::text[])),
            'select_allowed', 'phone' = ANY(selectable_columns)
          ),
          'lawyer_license_no', jsonb_build_object(
            'exists', 'lawyer_license_no' = ANY(COALESCE(member_columns, ARRAY[]::text[])),
            'select_allowed', 'lawyer_license_no' = ANY(selectable_columns)
          )
        ),
        'limitations', jsonb_build_array(
          'Database role anon with no user JWT; not an HTTP/PostgREST or Storage API test.',
          'LIMIT 0 checks column access; false row visibility may mean an empty table or RLS filtering.'
        )
      );
    EXCEPTION WHEN OTHERS THEN
      -- This block rolls back its role/settings on error; no success is inferred.
      probe_report := jsonb_build_object('status', 'unavailable', 'sqlstate', SQLSTATE);
    END;
  END IF;

  -- One final result row keeps both reports visible in SQL Editor.
  PERFORM set_config('ksw_audit.schema_audit', schema_report::text, true);
  PERFORM set_config('ksw_audit.anon_database_probe', probe_report::text, true);
END;
$audit$;

SELECT
  current_setting('ksw_audit.schema_audit')::jsonb AS schema_audit,
  current_setting('ksw_audit.anon_database_probe')::jsonb AS anon_database_probe;

ROLLBACK;
