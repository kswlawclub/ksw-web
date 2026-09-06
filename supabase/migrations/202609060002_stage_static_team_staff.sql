-- Phase 2B staging only. Run the WHOLE script as postgres/table owner.
-- Identity is the fixed UUID, never the nickname. The two people named โก้ are distinct.
-- Exact retries are no-ops; changed/colliding reserved IDs abort without overwriting.
-- No activation, UI, Storage, grant, policy, or schema changes.
-- After applying, run scripts/sql/verify_team_staff_staging.sql (not the Phase 1 backfill verifier).

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $migration$
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
  spec record;
  existing_before jsonb;
  existing_after jsonb;
  count_before bigint;
  inserted_count integer := 0;
BEGIN
  IF member_table IS NULL THEN
    RAISE EXCEPTION 'club_members is missing; run the member schema audit first.';
  END IF;
  -- Serialize member writes while comparing before/after; public SELECT stays available.
  LOCK TABLE public.club_members IN SHARE ROW EXCLUSIVE MODE;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_roles r ON r.rolname = current_user
    WHERE c.oid = member_table AND c.relrowsecurity
      AND (r.rolsuper OR r.rolbypassrls OR (c.relowner = r.oid AND NOT c.relforcerowsecurity))
      AND has_table_privilege(current_user, member_table, 'SELECT')
  ) THEN
    RAISE EXCEPTION 'Staging requires enabled RLS and a role that can audit all member rows.';
  END IF;
  IF jsonb_array_length(staff_manifest) <> 6 OR (
    SELECT count(DISTINCT s.id) FROM jsonb_to_recordset(staff_manifest) AS s(id uuid)
    WHERE s.id IS NOT NULL AND s.id <> protected_member_id
  ) <> 6 THEN
    RAISE EXCEPTION 'Staff manifest must contain six unique, separate UUIDs.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.club_members m WHERE m.id = protected_member_id
      AND m.nickname COLLATE "C" = 'โก้' AND m.membership_type = 'ordinary' AND m.club_role = 'member'
  ) THEN
    RAISE EXCEPTION 'Protected ordinary member baseline differs; review before staging.';
  END IF;

  -- Full rows are held only in this block, never printed or persisted as audit data.
  -- This also catches member triggers that unexpectedly change an existing person.
  SELECT count(*), COALESCE(jsonb_object_agg(m.id::text, to_jsonb(m)), '{}'::jsonb)
    INTO count_before, existing_before FROM public.club_members m;

  INSERT INTO public.club_members (
    id, nickname, photo_url, membership_type, club_role, is_active, lineup_enabled,
    first_name, last_name, lawyer_license_no, phone, birth_day, birth_month, birth_year_be, shirt_number
  )
  SELECT s.id, s.nickname, s.photo_url, 'extraordinary', 'staff', false, false,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  FROM jsonb_to_recordset(staff_manifest) AS s(id uuid, nickname text, photo_url text)
  WHERE NOT EXISTS (SELECT 1 FROM public.club_members m WHERE m.id = s.id)
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  -- Check all six after the entire INSERT, including any trigger effects.
  FOR spec IN
    SELECT * FROM jsonb_to_recordset(staff_manifest) AS s(id uuid, nickname text, photo_url text)
  LOOP
    -- Existing reserved IDs must already match exactly; never repair or upsert them.
    IF NOT EXISTS (
      SELECT 1 FROM public.club_members m WHERE m.id = spec.id
        AND m.nickname COLLATE "C" = spec.nickname COLLATE "C" AND m.photo_url = spec.photo_url
        AND m.membership_type = 'extraordinary' AND m.club_role = 'staff'
        AND m.is_active IS FALSE AND m.lineup_enabled IS FALSE
        AND m.first_name IS NULL AND m.last_name IS NULL AND m.lawyer_license_no IS NULL AND m.phone IS NULL
        AND m.birth_day IS NULL AND m.birth_month IS NULL AND m.birth_year_be IS NULL AND m.shirt_number IS NULL
    ) THEN
      RAISE EXCEPTION 'Reserved Staff ID % differs from staging contract; transaction aborted.', spec.id;
    END IF;
  END LOOP;

  SELECT COALESCE(jsonb_object_agg(m.id::text, to_jsonb(m)), '{}'::jsonb)
    INTO existing_after FROM public.club_members m WHERE existing_before ? m.id::text;
  IF existing_after IS DISTINCT FROM existing_before THEN
    RAISE EXCEPTION 'An existing member changed; transaction aborted.';
  END IF;
  IF (SELECT count(*) FROM public.club_members) <> count_before + inserted_count THEN
    RAISE EXCEPTION 'Unexpected member count after staging; transaction aborted.';
  END IF;
END;
$migration$;

COMMIT;
