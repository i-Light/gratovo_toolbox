// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GoalReport } from "@gratovo/core/insights";

import { strings } from "../strings";
import { GoalTab } from "./goal-tab";
import { goalReport } from "./test-reports-search";

const t = strings.insights.goal;

afterEach(cleanup);

function setup(report: GoalReport = goalReport()) {
  const onGoal = vi.fn();
  const onGo = vi.fn();
  const out = render(<GoalTab report={report} onGoal={onGoal} onGo={onGo} />);
  return { onGoal, onGo, ...out };
}

describe("the Goal tab", () => {
  it("shows the goal, the chain, the lever and the room", () => {
    setup();
    expect(screen.getByText("Your goal: sign 4 creators a month.")).toBeTruthy();
    expect(screen.getByText("First emails: 10 a day short.")).toBeTruthy();
    expect(screen.getByText("yours, 61 of 1,240", { exact: false })).toBeTruthy();
    expect(screen.getByText("course figure", { exact: false })).toBeTruthy();
    expect(screen.getByText("starting guess", { exact: false })).toBeTruthy();
    expect(screen.getByText(t.chain.shortBy("10"))).toBeTruthy();
    expect(screen.getByText(t.moneyNote)).toBeTruthy();
  });

  it("tags only the first lever as the biggest", () => {
    setup();
    expect(screen.getAllByText(t.levers.biggest)).toHaveLength(1);
    expect(
      screen.getByText("Raising replies from 4.9% to 5.9% cuts first emails from 64 to 54 a day."),
    ).toBeTruthy();
  });

  it("says how much room the mailboxes have", () => {
    setup();
    expect(screen.getByText("Your mailboxes have room for 28 more a day.")).toBeTruthy();
  });

  it("commits the goal on Enter and on blur", () => {
    const s = setup();
    const input = screen.getByLabelText(new RegExp(t.inputLabel));
    fireEvent.change(input, { target: { value: "6" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(s.onGoal).toHaveBeenLastCalledWith({ signsPerMonth: 6 });
    fireEvent.change(input, { target: { value: "8" } });
    fireEvent.blur(input);
    expect(s.onGoal).toHaveBeenLastCalledWith({ signsPerMonth: 8 });
  });

  it("does not commit an invalid or unchanged goal", () => {
    const s = setup();
    const input = screen.getByLabelText(new RegExp(t.inputLabel));
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.blur(input);
    expect(s.onGoal).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe("4");
  });

  it("resets the rates", () => {
    const s = setup();
    fireEvent.click(screen.getByRole("button", { name: t.chain.reset }));
    expect(s.onGoal).toHaveBeenCalledWith({ reset: true });
  });

  it("the action under the chain goes to the step falling short", () => {
    const s = setup();
    fireEvent.click(screen.getByRole("button", { name: t.chain.open.firstEmails }));
    expect(s.onGo).toHaveBeenCalledWith({ kind: "route", screen: "reach", tab: "board" });
  });

  it("renders empty states for an empty report", () => {
    setup(goalReport({ lines: [], shortStep: null, levers: [], room: { needed: 0, capacity: 0 } }));
    expect(screen.getByText(t.emptyTitle)).toBeTruthy();
    expect(screen.getAllByText(t.levers.none).length).toBeTruthy();
    expect(screen.getByText(t.room.headlineNone)).toBeTruthy();
  });
});
