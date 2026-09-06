-- Phase 2A: run the WHOLE script in Supabase SQL Editor as postgres/table owner.
-- Candidates are not identity confirmations. Review every source before Phase 2B.
-- no_match only means no nickname candidate, not proof that the person is absent.
-- Keep existing membership_type; this script never chooses a migration action.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;

DO $guard$
DECLARE
  member_table oid := to_regclass('public.club_members');
BEGIN
  IF current_setting('transaction_read_only') <> 'on' THEN
    RAISE EXCEPTION 'This audit requires a READ ONLY transaction.';
  END IF;
  IF member_table IS NULL THEN
    RAISE EXCEPTION 'public.club_members is missing.';
  END IF;
  -- An active-only public session cannot establish whether an inactive member exists.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_roles r ON r.rolname = current_user
    WHERE c.oid = member_table AND (
      NOT c.relrowsecurity OR r.rolsuper OR r.rolbypassrls
      OR (c.relowner = r.oid AND NOT c.relforcerowsecurity)
    )
  ) THEN
    RAISE EXCEPTION 'Use a role that can read all members, including inactive members.';
  END IF;
END;
$guard$;

WITH staff_source(source_order, source_nickname, source_image_path) AS (
  VALUES
    (1, 'เฟี๊ยต', '/images/staff/staff-01.png'),
    (2, 'เหงี่ยม', '/images/staff/staff-02.png'),
    (3, 'พาสต้า', '/images/staff/staff-03.png'),
    (4, 'โก้', '/images/staff/staff-04.png'),
    (5, 'หม่อมโจอี้', '/images/staff/staff-05.png'),
    (6, 'เด่น', '/images/staff/staff-06.png')
), member_rows AS (
  SELECT m.id, m.nickname, m.is_active, m.membership_type, m.club_role, m.photo_url
  FROM public.club_members m
), nickname_keys AS (
  -- One normalization rule for both sources: collapse/trim whitespace, strip one
  -- leading Thai lawyer prefix, and lowercase. No fuzzy/substring/accent matching.
  SELECT names.nickname,
    lower(btrim(regexp_replace(
      btrim(regexp_replace(names.nickname, '[[:space:]]+', ' ', 'g')),
      '^ทนาย[[:space:]]*', ''
    ))) AS normalized_nickname
  FROM (
    SELECT source_nickname COLLATE "C" AS nickname FROM staff_source
    UNION
    SELECT nickname COLLATE "C" FROM member_rows
  ) names
), candidates AS (
  SELECT s.source_order, m.id, m.nickname, m.is_active, m.membership_type, m.club_role, m.photo_url,
    CASE WHEN m.nickname COLLATE "C" = s.source_nickname COLLATE "C" THEN 0 ELSE 1 END AS match_priority
  FROM staff_source s
  JOIN nickname_keys source_key ON source_key.nickname = s.source_nickname COLLATE "C"
  JOIN nickname_keys member_key ON member_key.normalized_nickname = source_key.normalized_nickname
    AND source_key.normalized_nickname <> ''
  JOIN member_rows m ON m.nickname COLLATE "C" = member_key.nickname
)
SELECT
  s.source_nickname,
  s.source_image_path,
  CASE
    WHEN count(c.id) = 0 THEN 'no_match'
    WHEN count(c.id) > 1 THEN 'ambiguous'
    WHEN min(c.match_priority) = 0 THEN 'exact_candidate'
    ELSE 'normalized_candidate'
  END AS mapping_status,
  count(c.id)::integer AS candidate_count,
  true AS manual_identity_review_required,
  COALESCE(jsonb_agg(jsonb_build_object(
    'match_type', CASE WHEN c.match_priority = 0 THEN 'exact_nickname' ELSE 'normalized_nickname' END,
    'id', c.id,
    'nickname', c.nickname,
    'is_active', c.is_active,
    'membership_type', c.membership_type,
    'club_role', c.club_role,
    'photo_url', c.photo_url
  ) ORDER BY c.match_priority, c.id) FILTER (WHERE c.id IS NOT NULL), '[]'::jsonb) AS candidates
FROM staff_source s
LEFT JOIN candidates c ON c.source_order = s.source_order
GROUP BY s.source_order, s.source_nickname, s.source_image_path
ORDER BY s.source_order;

ROLLBACK;
