/**
 * What to do with an upload that failed (plan D8, ported from the old app's
 * `isFinalUploadRefusal`): drop what the server refused for good, keep what a forgotten
 * migration or the network broke, and stop the pass when the session is gone.
 */

import { AuthError } from "../supabase/auth-client";
import { RestError } from "../supabase/rest";

export type Verdict = "drop" | "retry" | "session";

/** A missing function, column or table: the server is behind, so the edit must not be lost. */
export const schemaBehindCodes: readonly string[] = [
  "PGRST202",
  "PGRST204",
  "PGRST205",
  "42883",
  "42703",
  "42P01",
];

export function classifyUploadError(error: unknown): Verdict {
  if (error instanceof AuthError) {
    return "session";
  }
  if (error instanceof RestError) {
    if (error.kind === "http" && error.status === 401) {
      return "session";
    }
    const code = error.code;
    if (code !== null && !schemaBehindCodes.includes(code)) {
      if (code === "42501" || /^(22|23)[0-9A-Z]{3}$/.test(code)) {
        return "drop";
      }
    }
  }
  return "retry";
}
