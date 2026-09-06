// Offline source contracts and fixture models, not PostgreSQL execution.
// Production approval still requires the read-only staging verifier to pass.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(resolve(root, path), "utf8");
const migrationName = "202609060002_stage_static_team_staff.sql";
const migration = read(`supabase/migrations/${migrationName}`);
const verifier = read("scripts/sql/verify_team_staff_staging.sql");
const protectedId = "0d3ec2a6-7f44-4579-a98d-64232fda2db1";
const fixedIds = [
  "e950da1b-7788-4e80-bcec-9a8f6e5d1397",
  "84a1bd85-ba18-412f-b783-da4c01d9088d",
  "f8fe38e1-201e-4327-a645-a17140079e93",
  "77eb3cde-3815-4c4a-b33c-3dff615a4e70",
  "749c89b3-9953-433f-904a-50429442ec14",
  "37f8ab40-e282-4619-a4e7-c7307f4665ea",
];
const nullFields = [
  "first_name", "last_name", "lawyer_license_no", "phone",
  "birth_day", "birth_month", "birth_year_be", "shirt_number",
];

function manifest(sql) {
  const data = sql.match(/staff_manifest CONSTANT jsonb := \$staff\$([\s\S]*?)\$staff\$::jsonb;/);
  assert.ok(data, "Missing canonical fixed-ID manifest");
  return JSON.parse(data[1]);
}

function sqlCode(source) {
  let output = "";
  for (let index = 0; index < source.length;) {
    if (source.startsWith("--", index)) {
      const end = source.indexOf("\n", index);
      index = end < 0 ? source.length : end;
      output += " ";
    } else if (source[index] === "'") {
      let closed = false;
      index++;
      while (index < source.length) {
        if (source[index] === "'") {
          if (source[index + 1] === "'") { index += 2; continue; }
          index++;
          closed = true;
          break;
        }
        index++;
      }
      assert.ok(closed, "Unclosed SQL string");
      output += " ";
    } else {
      const tag = source.slice(index).match(/^\$([a-z_]+)\$/i);
      if (tag) {
        const start = index + tag[0].length;
        const end = source.indexOf(tag[0], start);
        assert.ok(end >= 0, "Unclosed dollar quote");
        output += ["migration", "verify"].includes(tag[1]) ? ` ${sqlCode(source.slice(start, end))} ` : " ";
        index = end + tag[0].length;
      } else {
        output += source[index++];
      }
    }
  }
  return output;
}

// Read the actual INSERT projection into a fixture model; do not duplicate seed data.
function insertedRows() {
  const insert = migration.match(/INSERT INTO public\.club_members \(([\s\S]*?)\)\s*SELECT ([\s\S]*?)\s+FROM jsonb_to_recordset/);
  assert.ok(insert);
  const columns = insert[1].split(",").map((value) => value.trim());
  const values = insert[2].split(",").map((value) => value.trim());
  assert.equal(columns.length, values.length);
  return manifest(migration).map((spec) => Object.fromEntries(columns.map((column, index) => {
    const expression = values[index];
    if (/^s\.(id|nickname|photo_url)$/.test(expression)) return [column, spec[expression.slice(2)]];
    if (expression === "NULL") return [column, null];
    if (expression === "false") return [column, false];
    assert.match(expression, /^'(extraordinary|staff)'$/);
    return [column, expression.slice(1, -1)];
  })));
}

// Models the fixed-ID/no-overwrite/postcondition contract, not a SQL interpreter.
function stageModel(before) {
  const protectedMember = before.find((member) => member.id === protectedId);
  assert.ok(protectedMember?.nickname === "โก้" && protectedMember.membership_type === "ordinary" && protectedMember.club_role === "member", "Protected baseline mismatch");
  const result = structuredClone(before);
  for (const expected of insertedRows()) {
    const existing = result.find((member) => member.id === expected.id);
    if (existing) {
      for (const [column, value] of Object.entries(expected)) assert.deepEqual(existing[column], value, "Reserved ID collision/drift");
    } else {
      result.push(expected);
    }
  }
  return result;
}

const ordinaryGo = {
  id: protectedId, nickname: "โก้", membership_type: "ordinary", club_role: "member",
  is_active: true, lineup_enabled: true, created_at: "existing-timestamp", unchanged_marker: "original",
};

test("migration follows Phase 1 in the existing ordered migration directory", () => {
  const names = readdirSync(resolve(root, "supabase/migrations")).sort();
  assert.equal(names[names.indexOf(migrationName) - 1], "202609060001_add_member_foundation_and_public_privacy.sql");
});

test("six fixed UUIDs are identical in migration/verifier and separate from ordinary Go", () => {
  const staff = manifest(migration);
  assert.deepEqual(manifest(verifier), staff);
  assert.deepEqual(staff.map((member) => member.id), fixedIds);
  assert.equal(new Set(fixedIds).size, 6);
  for (const id of fixedIds) {
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(id, protectedId);
  }
});

test("names/photo paths match the unchanged Public static array and assets exist", () => {
  const source = [...read("src/app/team/page.tsx").matchAll(/\["([^"]+)", "(\/images\/staff\/staff-\d+\.png)"\]/g)].map((match) => [match[1], match[2]]);
  assert.equal(source.length, 6);
  assert.deepEqual(manifest(migration).map((member) => [member.nickname, member.photo_url]), source);
  for (const [, path] of source) assert.ok(existsSync(resolve(root, `public${path}`)));
});

test("actual INSERT sets extraordinary/staff, inactive, lineup off and all unsupplied fields NULL", () => {
  for (const row of insertedRows()) {
    assert.equal(row.membership_type, "extraordinary");
    assert.equal(row.club_role, "staff");
    assert.equal(row.is_active, false);
    assert.equal(row.lineup_enabled, false);
    for (const field of nullFields) assert.equal(row[field], null);
    assert.deepEqual(Object.keys(row).sort(), ["id", "nickname", "photo_url", "membership_type", "club_role", "is_active", "lineup_enabled", ...nullFields].sort());
  }
});

test("migration is atomic, serializes writes and inserts only by UUID without updating conflicts", () => {
  const code = sqlCode(migration);
  assert.match(code, /^\s*BEGIN;/);
  assert.match(code, /COMMIT;\s*$/);
  assert.match(migration, /SET LOCAL lock_timeout = '5s'/);
  const lock = migration.indexOf("LOCK TABLE public.club_members IN SHARE ROW EXCLUSIVE MODE");
  assert.ok(lock > 0 && lock < migration.indexOf("INTO count_before, existing_before"));
  assert.equal((code.match(/\bINSERT INTO\b/g) ?? []).length, 1);
  assert.match(migration, /WHERE NOT EXISTS \(SELECT 1 FROM public\.club_members m WHERE m\.id = s\.id\)\s+ON CONFLICT \(id\) DO NOTHING;/);
  assert.doesNotMatch(code, /\b(?:UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|MERGE|GRANT|REVOKE|COPY|CALL)\b/);
  assert.doesNotMatch(migration, /ON CONFLICT \(nickname\)|gen_random_uuid|uuid_generate|lower\(|regexp_replace|ILIKE/);
  assert.doesNotMatch(migration, /EXCEPTION WHEN|RAISE NOTICE|RAISE WARNING/);
});

test("postcondition validates every ID after bulk INSERT; mismatch aborts the entire transaction", () => {
  const insert = migration.indexOf("INSERT INTO public.club_members");
  const validate = migration.indexOf("FOR spec IN");
  assert.ok(validate > insert);
  assert.match(migration, /WHERE m\.id = spec\.id/);
  assert.match(migration, /m\.nickname COLLATE "C" = spec\.nickname COLLATE "C" AND m\.photo_url = spec\.photo_url/);
  assert.match(migration, /m\.membership_type = 'extraordinary' AND m\.club_role = 'staff'/);
  assert.match(migration, /m\.is_active IS FALSE AND m\.lineup_enabled IS FALSE/);
  for (const field of nullFields) assert.ok(migration.includes(`m.${field} IS NULL`));
  assert.match(migration, /RAISE EXCEPTION 'Reserved Staff ID % differs from staging contract; transaction aborted.', spec\.id/);
});

test("all existing rows and protected ordinary Go are checked without exposing snapshots", () => {
  for (const sql of [migration, verifier]) {
    assert.ok(sql.includes(`protected_member_id CONSTANT uuid := '${protectedId}'`));
    assert.match(sql, /m\.nickname COLLATE "C" = 'โก้' AND m\.membership_type = 'ordinary' AND m\.club_role = 'member'/);
    assert.match(sql, /rolsuper OR r\.rolbypassrls OR \(c\.relowner = r\.oid AND NOT c\.relforcerowsecurity\)/);
    assert.match(sql, /has_table_privilege\(current_user, member_table, 'SELECT'\)/);
  }
  assert.match(migration, /WHERE existing_before \? m\.id::text/);
  assert.match(migration, /existing_after IS DISTINCT FROM existing_before/);
  assert.match(migration, /GET DIAGNOSTICS inserted_count = ROW_COUNT/);
  assert.match(migration, /<> count_before \+ inserted_count/);
  assert.doesNotMatch(migration, /set_config|RETURNING/);
});

test("fixture model: first run adds six inactive people and preserves all existing records", () => {
  const before = [ordinaryGo, { ...ordinaryGo, id: "another-existing-id", nickname: "เฟี๊ยต" }];
  const untouched = structuredClone(before);
  const result = stageModel(before);
  assert.deepEqual(before, untouched);
  assert.deepEqual(result.slice(0, before.length), untouched);
  assert.equal(result.length, before.length + 6);
  assert.equal(result.filter((member) => member.nickname === "โก้").length, 2);
  assert.equal(result.filter((member) => member.nickname === "เฟี๊ยต").length, 2);
});

test("fixture model: full rerun is a no-op, including timestamps/other existing fields", () => {
  const once = stageModel([ordinaryGo]);
  once[1].created_at = "original-staff-created-at";
  assert.deepEqual(stageModel(once), once);
});

test("fixture model: each partial prefix retry creates only missing UUIDs", () => {
  for (let count = 0; count <= 6; count++) {
    const before = [ordinaryGo, ...insertedRows().slice(0, count)];
    const result = stageModel(before);
    assert.equal(result.length, 7);
    assert.equal(new Set(result.map((member) => member.id)).size, 7);
    assert.deepEqual(result.slice(0, before.length), before);
  }
});

test("fixture model: reserved ID collision or later activation/edit aborts; no changes to input", () => {
  for (const change of [
    { nickname: "different person" }, { photo_url: "/different.png" },
    { membership_type: "ordinary" }, { club_role: "coach" },
    { is_active: true }, { lineup_enabled: true }, { first_name: "already edited" },
  ]) {
    const before = [ordinaryGo, { ...insertedRows()[5], ...change }];
    const original = structuredClone(before);
    assert.throws(() => stageModel(before), /Reserved ID collision\/drift/);
    assert.deepEqual(before, original);
  }
  assert.throws(() => stageModel([]), /Protected baseline mismatch/);
  assert.throws(() => stageModel([{ ...ordinaryGo, membership_type: "extraordinary" }]), /Protected baseline mismatch/);
});

test("verifier returns all required current-state checks and fails closed on missing rows/errors", () => {
  for (const name of ["exists", "nickname_photo_match", "extraordinary_staff", "inactive_lineup_disabled", "unsupplied_fields_null", "protected_ordinary_member_exists", "protected_ordinary_member_identity_and_role", "staff_go_is_a_separate_member"]) {
    assert.ok(verifier.includes(`'${name}'`));
  }
  assert.match(verifier, /count\(\*\) = 1/);
  assert.match(verifier, /WHERE m\.id = spec\.id/);
  assert.match(verifier, /m\.id <> protected_member_id/);
  assert.match(verifier, /IF can_audit_all_rows AND manifest_ok THEN/);
  assert.match(verifier, /'row_verification_succeeded', false/);
  assert.match(verifier, /'row_verification_error_sqlstate', SQLSTATE/);
  assert.match(verifier, /WHERE value IS DISTINCT FROM 'true'::jsonb/);
  assert.match(verifier, /'overall_pass', jsonb_array_length\(failed_checks\) = 0/);
  for (const field of nullFields) assert.ok(verifier.includes(`m.${field} IS NULL`));
});

test("verifier emits only manifest fields and booleans, never private member values", () => {
  assert.doesNotMatch(verifier, /to_jsonb\(m\)|m\.\*|SQLERRM|GET STACKED DIAGNOSTICS|RAISE (?:NOTICE|WARNING)/);
  for (const field of nullFields) {
    assert.equal((verifier.match(new RegExp(`\\bm\\.${field}\\b`, "g")) ?? []).length, 1);
    assert.ok(verifier.includes(`m.${field} IS NULL`));
  }
  assert.match(verifier, /'id', spec\.id, 'nickname', spec\.nickname, 'photo_url', spec\.photo_url, 'checks', staff_checks/);
  assert.match(verifier, /AS overall_pass,[\s\S]*AS failed_checks,[\s\S]*AS details/);
});

test("verifier is READ ONLY/ROLLBACK, with no mutation or member-data materialization", () => {
  const code = sqlCode(verifier);
  assert.match(code, /^\s*BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;/);
  assert.match(code, /ROLLBACK;\s*$/);
  assert.doesNotMatch(code, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|MERGE|COPY|CALL|GRANT|REVOKE|COMMIT)\b/);
  assert.match(verifier, /current_setting\('transaction_read_only'\) <> 'on'/);
  assert.match(verifier, /current_setting\('transaction_isolation'\) <> 'repeatable read'/);
});

test("SQL lexical delimiters, PL/pgSQL blocks and whitespace are balanced", () => {
  for (const [sql, tag] of [[migration, "migration"], [verifier, "verify"]]) {
    let depth = 0;
    for (const char of sqlCode(sql)) {
      if (char === "(") depth++;
      if (char === ")") depth--;
      assert.ok(depth >= 0);
    }
    assert.equal(depth, 0);
    const stack = [];
    for (const token of sqlCode(sql.split(`$${tag}$`)[1]).matchAll(/\bBEGIN\b|\bEND(?:\s+IF|\s+LOOP)?\b|\bIF\b|\bLOOP\b|\bCASE\b/g)) {
      if (["BEGIN", "IF", "LOOP", "CASE"].includes(token[0])) stack.push(token[0]);
      else {
        const opening = stack.pop();
        if (token[0] === "END IF") assert.equal(opening, "IF");
        else if (token[0] === "END LOOP") assert.equal(opening, "LOOP");
        else assert.ok(["BEGIN", "CASE"].includes(opening));
      }
    }
    assert.equal(stack.length, 0);
    assert.ok(sql.endsWith("\n"));
    assert.ok(sql.split("\n").every((line) => !/[ \t]+$/.test(line)));
  }
});
