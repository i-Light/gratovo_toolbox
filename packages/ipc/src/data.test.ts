import { exampleFrame, nameMax, type DataWrite } from "@gratovo/core/data";
import { describe, expect, it, vi } from "vitest";

import { channels } from "./channels";
import { dataWriteSchema, frameSchema } from "./data";
import { createDispatcher, type Handlers } from "./dispatch";

const frame = exampleFrame(Date.UTC(2026, 9, 20));

describe("frameSchema", () => {
  it("accepts the example frame", () => {
    expect(frameSchema.safeParse(frame).success).toBe(true);
    expect(channels["frame:load"].response.safeParse(frame).success).toBe(true);
  });

  it("refuses a frame with an extra field, at any depth", () => {
    expect(frameSchema.safeParse({ ...frame, extra: 1 }).success).toBe(false);
    const [first, ...rest] = frame.team;
    const team = [{ ...first, token: "x" }, ...rest];
    expect(frameSchema.safeParse({ ...frame, team }).success).toBe(false);
  });

  it("refuses a name that is too long", () => {
    expect(frameSchema.safeParse({ ...frame, myName: "x".repeat(nameMax + 1) }).success).toBe(
      false,
    );
    expect(frameSchema.safeParse({ ...frame, myName: "x".repeat(nameMax) }).success).toBe(true);
  });

  it("refuses more than 50 log lines", () => {
    const line = { id: "l", at: 0, who: "a", text: "t" };
    expect(frameSchema.safeParse({ ...frame, log: Array(51).fill(line) }).success).toBe(false);
  });
});

describe("dataWriteSchema", () => {
  const every: DataWrite[] = [
    { kind: "notification.read", id: "n1", read: true },
    { kind: "notify.set", notify: { reply: false, money: true } },
    { kind: "me.name", name: "Sam" },
    { kind: "me.name", name: "" },
    { kind: "log.add", id: "5f1c0f3e-0000-4000-8000-000000000000", at: 1, text: "Did a thing" },
    { kind: "log.remove", id: "l1" },
  ];

  it("accepts every kind of write", () => {
    for (const write of every) {
      expect(dataWriteSchema.safeParse(write).success).toBe(true);
    }
  });

  it("refuses an unknown kind, an extra field and a name that is too long", () => {
    expect(dataWriteSchema.safeParse({ kind: "creator.delete", id: "c1" }).success).toBe(false);
    expect(dataWriteSchema.safeParse({ kind: "log.remove", id: "l1", x: 1 }).success).toBe(false);
    const name = "x".repeat(nameMax + 1);
    expect(dataWriteSchema.safeParse({ kind: "me.name", name }).success).toBe(false);
  });

  it("refuses an id over 100 characters and text over 500", () => {
    const id = "x".repeat(101);
    expect(dataWriteSchema.safeParse({ kind: "log.remove", id }).success).toBe(false);
    const text = "x".repeat(501);
    expect(dataWriteSchema.safeParse({ kind: "log.add", id: "a", at: 1, text }).success).toBe(
      false,
    );
  });
});

describe("data:write request", () => {
  const request = channels["data:write"].request;
  const write = { kind: "log.remove", id: "l1" };

  it("takes 1 to 100 writes", () => {
    expect(request.safeParse({ writes: [] }).success).toBe(false);
    expect(request.safeParse({ writes: [write] }).success).toBe(true);
    expect(request.safeParse({ writes: Array(100).fill(write) }).success).toBe(true);
    expect(request.safeParse({ writes: Array(101).fill(write) }).success).toBe(false);
  });

  it("refuses anything beside writes", () => {
    expect(request.safeParse({ writes: [write], path: "C:/x" }).success).toBe(false);
  });
});

describe("the data channels through the dispatcher", () => {
  function setup(overrides: Partial<Handlers> = {}) {
    const handlers: Handlers = {
      "app:ping": () => ({ ok: true as const, version: "1" }),
      "secrets:status": () => ({ set: false }),
      "frame:load": () => frame,
      "data:write": vi.fn(() => ({})),
      ...overrides,
    };
    const onError = vi.fn();
    return { handlers, onError, dispatch: createDispatcher(handlers, onError) };
  }

  it("returns a valid frame", async () => {
    const { dispatch } = setup();
    expect(await dispatch("frame:load", {})).toEqual({ ok: true, value: frame });
  });

  it("refuses a frame with an extra field before it leaves", async () => {
    const { dispatch, onError } = setup({ "frame:load": () => ({ ...frame, secret: "x" }) });
    expect(await dispatch("frame:load", {})).toEqual({ ok: false, reason: "The call failed" });
    expect(onError).toHaveBeenCalledOnce();
  });

  it("refuses an empty batch and 101 writes without running the handler", async () => {
    const { dispatch, handlers } = setup();
    const write = { kind: "log.remove", id: "l1" };
    expect((await dispatch("data:write", { writes: [] })).ok).toBe(false);
    expect((await dispatch("data:write", { writes: Array(101).fill(write) })).ok).toBe(false);
    expect(handlers["data:write"]).not.toHaveBeenCalled();
    expect(await dispatch("data:write", { writes: [write] })).toEqual({ ok: true, value: {} });
  });
});
