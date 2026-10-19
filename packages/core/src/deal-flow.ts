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
 * Ported from the prototype's `W.DEAL_FLOW` (design/workbench-prototype/js/data.js), with `k`
 * renamed to `key`. A test keeps the two in step while the prototype is the spec.
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
      "Brand's contract received",
      "Mirrored for the creator",
      "Creator signed",
      "Agency signed with the brand",
    ],
    ordered: true,
    note: "Runs in order: the creator signs before the agency signs with the brand.",
  },
  {
    key: "brief",
    name: "Brief",
    items: ["Brief sent to the creator", "Creator confirmed the date"],
  },
  {
    key: "draft",
    name: "Draft review",
    items: ["Draft received", "Checked against the brief", "Brand approved the draft"],
  },
  {
    key: "prelive",
    name: "Pre-live checks",
    items: [
      "Tracking link opens the right page",
      "Placement matches the brief",
      "Promo code works",
    ],
  },
  {
    key: "golive",
    name: "Go-live",
    items: ["Video is live, link saved", "Go-live email sent to the brand"],
  },
  {
    key: "invoice",
    name: "Invoice",
    items: ["Invoice sent on go-live day (Net 30)"],
  },
  {
    key: "report",
    name: "30-day report",
    items: ["Views and clicks read", "Report sent to the brand"],
  },
  {
    key: "pay",
    name: "Pay creator",
    items: ["Creator paid"],
    lockedUntilPaid: true,
  },
  {
    key: "next",
    name: "Next deal",
    items: ["Next creator pitched to this brand"],
  },
];
