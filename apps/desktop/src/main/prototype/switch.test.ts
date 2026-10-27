import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DataSource, Scenario } from "@gratovo/core/data";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openExampleCopy } from "../data";

import { createPrototype } from "./prototype";
import type { Prototype, PrototypeDeps } from "./prototype";

/**
 * How prototype mode switches (the review of step 7, part 2): it is never off part-way through a
 * turn-on or a scenario pick, a failure leaves a copy open (or prototype mode cleanly off), the
 * windows always reload, and `beforeSwitch` runs inside the queue, after the owner check.
 */

const start = Date.UTC(2026, 9, 26, 9, 0, 0);

describe("prototype mode's switch", () => {
  let folder: string;
  let calls: string[];
  let reload: ReturnType<typeof vi.fn<() => void>>;
  let beforeSwitch: ReturnType<typeof vi.fn<() => Promise<void>>>;
  const made: Prototype[] = [];

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "gratovo-switch-"));
    calls = [];
    reload = vi.fn<() => void>(() => {
      calls.push("reload");
    });
    beforeSwitch = vi.fn<() => Promise<void>>(() => {
      calls.push("beforeSwitch");
      return Promise.resolve();
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    for (const proto of made.splice(0)) {
      proto.close();
    }
    vi.restoreAllMocks();
    await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  /** A base whose frame says whether `me` is the owner, noting each owner check in `calls`. */
  function base(owner: boolean): PrototypeDeps["base"] {
    const fake = {
      frame: () => {
        calls.push("owner");
        return Promise.resolve({ me: "me", team: [{ id: "me", roles: owner ? ["owner"] : [] }] });
      },
    };
    return { source: () => fake as unknown as DataSource };
  }

  function make(extra: Partial<PrototypeDeps> = {}, owner = true): Prototype {
    const proto = createPrototype({
      userData: folder,
      now: () => start,
      base: base(owner),
      reloadWindow: reload,
      beforeSwitch,
      ...extra,
    });
    made.push(proto);
    return proto;
  }

  /** `openExampleCopy`, failing for the scenarios in `failing`. */
  function openFailingFor(failing: Set<Scenario>): typeof openExampleCopy {
    return (path, now, options) => {
      if (failing.has(options?.scenario ?? "normal")) {
        throw Object.assign(new Error("C:\\Users\\maya\\prototype.db"), { code: "EBUSY" });
      }
      return openExampleCopy(path, now, options);
    };
  }

  it("never calls beforeSwitch for a non-owner's refused turn-on", async () => {
    const proto = make({}, false);
    await expect(proto.set(true)).rejects.toThrow("prototype mode is for the owner");
    expect(beforeSwitch).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("calls beforeSwitch after the owner check on an owner's turn-on, and on a turn-off", async () => {
    const proto = make();
    await proto.set(true);
    expect(calls).toEqual(["owner", "beforeSwitch", "reload"]);
    calls.length = 0;
    await proto.set(true);
    expect(beforeSwitch).toHaveBeenCalledOnce();
    await proto.set(false);
    expect(calls[0]).toBe("beforeSwitch");
    expect(beforeSwitch).toHaveBeenCalledTimes(2);
    expect(proto.isOn()).toBe(false);
  });

  it("calls beforeSwitch on a scenario pick: before the folder is emptied, and before the swap", async () => {
    const proto = make({
      removeFolder: (path) => {
        calls.push("rm");
        return rm(path, { recursive: true, force: true });
      },
    });
    await proto.set(true);
    calls.length = 0;
    await proto.setScenario("later");
    expect(calls.slice(0, 4)).toEqual(["beforeSwitch", "rm", "beforeSwitch", "reload"]);
    expect((await proto.status()).scenario).toBe("later");
  });

  it("stays on at every wait of a scenario pick and of a turn-on", async () => {
    const seen: boolean[] = [];
    const proto = make({
      removeFolder: async (path) => {
        seen.push(proto.isOn());
        await new Promise((resolve) => setTimeout(resolve, 5));
        seen.push(proto.isOn());
        await rm(path, { recursive: true, force: true });
      },
    });
    beforeSwitch.mockImplementation(async () => {
      seen.push(proto.isOn());
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(proto.isOn());
    });
    await proto.set(true);
    // Off while it waits to turn on: it never looks on without a copy.
    expect(seen).toEqual([false, false, false, false]);
    expect(proto.isOn()).toBe(true);

    seen.length = 0;
    await proto.setScenario("broke");
    expect(seen).toEqual([true, true, true, true, true, true]);
    expect(proto.isOn()).toBe(true);
  });

  it("keeps the old scenario on, and reloads, when the folder can't be emptied", async () => {
    let failing = false;
    let onWhileRemoving: boolean | null = null;
    const proto = make({
      removeFolder: (path) => {
        if (!failing) {
          return rm(path, { recursive: true, force: true });
        }
        onWhileRemoving = proto.isOn();
        return Promise.reject(Object.assign(new Error("busy"), { code: "EBUSY" }));
      },
    });
    await proto.set(true);
    const before = proto.source();
    reload.mockClear();
    failing = true;

    await expect(proto.setScenario("broke")).rejects.toThrow("busy");
    expect(onWhileRemoving).toBe(true);
    expect(proto.isOn()).toBe(true);
    expect(proto.source()).toBe(before);
    expect(await proto.status()).toEqual({ available: true, on: true, scenario: "normal" });
    expect(reload).toHaveBeenCalledOnce();
  });

  it("stays off, and reloads, when the folder can't be emptied at a turn-on", async () => {
    const proto = make({
      removeFolder: () => Promise.reject(Object.assign(new Error("busy"), { code: "EPERM" })),
    });
    await expect(proto.set(true)).rejects.toThrow("busy");
    expect(proto.isOn()).toBe(false);
    expect(beforeSwitch).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("falls back to the old scenario when the new copy won't open", async () => {
    const proto = make({ openCopy: openFailingFor(new Set(["broke"])) });
    await proto.set(true);
    await proto.source()?.write([{ kind: "me.name", name: "Ada" }]);
    reload.mockClear();

    await expect(proto.setScenario("broke")).rejects.toThrow();
    expect(proto.isOn()).toBe(true);
    // The previous scenario again, as a fresh copy; the stored scenario is unchanged.
    expect(await proto.status()).toEqual({ available: true, on: true, scenario: "normal" });
    expect((await proto.source()?.frame())?.source).toBe("example");
    expect(reload).toHaveBeenCalledOnce();
    expect(vi.mocked(console.warn).mock.calls.flat().join(" ")).not.toContain("maya");

    proto.close();
    expect(await make().status()).toMatchObject({ on: false, scenario: "normal" });
  });

  it("turns off cleanly, and reloads, when neither copy will open", async () => {
    const failing = new Set<Scenario>();
    const proto = make({ openCopy: openFailingFor(failing) });
    await proto.set(true);
    reload.mockClear();
    failing.add("normal").add("broke");

    await expect(proto.setScenario("broke")).rejects.toThrow();
    expect(proto.isOn()).toBe(false);
    expect(proto.source()).toBeNull();
    expect(reload).toHaveBeenCalledOnce();
    expect((await proto.status()).scenario).toBe("normal");
  });

  it("stops the switch when beforeSwitch fails", async () => {
    const proto = make();
    await proto.set(true);
    const before = proto.source();
    beforeSwitch.mockRejectedValueOnce(new Error("the search won't stop"));
    await expect(proto.set(false)).rejects.toThrow("the search won't stop");
    expect(proto.source()).toBe(before);
  });

  it("runs overlapping turns and picks one at a time, with one copy open at most", async () => {
    let open = 0;
    let most = 0;
    const proto = make({
      openCopy: (path, now, options) => {
        const copy = openExampleCopy(path, now, options);
        open += 1;
        most = Math.max(most, open);
        const close = copy.source.close.bind(copy.source);
        copy.source.close = () => {
          open -= 1;
          close();
        };
        return copy;
      },
    });

    const answers = await Promise.allSettled([
      proto.set(true),
      proto.setScenario("broke"),
      proto.set(true),
      proto.set(false),
      proto.set(true),
      proto.setScenario("later"),
    ]);
    expect(answers.map((answer) => answer.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "fulfilled",
      "fulfilled",
      "fulfilled",
      "fulfilled",
    ]);
    expect(most).toBe(1);
    expect(open).toBe(1);
    expect(await proto.status()).toEqual({ available: true, on: true, scenario: "later" });
    // On, broke (the pick), off, on (broke, as stored), later: five switches, five reloads.
    expect(reload).toHaveBeenCalledTimes(5);
  });
});
