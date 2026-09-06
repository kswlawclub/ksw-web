// Offline source-contract checks, not a substitute for the live read-only verifier.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(resolve(root, path), "utf8");
const migration = read("supabase/migrations/202609060001_add_member_foundation_and_public_privacy.sql");
const verifier = read("scripts/sql/verify_club_members_phase1.sql");
const publicPaths = ["src/app/team/page.tsx", "src/app/lineup-builder/page.tsx"];

function allowlist(sql) {
  const array = sql.match(/public_columns CONSTANT text\[\] := ARRAY\[([\s\S]*?)\];/);
  assert.ok(array, "Missing canonical public_columns array");
  return [...array[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

function publicQuery(path) {
  const chain = read(path).match(/\.from\("club_members"\)([\s\S]*?)\.order\("([^"]+)", \{ ascending: (true|false) \}\)/);
  assert.ok(chain, `Public query shape changed: ${path}`);
  const columns = chain[1].match(/\.select\("([^"]+)"\)/)?.[1].split(",").map((name) => name.trim());
  assert.ok(columns);
  const filters = [...chain[1].matchAll(/\.eq\("([^"]+)", (true|false)\)/g)].map((match) => [match[1], match[2]]);
  return { columns, filters, order: chain[2], direction: chain[3] === "true" ? "ASC" : "DESC" };
}

function sourceFiles(directory) {
  return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(path) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
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

const normalize = (sql) => sql.replace(/\s+/g, " ").trim();

test("public club_members inventory has only Team and Lineup; Admin stays service-role guarded", () => {
  const queries = sourceFiles("src").filter((path) => /\.from\(["']club_members["']\)/.test(read(path)));
  assert.deepEqual(queries.sort(), [...publicPaths, "src/app/admin/members/actions.ts"].sort());
  for (const path of publicPaths) assert.match(read(path), /import \{ getSupabase \} from "@\/lib\/supabase"/);
  const admin = read("src/app/admin/members/actions.ts");
  assert.match(admin, /getSupabaseAdmin/);
  assert.match(admin, /await requireAdminSession\(\)/);
});

test("exact allowlist equals runtime SELECT/filter/order needs plus the two future public fields", () => {
  const required = new Set(["membership_type", "club_role"]);
  for (const path of publicPaths) {
    const query = publicQuery(path);
    [...query.columns, ...query.filters.map(([name]) => name), query.order].forEach((name) => required.add(name));
  }
  assert.deepEqual(allowlist(migration).sort(), [...required].sort());
  assert.deepEqual(allowlist(verifier), allowlist(migration));
  assert.equal(new Set(allowlist(migration)).size, 10);
});

test("sensitive/unneeded fields are excluded while display age and ordering remain usable", () => {
  for (const name of ["phone", "lawyer_license_no", "first_name", "last_name", "birth_day", "birth_month", "updated_at"]) {
    assert.ok(!allowlist(migration).includes(name), `${name} must not be public`);
  }
  assert.ok(allowlist(migration).includes("birth_year_be"));
  assert.ok(allowlist(migration).includes("created_at"));
});

test("frozen Phase 1 verifier preserves runtime query shapes; Phase 3 Lineup adds only pre-granted membership_type", () => {
  for (const [index, tag] of ["team", "lineup"].entries()) {
    const query = publicQuery(publicPaths[index]);
    // Do not rewrite an already-applied Phase 1 SQL artifact for a later query extension.
    if (tag === "lineup") {
      assert.ok(query.columns.includes("membership_type"));
      assert.ok(allowlist(migration).includes("membership_type"));
    }
    const phase1Columns = query.columns.filter((column) => tag !== "lineup" || column !== "membership_type");
    const expected = `SELECT ${phase1Columns.join(", ")} FROM public.club_members WHERE ${query.filters.map(([name, value]) => `${name} = ${value}`).join(" AND ")} ORDER BY ${query.order} ${query.direction} LIMIT 0`;
    const probe = verifier.match(new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`));
    assert.ok(probe);
    assert.equal(normalize(probe[1]), expected);
  }
});

test("foundation is additive, exact enums/defaults, and does not overwrite existing member fields", () => {
  assert.match(migration, /ADD COLUMN membership_type text NOT NULL DEFAULT 'ordinary'/);
  assert.match(migration, /ADD COLUMN club_role text NOT NULL DEFAULT 'member'/);
  assert.match(migration, /CHECK \(membership_type IN \('ordinary', 'extraordinary'\)\)/);
  assert.match(migration, /CHECK \(club_role IN \('member', 'staff', 'coach', 'assistant_coach'\)\)/);
  assert.equal((sqlCode(migration).match(/\bADD COLUMN\b/g) ?? []).length, 2);
  assert.doesNotMatch(sqlCode(migration), /\b(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE|CASCADE)\b/);
  assert.doesNotMatch(migration, /ADD COLUMN IF NOT EXISTS|public_visible/);
});

test("table-level and explicit column grants are revoked before exact column-only SELECT", () => {
  const revoke = migration.indexOf("REVOKE ALL PRIVILEGES ON TABLE public.club_members FROM PUBLIC, anon, authenticated RESTRICT");
  const columns = migration.indexOf("REVOKE ALL PRIVILEGES (%s)");
  const grant = migration.indexOf("GRANT SELECT (%s) ON TABLE public.club_members TO anon, authenticated");
  assert.ok(revoke > 0 && columns > revoke && grant > columns);
  assert.doesNotMatch(migration, /GRANT (?:ALL|SELECT) ON TABLE/);
  assert.match(migration, /string_agg\(format\('%I', a.attname\)/);
});

test("effective inherited/table/column privileges fail closed and MAINTAIN is version-aware", () => {
  for (const sql of [migration, verifier]) {
    assert.match(sql, /server_version_num'\)::integer >= 170000/);
    assert.match(sql, /array_append\(table_privileges, 'MAINTAIN'\)/);
    assert.match(sql, /has_table_privilege/);
    assert.match(sql, /has_column_privilege/);
    assert.match(sql, /'INSERT', 'UPDATE', 'REFERENCES'/);
    assert.match(sql, /SELECT WITH GRANT OPTION/);
    assert.doesNotMatch(sql, /aclexplode\s*\(/);
  }
  assert.match(migration, /IS DISTINCT FROM \(column_record.attname::text = ANY\(public_columns\)\)/);
  assert.doesNotMatch(migration, /EXCEPTION WHEN/);
});

test("migration preserves service-role privileges and the exact existing RLS catalog", () => {
  assert.match(migration, /service_after IS DISTINCT FROM service_before/);
  assert.match(migration, /policies_after IS DISTINCT FROM policies_before/);
  assert.match(migration, /IS DISTINCT FROM forced_rls_before/);
  assert.match(migration, /LOCK TABLE public.club_members IN ACCESS EXCLUSIVE MODE/);
  for (const sql of [migration, verifier]) {
    assert.doesNotMatch(sqlCode(sql), /\b(?:CREATE|ALTER|DROP) POLICY\b|\bDISABLE ROW LEVEL SECURITY\b|\bstorage\./i);
  }
});

test("verifier covers schema/default/check validation and immediate all-row backfill", () => {
  assert.match(verifier, /a.atttypid = 'text'::regtype AND a.attnotnull/);
  assert.match(verifier, /c.contype = 'c' AND c.convalidated/);
  assert.match(verifier, /pg_get_expr\(d.adbin, d.adrelid\)/);
  assert.match(verifier, /membership_type IS DISTINCT FROM 'ordinary' OR club_role IS DISTINCT FROM 'member'/);
  assert.match(verifier, /row_backfill_ok AND can_audit_all_rows/);
});

test("verifier denies every private column with 42501; errors and nulls cannot produce a pass", () => {
  assert.match(verifier, /FOREACH column_name IN ARRAY private_columns LOOP/);
  assert.match(verifier, /SELECT %I FROM public.club_members LIMIT 0/);
  assert.match(verifier, /IF SQLSTATE <> '42501' THEN/);
  assert.match(verifier, /unexpected_select_success/);
  assert.match(verifier, /attname IN \('phone', 'lawyer_license_no'\)/);
  assert.match(verifier, /WHERE value IS DISTINCT FROM 'true'::jsonb/);
  assert.match(verifier, /jsonb_array_length\(failed_checks\) = 0/);
});

test("RLS is checked using applicable policies and actual active/inactive visibility for both roles", () => {
  assert.match(verifier, /FOREACH role_name IN ARRAY ARRAY\['anon', 'authenticated'\]/);
  assert.match(verifier, /CASE WHEN id = 0::oid THEN false ELSE pg_has_role/);
  assert.match(verifier, /NOT COALESCE\(bool_or\(polpermissive AND NOT active_only\), false\)/);
  assert.match(verifier, /WHERE is_active IS NOT TRUE/);
  assert.match(verifier, /visible_active_count = active_count AND can_audit_all_rows/);
  assert.match(verifier, /service_role.all_columns_selectable/);
});

test("verifier is read-only and both scripts have balanced lexical structure", () => {
  const code = sqlCode(verifier);
  assert.match(code, /^\s*BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;/);
  assert.match(code, /ROLLBACK;\s*$/);
  assert.doesNotMatch(code, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|MERGE|COPY|CALL|GRANT|REVOKE|COMMIT)\b/);
  assert.match(sqlCode(migration), /^\s*BEGIN;/);
  assert.match(sqlCode(migration), /COMMIT;\s*$/);
  for (const sql of [migration, verifier]) {
    let depth = 0;
    for (const char of sqlCode(sql)) {
      if (char === "(") depth++;
      if (char === ")") depth--;
      assert.ok(depth >= 0);
    }
    assert.equal(depth, 0);
    assert.ok(sql.endsWith("\n"));
    assert.ok(sql.split("\n").every((line) => !/[ \t]+$/.test(line)));
  }
});

test("PL/pgSQL blocks balance and row visibility uses a consistent snapshot", () => {
  assert.match(verifier, /current_setting\('transaction_isolation'\) <> 'repeatable read'/);
  for (const [sql, tag] of [[migration, "migration"], [verifier, "verify"]]) {
    const body = sql.split(`$${tag}$`)[1];
    const stack = [];
    for (const token of sqlCode(body).matchAll(/\bBEGIN\b|\bEND(?:\s+IF|\s+LOOP)?\b|\bIF\b|\bLOOP\b|\bCASE\b/g)) {
      if (["BEGIN", "IF", "LOOP", "CASE"].includes(token[0])) {
        stack.push(token[0]);
      } else {
        const opening = stack.pop();
        if (token[0] === "END IF") assert.equal(opening, "IF");
        else if (token[0] === "END LOOP") assert.equal(opening, "LOOP");
        else assert.ok(["BEGIN", "CASE"].includes(opening));
      }
    }
    assert.equal(stack.length, 0);
  }
});
