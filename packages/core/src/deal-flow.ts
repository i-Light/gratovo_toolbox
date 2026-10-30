/** The ten deal steps, in the order a deal moves through them. */
export type DealStepKey =
  | "negotiate"
  | "contracts"
  | "brief"
  | "draft"
  | "prelive"
  | "golive"
  | "invoice"
  | "report"
  | "pay"
  | "next";

export interface DealStep {
  readonly key: DealStepKey;
  readonly name: string;
  /** The checklist a deal must clear before it moves to the next step. */
  readonly items: readonly string[];
  /** The items must be ticked in the order listed. */
  readonly ordered?: true;
  /** The step stays locked until the brand has paid its invoice. */
  readonly lockedUntilPaid?: true;
  /** Shown with the step to explain its rule. */
  readonly note?: string;
}

/**
 * The deal journey, from agreeing the price to pitching the next creator. Money is tracked beside
 * the steps, and "Pay creator" stays locked until the brand has paid.
 *
 * Ported from the design's `W.DEAL_FLOW` (design/workbench-v6/js/data.js), with `k` renamed to
 * `key` and the design's rule codes left out of the words (P1 decision F7). A test keeps the two
 * in step while the design is the spec.
 */
export const DEAL_FLOW: readonly DealStep[] = [
  {
    key: "negotiate",
    name: "Negotiate",
    items: [
      "Price the brand pays agreed",
      "Creator's payout agreed",
      "Payment terms set (Net 30)",
      "Exclusivity and usage rights written down",
    ],
  },
  {
    key: "contracts",
    name: "Contracts",
    items: [
      "Brand's order (insertion order) received and marked up",
      "Brand signed the order first",
      "Matching creator contract written",
      "Creator signed the matching agreement",
    ],
    ordered: true,
    note: "Runs in strict order. The brand signs its order first (or locks the terms). Then the creator signs the matching agreement, with a draft deadline 5 days earlier than the brand's.",
  },
  {
    key: "brief",
    name: "Brief & Ship",
    items: [
      "Brief translated into creator voice",
      "Product shipped, and tracking or a demo account confirmed",
      "Creator confirmed a firm draft deadline, 5 days early",
    ],
  },
  {
    key: "draft",
    name: "Draft and checks",
    items: [
      "Script or outline approved before filming",
      "Unlisted video draft received from creator",
      "Our 5-point check passed (no music, #ad shown)",
      "Brand approved the draft (within 2 rounds of changes)",
    ],
  },
  {
    key: "prelive",
    name: "Pre-live checks",
    items: [
      "Tracking link opens the landing page cleanly",
      "Integration placed in first third of video",
      "Promo code and the link in the first 3 lines of the description checked",
    ],
  },
  {
    key: "golive",
    name: "Go-live",
    items: [
      "Video is live, public link saved",
      "Same-day go-live email and PDF invoice sent to the brand",
    ],
  },
  {
    key: "invoice",
    name: "Invoice",
    items: ["Invoice sent on go-live day (Net 30 clock running)"],
  },
  {
    key: "report",
    name: "30-day report",
    items: [
      "YouTube Studio 30-day retention and link clicks pulled",
      "30-day results report sent to the brand (or an offer to fix it, if results fell short)",
    ],
  },
  {
    key: "pay",
    name: "Pay creator",
    items: ["Creator payout released via Wise/PayPal/ACH"],
    lockedUntilPaid: true,
  },
  {
    key: "next",
    name: "Next deal",
    items: ["Pitch for the next creator sent to the brand (ongoing deal or one-off)"],
  },
];
