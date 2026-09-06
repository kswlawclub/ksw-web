-- Phase 5A: optional current football profile only. No member writes or rating seeds.
-- Run as postgres/table owner, then run verify_member_football_rating_foundation.sql.
-- Like Phase 1, an existing/partial installation fails closed; never replace live objects.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, public;

DO $migration$
DECLARE
  member_table oid := to_regclass('public.club_members');
  rating_table oid;
  updated_at_function oid := to_regprocedure('public.set_updated_at()');
  updated_at_function_before jsonb;
  updated_at_function_after jsonb;
  -- Conservative compatibility contract; unknown bodies require read-only review, not replacement.
  updated_at_body_pattern CONSTANT text := '^beginnew\.updated_at(:=|=)((pg_catalog\.)?(now|transaction_timestamp)\(\)|current_timestamp);returnnew;end;$';
  member_security_before jsonb;
  member_security_after jsonb;
  table_privileges text[] := ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  role_name text;
  privilege_name text;
  column_record record;
  all_columns text;
BEGIN
  IF current_setting('server_version_num')::integer < 120000 THEN
    RAISE EXCEPTION 'Stored generated columns require PostgreSQL 12 or later.';
  END IF;
  IF member_table IS NULL OR to_regclass('public.club_member_football_ratings') IS NOT NULL THEN
    RAISE EXCEPTION 'Expected club_members and no existing ratings table; inspect schema before retrying.';
  END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) <> 3
    OR NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'Expected Supabase roles and service_role RLS bypass.';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = member_table) THEN
    RAISE EXCEPTION 'Expected club_members RLS to remain enabled.';
  END IF;
  IF current_setting('server_version_num')::integer >= 170000 THEN
    table_privileges := array_append(table_privileges, 'MAINTAIN');
  END IF;

  IF updated_at_function IS NULL THEN
    RAISE EXCEPTION 'Required existing function public.set_updated_at() is missing. Inspect the Live DB audit; this migration will not create or replace it.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
    WHERE p.oid = updated_at_function AND p.prokind = 'f' AND p.pronargs = 0
      AND p.prorettype = 'trigger'::regtype AND NOT p.proretset AND l.lanname = 'plpgsql'
      AND regexp_replace(lower(p.prosrc), '[[:space:]]', '', 'g') ~ updated_at_body_pattern
  ) THEN
    RAISE EXCEPTION 'Cannot confirm public.set_updated_at() is a generic NEW.updated_at timestamp setter returning NEW. Review its signature/body read-only; do not replace the shared function.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t WHERE t.tgrelid = member_table AND NOT t.tgisinternal
      AND t.tgname = 'set_club_members_updated_at' AND t.tgfoid = updated_at_function
      AND t.tgenabled IN ('O', 'A')
  ) THEN
    RAISE EXCEPTION 'Expected enabled club_members trigger set_club_members_updated_at calling public.set_updated_at(). Inspect the Live DB audit; no member trigger will be modified.';
  END IF;
  IF NOT has_function_privilege(current_user, updated_at_function, 'EXECUTE')
    OR NOT has_function_privilege('service_role', updated_at_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'Expected migration-role and service_role EXECUTE access to existing public.set_updated_at(). Review existing privileges; this migration will not change function grants.';
  END IF;
  SELECT to_jsonb(p) INTO updated_at_function_before FROM pg_proc p WHERE p.oid = updated_at_function;

  SELECT jsonb_build_object(
    'acl', c.relacl, 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
    'column_acls', (SELECT jsonb_agg(jsonb_build_array(a.attname, a.attacl) ORDER BY a.attnum)
      FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
    'policies', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p WHERE p.polrelid = c.oid),
    'user_triggers', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal)
  ) INTO member_security_before FROM pg_class c WHERE c.oid = member_table;

  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT has_column_privilege(role_name, member_table, 'id', 'SELECT')
      OR NOT has_column_privilege(role_name, member_table, 'is_active', 'SELECT')
      OR has_column_privilege(role_name, member_table, 'phone', 'SELECT')
      OR has_column_privilege(role_name, member_table, 'lawyer_license_no', 'SELECT') THEN
      RAISE EXCEPTION 'Member privacy prerequisite failed for %; no grants will be changed on club_members.', role_name;
    END IF;
  END LOOP;

  CREATE TABLE public.club_member_football_ratings (
    member_id uuid PRIMARY KEY REFERENCES public.club_members(id) ON DELETE RESTRICT,
    rating_type text NOT NULL,
    pace smallint,
    shooting smallint,
    passing smallint,
    dribbling smallint,
    defending smallint,
    physical smallint,
    gk_diving smallint,
    gk_handling smallint,
    gk_kicking smallint,
    gk_reflexes smallint,
    gk_speed smallint,
    gk_positioning smallint,
    overall integer GENERATED ALWAYS AS (
      CASE WHEN rating_type = 'player' THEN
        round((pace + shooting + passing + dribbling + defending + physical)::numeric / 6)::integer
      ELSE
        round((gk_diving + gk_handling + gk_kicking + gk_reflexes + gk_speed + gk_positioning)::numeric / 6)::integer
      END
    ) STORED NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT cmfr_rating_type CHECK (rating_type IN ('player', 'goalkeeper')),
    CONSTRAINT cmfr_pace_range CHECK (pace BETWEEN 1 AND 99),
    CONSTRAINT cmfr_shooting_range CHECK (shooting BETWEEN 1 AND 99),
    CONSTRAINT cmfr_passing_range CHECK (passing BETWEEN 1 AND 99),
    CONSTRAINT cmfr_dribbling_range CHECK (dribbling BETWEEN 1 AND 99),
    CONSTRAINT cmfr_defending_range CHECK (defending BETWEEN 1 AND 99),
    CONSTRAINT cmfr_physical_range CHECK (physical BETWEEN 1 AND 99),
    CONSTRAINT cmfr_gk_diving_range CHECK (gk_diving BETWEEN 1 AND 99),
    CONSTRAINT cmfr_gk_handling_range CHECK (gk_handling BETWEEN 1 AND 99),
    CONSTRAINT cmfr_gk_kicking_range CHECK (gk_kicking BETWEEN 1 AND 99),
    CONSTRAINT cmfr_gk_reflexes_range CHECK (gk_reflexes BETWEEN 1 AND 99),
    CONSTRAINT cmfr_gk_speed_range CHECK (gk_speed BETWEEN 1 AND 99),
    CONSTRAINT cmfr_gk_positioning_range CHECK (gk_positioning BETWEEN 1 AND 99),
    -- Explicit IS NOT NULL checks prevent CHECK's SQL NULL/unknown acceptance.
    CONSTRAINT cmfr_stat_shape CHECK (
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
    )
  );
  rating_table := 'public.club_member_football_ratings'::regclass;

  -- Reuse the audited Live function; its definition, security settings and ACL stay untouched.
  CREATE TRIGGER club_member_football_ratings_updated_at
    BEFORE UPDATE ON public.club_member_football_ratings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

  ALTER TABLE public.club_member_football_ratings ENABLE ROW LEVEL SECURITY;
  CREATE POLICY club_member_football_ratings_active_select
    ON public.club_member_football_ratings FOR SELECT TO anon, authenticated
    USING (EXISTS (
      SELECT 1 FROM public.club_members m
      WHERE m.id = club_member_football_ratings.member_id AND m.is_active IS TRUE
    ));

  -- Supabase default privileges may grant writes on newly created tables.
  REVOKE ALL PRIVILEGES ON TABLE public.club_member_football_ratings FROM PUBLIC, anon, authenticated RESTRICT;
  SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum) INTO all_columns
    FROM pg_attribute a WHERE a.attrelid = rating_table AND a.attnum > 0 AND NOT a.attisdropped;
  EXECUTE format('REVOKE ALL PRIVILEGES (%s) ON TABLE public.club_member_football_ratings FROM PUBLIC, anon, authenticated RESTRICT', all_columns);
  GRANT SELECT ON TABLE public.club_member_football_ratings TO anon, authenticated;
  GRANT ALL PRIVILEGES ON TABLE public.club_member_football_ratings TO service_role;

  -- Effective checks also catch inherited grants, owner access and version-specific MAINTAIN.
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT has_schema_privilege(role_name, 'public', 'USAGE') THEN
      RAISE EXCEPTION 'Missing public schema USAGE for %.', role_name;
    END IF;
    FOREACH privilege_name IN ARRAY table_privileges LOOP
      IF has_table_privilege(role_name, rating_table, privilege_name)
        IS DISTINCT FROM (role_name = 'service_role' OR privilege_name = 'SELECT') THEN
        RAISE EXCEPTION 'Unexpected effective rating privilege %.%; transaction aborted.', role_name, privilege_name;
      END IF;
    END LOOP;
    IF role_name <> 'service_role' THEN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name AND (rolsuper OR rolbypassrls)) THEN
        RAISE EXCEPTION 'Public role % must not bypass RLS.', role_name;
      END IF;
      FOR column_record IN SELECT attnum FROM pg_attribute
        WHERE attrelid = rating_table AND attnum > 0 AND NOT attisdropped
      LOOP
        FOREACH privilege_name IN ARRAY ARRAY['INSERT', 'UPDATE', 'REFERENCES', 'SELECT WITH GRANT OPTION'] LOOP
          IF has_column_privilege(role_name, rating_table, column_record.attnum, privilege_name) THEN
            RAISE EXCEPTION 'Unexpected rating column privilege for %.', role_name;
          END IF;
        END LOOP;
      END LOOP;
    END IF;
  END LOOP;

  SELECT jsonb_build_object(
    'acl', c.relacl, 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
    'column_acls', (SELECT jsonb_agg(jsonb_build_array(a.attname, a.attacl) ORDER BY a.attnum)
      FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
    'policies', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p WHERE p.polrelid = c.oid),
    'user_triggers', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal)
  ) INTO member_security_after FROM pg_class c WHERE c.oid = member_table;
  IF member_security_after IS DISTINCT FROM member_security_before THEN
    RAISE EXCEPTION 'club_members privacy or user triggers changed; transaction aborted.';
  END IF;
  SELECT to_jsonb(p) INTO updated_at_function_after FROM pg_proc p WHERE p.oid = updated_at_function;
  IF updated_at_function_after IS DISTINCT FROM updated_at_function_before THEN
    RAISE EXCEPTION 'Existing public.set_updated_at() definition or privileges changed; transaction aborted.';
  END IF;
END;
$migration$;

COMMIT;
