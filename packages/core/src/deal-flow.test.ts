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

/** Texts rewritten by hand because stripping the codes left them broken: design -> app. */
const rewritten: Record<string, string> = {
  "5-Point Agency QC passed (no music HC-33, #ad FND-ETH-13)":
    "5-point agency QC passed (no music, #ad shown)",
};

function inApp(text: string): string {
  return rewritten[text] ?? stripCodes(text);
}

describe("DEAL_FLOW", () => {
  it("matches the prototype, step for step, minus the rule codes", () => {
    const fromPrototype = prototypeDealFlow().map(({ k, name, items, note, ...rest }) => ({
      key: k,
      name,
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

  it("has the brand sign the IO before the creator countersigns", () => {
    const contracts = DEAL_FLOW.find((step) => step.key === "contracts");
    expect(contracts?.ordered).toBe(true);
    const items = contracts?.items ?? [];
    const brandSigns = items.indexOf("Brand signed IO first");
    expect(brandSigns).toBeGreaterThanOrEqual(0);
    expect(brandSigns).toBeLessThan(items.indexOf("Creator countersigned mirrored agreement"));
  });

  it("locks only the creator's payout until the brand pays", () => {
    const locked = DEAL_FLOW.filter((step) => step.lockedUntilPaid).map((step) => step.key);
    expect(locked).toEqual(["pay"]);
  });
});
