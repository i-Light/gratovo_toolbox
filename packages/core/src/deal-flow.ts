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
      "Brand's IO received & redlined",
      "Brand signed IO first",
      "Mirrored creator contract generated",
      "Creator countersigned mirrored agreement",
    ],
    ordered: true,
    note: "Runs in strict order: Brand signs IO first (or locks terms), then Creator signs mirrored agreement with 5-day earlier draft buffer.",
  },
  {
    key: "brief",
    name: "Brief & Ship",
    items: [
      "Brief translated into creator voice",
      "Product shipped / tracking or demo account confirmed",
      "Creator confirmed firm draft deadline (-5d buffer)",
    ],
  },
  {
    key: "draft",
    name: "Draft & QC",
    items: [
      "Script / outline approved before filming",
      "Unlisted video draft received from creator",
      "5-point agency QC passed (no music, #ad shown)",
      "Brand approved the draft (within 2-round limit)",
    ],
  },
  {
    key: "prelive",
    name: "Pre-live checks",
    items: [
      "UTM tracking link opens landing page cleanly",
      "Integration placed in first third of video",
      "Promo code & top-3-line description link verified",
    ],
  },
  {
    key: "golive",
    name: "Go-live",
    items: [
      "Video is live, public link saved",
      "Same-day go-live email + PDF invoice sent to brand",
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
      "YouTube Studio 30d retention & link clicks pulled",
      "30-day ROI report (or proactive Make-Good) sent to brand",
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
    items: ["Retainer / Droplet next-creator pitch sent to brand"],
  },
];
