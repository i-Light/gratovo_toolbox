// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetAppStoreForTests } from "../lib/store";
import { strings } from "../strings";
import { AudienceCheck } from "./audience-check";
import { kitCreator, passingKit, seedCreators } from "./close-fixtures";

const t = strings.close.audience;

beforeEach(() => {
  resetAppStoreForTests({ screen: "find", tab: "review" });
});
afterEach(cleanup);

describe("AudienceCheck", () => {
  it("passes: shows the sign button and the four rows", () => {
    const creator = kitCreator(passingKit());
    seedCreators([creator]);
    render(<AudienceCheck creator={creator} />);
    expect(screen.getByRole("button", { name: t.sign("$3,400") })).toBeTruthy();
    expect(screen.getByText("US 52% · GB 14% · CA 9%")).toBeTruthy();
    expect(screen.getByText("25-34")).toBeTruthy();
    expect(screen.getByText("4.6%")).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.decline })).toBeNull();
    expect(screen.queryByRole("button", { name: t.ask })).toBeNull();
  });

  it("fails: shows decline and park, not sign", () => {
    const creator = kitCreator(passingKit({ countries: [{ code: "IN", share: 60 }] }));
    seedCreators([creator]);
    render(<AudienceCheck creator={creator} />);
    expect(screen.getByRole("button", { name: t.decline })).toBeTruthy();
    expect(screen.getByRole("button", { name: t.park })).toBeTruthy();
    expect(screen.getByText(t.failHint)).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.sign("$3,400") })).toBeNull();
  });

  it("is missing numbers: shows ask", () => {
    const creator = kitCreator(passingKit({ ageBand: null }), "replied");
    seedCreators([creator]);
    render(<AudienceCheck creator={creator} />);
    expect(screen.getByRole("button", { name: t.ask })).toBeTruthy();
    expect(screen.getByText(t.notReceived)).toBeTruthy();
  });

  it("shows no button without actions, or in a stage the check cannot act on", () => {
    const creator = kitCreator(passingKit());
    seedCreators([creator]);
    const { unmount } = render(<AudienceCheck creator={creator} actions={false} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    unmount();
    const signed = kitCreator(passingKit(), "signed");
    render(<AudienceCheck creator={signed} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("shows Hidden for a rate the viewer cannot see, and the reply callout", () => {
    const creator = kitCreator(passingKit({ rate: null, fromReply: true }));
    seedCreators([creator], false);
    render(<AudienceCheck creator={creator} />);
    expect(screen.getByText(t.hidden)).toBeTruthy();
    expect(screen.getByText(t.fromReply)).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.ask })).toBeNull();
  });

  it("with a hidden stored rate: reads Hidden, passes, and signs without an amount", () => {
    const creator = kitCreator(passingKit({ rate: null, rateKnown: true }));
    seedCreators([creator], false);
    render(<AudienceCheck creator={creator} />);
    expect(screen.getByText(t.hidden)).toBeTruthy();
    expect(screen.getByRole("button", { name: t.signNoRate })).toBeTruthy();
    expect(screen.getByRole("group", { name: t.checkLabel })).toBeTruthy();
  });
});
