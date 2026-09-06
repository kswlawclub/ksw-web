// Offline SQL source contracts and synthetic fixtures, never a Production DB connection.
// Catalog/RLS enforcement still requires the companion read-only PostgreSQL verifier.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const migrationName = "202609060003_add_member_football_rating_foundation.sql";
const migration = read(`supabase/migrations/${migrationName}`);
const verifier = read("scripts/sql/verify_member_football_rating_foundation.sql");
const foundation = read("supabase/migrations/202609060001_add_member_foundation_and_public_privacy.sql");
const playerStats = ["pace", "shooting", "passing", "dribbling", "defending", "physical"];
const gkStats = ["gk_diving", "gk_handling", "gk_kicking", "gk_reflexes", "gk_speed", "gk_positioning"];
const stats = [...playerStats, ...gkStats];
const compact = (text) => text.replace(/\s+/g, " ").trim();
const generated = migration.match(/overall integer GENERATED ALWAYS AS \(([\s\S]*?)\) STORED NOT NULL/)[1];
const shape = migration.match(/CONSTRAINT cmfr_stat_shape CHECK \(([\s\S]*?)\n    \)/)[1];

function sqlCode(source) {
  let code = "";
  for (let index = 0; index < source.length;) {
    if (source.startsWith("--", index)) {
      const end = source.indexOf("\n", index);
      index = end < 0 ? source.length : end;
      code += " ";
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
      code += " ";
    } else {
      const tag = source.slice(index).match(/^\$([a-z_]+)\$/i);
      if (tag) {
        const start = index + tag[0].length;
        const end = source.indexOf(tag[0], start);
        assert.ok(end >= 0, "Unclosed dollar quote");
        code += ["migration", "verify"].includes(tag[1]) ? ` ${sqlCode(source.slice(start, end))} ` : " ";
        index = end + tag[0].length;
      } else code += source[index++];
    }
  }
  return code;
}

// Read the exact required/NULL fields from each SQL shape branch for fixture checks.
const shapeBranches = shape.split(/\n\s+OR\n/).map((branch) => ({
  type: branch.match(/rating_type = '([^']+)'/)[1],
  required: [...branch.matchAll(/AND (\w+) IS NOT NULL/g)].map((match) => match[1]),
  absent: [...branch.matchAll(/AND (\w+) IS NULL/g)].map((match) => match[1]),
}));
function acceptsShape(row) {
  const branch = shapeBranches.find((item) => item.type === row.rating_type);
  return !!branch && branch.required.every((name) => Number.isInteger(row[name]) && row[name] >= 1 && row[name] <= 99)
    && branch.absent.every((name) => row[name] == null);
}
function fixture(type, value = 50) {
  const selected = type === "player" ? playerStats : gkStats;
  return { member_id: "synthetic-member", rating_type: type, ...Object.fromEntries(stats.map((name) => [name, selected.includes(name) ? value : null])) };
}
const overallBranches = [...generated.matchAll(/round\(\(([^)]+)\)::numeric \/ 6\)::integer/g)].map((match) => match[1].split("+").map((name) => name.trim()));
function overall(row) {
  return Math.round(overallBranches[row.rating_type === "player" ? 0 : 1].reduce((sum, name) => sum + row[name], 0) / 6);
}

test("migration is next in order, atomic, additive, seedless, and fails closed on existing objects", () => {
  const migrations = readdirSync(new URL("../../supabase/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).sort();
  assert.equal(migrations.at(-1), migrationName);
  assert.equal(migrations.at(-2), "202609060002_stage_static_team_staff.sql");
  assert.match(sqlCode(migration), /^\s*BEGIN;/);
  assert.match(sqlCode(migration), /COMMIT;\s*$/);
  assert.match(migration, /SET LOCAL lock_timeout = '5s'/);
  assert.match(migration, /to_regclass\('public.club_member_football_ratings'\) IS NOT NULL/);
  assert.doesNotMatch(sqlCode(migration), /\bINSERT\s+INTO\b|\b(?:UPDATE|DELETE\s+FROM)\s+public\.|\bDROP\b|\bTRUNCATE\s+(?:TABLE\s+)?public\./i);
  assert.doesNotMatch(migration, /CREATE OR REPLACE|CREATE TABLE IF NOT EXISTS|ON CONFLICT/);
});

test("optional one-to-one identity FK restricts hard deletion; no classification/lineup/season coupling", () => {
  assert.match(migration, /member_id uuid PRIMARY KEY REFERENCES public\.club_members\(id\) ON DELETE RESTRICT/);
  const table = migration.match(/CREATE TABLE public\.club_member_football_ratings \(([\s\S]*?)\n  \);/)[1];
  assert.doesNotMatch(table, /membership_type|club_role|lineup_enabled|season|history|is_active/);
  assert.doesNotMatch(migration, /ALTER TABLE public\.club_members|CREATE TRIGGER[\s\S]*?ON public\.club_members/);
  assert.match(verifier, /c\.conkey = ARRAY\[member_id_att\]/);
  assert.match(verifier, /c\.confkey = ARRAY\[parent_id_att\]/);
  assert.match(verifier, /c\.confdeltype = 'r'.*c\.confupdtype = 'a'/);
  assert.match(verifier, /i\.indisvalid AND i\.indisunique/);
});

test("exact two types; all twelve nullable stat columns have independently validated integer ranges", () => {
  assert.match(migration, /rating_type text NOT NULL/);
  assert.match(migration, /CHECK \(rating_type IN \('player', 'goalkeeper'\)\)/);
  for (const name of stats) {
    assert.match(migration, new RegExp(`\\b${name} smallint,`));
    assert.match(migration, new RegExp(`CONSTRAINT cmfr_${name}_range CHECK \\(${name} BETWEEN 1 AND 99\\)`));
  }
  assert.equal((migration.match(/smallint,/g) ?? []).length, 12);
  assert.deepEqual(shapeBranches, [
    { type: "player", required: playerStats, absent: gkStats },
    { type: "goalkeeper", required: gkStats, absent: playerStats },
  ]);
});

test("both six-stat shapes accept 1/99 and reject missing stats, mixed types and out-of-range values", () => {
  for (const branch of shapeBranches) {
    for (const value of [1, 50, 99]) assert.equal(acceptsShape(fixture(branch.type, value)), true);
    for (const field of branch.required) {
      for (const value of [null, undefined, 0, -1, 100, 1000, 1.5, "50", NaN]) assert.equal(acceptsShape({ ...fixture(branch.type), [field]: value }), false);
    }
    for (const field of branch.absent) assert.equal(acceptsShape({ ...fixture(branch.type), [field]: 1 }), false);
  }
  for (const rating_type of [null, undefined, "", "Player", "GOALKEEPER", "coach"]) assert.equal(acceptsShape({ ...fixture("player"), rating_type }), false);
  assert.equal(acceptsShape({ ...fixture("player"), rating_type: "goalkeeper" }), false);
});

test("overall is stored GENERATED ALWAYS, NOT NULL, numeric division, never an editable default", () => {
  assert.deepEqual(overallBranches, [playerStats, gkStats]);
  assert.equal(compact(generated), compact(verifier.match(/\$overall\$([\s\S]*?)\$overall\$/)[1]));
  assert.doesNotMatch(generated, /now\(|random\(|SELECT|COALESCE|membership_type|club_role/);
  assert.doesNotMatch(migration, /overall[^\n]*DEFAULT|NEW\.overall/);
  assert.match(verifier, /a\.attgenerated = 's'/);
  assert.match(verifier, /overall_exact_generated_expression/);
  // Every possible sum of six legal stats, including all half-integer rounding boundaries.
  for (const type of ["player", "goalkeeper"]) for (let sum = 6; sum <= 594; sum++) {
    const row = fixture(type, 1);
    let extra = sum - 6;
    for (const name of type === "player" ? playerStats : gkStats) {
      const delta = Math.min(extra, 98);
      row[name] += delta;
      extra -= delta;
    }
    assert.equal(acceptsShape(row), true);
    assert.equal(overall(row), Math.floor((sum + 3) / 6));
  }
  const changed = fixture("player", 10);
  assert.equal(overall(changed), 10);
  changed.pace = 99;
  assert.equal(overall(changed), 25);
});

test("rating trigger reuses the audited Live function without defining or changing any function", () => {
  assert.match(migration, /BEFORE UPDATE ON public\.club_member_football_ratings\s+FOR EACH ROW EXECUTE FUNCTION public\.set_updated_at\(\)/);
  assert.equal((sqlCode(migration).match(/CREATE TRIGGER/g) ?? []).length, 1);
  assert.doesNotMatch(sqlCode(migration), /\b(?:CREATE|ALTER|DROP)(?: OR REPLACE)? FUNCTION\b|\b(?:GRANT|REVOKE)[^;]*ON FUNCTION\b/);
  assert.doesNotMatch(migration + verifier, /set_club_member_football_rating_updated_at/);
  assert.match(migration, /updated_at_function_after IS DISTINCT FROM updated_at_function_before/);
  assert.equal((migration.match(/SELECT to_jsonb\(p\) INTO updated_at_function_(?:before|after)/g) ?? []).length, 2);
  assert.equal((migration.match(/'user_triggers',[\s\S]*?NOT t\.tgisinternal/g) ?? []).length, 2);
  assert.doesNotMatch(sqlCode(migration), /\b(?:ALTER|DROP) TRIGGER\b/);
  assert.match(verifier, /t\.tgtype = 19.*t\.tgenabled = 'O'/);
  assert.match(verifier, /t\.tgname = 'club_member_football_ratings_updated_at' AND t\.tgfoid = updated_at_function/);
  // Do not impose the deleted function's security/search_path settings on the existing Live function.
  assert.doesNotMatch(verifier, /NOT p\.prosecdef|p\.proconfig = ARRAY/);
});

test("existing timestamp function prerequisites fail before creating the rating table", () => {
  const createTable = migration.indexOf("CREATE TABLE public.club_member_football_ratings");
  for (const check of ["IF updated_at_function IS NULL THEN", "p.prorettype = 'trigger'::regtype", "p.prokind = 'f' AND p.pronargs = 0", "NOT p.proretset", "l.lanname = 'plpgsql'", "~ updated_at_body_pattern", "t.tgname = 'set_club_members_updated_at'", "has_function_privilege(current_user, updated_at_function, 'EXECUTE')", "has_function_privilege('service_role', updated_at_function, 'EXECUTE')"]) {
    assert.ok(migration.indexOf(check) > 0 && migration.indexOf(check) < createTable, check);
  }
  assert.match(migration, /Required existing function public\.set_updated_at\(\) is missing/);
  assert.match(migration, /Review its signature\/body read-only; do not replace the shared function/);
  for (const sql of [migration, verifier]) {
    assert.match(sql, /to_regprocedure\('public\.set_updated_at\(\)'\)/);
    assert.match(sql, /t\.tgname = 'set_club_members_updated_at' AND t\.tgfoid = updated_at_function/);
  }
  for (const key of ["existing_updated_at_function", "existing_updated_at_function_compatible", "existing_member_updated_at_trigger"]) assert.ok(verifier.includes(`'${key}'`));
  assert.match(verifier, /has_function_privilege\(role_oid, updated_at_function, 'EXECUTE'\)/);
});

test("migration and verifier accept the same generic setter bodies and reject unverified table-specific bodies", () => {
  const pattern = (sql) => sql.match(/updated_at_body_pattern CONSTANT text := '([^']+)'/)[1];
  assert.equal(pattern(migration), pattern(verifier));
  const compatible = (body) => new RegExp(pattern(migration)).test(body.toLowerCase().replace(/\s+/g, ""));
  for (const assignment of ["=", ":="]) for (const timestamp of ["now()", "pg_catalog.now()", "CURRENT_TIMESTAMP", "transaction_timestamp()", "pg_catalog.transaction_timestamp()"]) {
    assert.equal(compatible(`BEGIN\n NEW.updated_at ${assignment} ${timestamp};\n RETURN NEW;\nEND;`), true);
  }
  for (const body of ["", "BEGIN RETURN NEW; END;", "BEGIN NEW.updated_at = now(); RETURN OLD; END;", "BEGIN NEW.updated_at = now(); NEW.nickname = 'edited'; RETURN NEW; END;", "BEGIN UPDATE public.club_members SET updated_at = now(); RETURN NEW; END;", "BEGIN NEW.updated_at = custom_timestamp(); RETURN NEW; END;", "BEGIN NEW.updated_at = now(); -- RETURN NEW; END;"]) {
    assert.equal(compatible(body), false);
  }
});

test("RLS permits active-member SELECT only, independent of role, membership type and lineup", () => {
  const policy = migration.match(/CREATE POLICY club_member_football_ratings_active_select([\s\S]*?)\);/)[1];
  assert.equal(compact(policy), "ON public.club_member_football_ratings FOR SELECT TO anon, authenticated USING (EXISTS ( SELECT 1 FROM public.club_members m WHERE m.id = club_member_football_ratings.member_id AND m.is_active IS TRUE )");
  assert.match(migration, /ALTER TABLE public\.club_member_football_ratings ENABLE ROW LEVEL SECURITY/);
  assert.equal((migration.match(/CREATE POLICY/g) ?? []).length, 1);
  assert.match(verifier, /count\(\*\) = 1 AND bool_and\(p\.polcmd = 'r'/);
  assert.match(verifier, /rating_active_only_policy_contract/);
  assert.match(verifier, /actual_visible_ids IS NOT DISTINCT FROM expected_visible_ids/);
  assert.match(verifier, /expected_visible_ids IS NOT NULL/);
});

test("new-table default/inherited public writes and grant options are removed and checked effectively", () => {
  const revoke = migration.indexOf("REVOKE ALL PRIVILEGES ON TABLE public.club_member_football_ratings FROM PUBLIC, anon, authenticated RESTRICT");
  const columnRevoke = migration.indexOf("REVOKE ALL PRIVILEGES (%s) ON TABLE public.club_member_football_ratings");
  const grant = migration.indexOf("GRANT SELECT ON TABLE public.club_member_football_ratings TO anon, authenticated");
  assert.ok(revoke > 0 && columnRevoke > revoke && grant > columnRevoke);
  assert.match(migration, /GRANT ALL PRIVILEGES ON TABLE public\.club_member_football_ratings TO service_role/);
  for (const sql of [migration, verifier]) {
    assert.match(sql, /has_table_privilege/);
    assert.match(sql, /has_column_privilege/);
    assert.match(sql, /'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'/);
    assert.match(sql, /'INSERT', 'UPDATE', 'REFERENCES', 'SELECT WITH GRANT OPTION'/);
    assert.match(sql, /server_version_num'\)::integer >= 170000/);
    assert.match(sql, /array_append\(table_privileges, 'MAINTAIN'\)/);
    assert.doesNotMatch(sql, /aclexplode|array_agg\([^)]*(?:relacl|attacl)/);
  }
});

test("member privacy catalog is preserved exactly with no grants/policies/rows/storage changed", () => {
  assert.match(migration, /member_security_after IS DISTINCT FROM member_security_before/);
  for (const field of ["relacl", "attacl", "relrowsecurity", "relforcerowsecurity", "pg_policy"]) assert.ok(migration.includes(field));
  assert.doesNotMatch(migration, /(?:GRANT|REVOKE)[^;]+ON TABLE public\.club_members|ALTER TABLE public\.club_members|ON public\.club_members (?:FOR|USING)/);
  for (const sql of [migration, verifier]) assert.doesNotMatch(sqlCode(sql), /\bstorage\./i);
  const columns = (sql) => sql.match(/public_columns CONSTANT text\[\] := ARRAY\[([\s\S]*?)\];/)[1].match(/'[^']+'/g);
  assert.deepEqual(columns(verifier), columns(foundation));
  assert.match(verifier, /member_privacy_exact/);
  assert.match(verifier, /member_active_only_policy/);
  assert.match(verifier, /service_role.member_privileges_intact/);
  assert.doesNotMatch(verifier, /phase1_rows_backfilled/);
});

test("verifier fails closed on absent schema, drift, role errors and non-42501 privacy errors", () => {
  for (const key of ["rating_table_exists", "club_members_exists", "exact_column_count", "audit_can_see_all_rows", "timestamp_trigger", "stored_overall_consistent", "no_rating_column_writes_or_grant"]) assert.ok(verifier.includes(key));
  assert.match(verifier, /c\.convalidated/);
  assert.match(verifier, /IF SQLSTATE <> '42501' THEN denials_ok := false/);
  assert.match(verifier, /WHERE value IS DISTINCT FROM 'true'::jsonb/);
  assert.match(verifier, /jsonb_array_length\(failed_checks\) = 0/);
  assert.match(verifier, /SET LOCAL ROLE %I/);
  assert.match(verifier, /SELECT \* FROM public\.club_member_football_ratings LIMIT 0/);
  assert.match(verifier, /sensitive_member_columns_denied_42501/);
  assert.doesNotMatch(verifier, /SQLERRM/);
});

test("read-only verifier exercises actual constraint/generated expressions with synthetic composite values", () => {
  assert.match(verifier, /jsonb_populate_record\(NULL::public\.club_member_football_ratings, \$1\)/);
  assert.match(verifier, /SELECT \(' \|\| shape_expression \|\| '\) IS FALSE/);
  assert.match(verifier, /overall_synthetic_probes/);
  assert.match(verifier, /stat_shape_synthetic_probes/);
  assert.match(verifier, /ARRAY\[6, 7, 8, 9, 11, 12, 297, 591, 594\]/);
  assert.match(verifier, /probe_overall IS NOT DISTINCT FROM round\(test_sum::numeric \/ 6\)::integer/);
  const overallCheck = verifier.slice(verifier.indexOf("'overall_exact_generated_expression'"), verifier.indexOf("overall_expression := expression"));
  assert.doesNotMatch(overallCheck, /normalize_pattern/);
  assert.match(overallCheck, /\/6::numeric/);
});

test("verifier is read-only/rollback and reports booleans, not member IDs or private values", () => {
  const code = sqlCode(verifier);
  assert.match(code, /^\s*BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;/);
  assert.match(code, /ROLLBACK;\s*$/);
  assert.doesNotMatch(code, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|MERGE|COPY|CALL|GRANT|REVOKE|COMMIT)\b/i);
  const reporting = verifier.slice(verifier.indexOf("details := details || jsonb_build_object('checks'"));
  assert.doesNotMatch(reporting, /actual_visible_ids|expected_visible_ids|nickname|photo_url|phone|lawyer_license_no/);
  for (const output of ["overall_pass", "failed_checks", "details"]) assert.ok(reporting.includes(`AS ${output}`));
});

test("SQL delimiters, parentheses and PL/pgSQL blocks balance", () => {
  for (const sql of [migration, verifier]) {
    let depth = 0;
    for (const char of sqlCode(sql)) {
      if (char === "(") depth++;
      if (char === ")") depth--;
      assert.ok(depth >= 0);
    }
    assert.equal(depth, 0);
    const stack = [];
    const tag = sql === migration ? "migration" : "verify";
    for (const token of sqlCode(sql.split(`$${tag}$`)[1]).matchAll(/\bBEGIN\b|\bEND(?:\s+IF|\s+LOOP)?\b|\bIF\b|\bLOOP\b|\bCASE\b/g)) {
      if (["BEGIN", "IF", "LOOP", "CASE"].includes(token[0])) stack.push(token[0]);
      else {
        const start = stack.pop();
        if (token[0] === "END IF") assert.equal(start, "IF");
        else if (token[0] === "END LOOP") assert.equal(start, "LOOP");
        else assert.ok(["BEGIN", "CASE"].includes(start));
      }
    }
    assert.equal(stack.length, 0);
    assert.ok(sql.endsWith("\n"));
    assert.ok(sql.split("\n").every((line) => !/[ \t]+$/.test(line)));
  }
});
