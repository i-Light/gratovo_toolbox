import { exampleFrame, nameMax, type DataSource } from "@gratovo/core/data";
import { describe, expect, it, vi } from "vitest";

import { withServerWrites } from "./live-writes";

function setup(sendName: (name: string) => Promise<void> = () => Promise.resolve()) {
  const order: string[] = [];
  const write = vi.fn<DataSource["write"]>(() => {
    order.push("local");
    return Promise.resolve();
  });
  const close = vi.fn();
  const inner: DataSource = {
    frame: () => Promise.resolve(exampleFrame(0)),
    write,
    close,
  };
  const send = vi.fn((name: string) => {
    order.push(`server:${name}`);
    return sendName(name);
  });
  return { source: withServerWrites(inner, { sendName: send }), write, close, send, order };
}

describe("withServerWrites", () => {
  it("sends a new name to the server before saving it locally", async () => {
    const t = setup();
    const writes = [{ kind: "me.name", name: "  Sam  " }] as const;
    await t.source.write(writes);
    expect(t.order).toEqual(["server:Sam", "local"]);
    expect(t.write).toHaveBeenCalledWith(writes);
  });

  it("sends only the last name of a batch, cut to the longest name", async () => {
    const t = setup();
    await t.source.write([
      { kind: "me.name", name: "First" },
      { kind: "log.remove", id: "l1" },
      { kind: "me.name", name: "x".repeat(nameMax + 10) },
    ]);
    expect(t.send).toHaveBeenCalledOnce();
    expect(t.send).toHaveBeenCalledWith("x".repeat(nameMax));
  });

  it("fails the whole batch, saving nothing, when the server doesn't take the name", async () => {
    const t = setup(() => Promise.reject(new Error("offline")));
    await expect(
      t.source.write([
        { kind: "log.remove", id: "l1" },
        { kind: "me.name", name: "Sam" },
      ]),
    ).rejects.toThrow("offline");
    expect(t.write).not.toHaveBeenCalled();
  });

  it("keeps other writes local", async () => {
    const t = setup();
    await t.source.write([{ kind: "notification.read", id: "n1", read: true }]);
    expect(t.send).not.toHaveBeenCalled();
    expect(t.write).toHaveBeenCalledOnce();
  });

  it("passes frame and close through", async () => {
    const t = setup();
    expect((await t.source.frame()).me).toBe(exampleFrame(0).me);
    t.source.close();
    expect(t.close).toHaveBeenCalledOnce();
  });
});
