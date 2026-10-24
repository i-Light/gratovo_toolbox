import { z } from "zod";

/**
 * The Gemini bridge as Settings › Connections shows it (plan step 4, D11 and D12). The owner
 * starts it; step 4 never sends a prompt.
 */

/** A browser's id as the bridge names them ("firefox", "chrome", "edge"). */
export const browserId = z.string().regex(/^[a-z][a-z0-9_-]{0,49}$/);

export const geminiStates = ["stopped", "starting", "listening", "failed"] as const;
export const geminiAddonStates = ["connected", "disconnected", "missing"] as const;
/**
 * Why the bridge isn't listening, when it failed or couldn't start. `not_built` is the step 4
 * stub's answer until the bridge control is wired.
 */
export const geminiProblems = [
  "not_built",
  "no_python",
  "port_in_use",
  /** The add-on's folder isn't there (a packaged build until step T5). */
  "no_extension",
  /** No data is open, so there is no pipeline folder to give it. */
  "no_data",
  "crash",
] as const;

export const geminiStatusSchema = z.strictObject({
  state: z.enum(geminiStates),
  addon: z.strictObject({
    state: z.enum(geminiAddonStates),
    version: z.string().min(1).max(50).nullable(),
  }),
  /** The browser the bridge drives, or null before it has picked one. */
  browser: browserId.nullable(),
  problem: z.enum(geminiProblems).nullable(),
});
export type GeminiStatus = z.output<typeof geminiStatusSchema>;

/** `browser` null means the bridge's own choice. */
export const geminiOpenWindowRequestSchema = z.strictObject({ browser: browserId.nullable() });
