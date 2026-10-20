// @vitest-environment happy-dom
import type { Bridge } from "@gratovo/ipc/bridge";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { strings } from "../strings";
import { SignIn } from "./sign-in";

afterEach(cleanup);

function bridge(pending: number | "fail"): void {
  const invoke = (): Promise<unknown> =>
    Promise.resolve(
      pending === "fail"
        ? { ok: false, reason: "x" }
        : { ok: true, value: { state: "off", pending, refused: 0, lastSyncedAt: null } },
    );
  (window as unknown as { gratovo: Bridge }).gratovo = {
    invoke,
    on: () => () => undefined,
  } as unknown as Bridge;
}

const props = {
  signIn: () => Promise.resolve({ ok: false, problem: "failed" } as const),
  onDone: () => undefined,
};

describe("the sign-in screen", () => {
  it("shows the waiting-changes line when a signed-out copy holds changes", async () => {
    bridge(3);
    render(<SignIn {...props} />);
    expect(await screen.findByText(strings.auth.signIn.waitingChanges(3))).toBeTruthy();
  });

  it("shows no line when nothing waits or the status can't be read", async () => {
    bridge(0);
    const first = render(<SignIn {...props} />);
    await Promise.resolve();
    expect(first.container.textContent).not.toContain("waiting on this computer");
    first.unmount();
    bridge("fail");
    const second = render(<SignIn {...props} />);
    await Promise.resolve();
    expect(second.container.textContent).not.toContain("waiting on this computer");
  });
});
