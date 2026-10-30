import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { DEAL_FLOW } from "./deal-flow";

const prototypeData = new URL("../../../design/workbench-v6/js/data.js", import.meta.url);

interface PrototypeStep {
  k: string;
  [field: string]: unknown;
}

/** Reads the `W.DEAL_FLOW = [...]` literal out of the prototype's data file. */
function prototypeDealFlow(): PrototypeStep[] {
  const source = readFileSync(prototypeData, "utf8");
  const literal = /W\.DEAL_FLOW = (\[[\s\S]*?\]);\r?\n/.exec(source)?.[1];
  if (literal === undefined) {
    throw new Error("W.DEAL_FLOW not found in the design's data.js");
  }
  // The literal is plain data from our own repository, evaluated in an empty context.
  return runInNewContext(`(${literal})`) as PrototypeStep[];
}

/**
 * Decision F7: the design's rule codes stay out of the app's words. A code in brackets, such as
 * "(BRD-CONTRACT-09)", is dropped with the space before it.
 */
function stripCodes(text: string): string {
  return text.replace(/ \((?:[A-Z]+-)+\d+\)/g, "");
}

/**
 * Texts rewritten by hand into plain words (the owner's rule), or because stripping the codes left
 * them broken: the design's text with its codes stripped -> the app's. The count and flags of
 * every step are still compared in full.
 */
const rewritten: Record<string, string> = {
  "Brand's IO received & redlined": "Brand's order (insertion order) received and marked up",
  "Brand signed IO first": "Brand signed the order first",
  "Mirrored creator contract generated": "Matching creator contract written",
  "Creator countersigned mirrored agreement": "Creator signed the matching agreement",
  "Runs in strict order: Brand signs IO first (or locks terms), then Creator signs mirrored agreement with 5-day earlier draft buffer.":
    "Runs in strict order. The brand signs its order first (or locks the terms). Then the creator signs the matching agreement, with a draft deadline 5 days earlier than the brand's.",
  "Product shipped / tracking or demo account confirmed":
    "Product shipped, and tracking or a demo account confirmed",
  "Creator confirmed firm draft deadline (-5d buffer)":
    "Creator confirmed a firm draft deadline, 5 days early",
  "Draft & QC": "Draft and checks",
  "Script / outline approved before filming": "Script or outline approved before filming",
  "5-Point Agency QC passed (no music HC-33, #ad FND-ETH-13)":
    "Our 5-point check passed (no music, #ad shown)",
  "Brand approved the draft (within 2-round limit)":
    "Brand approved the draft (within 2 rounds of changes)",
  "UTM tracking link opens landing page cleanly": "Tracking link opens the landing page cleanly",
  "Promo code & top-3-line description link verified":
    "Promo code and the link in the first 3 lines of the description checked",
  "Same-day go-live email + PDF invoice sent to brand":
    "Same-day go-live email and PDF invoice sent to the brand",
  "YouTube Studio 30d retention & link clicks pulled":
    "YouTube Studio 30-day retention and link clicks pulled",
  "30-day ROI report (or proactive Make-Good) sent to brand":
    "30-day results report sent to the brand (or an offer to fix it, if results fell short)",
  "Retainer / Droplet next-creator pitch sent to brand":
    "Pitch for the next creator sent to the brand (ongoing deal or one-off)",
};

function inApp(text: string): string {
  const plain = stripCodes(text);
  return rewritten[plain] ?? plain;
}

describe("DEAL_FLOW", () => {
  it("matches the prototype, step for step, minus the rule codes", () => {
    const fromPrototype = prototypeDealFlow().map(({ k, name, items, note, ...rest }) => ({
      key: k,
      name: inApp(name as string),
      items: (items as string[]).map(inApp),
      ...(note === undefined ? {} : { note: inApp(note as string) }),
      ...rest,
    }));
    expect(DEAL_FLOW).toEqual(fromPrototype);
  });

  it("keeps rule codes out of every word", () => {
    const words = DEAL_FLOW.flatMap((step) => [step.name, ...step.items, step.note ?? ""]);
    for (const word of words) {
      expect(word).not.toMatch(/\b[A-Z]{2,4}-(?:[A-Z]+-)?\d+\b/);
    }
  });

  it("runs from agreeing the price to pitching the next creator", () => {
    expect(DEAL_FLOW.map((step) => step.key)).toEqual([
      "negotiate",
      "contracts",
      "brief",
      "draft",
      "prelive",
      "golive",
      "invoice",
      "report",
      "pay",
      "next",
    ]);
  });

  it("gives every step at least one item to tick", () => {
    for (const step of DEAL_FLOW) {
      expect(step.items.length, step.key).toBeGreaterThan(0);
    }
  });

  it("has the brand sign its order before the creator countersigns", () => {
    const contracts = DEAL_FLOW.find((step) => step.key === "contracts");
    expect(contracts?.ordered).toBe(true);
    const items = contracts?.items ?? [];
    const brandSigns = items.indexOf("Brand signed the order first");
    expect(brandSigns).toBeGreaterThanOrEqual(0);
    expect(brandSigns).toBeLessThan(items.indexOf("Creator signed the matching agreement"));
  });

  it("locks only the creator's payout until the brand pays", () => {
    const locked = DEAL_FLOW.filter((step) => step.lockedUntilPaid).map((step) => step.key);
    expect(locked).toEqual(["pay"]);
  });
});
