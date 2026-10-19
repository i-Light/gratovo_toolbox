/** One step of a deal. Ported from the prototype's W.DEAL_FLOW (js/data.js). */
export interface DealStep {
  readonly key: string;
  readonly name: string;
  readonly items: readonly string[];
  /** The items must be ticked in order: the creator signs before the agency signs. */
  readonly ordered?: boolean;
  /** "Pay creator" stays locked until the brand has paid. */
  readonly lockedUntilPaid?: boolean;
  readonly note?: string;
}

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
