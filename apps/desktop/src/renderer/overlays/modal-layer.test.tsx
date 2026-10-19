// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Floating } from "./floating";
import { ModalLayer } from "./modal-layer";

afterEach(cleanup);

describe("ModalLayer", () => {
  it("renders its children in a dialog with the label", () => {
    render(
      <ModalLayer label="Search" onClose={() => undefined}>
        <p>inside</p>
      </ModalLayer>,
    );
    const dialog = document.querySelector("dialog");
    expect(dialog?.getAttribute("aria-label")).toBe("Search");
    expect(dialog?.classList.contains("layer")).toBe(true);
    expect(dialog?.contains(screen.getByText("inside"))).toBe(true);
  });

  it("gives focus back to the earlier focused element on unmount", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const view = render(
      <ModalLayer label="Search" onClose={() => undefined}>
        <button>inner</button>
      </ModalLayer>,
    );
    screen.getByText("inner").focus();
    view.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("prevents the dialog's own cancel", () => {
    render(
      <ModalLayer label="Search" onClose={() => undefined}>
        <p>inside</p>
      </ModalLayer>,
    );
    const event = new Event("cancel", { cancelable: true, bubbles: false });
    document.querySelector("dialog")?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("calls onClose for a click on the dialog itself, not on a child", () => {
    const onClose = vi.fn();
    render(
      <ModalLayer label="Search" onClose={onClose}>
        <p>inside</p>
      </ModalLayer>,
    );
    fireEvent.click(screen.getByText("inside"));
    expect(onClose).not.toHaveBeenCalled();
    const dialog = document.querySelector("dialog");
    if (dialog === null) throw new Error("no dialog");
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("focuses its first control by default, and itself with focusSelf", () => {
    const first = render(
      <ModalLayer label="Search" onClose={() => undefined}>
        <button>inner</button>
      </ModalLayer>,
    );
    expect(document.activeElement).not.toBe(document.querySelector("dialog"));
    first.unmount();
    render(
      <ModalLayer label="Keyboard shortcuts" onClose={() => undefined} focusSelf>
        <button>inner</button>
      </ModalLayer>,
    );
    expect(document.activeElement).toBe(document.querySelector("dialog"));
  });

  it("holds the floating container while open, so toasts and menus show above it", () => {
    render(
      <Floating>
        <p>floating</p>
      </Floating>,
    );
    const floating = screen.getByText("floating");
    expect(floating.closest("dialog")).toBeNull();
    const view = render(
      <ModalLayer label="Search" onClose={() => undefined}>
        <p>inside</p>
      </ModalLayer>,
    );
    expect(floating.closest("dialog")).toBe(document.querySelector("dialog"));
    expect(floating.isConnected).toBe(true);
    view.unmount();
    expect(floating.closest("dialog")).toBeNull();
    expect(floating.isConnected).toBe(true);
  });
});
