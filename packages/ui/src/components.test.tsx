// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Avatar, Btn, Empty, Icon, IconBtn, Kbd, PageHead, Seg, Switch, Tag } from "./index";

afterEach(cleanup);

describe("Icon", () => {
  it("draws paths, circles and rects, hidden from screen readers by default", () => {
    const { container } = render(<Icon name="mail" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class")).toBe("ic");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("width")).toBe("16");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg?.querySelector("rect")?.getAttribute("width")).toBe("20");
    expect(svg?.querySelector("rect")?.getAttribute("rx")).toBe("2");
    expect(svg?.querySelector("path")).not.toBeNull();
    const circle = render(<Icon name="dot" />).container.querySelector("circle");
    expect(circle?.getAttribute("r")).toBe("3");
  });

  it("is an image with a title when titled", () => {
    render(<Icon name="check" title="Done" size={20} className="x" />);
    const img = screen.getByRole("img", { name: "Done" });
    expect(img.getAttribute("aria-hidden")).toBeNull();
    expect(img.getAttribute("class")).toBe("ic x");
    expect(img.getAttribute("width")).toBe("20");
  });
});

describe("IconBtn", () => {
  it("sets the label, tip, key hint and badge", () => {
    const onClick = vi.fn();
    render(<IconBtn icon="bell" label="Alerts" kbd="N" badge={3} onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Alerts" });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("class")).toBe("iconbtn");
    expect(button.getAttribute("data-tip")).toBe("Alerts");
    expect(button.getAttribute("data-kbd")).toBe("N");
    expect(button.querySelector(".badge")?.textContent).toBe("3");
    button.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("writes aria-pressed only when pressed is given", () => {
    const { rerender } = render(<IconBtn icon="bell" label="A" onClick={vi.fn()} />);
    expect(screen.getByRole("button").hasAttribute("aria-pressed")).toBe(false);
    rerender(<IconBtn icon="bell" label="A" pressed={false} onClick={vi.fn()} />);
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("false");
    rerender(<IconBtn icon="bell" label="A" pressed onClick={vi.fn()} />);
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
  });

  it("uses the tip for the tooltip and the label for the name", () => {
    render(<IconBtn icon="bell" label="Alerts" tip="Show alerts" onClick={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Alerts" });
    expect(button.getAttribute("data-tip")).toBe("Show alerts");
  });

  it("can be disabled and has no badge by default", () => {
    render(<IconBtn icon="bell" label="A" disabled onClick={vi.fn()} />);
    const button = screen.getByRole<HTMLButtonElement>("button");
    expect(button.disabled).toBe(true);
    expect(button.querySelector(".badge")).toBeNull();
  });
});

describe("Btn", () => {
  it("joins kind and size into the classes and shows the key hint of a primary button", () => {
    render(
      <Btn kind="pri" size="sm" icon="plus" kbd="Enter" tip="Add" onClick={vi.fn()}>
        Add it
      </Btn>,
    );
    const button = screen.getByRole("button");
    expect(button.getAttribute("class")).toBe("btn pri sm");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("data-tip")).toBe("Add");
    expect(button.getAttribute("data-kbd")).toBe("Enter");
    expect(button.querySelector("svg.ic")).not.toBeNull();
    expect(button.querySelector(".kbd")?.textContent).toBe("Enter");
  });

  it("keeps the key hint in the tip for a non-primary button with a tip", () => {
    render(
      <Btn kind="ghost" kbd="Esc" tip="Close" onClick={vi.fn()}>
        Close
      </Btn>,
    );
    const button = screen.getByRole("button");
    expect(button.querySelector(".kbd")).toBeNull();
    expect(button.getAttribute("data-kbd")).toBe("Esc");
  });

  it("shows the key hint on a button with no tip, and passes label and disabled", () => {
    render(
      <Btn kbd="S" label="Save now" disabled onClick={vi.fn()}>
        Save
      </Btn>,
    );
    const button = screen.getByRole<HTMLButtonElement>("button", { name: "Save now" });
    expect(button.getAttribute("class")).toBe("btn");
    expect(button.querySelector(".kbd")?.textContent).toBe("S");
    expect(button.hasAttribute("data-kbd")).toBe(false);
    expect(button.disabled).toBe(true);
  });

  it("says whether what it opens is open, and hands over its element", () => {
    const ref = createRef<HTMLButtonElement>();
    const { rerender } = render(
      <Btn ref={ref} onClick={vi.fn()}>
        Ideas
      </Btn>,
    );
    const button = screen.getByRole("button");
    expect(button.hasAttribute("aria-expanded")).toBe(false);
    expect(ref.current).toBe(button);
    rerender(
      <Btn expanded onClick={vi.fn()}>
        Ideas
      </Btn>,
    );
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("Kbd", () => {
  it("renders a key cap", () => {
    const { container } = render(<Kbd>Ctrl K</Kbd>);
    expect(container.querySelector("span.kbd")?.textContent).toBe("Ctrl K");
  });
});

describe("Avatar", () => {
  it("shows the initials on the colour with the name as its label", () => {
    render(<Avatar name="Mira Chen" color="#2c6e9b" tip="Mira" />);
    const avatar = screen.getByLabelText("Mira Chen");
    expect(avatar.textContent).toBe("MC");
    expect(avatar.getAttribute("class")).toBe("av");
    expect(avatar.style.background).not.toBe("");
    expect(avatar.getAttribute("data-tip")).toBe("Mira");
    expect(avatar.querySelector("i")).toBeNull();
  });

  it("shows the user icon when unnamed", () => {
    render(<Avatar name="You" color="#111" unnamed size="xl" />);
    const avatar = screen.getByLabelText("You");
    expect(avatar.textContent).toBe("");
    expect(avatar.querySelector("svg.ic")?.getAttribute("width")).toBe("24");
    expect(avatar.getAttribute("class")).toBe("av xl");
  });

  it("shows a photo when given", () => {
    render(<Avatar name="Mira" color="#111" photo="mira.png" />);
    expect(screen.getByLabelText("Mira").querySelector("img")?.getAttribute("src")).toBe(
      "mira.png",
    );
  });

  it("draws the status dot, with away as a second class", () => {
    const { rerender } = render(<Avatar name="A B" color="#111" status="online" size="s" />);
    expect(screen.getByLabelText("A B").getAttribute("class")).toBe("av s");
    expect(screen.getByLabelText("A B").querySelector("i")?.getAttribute("class")).toBe("dot");
    rerender(<Avatar name="A B" color="#111" status="away" size="l" />);
    expect(screen.getByLabelText("A B").querySelector("i")?.getAttribute("class")).toBe("dot away");
    expect(screen.getByLabelText("A B").getAttribute("class")).toBe("av l");
  });

  it("is hidden from screen readers when decorative, since its name is written beside it", () => {
    const { container } = render(<Avatar name="Mira Chen" color="#111" decorative />);
    const avatar = container.querySelector(".av");
    expect(avatar?.getAttribute("aria-hidden")).toBe("true");
    expect(avatar?.getAttribute("role")).toBeNull();
    expect(avatar?.getAttribute("aria-label")).toBeNull();
    expect(avatar?.textContent).toBe("MC");
  });
});

describe("Empty", () => {
  it("renders the icon, title, hint and action", () => {
    const { container } = render(
      <Empty title="Nothing yet" action={<button type="button">Add</button>}>
        Add a creator to begin.
      </Empty>,
    );
    expect(container.querySelector(".empty .ei svg.ic")?.getAttribute("width")).toBe("20");
    expect(container.querySelector("b")?.textContent).toBe("Nothing yet");
    expect(container.querySelector("p.hint")?.textContent).toBe("Add a creator to begin.");
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
  });

  it("leaves out the hint when there are no children", () => {
    const { container } = render(<Empty title="Clear" icon="check" />);
    expect(container.querySelector("p")).toBeNull();
  });
});

describe("PageHead", () => {
  it("renders the title, sub line, right side and hue", () => {
    const { container } = render(
      <PageHead
        title="Find"
        sub="Creators worth a look"
        hue="var(--find)"
        right={<span>R</span>}
      />,
    );
    const head = container.querySelector<HTMLElement>(".ph");
    expect(head?.style.getPropertyValue("--hue")).toBe("var(--find)");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Find");
    expect(container.querySelector(".t.grow p")?.textContent).toBe("Creators worth a look");
    expect(head?.lastElementChild?.textContent).toBe("R");
  });

  it("has no sub line or hue by default", () => {
    const { container } = render(<PageHead title="Team" />);
    expect(container.querySelector("p")).toBeNull();
    expect(container.querySelector(".ph")?.getAttribute("style")).toBeNull();
  });
});

describe("Seg", () => {
  it("is a named group with one pressed button, and picks on click", () => {
    const onPick = vi.fn();
    render(
      <Seg
        label="Theme"
        value="dark"
        options={[
          { value: "light", label: "Light", icon: "sun" },
          { value: "dark", label: "Dark" },
        ]}
        onPick={onPick}
      />,
    );
    const group = screen.getByRole("group", { name: "Theme" });
    expect(group.getAttribute("class")).toBe("seg");
    const light = screen.getByRole("button", { name: "Light" });
    const dark = screen.getByRole("button", { name: "Dark" });
    expect(light.getAttribute("aria-pressed")).toBe("false");
    expect(dark.getAttribute("aria-pressed")).toBe("true");
    expect(light.querySelector("svg")).not.toBeNull();
    expect(dark.querySelector("svg")).toBeNull();
    light.click();
    expect(onPick).toHaveBeenCalledWith("light");
  });
});

describe("Tag", () => {
  it("renders the text with its tone and icon", () => {
    const { container } = render(
      <Tag tone="good" icon="check">
        On
      </Tag>,
    );
    const tag = container.querySelector("span.tag");
    expect(tag?.getAttribute("class")).toBe("tag good");
    expect(tag?.textContent).toBe("On");
    expect(tag?.querySelector("svg")).not.toBeNull();
  });

  it("is plain without a tone or icon", () => {
    const { container } = render(<Tag>Owner</Tag>);
    const tag = container.querySelector("span.tag");
    expect(tag?.getAttribute("class")).toBe("tag");
    expect(tag?.querySelector("svg")).toBeNull();
  });
});

describe("Switch", () => {
  it("has the switch role, a name and a checked state, and asks for the opposite on click", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Switch on={false} label="Replies" onChange={onChange} />);
    const off = screen.getByRole("switch", { name: "Replies" });
    expect(off.getAttribute("type")).toBe("button");
    expect(off.getAttribute("class")).toBe("switch");
    expect(off.getAttribute("aria-checked")).toBe("false");
    expect(off.querySelector("i")).not.toBeNull();
    off.click();
    expect(onChange).toHaveBeenLastCalledWith(true);
    rerender(<Switch on label="Replies" onChange={onChange} />);
    const on = screen.getByRole("switch", { name: "Replies" });
    expect(on.getAttribute("aria-checked")).toBe("true");
    on.click();
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("does nothing when disabled", () => {
    const onChange = vi.fn();
    render(<Switch on label="Problems" disabled onChange={onChange} />);
    const button = screen.getByRole<HTMLButtonElement>("switch");
    expect(button.disabled).toBe(true);
    button.click();
    expect(onChange).not.toHaveBeenCalled();
  });
});
