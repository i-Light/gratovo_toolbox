// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyPrefs, getPrefs, initPrefs, prefsKey, readPrefs, setPref, usePref } from "./prefs";
import type { Prefs } from "./prefs";

const defaults: Prefs = { theme: "", density: "", size: "", motion: "", letters: "", rail: "" };

function storageWith(text: string | null): Pick<Storage, "getItem"> {
  return { getItem: () => text };
}

afterEach(cleanup);

describe("readPrefs", () => {
  it("gives defaults when nothing is saved or there is no storage", () => {
    expect(readPrefs(storageWith(null))).toEqual(defaults);
    expect(readPrefs(null)).toEqual(defaults);
  });

  it("reads good JSON", () => {
    const saved = {
      theme: "dark",
      density: "compact",
      size: "large",
      motion: "reduce",
      letters: "off",
      rail: "min",
    };
    expect(readPrefs(storageWith(JSON.stringify(saved)))).toEqual(saved);
  });

  it("keeps the good fields when one is bad", () => {
    const text = JSON.stringify({ theme: "purple", density: "compact", size: 3, rail: "min" });
    expect(readPrefs(storageWith(text))).toEqual({ ...defaults, density: "compact", rail: "min" });
  });

  it("gives defaults for broken JSON or JSON that is not an object", () => {
    expect(readPrefs(storageWith("{nope"))).toEqual(defaults);
    expect(readPrefs(storageWith("[1,2]"))).toEqual(defaults);
    expect(readPrefs(storageWith("null"))).toEqual(defaults);
  });

  it("survives storage that throws", () => {
    const broken = {
      getItem: (): never => {
        throw new Error("blocked");
      },
    };
    expect(readPrefs(broken)).toEqual(defaults);
  });
});

describe("applyPrefs", () => {
  it("sets and removes the data attributes", () => {
    const root = document.createElement("div");
    applyPrefs(
      { ...defaults, theme: "dark", density: "compact", size: "large", motion: "reduce" },
      root,
    );
    expect(root.dataset["theme"]).toBe("dark");
    expect(root.dataset["density"]).toBe("compact");
    expect(root.dataset["size"]).toBe("large");
    expect(root.dataset["motion"]).toBe("reduce");
    applyPrefs(defaults, root);
    expect(root.getAttributeNames()).toEqual([]);
  });

  it("leaves letters and rail off the element", () => {
    const root = document.createElement("div");
    applyPrefs({ ...defaults, letters: "off", rail: "min" }, root);
    expect(root.getAttributeNames()).toEqual([]);
  });
});

describe("setPref", () => {
  beforeEach(() => {
    localStorage.clear();
    initPrefs();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    initPrefs();
  });

  it("saves, applies and notifies", () => {
    const { result } = renderHook(() => usePref("theme"));
    expect(result.current).toBe("");
    act(() => {
      setPref("theme", "dark");
    });
    expect(result.current).toBe("dark");
    expect(getPrefs().theme).toBe("dark");
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    expect(JSON.parse(localStorage.getItem(prefsKey) ?? "{}")).toMatchObject({ theme: "dark" });
    act(() => {
      setPref("theme", "");
    });
    expect(document.documentElement.dataset["theme"]).toBeUndefined();
  });

  it("does not re-render a component whose preference did not change", () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return usePref("density");
    });
    const before = renders;
    act(() => {
      setPref("theme", "light");
    });
    expect(renders).toBe(before);
  });

  it("loads what was saved", () => {
    localStorage.setItem(prefsKey, JSON.stringify({ rail: "min", size: "large" }));
    initPrefs();
    expect(getPrefs()).toEqual({ ...defaults, rail: "min", size: "large" });
    expect(document.documentElement.dataset["size"]).toBe("large");
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => {
      setPref("motion", "reduce");
    }).not.toThrow();
    expect(getPrefs().motion).toBe("reduce");
    expect(document.documentElement.dataset["motion"]).toBe("reduce");
  });
});
