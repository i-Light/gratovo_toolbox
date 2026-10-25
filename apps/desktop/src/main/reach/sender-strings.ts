/**
 * The words the sender writes into the activity log (plan step 6, D11). Kept apart from the
 * drafter's `strings.ts` so two modules can grow them side by side; other languages come later.
 */
export const senderStrings = {
  /** The log line of a first email that went: "Sent the first email to Prompt Lab". */
  firstSent: (name: string): string => `Sent the first email to ${name}`,
  /** The same, when the edited text went without the check (the bridge was off). */
  firstSentUnchecked: (name: string): string =>
    `Sent the first email to ${name} (not checked again after your edit)`,
} as const;
