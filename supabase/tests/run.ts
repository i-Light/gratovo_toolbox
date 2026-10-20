// Builds a throwaway Postgres in Docker, applies the Supabase stubs, the baseline (twice, to prove it can be
// re-run) and the later migrations in name order, then the baseline once more and the later migrations again
// (the documented recovery when someone re-runs the old schema.sql), then runs each test_*.sql against it.
//
//   node supabase/tests/run.ts        (or: pnpm test:sql)
//
// Needs Docker running and nothing else: no local Postgres, no Supabase project, no credentials.
// The container is removed on exit, so this never touches anything real.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Pinned by tag and digest. Postgres 17 is Supabase's current default major.
const IMAGE =
  "postgres:17.11@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3";
const CONTAINER = `gratovo-sqltest-${String(process.pid)}`;
const here = dirname(fileURLToPath(import.meta.url));
const supabaseDir = dirname(here);
const migrationsDir = join(supabaseDir, "migrations");
const baselineName = "20261020120000_baseline.sql";
const legacySchema = join(dirname(supabaseDir), "legacy", "backend", "schema.sql");

function docker(args: string[], input?: string) {
  return spawnSync("docker", args, { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

// Runs SQL through psql in the container and returns the output. Throws if psql fails.
function psql(sql: string, quiet: boolean, extra: string[] = []): string {
  const args = ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "gratovo"];
  args.push("-v", "ON_ERROR_STOP=1", ...extra);
  if (quiet) args.push("-q");
  const r = docker(args, sql);
  const out = `${r.stdout}${r.stderr}`;
  if (r.status !== 0) throw new Error(out || `psql exited with ${String(r.status)}`);
  return out;
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

// The baseline is a header comment, a blank line, then legacy/backend/schema.sql unchanged.
// While legacy/ exists, any difference is drift from production. Step 11 removes this check.
function checkBaselineMatchesLegacy(): void {
  if (!existsSync(legacySchema)) return;
  const baseline = read(join(migrationsDir, baselineName));
  const body = baseline.slice(baseline.indexOf("\n\n") + 2);
  if (body !== read(legacySchema)) {
    throw new Error(`${baselineName} no longer matches legacy/backend/schema.sql`);
  }
}

// Every privilege on the tables, sequences, functions and schemas of `public` and `private`, one sorted line
// each, so two states of the database can be compared.
const PRIVILEGES_SQL = `
select line from (
  select format('%s %s %s %s', case c.relkind when 'S' then 'sequence' else 'table' end, c.oid::regclass,
                case a.grantee when 0 then 'public' else a.grantee::regrole::text end, a.privilege_type) as line
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   cross join lateral aclexplode(coalesce(c.relacl, acldefault((case c.relkind when 'S' then 's' else 'r' end)::"char", c.relowner))) a
   where n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'v', 'm', 'S')
  union all
  select format('function %s %s %s', p.oid::regprocedure,
                case a.grantee when 0 then 'public' else a.grantee::regrole::text end, a.privilege_type)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where n.nspname in ('public', 'private')
  union all
  select format('schema %s %s %s', n.nspname,
                case a.grantee when 0 then 'public' else a.grantee::regrole::text end, a.privilege_type)
    from pg_namespace n
   cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
   where n.nspname in ('public', 'private')
) s order by line;`;

function privileges(): string[] {
  const out = psql(PRIVILEGES_SQL, true, ["-A", "-t"]);
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const info = docker(["info"]);
  if (info.error || info.status !== 0) {
    throw new Error("Docker is not available. Start Docker Desktop and run this again.");
  }
  checkBaselineMatchesLegacy();

  const migrations = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const tests = readdirSync(here)
    .filter((f) => /^test_.*\.sql$/.test(f))
    .sort();

  console.log(`starting ${IMAGE}...`);
  const started = docker([
    "run",
    "-d",
    "--name",
    CONTAINER,
    "-e",
    "POSTGRES_PASSWORD=test",
    "-e",
    "POSTGRES_DB=gratovo",
    IMAGE,
  ]);
  if (started.status !== 0) throw new Error(`${started.stdout}${started.stderr}`);

  // Waiting on a real query, not on pg_isready: the image runs a temporary server during its own
  // initialisation, and pg_isready answers "ready" to that one.
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      psql("select 1", true);
      break;
    } catch {
      if (Date.now() > deadline) throw new Error("Postgres did not become ready within 60 s.");
      await sleep(1000);
    }
  }

  console.log("applying stubs...");
  psql(read(join(here, "00_supabase_stubs.sql")), true);

  // The baseline first, then again on its own: it promises it is safe to re-run. Later migrations
  // come after that, and their privileges are recorded before the baseline's blanket grants run again.
  console.log(`applying ${baselineName}...`);
  psql(read(join(migrationsDir, baselineName)), true);
  console.log(`applying ${baselineName} again (re-runnability)...`);
  psql(read(join(migrationsDir, baselineName)), true);
  const later = migrations.filter((f) => f !== baselineName);
  for (const m of later) {
    console.log(`applying ${m}...`);
    psql(read(join(migrationsDir, m)), true);
  }
  const fresh = privileges();

  // Re-running the old schema.sql after the later migrations revokes execute on their public wrappers and
  // grants write privileges on their tables. The documented fix is to re-apply the later migrations right
  // after. The tests run on that repaired database, and its privileges must equal the fresh pass's, so a
  // grant the baseline's blanket `grant ... on all tables` would otherwise supply can't hide a missing one.
  console.log(`applying ${baselineName} after the later migrations (an old schema.sql re-run)...`);
  psql(read(join(migrationsDir, baselineName)), true);
  for (const m of later) {
    console.log(`re-applying ${m}...`);
    psql(read(join(migrationsDir, m)), true);
  }
  const repaired = privileges();
  if (repaired.join("\n") !== fresh.join("\n")) {
    const lost = fresh.filter((l) => !repaired.includes(l)).map((l) => `  - ${l}`);
    const gained = repaired.filter((l) => !fresh.includes(l)).map((l) => `  + ${l}`);
    throw new Error(
      `re-applying the later migrations after the baseline did not restore the privileges:\n${[...lost, ...gained].join("\n")}`,
    );
  }
  console.log(`privileges match the fresh pass (${String(fresh.length)} grants).`);

  for (const t of tests) {
    console.log(`\n=== ${t}`);
    process.stdout.write(psql(read(join(here, t)), false));
  }
  console.log(`\nSQL tests passed (${String(tests.length)} files).`);
}

let cleaned = false;
function cleanup(): void {
  if (cleaned) return;
  cleaned = true;
  docker(["rm", "-f", CONTAINER]);
}
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});

try {
  await main();
} catch (error) {
  console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  cleanup();
}
