import { Avatar, Icon } from "@gratovo/ui";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { closeMenu } from "../lib/actions";
import { useKeys } from "../lib/keys";
import { useApp } from "../lib/store";
import type { MenuItem, OpenMenu } from "../lib/store";
import { Floating } from "./floating";

/** Keeps `value` between `low` and `high` (`low` wins when the range is empty). */
function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/** Moves focus to the menu's button at the index `to` picks (from the focused one's index and the count); nothing happens past either end. */
function focusButton(root: HTMLElement | null, to: (at: number, count: number) => number): void {
  const buttons = Array.from(root?.querySelectorAll("button") ?? []);
  const at = buttons.findIndex((b) => b === document.activeElement);
  buttons[to(at, buttons.length)]?.focus();
}

function MenuBody({ menu }: { readonly menu: OpenMenu }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ readonly x: number; readonly y: number } | null>(null);

  // Hand focus back to what had it when the menu opened (E8), if it is still on the page.
  useLayoutEffect(() => {
    const opener = document.activeElement;
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus();
      }
    };
  }, []);

  // Place the menu once it is measured: inside the window, above its control when it would overflow.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) {
      return;
    }
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const wanted = menu.align === "end" ? menu.right - w : menu.x;
    const x = clamp(wanted, 8, window.innerWidth - w - 8);
    const y = menu.y + h > window.innerHeight - 8 ? Math.max(8, menu.top - h - 4) : menu.y;
    setPos({ x, y });
    el.querySelector("button")?.focus();
  }, [menu]);

  // A press outside closes it. Added after a tick so the press that opened it does not count.
  useEffect(() => {
    const off = (event: MouseEvent): void => {
      if (
        ref.current !== null &&
        event.target instanceof Node &&
        !ref.current.contains(event.target)
      ) {
        closeMenu();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", off);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", off);
    };
  }, []);

  useKeys(
    {
      escape: closeMenu,
      arrowdown: () => {
        focusButton(ref.current, (at) => at + 1);
      },
      arrowup: () => {
        focusButton(ref.current, (at) => at - 1);
      },
      home: () => {
        focusButton(ref.current, () => 0);
      },
      end: () => {
        focusButton(ref.current, (_at, count) => count - 1);
      },
    },
    { barrier: true },
  );

  const choose = (run: () => void) => () => {
    closeMenu();
    run();
  };
  const render = (item: MenuItem, i: number) => {
    if (item.kind === "separator") {
      return <hr key={i} />;
    }
    if (item.kind === "heading") {
      return (
        <div key={i} className="mh">
          {item.label}
        </div>
      );
    }
    if (item.kind === "who") {
      return (
        <button key={i} type="button" role="menuitem" className="mwho" onClick={choose(item.run)}>
          <Avatar name={item.name} color={item.color} size="l" unnamed={item.unnamed} />
          <span className="col t2" style={{ minWidth: 0 }}>
            <b className="ell">{item.name}</b>
            <small>{item.sub}</small>
          </span>
        </button>
      );
    }
    return (
      <button
        key={i}
        type="button"
        role={item.checked === undefined ? "menuitem" : "menuitemradio"}
        aria-checked={item.checked}
        {...(item.danger === true ? { style: { color: "var(--crit)" } } : {})}
        onClick={choose(item.run)}
      >
        {item.icon === undefined ? null : <Icon name={item.icon} />}
        {item.label}
        {item.hint === undefined ? null : <small>{item.hint}</small>}
        {item.checked === true ? <Icon name="check" size={14} className="mcheck" /> : null}
      </button>
    );
  };

  return (
    <div
      ref={ref}
      className="menu"
      role="menu"
      style={{
        left: `${String(pos?.x ?? menu.x)}px`,
        top: `${String(pos?.y ?? menu.y)}px`,
        visibility: pos === null ? "hidden" : "visible",
      }}
    >
      {menu.items.map(render)}
    </div>
  );
}

/**
 * Shows the open dropdown menu (the account menu, for one). Keyed by its position so a menu opened
 * again elsewhere is placed afresh. It holds the keys as a barrier: arrows, Home, End move focus,
 * Esc closes. It shows above any open dialog. Reads only `ui.menu`, so the frame does not
 * re-render when it opens.
 */
export function MenuLayer() {
  const menu = useApp((s) => s.ui.menu);
  return menu === null ? null : (
    <Floating>
      <MenuBody key={`${String(menu.x)},${String(menu.y)}`} menu={menu} />
    </Floating>
  );
}
