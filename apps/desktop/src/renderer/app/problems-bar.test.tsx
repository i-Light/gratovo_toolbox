// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Problem } from "../lib/store";
import { strings } from "../strings";
import { ProblemsBar } from "./problems-bar";

afterEach(cleanup);

describe("the problems bar", () => {
  it("renders nothing when there are no problems", () => {
    const { container } = render(<ProblemsBar problems={[]} />);
    expect(container.innerHTML).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the first problem, lists the rest on request and runs the action", async () => {
    const run = vi.fn();
    const problems: Problem[] = [
      {
        key: "a",
        text: "Mailbox outreach3 stopped",
        sub: "Sign in again.",
        action: { label: "Reconnect", run },
      },
      { key: "b", text: "Gemini key is missing", sub: "" },
    ];
    render(<ProblemsBar problems={problems} />);
    expect(screen.getByRole("alert").textContent).toContain("Mailbox outreach3 stopped");
    expect(screen.queryByText("Gemini key is missing")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: strings.problems.more(1) }));
    expect(screen.getByText("Gemini key is missing")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: strings.problems.hide }));
    expect(screen.queryByText("Gemini key is missing")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(run).toHaveBeenCalledTimes(1);
  });
});
