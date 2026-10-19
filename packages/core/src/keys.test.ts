import { describe, expect, it, vi } from "vitest";

import { createGoPrefix, createKeyStack, keyName } from "./keys";
import type { KeyContext, KeyInput, KeyLayer } from "./keys";

function key(k: string, mods: Partial<Omit<KeyInput, "key">> = {}): KeyInput {
  return { key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods };
}

const free: KeyContext = { typing: false, lettersOff: false };

describe("keyName", () => {
  const table: [KeyInput, string][] = [
    [key("j"), "j"],
    [key("J", { shiftKey: true }), "j"],
    [key("G", { shiftKey: true }), "g"],
    [key("?", { shiftKey: true }), "?"],
    [key("["), "["],
    [key(" "), "space"],
    [key("Escape"), "escape"],
    [key("ArrowLeft", { altKey: true }), "alt+arrowleft"],
    [key("k", { ctrlKey: true }), "mod+k"],
    [key("k", { metaKey: true }), "mod+k"],
    [key("Z", { ctrlKey: true, shiftKey: true }), "mod+z"],
    [key("Tab", { shiftKey: true }), "shift+tab"],
    [key("F5"), "f5"],
    [key("ArrowDown", { ctrlKey: true, altKey: true, shiftKey: true }), "mod+alt+shift+arrowdown"],
  ];
  it.each(table)("names %j as %s", (input, name) => {
    expect(keyName(input)).toBe(name);
  });
});

function layer(map: Record<string, () => boolean | undefined>, barrier = false): KeyLayer {
  return { keys: () => map, barrier };
}

describe("key stack dispatch", () => {
  it("runs the handler and returns true", () => {
    const stack = createKeyStack();
    const run = vi.fn();
    stack.push(layer({ j: run }));
    expect(stack.dispatch(key("j"), free)).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("passes the input to the handler", () => {
    const stack = createKeyStack();
    const run = vi.fn();
    stack.push(layer({ "mod+z": run }));
    const input = key("z", { ctrlKey: true, shiftKey: true });
    stack.dispatch(input, free);
    expect(run).toHaveBeenCalledWith(input);
  });

  it("returns false when nothing handles the key", () => {
    const stack = createKeyStack();
    stack.push(layer({ j: () => undefined }));
    expect(stack.dispatch(key("x"), free)).toBe(false);
  });

  it("ignores events that are already default-prevented", () => {
    const stack = createKeyStack();
    const run = vi.fn();
    stack.push(layer({ j: run }));
    expect(stack.dispatch(key("j", { defaultPrevented: true }), free)).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("ignores plain keys while typing, but not mod, alt, escape or F-keys", () => {
    const stack = createKeyStack();
    const run = vi.fn();
    stack.push(
      layer({ j: run, arrowdown: run, "mod+k": run, "alt+arrowleft": run, escape: run, f5: run }),
    );
    const typing: KeyContext = { typing: true, lettersOff: false };
    expect(stack.dispatch(key("j"), typing)).toBe(false);
    expect(stack.dispatch(key("ArrowDown"), typing)).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(stack.dispatch(key("k", { ctrlKey: true }), typing)).toBe(true);
    expect(stack.dispatch(key("ArrowLeft", { altKey: true }), typing)).toBe(true);
    expect(stack.dispatch(key("Escape"), typing)).toBe(true);
    expect(stack.dispatch(key("F5"), typing)).toBe(true);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it("blocks every one-character name when letters are off, but not longer names", () => {
    const stack = createKeyStack();
    const run = vi.fn();
    stack.push(
      layer({ g: run, "?": run, "[": run, escape: run, arrowdown: run, enter: run, "mod+k": run }),
    );
    const off: KeyContext = { typing: false, lettersOff: true };
    expect(stack.dispatch(key("g"), off)).toBe(false);
    expect(stack.dispatch(key("?", { shiftKey: true }), off)).toBe(false);
    expect(stack.dispatch(key("["), off)).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(stack.dispatch(key("Escape"), off)).toBe(true);
    expect(stack.dispatch(key("ArrowDown"), off)).toBe(true);
    expect(stack.dispatch(key("Enter"), off)).toBe(true);
    expect(stack.dispatch(key("k", { ctrlKey: true }), off)).toBe(true);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it("lets the newest layer win", () => {
    const stack = createKeyStack();
    const older = vi.fn();
    const newer = vi.fn();
    stack.push(layer({ j: older }));
    stack.push(layer({ j: newer }));
    stack.dispatch(key("j"), free);
    expect(newer).toHaveBeenCalledTimes(1);
    expect(older).not.toHaveBeenCalled();
  });

  it("falls through when a handler returns false", () => {
    const stack = createKeyStack();
    const older = vi.fn();
    stack.push(layer({ j: older }));
    stack.push(layer({ j: () => false }));
    expect(stack.dispatch(key("j"), free)).toBe(true);
    expect(older).toHaveBeenCalledTimes(1);
  });

  it("reads the layer's keys at dispatch time", () => {
    const stack = createKeyStack();
    let map: Record<string, () => void> = {};
    stack.push({ keys: () => map, barrier: false });
    expect(stack.dispatch(key("j"), free)).toBe(false);
    const run = vi.fn();
    map = { j: run };
    expect(stack.dispatch(key("j"), free)).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("stops at a barrier that doesn't handle the key", () => {
    const stack = createKeyStack();
    const below = vi.fn();
    stack.push(layer({ j: below }));
    stack.push(layer({}, true));
    expect(stack.dispatch(key("j"), free)).toBe(false);
    expect(below).not.toHaveBeenCalled();
  });

  it("stops at a barrier whose handler returns false", () => {
    const stack = createKeyStack();
    const below = vi.fn();
    stack.push(layer({ j: below }));
    stack.push(layer({ j: () => false }, true));
    expect(stack.dispatch(key("j"), free)).toBe(false);
    expect(below).not.toHaveBeenCalled();
  });

  it("runs a barrier's own handler", () => {
    const stack = createKeyStack();
    const run = vi.fn();
    stack.push(layer({ escape: run }, true));
    expect(stack.dispatch(key("Escape"), free)).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("lets keys pass through a non-barrier layer above a barrier handler", () => {
    const stack = createKeyStack();
    const run = vi.fn();
    stack.push(layer({ escape: run }, true));
    stack.push(layer({}));
    expect(stack.dispatch(key("Escape"), free)).toBe(true);
  });

  it("reports hasBarrier and removes exactly the layer it pushed, in any order", () => {
    const stack = createKeyStack();
    expect(stack.hasBarrier()).toBe(false);
    const a = vi.fn();
    const b = vi.fn();
    const removeA = stack.push(layer({ j: a }));
    const removeB = stack.push(layer({ k: b }, true));
    expect(stack.hasBarrier()).toBe(true);
    removeA();
    expect(stack.hasBarrier()).toBe(true);
    expect(stack.dispatch(key("j"), free)).toBe(false);
    expect(stack.dispatch(key("k"), free)).toBe(true);
    removeB();
    expect(stack.hasBarrier()).toBe(false);
    expect(stack.dispatch(key("k"), free)).toBe(false);
    expect(a).not.toHaveBeenCalled();
  });

  it("removes only its own layer when the same map is pushed twice", () => {
    const stack = createKeyStack();
    const run = vi.fn();
    const map = { j: run };
    const removeFirst = stack.push({ keys: () => map, barrier: false });
    stack.push({ keys: () => map, barrier: false });
    removeFirst();
    expect(stack.dispatch(key("j"), free)).toBe(true);
  });

  it("never calls inherited properties", () => {
    const stack = createKeyStack();
    stack.push(layer({}));
    expect(stack.dispatch(key("constructor"), free)).toBe(false);
    expect(stack.dispatch(key("toString"), free)).toBe(false);
    expect(stack.dispatch(key("__proto__"), free)).toBe(false);
    stack.push(layer({}, true));
    expect(stack.dispatch(key("constructor"), free)).toBe(false);
  });
});

describe("go prefix", () => {
  it("returns undefined when not armed", () => {
    expect(createGoPrefix().take(key("t"), 0)).toBeUndefined();
  });

  it("returns the letter within the timeout and disarms", () => {
    const go = createGoPrefix();
    go.arm(1000);
    expect(go.take(key("T", { shiftKey: true }), 2200)).toBe("t");
    expect(go.take(key("t"), 2201)).toBeUndefined();
  });

  it("returns undefined after the timeout", () => {
    const go = createGoPrefix();
    go.arm(1000);
    expect(go.take(key("t"), 2201)).toBeUndefined();
    expect(go.take(key("t"), 2202)).toBeUndefined();
  });

  it("honours a custom timeout", () => {
    const go = createGoPrefix(100);
    go.arm(0);
    expect(go.take(key("t"), 101)).toBeUndefined();
    go.arm(0);
    expect(go.take(key("t"), 100)).toBe("t");
  });

  it.each(["ctrlKey", "metaKey", "altKey"] as const)("ignores %s and stays armed", (mod) => {
    const go = createGoPrefix();
    go.arm(0);
    expect(go.take(key("t", { [mod]: true }), 100)).toBeUndefined();
    expect(go.take(key("t"), 200)).toBe("t");
  });
});
