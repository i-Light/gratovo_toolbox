// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Thumb, ThumbAvatar } from "./thumb";

afterEach(cleanup);

describe("Thumb", () => {
  it("shows the picture through the app address, lazy-loaded", () => {
    render(<Thumb pic="v:abcdefghijk" alt="Claude Code vs Cursor" name="Agent Lab" />);
    const img = screen.getByRole("img", { name: "Claude Code vs Cursor" });
    expect(img.getAttribute("src")).toBe("app://gratovo/img/v:abcdefghijk");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("decoding")).toBe("async");
  });

  it("draws the channel's initials when there is no picture", () => {
    render(<Thumb pic={null} alt="A video" name="Agent Lab" />);
    expect(screen.getByRole("img", { name: "A video" }).textContent).toBe("AL");
    expect(document.querySelector("img")).toBeNull();
  });

  it("falls back to the placeholder when the picture fails", () => {
    render(<Thumb pic="v:abcdefghijk" alt="A video" name="Agent Lab" />);
    fireEvent.error(document.querySelector("img") as HTMLImageElement);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByRole("img", { name: "A video" }).textContent).toBe("AL");
  });

  it("tries a new picture again after one failed", () => {
    const { rerender } = render(<Thumb pic="v:abcdefghijk" alt="A video" name="Agent Lab" />);
    fireEvent.error(document.querySelector("img") as HTMLImageElement);
    rerender(<Thumb pic="v:zzzzzzzzzzz" alt="A video" name="Agent Lab" />);
    expect(document.querySelector("img")?.getAttribute("src")).toBe(
      "app://gratovo/img/v:zzzzzzzzzzz",
    );
  });
});

describe("ThumbAvatar", () => {
  it("shows a round picture, and initials without one", () => {
    const { rerender } = render(<ThumbAvatar pic="c:UCabc" name="Agent Lab" alt="Agent Lab" />);
    expect(document.querySelector(".av img")?.getAttribute("src")).toBe(
      "app://gratovo/img/c:UCabc",
    );
    rerender(<ThumbAvatar pic={null} name="Agent Lab" alt="Agent Lab" />);
    expect(screen.getByRole("img", { name: "Agent Lab" }).textContent).toBe("AL");
  });
});
