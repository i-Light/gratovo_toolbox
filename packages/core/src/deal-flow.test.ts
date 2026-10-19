import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { DEAL_FLOW } from "./deal-flow";

const prototypeData = new URL("../../../design/workbench-prototype/js/data.js", import.meta.url);

interface PrototypeStep {
  k: string;
  [field: string]: unknown;
}

/** Reads the `W.DEAL_FLOW = [...]` literal out of the prototype's data file. */
function prototypeDealFlow(): PrototypeStep[] {
  const source = readFileSync(prototypeData, "utf8");
  const literal = /W\.DEAL_FLOW = (\[[\s\S]*?\]);\n/.exec(source)?.[1];
  if (literal === undefined) {
    throw new Error("W.DEAL_FLOW not found in the prototype's data.js");
  }
  // The literal is plain data from our own repository, evaluated in an empty context.
  return runInNewContext(`(${literal})`) as PrototypeStep[];
}

describe("DEAL_FLOW", () => {
  it("matches the prototype, step for step", () => {
    const fromPrototype = prototypeDealFlow().map(({ k, ...rest }) => ({ key: k, ...rest }));
    expect(DEAL_FLOW).toEqual(fromPrototype);
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

  it("has the creator sign before the agency signs with the brand", () => {
    const contracts = DEAL_FLOW.find((step) => step.key === "contracts");
    expect(contracts?.ordered).toBe(true);
    const items = contracts?.items ?? [];
    const creatorSigns = items.indexOf("Creator signed");
    expect(creatorSigns).toBeGreaterThanOrEqual(0);
    expect(creatorSigns).toBeLessThan(items.indexOf("Agency signed with the brand"));
  });

  it("locks only the creator's payout until the brand pays", () => {
    const locked = DEAL_FLOW.filter((step) => step.lockedUntilPaid).map((step) => step.key);
    expect(locked).toEqual(["pay"]);
  });
});
