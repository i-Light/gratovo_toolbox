// @vitest-environment happy-dom
import { exampleFrame } from "@gratovo/core/data";
import type { Bridge } from "@gratovo/ipc/bridge";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetAccountViewForTests } from "../lib/account";
import { initPrefs } from "../lib/prefs";
import { go, resetAppStoreForTests } from "../lib/store";
import { strings } from "../strings";
import { startApp } from "./start";

type State = "unconfigured" | "signed-out" | "waiting" | "signed-in";
type Problem = keyof typeof strings.auth.signIn.problems;
type Calls = [string, unknown][];

interface Script {
  status?: State;
  email?: string | null;
  signIn?: { ok: true; state: "waiting" | "signed-in" } | { ok: false; problem: Problem };
  recheck?: State | "fail";
  /** Holds the sign-in answer back until this settles. */
  hold?: Promise<unknown>;
}

function fakeInvoke(script: Script, calls: Calls): Bridge["invoke"] {
  const invoke = (channel: string, input: unknown): Promise<unknown> => {
    calls.push([channel, input]);
    switch (channel) {
      case "auth:status":
        return Promise.resolve({
          ok: true,
          value: { state: script.status ?? "signed-out", email: script.email ?? null },
        });
      case "auth:sign-in":
        return script.hold ?? Promise.resolve({ ok: true, value: script.signIn });
      case "auth:recheck":
        return Promise.resolve(
          script.recheck === "fail"
            ? { ok: false, reason: "x" }
            : { ok: true, value: { state: script.recheck ?? "waiting", email: "me@example.com" } },
        );
      case "auth:sign-out":
        return Promise.resolve({ ok: true, value: {} });
      case "frame:load":
        return Promise.resolve({ ok: true, value: exampleFrame(Date.now()) });
      default:
        return Promise.resolve({ ok: true, value: {} });
    }
  };
  return invoke as unknown as Bridge["invoke"];
}

let root: Root;
let calls: Calls;

async function start(script: Script): Promise<void> {
  calls = [];
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const invoke = fakeInvoke(script, calls);
  (window as unknown as { gratovo: Bridge }).gratovo = { invoke, on: () => () => undefined };
  await act(async () => {
    await startApp(root, invoke);
  });
}

beforeEach(() => {
  localStorage.clear();
  initPrefs();
  resetAppStoreForTests({ screen: "today", tab: null });
  resetAccountViewForTests();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  cleanup();
  document.body.innerHTML = "";
});

const text = strings.auth;
const emailField = () => screen.getByLabelText(text.signIn.email);
const passwordField = () => screen.getByLabelText(text.signIn.password);
const submit = () => screen.getByRole("button", { name: text.signIn.submit });

async function fill(email: string, password: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(emailField(), email);
  await user.type(passwordField(), password);
}

describe("start", () => {
  it("asks who is signed in before anything else", async () => {
    await start({ status: "signed-out" });
    expect(calls[0]?.[0]).toBe("auth:status");
    expect(calls.map((c) => c[0])).not.toContain("frame:load");
  });

  it("opens the app straight away when there is no account setup or you are signed in", async () => {
    for (const status of ["unconfigured", "signed-in"] as const) {
      await start({ status, email: "me@example.com" });
      // Signed in, the page also asks for the sync status (it starts listening to main).
      expect(calls.map((c) => c[0])).toEqual(
        status === "signed-in"
          ? ["auth:status", "frame:load", "sync:status"]
          : ["auth:status", "frame:load"],
      );
      expect(screen.getByRole("navigation", { name: strings.rail.label })).toBeTruthy();
      act(() => {
        root.unmount();
      });
      cleanup();
    }
  });

  describe("the sign-in card", () => {
    it("starts with focus on the email, labelled fields and the right autocomplete", async () => {
      await start({ status: "signed-out" });
      expect(document.activeElement).toBe(emailField());
      expect(emailField().getAttribute("autocomplete")).toBe("username");
      expect(passwordField().getAttribute("autocomplete")).toBe("current-password");
      expect(passwordField().getAttribute("type")).toBe("password");
      expect(screen.getByText(text.signIn.noAccount)).toBeTruthy();
      expect((submit() as HTMLButtonElement).disabled).toBe(true);
    });

    it("submits with Enter and sends the trimmed email and the password", async () => {
      await start({ status: "signed-out", signIn: { ok: true, state: "waiting" } });
      const user = userEvent.setup();
      await user.type(emailField(), " me@example.com ");
      await user.type(passwordField(), "hunter22{Enter}");
      expect(calls.find((c) => c[0] === "auth:sign-in")?.[1]).toEqual({
        email: "me@example.com",
        password: "hunter22",
      });
    });

    it.each(Object.keys(text.signIn.problems) as Problem[])(
      "says what went wrong for %s, clears the password and puts focus back on it",
      async (problem) => {
        await start({ status: "signed-out", signIn: { ok: false, problem } });
        await fill("me@example.com", "wrong-one");
        await userEvent.setup().click(submit());
        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toBe(text.signIn.problems[problem]);
        expect((passwordField() as HTMLInputElement).value).toBe("");
        expect((emailField() as HTMLInputElement).value).toBe("me@example.com");
        expect(document.activeElement).toBe(passwordField());
      },
    );

    it("shows Signing in while the call is open and ignores a second press", async () => {
      let release: (value: unknown) => void = () => undefined;
      const hold = new Promise((resolve) => {
        release = resolve;
      });
      await start({ status: "signed-out", hold });
      await fill("me@example.com", "pw");
      const user = userEvent.setup();
      await user.click(submit());
      const busy = screen.getByRole("button", { name: text.signIn.submitting });
      expect((busy as HTMLButtonElement).disabled).toBe(true);
      await user.type(passwordField(), "{Enter}");
      expect(calls.filter((c) => c[0] === "auth:sign-in")).toHaveLength(1);
      await act(async () => {
        release({ ok: true, value: { ok: false, problem: "offline" } });
        await hold;
      });
      expect((await screen.findByRole("alert")).textContent).toBe(text.signIn.problems.offline);
    });

    it("goes on to the waiting screen, and to the app when signed in", async () => {
      await start({ status: "signed-out", signIn: { ok: true, state: "waiting" } });
      await fill("me@example.com", "pw");
      await userEvent.setup().click(submit());
      expect(await screen.findByText(text.waiting.sub)).toBeTruthy();
      expect(screen.getByText(text.waiting.signedInAs("me@example.com"))).toBeTruthy();

      act(() => {
        root.unmount();
      });
      await start({ status: "signed-out", signIn: { ok: true, state: "signed-in" } });
      await fill("me@example.com", "pw");
      await userEvent.setup().click(submit());
      await screen.findByRole("navigation", { name: strings.rail.label });
      expect(calls.map((c) => c[0])).toContain("frame:load");
    });

    it("never puts the password anywhere but the sign-in call", async () => {
      await start({ status: "signed-out", signIn: { ok: false, problem: "invalid" } });
      await fill("me@example.com", "s3cret-pw");
      await userEvent.setup().click(submit());
      await screen.findByRole("alert");
      const others = calls.filter((c) => c[0] !== "auth:sign-in");
      expect(JSON.stringify(others)).not.toContain("s3cret-pw");
      expect(document.body.innerHTML).not.toContain("s3cret-pw");
    });
  });

  describe("the waiting screen", () => {
    it("says who is signed in and offers Check again and Sign out", async () => {
      await start({ status: "waiting", email: "me@example.com" });
      expect(screen.getByText(text.waiting.sub)).toBeTruthy();
      expect(screen.getByText(text.waiting.signedInAs("me@example.com"))).toBeTruthy();
      expect(screen.getByRole("button", { name: text.waiting.check })).toBeTruthy();
      expect(calls.map((c) => c[0])).not.toContain("frame:load");
    });

    it("says Still waiting when nothing changed", async () => {
      await start({ status: "waiting", email: "me@example.com", recheck: "waiting" });
      await userEvent.setup().click(screen.getByRole("button", { name: text.waiting.check }));
      expect((await screen.findByRole("status")).textContent).toBe(text.waiting.stillWaiting);
    });

    it("says so when the check could not be made", async () => {
      await start({ status: "waiting", email: "me@example.com", recheck: "fail" });
      await userEvent.setup().click(screen.getByRole("button", { name: text.waiting.check }));
      expect((await screen.findByRole("status")).textContent).toBe(text.waiting.checkFailed);
    });

    it("opens the app once access arrives", async () => {
      await start({ status: "waiting", email: "me@example.com", recheck: "signed-in" });
      await userEvent.setup().click(screen.getByRole("button", { name: text.waiting.check }));
      await screen.findByRole("navigation", { name: strings.rail.label });
    });

    it("signs out without waiting for the app", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        await start({ status: "waiting", email: "me@example.com" });
        await userEvent
          .setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
          .click(screen.getByRole("button", { name: text.waiting.signOut }));
        await waitFor(() => {
          expect(calls.map((c) => c[0])).toContain("auth:sign-out");
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("signing out from the app", () => {
    it("is in the account menu and Profile when signed in, last in the menu", async () => {
      await start({ status: "signed-in", email: "me@example.com" });
      const user = userEvent.setup();
      await user.click(
        screen.getByRole("button", { name: new RegExp(strings.rail.roleOnline("")) }),
      );
      const menu = await screen.findByRole("menu");
      const items = within(menu).getAllByRole("menuitem");
      expect(items[items.length - 1]?.textContent).toContain(text.signOut);
      await user.keyboard("{Escape}");
      act(() => {
        go("settings", "profile");
      });
      expect(await screen.findByText(text.signedInAs("me@example.com"))).toBeTruthy();
    });

    it("is nowhere in example mode", async () => {
      await start({ status: "unconfigured" });
      const user = userEvent.setup();
      await user.click(
        screen.getByRole("button", { name: new RegExp(strings.rail.roleOnline("")) }),
      );
      const menu = await screen.findByRole("menu");
      expect(within(menu).queryByText(text.signOut)).toBeNull();
    });

    it("calls auth:sign-out from the menu", async () => {
      await start({ status: "signed-in", email: "me@example.com" });
      const user = userEvent.setup();
      await user.click(
        screen.getByRole("button", { name: new RegExp(strings.rail.roleOnline("")) }),
      );
      await user.click(await screen.findByRole("menuitem", { name: text.signOut }));
      await waitFor(() => {
        expect(calls.map((c) => c[0])).toContain("auth:sign-out");
      });
    });
  });
});
