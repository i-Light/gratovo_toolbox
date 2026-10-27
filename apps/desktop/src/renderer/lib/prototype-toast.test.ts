// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pickScenario, resetPrototypeForTests, setPrototype } from "./prototype";
import { takeSwitchToast } from "./prototype-toast";

const off = { available: true, on: false, scenario: "normal" };

function bridge(): void {
  (globalThis as { gratovo?: unknown }).gratovo = {
    invoke: () => Promise.resolve({ ok: true, value: off }),
  };
}

beforeEach(() => {
  resetPrototypeForTests();
  sessionStorage.clear();
});
afterEach(() => {
  delete (globalThis as { gratovo?: unknown }).gratovo;
});

describe("the switch toast", () => {
  it("is written before a switch and taken once", async () => {
    bridge();
    await setPrototype(true);
    expect(takeSwitchToast()?.msg).toBe("Prototype mode is on");
    expect(takeSwitchToast()).toBeNull();
    await setPrototype(false);
    expect(takeSwitchToast()?.msg).toBe("Prototype mode is off");
    await pickScenario("broke");
    expect(takeSwitchToast()?.msg).toBe("Scenario: Something broke");
  });

  it("says so when what is open after the reload isn't what was asked for", async () => {
    bridge();
    await pickScenario("broke");
    expect(takeSwitchToast({ available: true, on: true, scenario: "normal" })?.msg).toBe(
      "That switch didn't happen",
    );
    await setPrototype(true);
    expect(takeSwitchToast({ available: true, on: true, scenario: "normal" })?.msg).toBe(
      "Prototype mode is on",
    );
    await setPrototype(false);
    expect(takeSwitchToast({ available: true, on: true, scenario: "normal" })?.msg).toBe(
      "That switch didn't happen",
    );
    await setPrototype(true);
    expect(takeSwitchToast(null)?.msg).toBe("That switch didn't happen");
  });

  it("is dropped when the switch fails", async () => {
    (globalThis as { gratovo?: unknown }).gratovo = {
      invoke: () => Promise.resolve({ ok: false, reason: "x" }),
    };
    await setPrototype(true);
    expect(takeSwitchToast()).toBeNull();
  });
});
