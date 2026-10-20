import { z } from "zod";

/**
 * The schemas of the account channels (plan G12). No request or response carries a token, a key,
 * a URL or a path; the password crosses once, in `auth:sign-in`'s request, and never comes back.
 */

/** Where the account stands. `unconfigured`: a build without Supabase settings (example data). */
export const authStates = ["unconfigured", "signed-out", "waiting", "signed-in"] as const;
export type AuthState = (typeof authStates)[number];

/** Why a sign-in failed, one quiet line each on the sign-in screen. */
export const signInProblems = [
  "invalid",
  "unconfirmed",
  "rate-limited",
  "offline",
  "no-safe-storage",
  "unavailable",
] as const;
export type SignInProblem = (typeof signInProblems)[number];

/** What `auth:status` and `auth:recheck` answer. `email` is the account's own, or null. */
export interface AuthStatus {
  readonly state: AuthState;
  readonly email: string | null;
}

export type SignInResult =
  | { readonly ok: true; readonly state: "waiting" | "signed-in" }
  | { readonly ok: false; readonly problem: SignInProblem };

/** The longest email address (RFC 5321's path limit). */
export const emailMax = 254;
/** The longest password the app passes on. */
export const passwordMax = 1024;

export const authStateSchema = z.enum(authStates);

export const authStatusSchema: z.ZodType<AuthStatus> = z.strictObject({
  state: authStateSchema,
  email: z.email().max(emailMax).nullable(),
});

export interface SignInRequest {
  readonly email: string;
  readonly password: string;
}

/** Typed on both sides, so the page's call is checked against it too. */
export const signInRequestSchema: z.ZodType<SignInRequest, SignInRequest> = z.strictObject({
  email: z.email().max(emailMax),
  password: z.string().min(1).max(passwordMax),
});

export const signInResultSchema: z.ZodType<SignInResult> = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), state: z.enum(["waiting", "signed-in"]) }),
  z.strictObject({ ok: z.literal(false), problem: z.enum(signInProblems) }),
]);
