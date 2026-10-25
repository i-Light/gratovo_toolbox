// The whole gate a pull request must pass, run on this computer instead of GitHub Actions (owner,
// 2026-10-25: the Actions minutes ran out, and nothing should need GitHub to be checked).
//
//   pnpm verify                every check CI ran; the Docker ones only when the change needs them
//   pnpm verify --server       also run the SQL and server tests, whatever changed
//   pnpm verify --from=test    start at a step (after fixing a failure), skipping the ones before
//   pnpm verify --status       when everything passed on a clean tree, mark the commit green on
//                              GitHub (a commit status, free: no Actions minutes)
//
// The cheap checks run first and the first failure stops the run. The SQL and server tests need
// Docker, so they run only when the change touches the database, the server or the code that
// talks to it (see `serverPaths`), or with --server. Docker Desktop is started when it isn't
// running. The local Supabase stack's keys are its CLI's fixed throwaway defaults; they stay in
// the server tests' environment and are never printed.
import { spawn, spawnSync, type SpawnSyncOptions } from "node:child_process";
import { existsSync } from "node:fs";

const supabaseCli = "supabase@2.119.0";
// Everything the server tests import, and the database itself (tsconfig.tools.json lists the same).
const serverPaths = [
  /^supabase\//,
  /^legacy\/backend\/schema\.sql$/,
  /^apps\/desktop\/src\/main\/(supabase|sync|net|db|data)\//,
  /^apps\/desktop\/src\/main\/secret-store\.ts$/,
  /^vitest\.server\.config\.ts$/,
  /^tooling\/verify\.ts$/,
];
/** Shows a command's errors but not its output (for anything that prints keys). */
const quiet: SpawnSyncOptions = { stdio: ["ignore", "ignore", "inherit"] };
const dockerDesktop = "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe";

interface Step {
  name: string;
  why: string;
  run: () => boolean;
  docker?: boolean;
}

const args = new Set(process.argv.slice(2).filter((a) => !a.startsWith("--from=")));
const from = process.argv.find((a) => a.startsWith("--from="))?.slice("--from=".length) ?? null;

// Child processes: a uv.lock that doesn't match pyproject.toml fails instead of being rewritten,
// and Electron must start as Electron (a parent tool may have set this).
const env: NodeJS.ProcessEnv = { ...process.env, UV_LOCKED: "1" };
delete env.ELECTRON_RUN_AS_NODE;

function sh(command: string, options: SpawnSyncOptions = {}): boolean {
  const r = spawnSync(command, { shell: true, stdio: "inherit", env, ...options });
  return r.status === 0;
}

function read(command: string, extraEnv: NodeJS.ProcessEnv = env): { ok: boolean; out: string } {
  const r = spawnSync(command, { shell: true, encoding: "utf8", env: extraEnv });
  return { ok: r.status === 0, out: r.stdout };
}

function has(tool: string, hint: string): boolean {
  if (read(`${tool} --version`).ok || read(`${tool} version`).ok) return true;
  console.error(`\n${tool} is not installed. ${hint}`);
  return false;
}

/** Files this branch changed against main, committed or not. */
function changedFiles(): string[] {
  const base = read("git merge-base origin/main HEAD");
  const committed = base.ok ? read(`git diff --name-only ${base.out.trim()} HEAD`).out : "";
  const working = read("git status --porcelain").out.replace(/^.{3}/gm, "");
  return `${committed}\n${working}`
    .split("\n")
    .map((f) => f.trim().replace(/^"|"$/g, ""))
    .filter((f) => f !== "");
}

function dockerUp(): boolean {
  if (read("docker info").ok) return true;
  if (!existsSync(dockerDesktop)) {
    console.error(
      "\nDocker isn't running, and Docker Desktop wasn't found. Start Docker, then run again.",
    );
    return false;
  }
  console.log("Starting Docker Desktop (up to 3 minutes)...");
  spawn(dockerDesktop, [], { detached: true, stdio: "ignore" }).unref();
  const until = Date.now() + 180_000;
  while (Date.now() < until) {
    spawnSync("ping -n 6 127.0.0.1", { shell: true, stdio: "ignore" }); // about 5 s
    if (read("docker info").ok) return true;
  }
  console.error("\nDocker Desktop didn't come up in 3 minutes. Start it by hand, then run again.");
  return false;
}

/** The server tests against a throwaway local Supabase stack, stopped again whatever happens. */
function serverTests(): boolean {
  const cli = `npx --yes ${supabaseCli}`;
  const exclude = "studio,mailpit,storage-api,imgproxy,logflare,vector,supavisor,postgres-meta";
  // Its output ends with the stack's URLs and keys: keep stdout quiet, errors still show.
  console.log("Starting the local Supabase stack...");
  if (!sh(`${cli} start -x ${exclude}`, quiet)) return false;
  try {
    // The stack's keys go into the tests' environment only; nothing here prints them.
    const status = read(`${cli} status -o env`);
    if (!status.ok) return false;
    const values = new Map<string, string>();
    for (const line of status.out.split(/\r?\n/)) {
      const m = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
      if (m?.[1] !== undefined && m[2] !== undefined) values.set(m[1], m[2]);
    }
    const url = values.get("API_URL");
    const publishable = values.get("PUBLISHABLE_KEY");
    const secret = values.get("SECRET_KEY");
    if (url === undefined || publishable === undefined || secret === undefined) {
      console.error("\nThe local stack didn't report its URL and keys.");
      return false;
    }
    return sh("pnpm test:server", {
      env: {
        ...env,
        SUPABASE_URL: url,
        SUPABASE_PUBLISHABLE_KEY: publishable,
        SUPABASE_SECRET_KEY: secret,
      },
    });
  } finally {
    sh(`${cli} stop --no-backup`, quiet);
  }
}

/** Marks HEAD green on GitHub with a commit status. Costs no Actions minutes. */
function postStatus(summary: string): boolean {
  if (read("git status --porcelain").out.trim() !== "") {
    console.error("\n--status needs a clean tree: the result must be about the commit itself.");
    return false;
  }
  const sha = read("git rev-parse HEAD").out.trim();
  const remote = read("git remote get-url origin").out.trim();
  const repo = /github\.com[:/](.+?)(\.git)?$/.exec(remote)?.[1];
  if (repo === undefined) {
    console.error("\norigin is not a GitHub repository.");
    return false;
  }
  // The token comes from Git's credential helper and goes to gh's environment only.
  const fill = spawnSync("git credential fill", {
    shell: true,
    encoding: "utf8",
    input: "protocol=https\nhost=github.com\n\n",
  });
  const token = /^password=(.*)$/m.exec(fill.stdout)?.[1];
  if (token === undefined) {
    console.error("\nNo GitHub credential found for --status.");
    return false;
  }
  const r = spawnSync(
    "gh",
    [
      "api",
      `repos/${repo}/statuses/${sha}`,
      "-f",
      "state=success",
      "-f",
      "context=local verify",
      "-f",
      `description=${summary}`,
    ],
    { encoding: "utf8", env: { ...env, GH_TOKEN: token } },
  );
  if (r.status !== 0) {
    console.error(`\nCouldn't post the status: ${r.stderr.trim()}`);
    return false;
  }
  console.log(`Marked ${sha.slice(0, 7)} green on GitHub ("local verify").`);
  return true;
}

const needServer =
  args.has("--server") || changedFiles().some((f) => serverPaths.some((p) => p.test(f)));

const steps: Step[] = [
  {
    name: "deps",
    why: "the lockfile matches package.json",
    run: () => sh("pnpm install --frozen-lockfile --prefer-offline --reporter=silent"),
  },
  {
    name: "secrets",
    why: "no secret in any branch's history",
    run: () =>
      has("gitleaks", "Windows: winget install Gitleaks.Gitleaks (docs/workflow.md).") &&
      sh('gitleaks git --redact --no-banner --log-opts="--branches"'),
  },
  {
    name: "audit",
    why: "no known vulnerability in either lockfile",
    run: () =>
      has("osv-scanner", "See docs/workflow.md for the pinned download.") &&
      sh("osv-scanner scan source --lockfile pnpm-lock.yaml --lockfile services/pipeline/uv.lock"),
  },
  { name: "lint", why: "eslint, prettier, ruff", run: () => sh("pnpm lint") },
  { name: "typecheck", why: "tsc and pyright", run: () => sh("pnpm typecheck") },
  { name: "test", why: "vitest and pytest", run: () => sh("pnpm test") },
  { name: "e2e", why: "the Electron tests", run: () => sh("pnpm test:e2e") },
  {
    name: "sql",
    why: "the migrations and SQL tests in Docker",
    docker: true,
    run: () => dockerUp() && sh("pnpm test:sql"),
  },
  {
    name: "server",
    why: "the app's sign-in and sync against a local Supabase",
    docker: true,
    run: () => dockerUp() && serverTests(),
  },
];

if (from !== null && !steps.some((s) => s.name === from)) {
  console.error(`No step "${from}". Steps: ${steps.map((s) => s.name).join(", ")}`);
  process.exit(2);
}

const results: {
  name: string;
  state: "passed" | "failed" | "skipped";
  seconds: number;
  note: string;
}[] = [];
let reached = from === null;
let failed = false;
for (const step of steps) {
  if (!reached && step.name === from) reached = true;
  if (!reached) {
    results.push({ name: step.name, state: "skipped", seconds: 0, note: "--from" });
    continue;
  }
  if (failed) break;
  if (step.docker === true && !needServer) {
    results.push({ name: step.name, state: "skipped", seconds: 0, note: "no server change" });
    continue;
  }
  console.log(`\n=== ${step.name}: ${step.why}`);
  const start = Date.now();
  const ok = step.run();
  const seconds = Math.round((Date.now() - start) / 1000);
  results.push({ name: step.name, state: ok ? "passed" : "failed", seconds, note: "" });
  if (!ok) failed = true;
}

console.log("\n=== verify");
for (const r of results) {
  const time = r.state === "skipped" ? "" : ` ${String(r.seconds)} s`;
  console.log(`${r.state.padEnd(7)} ${r.name}${time}${r.note === "" ? "" : ` (${r.note})`}`);
}
const ran = results.filter((r) => r.state === "passed").map((r) => r.name);
const total = results.reduce((sum, r) => sum + r.seconds, 0);
if (failed) {
  const at = results.find((r) => r.state === "failed")?.name ?? "";
  console.log(`\nFailed at ${at}. Fix it, then: pnpm verify --from=${at}`);
  process.exit(1);
}
console.log(`\nAll passed in ${String(Math.round(total / 60))} min.`);
if (args.has("--status")) {
  if (from !== null) {
    console.error("--status needs a full run, not one started with --from.");
    process.exit(1);
  }
  if (!postStatus(`passed: ${ran.join(", ")}`)) process.exit(1);
}
