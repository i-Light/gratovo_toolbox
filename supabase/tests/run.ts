// Builds a throwaway Postgres in Docker, applies the Supabase stubs, the baseline (twice, to prove it can be
// re-run) and the later migrations in name order, then runs each test_*.sql against it.
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
function psql(sql: string, quiet: boolean): string {
  const args = ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "gratovo"];
  args.push("-v", "ON_ERROR_STOP=1");
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
  // come after that, so their grants are not hidden by the baseline's blanket grants.
  console.log(`applying ${baselineName}...`);
  psql(read(join(migrationsDir, baselineName)), true);
  console.log(`applying ${baselineName} again (re-runnability)...`);
  psql(read(join(migrationsDir, baselineName)), true);
  for (const m of migrations.filter((f) => f !== baselineName)) {
    console.log(`applying ${m}...`);
    psql(read(join(migrationsDir, m)), true);
  }

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
