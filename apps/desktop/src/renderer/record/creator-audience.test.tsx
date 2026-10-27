// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { kitCreator, passingKit, seedCreators } from "../close/close-fixtures";
import { stubReachBridge } from "../lib/reach-test-bridge";
import { resetAppStoreForTests } from "../lib/store";
import { strings } from "../strings";
import { CreatorAudience } from "./creator-audience";

const text = strings.close.card;

beforeEach(() => {
  resetAppStoreForTests({ screen: "find", tab: "review" });
  stubReachBridge();
  seedCreators([kitCreator(passingKit())]);
});
afterEach(cleanup);

describe("CreatorAudience", () => {
  it("shows the kit link as text with a Copy button, not an anchor", () => {
    render(<CreatorAudience creatorId="c1" />);
    expect(screen.getByText("https://example.com/kit")).toBeTruthy();
    expect(screen.getByRole("button", { name: text.copyLink })).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("returns focus to Edit when the form closes", () => {
    render(<CreatorAudience creatorId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: text.edit }));
    act(() => {
      fireEvent.keyDown(screen.getByLabelText(strings.close.kit.rate), { key: "Escape" });
    });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: text.edit }));
  });
});
