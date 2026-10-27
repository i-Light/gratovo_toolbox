// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { anchorOf, inCmtUi, locate, pick } from "./anchor";

function page(html: string): void {
  document.body.innerHTML = `<div id="root">${html}</div>`;
}
function q(selector: string): Element {
  const found = document.querySelector(selector);
  if (found === null) {
    throw new Error(`missing ${selector}`);
  }
  return found;
}

const list = `<div data-ui="reach.board"><section><h2>Board</h2><ul><li class="li"><b>Maya</b></li><li class="li"><b>Kai</b></li></ul></section></div>`;

beforeEach(() => {
  page(list);
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("anchorOf", () => {
  it("names the nearest data-ui and the path inside it", () => {
    const kai = q("li:nth-of-type(2)");
    const a = anchorOf(kai, 0, 0);
    expect(a.ui).toBe("reach.board");
    expect(a.path).toBe("section:nth-of-type(1) > ul:nth-of-type(1) > li:nth-of-type(2)");
    expect(a.tag).toBe("li");
    expect(a.text).toBe("Kai");
    expect(a.label).toContain("Kai");
    expect(a.rx).toBeGreaterThanOrEqual(0);
    expect(a.ry).toBeLessThanOrEqual(1);
  });

  it("gives an empty path for the data-ui element itself", () => {
    expect(anchorOf(q('[data-ui="reach.board"]'), 0, 0).path).toBe("");
  });

  it("uses the root when nothing above has a data-ui", () => {
    page("<p>Plain</p>");
    const a = anchorOf(q("p"), 0, 0);
    expect(a.ui).toBeNull();
    expect(a.path).toBe("p:nth-of-type(1)");
  });

  it("ignores a data-ui that is not a usable id", () => {
    page('<div data-ui="Bad Id"><p>Plain</p></div>');
    expect(anchorOf(q("p"), 0, 0).ui).toBeNull();
  });
});

describe("locate", () => {
  it("finds the exact spot", () => {
    const a = anchorOf(q("li:nth-of-type(2)"), 0, 0);
    const found = locate(a);
    expect(found?.el.textContent).toBe("Kai");
    expect(found?.moved).toBe(false);
  });

  it("finds it by text after a sibling is inserted before it", () => {
    const a = anchorOf(q("li:nth-of-type(2)"), 0, 0);
    q("ul").insertAdjacentHTML("afterbegin", '<li class="li"><b>New</b></li>');
    const found = locate(a);
    expect(found?.el.textContent).toBe("Kai");
    expect(found?.moved).toBe(false);
  });

  it("falls back to the data-ui element, marked moved", () => {
    const a = anchorOf(q("li:nth-of-type(2)"), 0, 0);
    q("li:nth-of-type(2)").remove();
    const found = locate(a);
    expect(found?.moved).toBe(true);
    expect(found?.el.getAttribute("data-ui")).toBe("reach.board");
  });

  it("gives null when the data-ui element is gone too", () => {
    const a = anchorOf(q("li:nth-of-type(2)"), 0, 0);
    page("<p>Other</p>");
    expect(locate(a)).toBeNull();
  });

  it("never counts the tool's own elements", () => {
    const a = anchorOf(q("li:nth-of-type(2)"), 0, 0);
    q("li:nth-of-type(2)").remove();
    q("ul").insertAdjacentHTML("beforeend", '<li data-cmt-ui="1">Kai</li>');
    const found = locate(a);
    expect(found?.moved).toBe(true);
  });
});

describe("pick", () => {
  it("picks the nearest target and never the tool's own elements", () => {
    page(
      '<div data-ui="x.y"><button><span>Go</span></button></div><div data-cmt-ui="1"><button>Mine</button></div>',
    );
    expect(pick(q("span"), false)?.tagName).toBe("BUTTON");
    expect(pick(q("[data-cmt-ui] button"), false)).toBeNull();
    expect(inCmtUi(q("[data-cmt-ui] button"))).toBe(true);
  });

  it("picks the whole section with Alt, and nothing for the page frame", () => {
    page(
      '<div class="app"><main class="content"><div data-ui="x.y"><section><button>Go</button></section></div></main></div>',
    );
    expect(pick(q("button"), true)?.tagName).toBe("SECTION");
    expect(pick(q("main"), false)).toBeNull();
  });
});
