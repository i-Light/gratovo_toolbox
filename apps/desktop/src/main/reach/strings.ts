import type { RewriteHow } from "@gratovo/core/data";

/**
 * The English text Reach's drafter uses (plan step 6, D7 and D8), in one place so other
 * languages can follow: the agency's name the engine is told, the four rewrite notes Gemini
 * reads, and the example data's stand-in email and its stand-in edits. The stand-in is AI-niche
 * only and is never sent anywhere: the example data never calls Gemini or Gmail.
 */
export const reachStrings = {
  /** The agency's name in the comms facts, until step 8's Agency facts. */
  agencyName: "Gratovo",
  /** The steer note each rewrite sends Gemini (D8). */
  rewriteNotes: {
    shorter: "Make it shorter: keep only what matters.",
    warmer: "Make it warmer, without flattery.",
    direct: "Make it more direct: get to the question.",
    redo: "Write it again from a different angle, using another moment from their videos.",
  } satisfies Record<RewriteHow, string>,
  /** The example data's first email, filled 0.9 s after the draft is made. */
  standIn: {
    subject: "your latest video",
    greeting: (contact: string | null): string => `Hi ${contact ?? "there"},`,
    /** Three short paragraphs; the first opens with a pleasantry on its own line. */
    paragraphs: (channel: string): readonly string[] => [
      `Thanks for the latest ${channel} video, it was a pleasure to watch.\nThe way you tested two AI coding tools side by side made the choice easy to follow.`,
      "We work with AI tool makers who sponsor creators, and one of them fits your audience well.",
      "Would you be open to a short note about it this week?",
    ],
    why: "It opens on a moment from their latest video and asks one small question.",
    rules: ["INF-FIRST-02", "FND-WRITE-11"],
  },
  /** The stand-in rewrites' own lines (D8): deterministic edits of the text. */
  standInRewrite: {
    /** Warmer: a friendly line before the first paragraph. */
    warmerLine: "I hope your week is off to a good start.",
    /** New angle: the second paragraph's first line becomes this one. */
    redoLine:
      "Your viewers often ask which AI tools are worth paying for, and a sponsor that fits could answer that for them.",
  },
} as const;
