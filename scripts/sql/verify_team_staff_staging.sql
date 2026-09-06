-- Run immediately after Phase 2B staging, before activating/editing the six Staff.
-- Run the WHOLE script as postgres/table owner. Only mapping fields/checks are returned.
-- Sensitive columns are tested only for NULL, never returned as values.
-- Current-state verification cannot prove historical equality: the migration itself
-- compares all pre-existing rows before/after and aborts if any have changed.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;

DO $verify$
DECLARE
  member_table oid := to_regclass('public.club_members');
  protected_member_id CONSTANT uuid := '0d3ec2a6-7f44-4579-a98d-64232fda2db1';
  staff_manifest CONSTANT jsonb := $staff$[
    {"id":"e950da1b-7788-4e80-bcec-9a8f6e5d1397","nickname":"เฟี๊ยต","photo_url":"/images/staff/staff-01.png"},
    {"id":"84a1bd85-ba18-412f-b783-da4c01d9088d","nickname":"เหงี่ยม","photo_url":"/images/staff/staff-02.png"},
    {"id":"f8fe38e1-201e-4327-a645-a17140079e93","nickname":"พาสต้า","photo_url":"/images/staff/staff-03.png"},
    {"id":"77eb3cde-3815-4c4a-b33c-3dff615a4e70","nickname":"โก้","photo_url":"/images/staff/staff-04.png"},
    {"id":"749c89b3-9953-433f-904a-50429442ec14","nickname":"หม่อมโจอี้","photo_url":"/images/staff/staff-05.png"},
    {"id":"37f8ab40-e282-4619-a4e7-c7307f4665ea","nickname":"เด่น","photo_url":"/images/staff/staff-06.png"}
  ]$staff$::jsonb;
  checks jsonb := '{}'::jsonb;
  details jsonb := '{}'::jsonb;
  staff_details jsonb := '[]'::jsonb;
  staff_checks jsonb;
  failed_checks jsonb;
  spec record;
  can_audit_all_rows boolean := false;
  manifest_ok boolean;
BEGIN
  IF current_setting('transaction_read_only') <> 'on'
    OR current_setting('transaction_isolation') <> 'repeatable read' THEN
    RAISE EXCEPTION 'Verifier requires a REPEATABLE READ, READ ONLY transaction.';
  END IF;
  SELECT jsonb_array_length(staff_manifest) = 6 AND count(DISTINCT s.id) = 6
      AND bool_and(s.id IS NOT NULL AND s.id <> protected_member_id)
    INTO manifest_ok FROM jsonb_to_recordset(staff_manifest) AS s(id uuid);
  checks := checks || jsonb_build_object(
    'club_members_exists', member_table IS NOT NULL,
    'six_distinct_staff_ids_separate_from_ordinary_member', manifest_ok
  );

  IF member_table IS NOT NULL THEN
    SELECT (r.rolsuper OR r.rolbypassrls OR (c.relowner = r.oid AND NOT c.relforcerowsecurity))
        AND has_table_privilege(current_user, member_table, 'SELECT')
      INTO can_audit_all_rows
      FROM pg_class c JOIN pg_roles r ON r.rolname = current_user WHERE c.oid = member_table;
    checks := checks || jsonb_build_object(
      'audit_can_see_all_rows', COALESCE(can_audit_all_rows, false),
      'rls_still_enabled', (SELECT relrowsecurity FROM pg_class WHERE oid = member_table)
    );

    IF can_audit_all_rows AND manifest_ok THEN
      BEGIN
        FOR spec IN
          SELECT * FROM jsonb_to_recordset(staff_manifest) AS s(id uuid, nickname text, photo_url text)
        LOOP
          SELECT jsonb_build_object(
            'exists', count(*) = 1,
            'nickname_photo_match', COALESCE(bool_and(
              m.nickname COLLATE "C" IS NOT DISTINCT FROM spec.nickname COLLATE "C"
              AND m.photo_url IS NOT DISTINCT FROM spec.photo_url
            ), false),
            'extraordinary_staff', COALESCE(bool_and(
              m.membership_type IS NOT DISTINCT FROM 'extraordinary' AND m.club_role IS NOT DISTINCT FROM 'staff'
            ), false),
            'inactive_lineup_disabled', COALESCE(bool_and(m.is_active IS FALSE AND m.lineup_enabled IS FALSE), false),
            'unsupplied_fields_null', COALESCE(bool_and(
              m.first_name IS NULL AND m.last_name IS NULL AND m.lawyer_license_no IS NULL AND m.phone IS NULL
              AND m.birth_day IS NULL AND m.birth_month IS NULL AND m.birth_year_be IS NULL AND m.shirt_number IS NULL
            ), false)
          ) INTO staff_checks FROM public.club_members m WHERE m.id = spec.id;
          checks := checks || (
            SELECT jsonb_object_agg('staff.' || spec.id::text || '.' || key, value) FROM jsonb_each(staff_checks)
          );
          staff_details := staff_details || jsonb_build_array(jsonb_build_object(
            'id', spec.id, 'nickname', spec.nickname, 'photo_url', spec.photo_url, 'checks', staff_checks
          ));
        END LOOP;

        checks := checks || jsonb_build_object(
          'protected_ordinary_member_exists', EXISTS (
            SELECT 1 FROM public.club_members m WHERE m.id = protected_member_id
          ),
          'protected_ordinary_member_identity_and_role', EXISTS (
            SELECT 1 FROM public.club_members m WHERE m.id = protected_member_id
              AND m.nickname COLLATE "C" = 'โก้' AND m.membership_type = 'ordinary' AND m.club_role = 'member'
          ),
          'staff_go_is_a_separate_member', EXISTS (
            SELECT 1 FROM jsonb_to_recordset(staff_manifest) AS s(id uuid, nickname text)
            JOIN public.club_members m ON m.id = s.id
            WHERE s.nickname COLLATE "C" = 'โก้' AND m.nickname COLLATE "C" = s.nickname COLLATE "C"
              AND m.id <> protected_member_id AND m.membership_type = 'extraordinary' AND m.club_role = 'staff'
          )
        );
      EXCEPTION WHEN OTHERS THEN
        checks := checks || jsonb_build_object('row_verification_succeeded', false);
        details := details || jsonb_build_object('row_verification_error_sqlstate', SQLSTATE);
      END;
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(key ORDER BY key), '[]'::jsonb) INTO failed_checks
    FROM jsonb_each(checks) WHERE value IS DISTINCT FROM 'true'::jsonb;
  details := details || jsonb_build_object(
    'staff', staff_details,
    'protected_ordinary_member_id', protected_member_id,
    'scope', 'Immediate Phase 2B inactive staging only; no sensitive member values returned.',
    'preservation_evidence', 'Migration compares every pre-existing full row before/after; this verifier checks current identity, type and role.'
  );
  PERFORM set_config('ksw_audit.staff_staging', jsonb_build_object(
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
FROM (SELECT current_setting('ksw_audit.staff_staging')::jsonb AS report) result;

ROLLBACK;
