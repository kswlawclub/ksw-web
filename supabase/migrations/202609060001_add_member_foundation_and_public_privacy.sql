-- Phase 1 only: no staff import, UI change, storage change, or member-row rewrite.
-- Run as the table owner in SQL Editor; run verify_club_members_phase1.sql afterward.
-- A repeat/partial installation deliberately fails instead of overwriting member types.

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $migration$
DECLARE
  member_table oid := to_regclass('public.club_members');
  public_columns CONSTANT text[] := ARRAY[
    'id', 'nickname', 'photo_url', 'shirt_number', 'birth_year_be',
    'is_active', 'lineup_enabled', 'created_at', 'membership_type', 'club_role'
  ];
  table_privileges text[] := ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  service_before jsonb;
  service_after jsonb;
  policies_before jsonb;
  policies_after jsonb;
  forced_rls_before boolean;
  role_name text;
  privilege_name text;
  column_record record;
  all_column_list text;
  public_column_list text;
BEGIN
  IF member_table IS NULL THEN
    RAISE EXCEPTION 'club_members is missing; run the schema audit first.';
  END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) <> 3 THEN
    RAISE EXCEPTION 'Expected Supabase roles are missing.';
  END IF;
  IF current_setting('server_version_num')::integer >= 170000 THEN
    table_privileges := array_append(table_privileges, 'MAINTAIN');
  END IF;

  LOCK TABLE public.club_members IN ACCESS EXCLUSIVE MODE;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = member_table) THEN
    RAISE EXCEPTION 'Expected existing RLS to be enabled; no policy is created by this migration.';
  END IF;
  SELECT relforcerowsecurity INTO forced_rls_before FROM pg_class WHERE oid = member_table;
  SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.oid), '[]'::jsonb)
    INTO policies_before FROM pg_policy p WHERE p.polrelid = member_table;

  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'service_role')
    OR NOT has_schema_privilege('service_role', 'public', 'USAGE') THEN
    RAISE EXCEPTION 'service_role access differs from the audited baseline.';
  END IF;
  FOREACH privilege_name IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF NOT has_table_privilege('service_role', member_table, privilege_name) THEN
      RAISE EXCEPTION 'service_role is missing baseline privilege: %', privilege_name;
    END IF;
  END LOOP;
  SELECT jsonb_object_agg(p, has_table_privilege('service_role', member_table, p))
    INTO service_before FROM unnest(table_privileges) AS privileges(p);

  -- Constant defaults populate all existing rows without changing existing columns.
  ALTER TABLE public.club_members
    ADD COLUMN membership_type text NOT NULL DEFAULT 'ordinary',
    ADD COLUMN club_role text NOT NULL DEFAULT 'member',
    ADD CONSTRAINT club_members_membership_type_check
      CHECK (membership_type IN ('ordinary', 'extraordinary')),
    ADD CONSTRAINT club_members_club_role_check
      CHECK (club_role IN ('member', 'staff', 'coach', 'assistant_coach'));

  SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
    INTO all_column_list FROM pg_attribute a
    WHERE a.attrelid = member_table AND a.attnum > 0 AND NOT a.attisdropped;
  SELECT string_agg(format('%I', name), ', ' ORDER BY ord)
    INTO public_column_list FROM unnest(public_columns) WITH ORDINALITY AS names(name, ord);

  -- PUBLIC grants also reach anon/authenticated. RESTRICT never cascades to other roles.
  -- ALL includes MAINTAIN on versions that support it. No empty ACL array expansion.
  REVOKE ALL PRIVILEGES ON TABLE public.club_members FROM PUBLIC, anon, authenticated RESTRICT;
  EXECUTE format(
    'REVOKE ALL PRIVILEGES (%s) ON TABLE public.club_members FROM PUBLIC, anon, authenticated RESTRICT',
    all_column_list
  );
  EXECUTE format(
    'GRANT SELECT (%s) ON TABLE public.club_members TO anon, authenticated',
    public_column_list
  );

  -- Effective checks catch inherited/other-grantor access that a direct REVOKE cannot remove.
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = role_name AND (r.rolsuper OR r.rolbypassrls))
      OR NOT has_schema_privilege(role_name, 'public', 'USAGE') THEN
      RAISE EXCEPTION 'Unexpected role/schema access for %; review grants before retrying.', role_name;
    END IF;
    FOREACH privilege_name IN ARRAY table_privileges LOOP
      IF has_table_privilege(role_name, member_table, privilege_name) THEN
        RAISE EXCEPTION 'Unexpected effective table privilege %.%; no changes committed.', role_name, privilege_name;
      END IF;
    END LOOP;
    FOR column_record IN
      SELECT attname, attnum FROM pg_attribute
      WHERE attrelid = member_table AND attnum > 0 AND NOT attisdropped
    LOOP
      IF has_column_privilege(role_name, member_table, column_record.attnum, 'SELECT')
        IS DISTINCT FROM (column_record.attname::text = ANY(public_columns)) THEN
        RAISE EXCEPTION 'Column SELECT allowlist mismatch for %.%; no changes committed.', role_name, column_record.attname;
      END IF;
      FOREACH privilege_name IN ARRAY ARRAY['INSERT', 'UPDATE', 'REFERENCES', 'SELECT WITH GRANT OPTION'] LOOP
        IF has_column_privilege(role_name, member_table, column_record.attnum, privilege_name) THEN
          RAISE EXCEPTION 'Unexpected column privilege %.%.%; no changes committed.', role_name, column_record.attname, privilege_name;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  SELECT jsonb_object_agg(p, has_table_privilege('service_role', member_table, p))
    INTO service_after FROM unnest(table_privileges) AS privileges(p);
  SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.oid), '[]'::jsonb)
    INTO policies_after FROM pg_policy p WHERE p.polrelid = member_table;
  IF service_after IS DISTINCT FROM service_before THEN
    RAISE EXCEPTION 'service_role privileges changed; no changes committed.';
  END IF;
  IF policies_after IS DISTINCT FROM policies_before
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = member_table)
    OR (SELECT relforcerowsecurity FROM pg_class WHERE oid = member_table) IS DISTINCT FROM forced_rls_before THEN
    RAISE EXCEPTION 'Existing RLS configuration changed; no changes committed.';
  END IF;
END;
$migration$;

COMMIT;
