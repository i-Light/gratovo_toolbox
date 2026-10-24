// @vitest-environment happy-dom
import { emptyFindFilter } from "@gratovo/core/find";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyPrefs, getPrefs, initPrefs, prefsKey, readPrefs, setPref, usePref } from "./prefs";
import type { Prefs } from "./prefs";

const defaults: Prefs = {
  density: "",
  size: "",
  motion: "",
  letters: "",
  rail: "",
  findFilter: emptyFindFilter,
  findSort: "fit",
  findView: "gallery",
  findSize: "m",
  findPics: true,
  findLatest: true,
  findSignals: true,
};

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
      density: "compact",
      size: "large",
      motion: "reduce",
      letters: "off",
      rail: "min",
    };
    expect(readPrefs(storageWith(JSON.stringify(saved)))).toEqual({ ...defaults, ...saved });
  });

  it("reads the gallery's filter, sort, view, size and show toggles", () => {
    const saved = {
      findFilter: {
        ...emptyFindFilter,
        stages: ["new"],
        countries: ["US"],
        runs: [3],
        q: "agents",
      },
      findSort: "median",
      findView: "table",
      findSize: "l",
      findPics: false,
      findLatest: false,
      findSignals: false,
    };
    expect(readPrefs(storageWith(JSON.stringify(saved)))).toEqual({ ...defaults, ...saved });
  });

  it("falls back to the default for a bad gallery value, field by field", () => {
    const text = JSON.stringify({
      findFilter: { ...emptyFindFilter, stages: ["bogus"] },
      findSort: "triage",
      findView: "cards",
      findSize: "xl",
      findPics: "yes",
      findLatest: false,
    });
    expect(readPrefs(storageWith(text))).toEqual({ ...defaults, findLatest: false });
  });

  // Your name was a preference until 3d-1 moved it to your account (G13); the trimming tests went
  // with it (setMyName and the database trim now). An old saved name is ignored, field by field.
  it("ignores a name saved by an older build and keeps the other fields", () => {
    const text = JSON.stringify({ name: "Ada", density: "compact" });
    expect(readPrefs(storageWith(text))).toEqual({ ...defaults, density: "compact" });
  });

  it("keeps the good fields when one is bad", () => {
    const text = JSON.stringify({ motion: "purple", density: "compact", size: 3, rail: "min" });
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
  it("sets and removes the data attributes, and always sets the dark theme", () => {
    const root = document.createElement("div");
    applyPrefs(
      {
        ...defaults,
        density: "compact",
        size: "large",
        motion: "reduce",
      },
      root,
    );
    expect(root.dataset["theme"]).toBe("dark");
    expect(root.dataset["density"]).toBe("compact");
    expect(root.dataset["size"]).toBe("large");
    expect(root.dataset["motion"]).toBe("reduce");
    applyPrefs(defaults, root);
    expect(root.getAttributeNames()).toEqual(["data-theme"]);
    expect(root.dataset["theme"]).toBe("dark");
  });

  it("ignores a theme saved before the app went dark only", () => {
    const root = document.createElement("div");
    applyPrefs(readPrefs(storageWith(JSON.stringify({ theme: "light" }))), root);
    expect(root.dataset["theme"]).toBe("dark");
  });

  it("leaves letters and rail off the element", () => {
    const root = document.createElement("div");
    applyPrefs({ ...defaults, letters: "off", rail: "min" }, root);
    expect(root.getAttributeNames()).toEqual(["data-theme"]);
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
    const { result } = renderHook(() => usePref("density"));
    expect(result.current).toBe("");
    act(() => {
      setPref("density", "compact");
    });
    expect(result.current).toBe("compact");
    expect(getPrefs().density).toBe("compact");
    expect(document.documentElement.dataset["density"]).toBe("compact");
    expect(JSON.parse(localStorage.getItem(prefsKey) ?? "{}")).toMatchObject({
      density: "compact",
    });
    act(() => {
      setPref("density", "");
    });
    expect(document.documentElement.dataset["density"]).toBeUndefined();
  });

  it("does not re-render a component whose preference did not change", () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return usePref("density");
    });
    const before = renders;
    act(() => {
      setPref("size", "large");
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
