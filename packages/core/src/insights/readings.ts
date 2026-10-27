import type { NoKind, ReadingKind } from "./types";

/**
 * Maps the comms engine's reply situation ids (`inf.*`, `any.*`, from the playbook) to the
 * reading kinds Insights counts (design 3.3). Pure; an unknown id is "other", never a throw.
 */

const kinds: Readonly<Record<string, ReadingKind>> = {
  "inf.interested_vague": "interested",
  "inf.agrees": "interested",
  "inf.media_kit": "interested",
  "inf.who_are_you": "question",
  "inf.asks_price_from_us": "question",
  "inf.contract_question": "question",
  "inf.payment_question": "question",
  "inf.wants_exclusivity_terms": "question",
  "inf.gives_rate": "rate",
  "inf.counter": "rate",
  "inf.later": "notNow",
  "inf.not_interested": "no",
  "inf.angry": "no",
  "any.unsubscribe": "no",
  "inf.has_manager": "manager",
  "any.out_of_office": "auto",
  "any.bounce": "bounce",
};

/** What a reply read as. Null: no reading yet (and not a bounce). */
export function readingKind(replyType: string | null, bounce: boolean): ReadingKind | null {
  if (bounce || replyType === "any.bounce") return "bounce";
  if (replyType === null || replyType === "") return null;
  return kinds[replyType] ?? "other";
}

const noKinds: Readonly<Record<string, NoKind>> = {
  "inf.later": "notNow",
  "inf.not_interested": "notInterested",
  "any.unsubscribe": "notInterested",
  "inf.angry": "notInterested",
  "inf.has_manager": "manager",
  "inf.wants_upfront": "money",
  "inf.non_negotiable": "money",
  "inf.counter": "money",
};

/** Why a reply that said no said no. Null when the reply is not one of the "no" situations. */
export function noKind(replyType: string | null): NoKind | null {
  return replyType === null ? null : (noKinds[replyType] ?? null);
}
