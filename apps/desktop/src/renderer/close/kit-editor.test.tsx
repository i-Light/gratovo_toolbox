// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubReachBridge } from "../lib/reach-test-bridge";
import { resetAppStoreForTests } from "../lib/store";
import { strings } from "../strings";
import { kitCreator, passingKit, seedCreators } from "./close-fixtures";
import { KitEditor } from "./kit-editor";

const t = strings.close.kit;

beforeEach(() => {
  resetAppStoreForTests({ screen: "find", tab: "review" });
  seedCreators([kitCreator(null, "replied")]);
});
afterEach(cleanup);

const type = (name: string, value: string): void => {
  fireEvent.change(screen.getByLabelText(name), { target: { value } });
};

describe("KitEditor", () => {
  it("saves what was typed, upper-cased, as a creator.kit write", async () => {
    const bridge = stubReachBridge();
    const done = vi.fn();
    render(<KitEditor creator={kitCreator(null, "replied")} onDone={done} />);
    type(t.country(1), "us");
    type(t.share(1), "52");
    type(t.country(2), "gb");
    type(t.ageBand, "25-34");
    type(t.engagement, "4.6");
    type(t.rate, "$3,400");
    type(t.link, "https://example.com/kit");
    fireEvent.click(screen.getByRole("button", { name: t.save }));
    await waitFor(() => {
      expect(done).toHaveBeenCalled();
    });
    expect(bridge.writes).toEqual([
      [
        {
          kind: "creator.kit",
          id: "c1",
          kit: {
            countries: [
              { code: "US", share: 52 },
              { code: "GB", share: null },
            ],
            ageBand: "25-34",
            engagement: 4.6,
            rate: 3400,
            link: "https://example.com/kit",
          },
          handle: "@promptlab",
          name: "Prompt Lab",
        },
      ],
    ]);
  });

  it("shows inline errors and sends nothing for bad input", () => {
    const bridge = stubReachBridge();
    render(<KitEditor creator={kitCreator(null)} onDone={vi.fn()} />);
    type(t.country(1), "USA");
    type(t.ageBand, "40-20");
    type(t.engagement, "140");
    type(t.rate, "12.5");
    type(t.link, "http://example.com");
    fireEvent.click(screen.getByRole("button", { name: t.save }));
    expect(screen.getByText(t.errors.code)).toBeTruthy();
    expect(screen.getByText(t.errors.age)).toBeTruthy();
    expect(screen.getByText(t.errors.engagement)).toBeTruthy();
    expect(screen.getByText(t.errors.rate)).toBeTruthy();
    expect(screen.getByText(t.errors.link)).toBeTruthy();
    expect(bridge.writes).toHaveLength(0);
  });

  it("closes on Esc without sending", () => {
    const bridge = stubReachBridge();
    const done = vi.fn();
    render(<KitEditor creator={kitCreator(null)} onDone={done} />);
    act(() => {
      fireEvent.keyDown(screen.getByLabelText(t.rate), { key: "Escape" });
    });
    expect(done).toHaveBeenCalledTimes(1);
    expect(bridge.writes).toHaveLength(0);
  });

  it("shows five country rows and reads UK as GB", async () => {
    const bridge = stubReachBridge();
    render(<KitEditor creator={kitCreator(null)} onDone={vi.fn()} />);
    expect(screen.getByLabelText(t.country(5))).toBeTruthy();
    type(t.country(1), "uk");
    fireEvent.click(screen.getByRole("button", { name: t.save }));
    await waitFor(() => {
      expect(bridge.writes).toHaveLength(1);
    });
    expect(bridge.writes[0]?.[0]).toMatchObject({
      kit: { countries: [{ code: "GB", share: null }] },
    });
  });

  it("sends only what changed, and does not judge what it did not touch", async () => {
    const bridge = stubReachBridge();
    const done = vi.fn();
    const old = kitCreator(passingKit({ link: "http://old.example.com/kit", rate: 3400.5 }));
    render(<KitEditor creator={old} onDone={done} />);
    type(t.engagement, "5");
    fireEvent.click(screen.getByRole("button", { name: t.save }));
    await waitFor(() => {
      expect(done).toHaveBeenCalled();
    });
    expect(bridge.writes[0]?.[0]).toMatchObject({ kind: "creator.kit", kit: { engagement: 5 } });
    expect(Object.keys((bridge.writes[0]?.[0] as { kit: object }).kit)).toEqual(["engagement"]);
  });

  it("closes without a write when nothing changed", () => {
    const bridge = stubReachBridge();
    const done = vi.fn();
    render(<KitEditor creator={kitCreator(passingKit())} onDone={done} />);
    fireEvent.click(screen.getByRole("button", { name: t.save }));
    expect(done).toHaveBeenCalledTimes(1);
    expect(bridge.writes).toHaveLength(0);
  });

  it("focuses the first field, and Esc on a button closes it without reaching the page", () => {
    stubReachBridge();
    const done = vi.fn();
    const outer = vi.fn();
    render(
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      <div onKeyDown={outer}>
        <KitEditor creator={kitCreator(null)} onDone={done} />
      </div>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText(t.country(1)));
    fireEvent.keyDown(screen.getByRole("button", { name: t.cancel }), { key: "Escape" });
    expect(done).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it("ignores a second save while one is running", async () => {
    const bridge = stubReachBridge();
    render(<KitEditor creator={kitCreator(null)} onDone={vi.fn()} />);
    type(t.rate, "100");
    const form = screen.getByRole("form", { name: t.title });
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => {
      expect(bridge.writes).toHaveLength(1);
    });
  });
});
