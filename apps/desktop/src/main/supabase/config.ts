/**
 * The two build values that point the app at the team's Supabase project (see G2 in the plan and
 * docs/setup.md). Pure: nothing here reads the environment or logs. A problem is reported as a
 * code, never with the value, so a key can't reach a log line or an error.
 */

export interface SupabaseConfig {
  readonly url: string;
  readonly origin: string;
  readonly publishableKey: string;
}

export type ConfigProblem = "missing" | "bad-url" | "secret-key" | "jwt-key" | "bad-key";

const projectUrl = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const localUrl = /^http:\/\/127\.0\.0\.1:\d{1,5}$/;
const publishableKey = /^sb_publishable_[A-Za-z0-9_-]+$/;
const jwtShape = /^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

/**
 * `built` holds the values electron-vite put into the bundle. `env` holds the test seam
 * (GRATOVO_SUPABASE_URL and GRATOVO_SUPABASE_PUBLISHABLE_KEY), honoured only when not packaged;
 * a set but empty URL there means "unconfigured".
 */
export function readSupabaseConfig(input: {
  packaged: boolean;
  built: { url?: string | undefined; key?: string | undefined };
  env: Readonly<Record<string, string | undefined>>;
}): { ok: true; config: SupabaseConfig } | { ok: false; problem: ConfigProblem } {
  const seam = !input.packaged && input.env["GRATOVO_SUPABASE_URL"] !== undefined;
  const url = (seam ? input.env["GRATOVO_SUPABASE_URL"] : input.built.url)?.trim() ?? "";
  const key =
    (seam ? input.env["GRATOVO_SUPABASE_PUBLISHABLE_KEY"] : input.built.key)?.trim() ?? "";

  if (url === "" || key === "") {
    return { ok: false, problem: "missing" };
  }
  if (!projectUrl.test(url) && !(seam && localUrl.test(url))) {
    return { ok: false, problem: "bad-url" };
  }
  if (key.startsWith("sb_secret_")) {
    return { ok: false, problem: "secret-key" };
  }
  if (jwtShape.test(key)) {
    return { ok: false, problem: "jwt-key" };
  }
  if (!publishableKey.test(key)) {
    return { ok: false, problem: "bad-key" };
  }
  return { ok: true, config: { url, origin: new URL(url).origin, publishableKey: key } };
}

/** One startup log line per problem. It names the problem and never a value. */
export function describeConfigProblem(problem: ConfigProblem): string {
  switch (problem) {
    case "missing":
      return "Supabase is not configured: MAIN_VITE_SUPABASE_URL or MAIN_VITE_SUPABASE_PUBLISHABLE_KEY is empty.";
    case "bad-url":
      return "Supabase is not configured: the project URL is not https://<project>.supabase.co.";
    case "secret-key":
      return "Supabase is not configured: the key is a secret key. Only the publishable key may be used.";
    case "jwt-key":
      return "Supabase is not configured: the key is a legacy JWT key. Use the publishable key (sb_publishable_...).";
    case "bad-key":
      return "Supabase is not configured: the key does not start with sb_publishable_.";
  }
}
