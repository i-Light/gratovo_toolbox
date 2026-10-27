import { Icon } from "@gratovo/ui";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useKeys } from "../lib/keys";
import { openCount, setPanel, toggleCommenting, usePrototype } from "../lib/prototype";
import { appStore, selectRoute } from "../lib/store";
import { strings } from "../strings";
import { anchorOf, inCmtUi, labelOf, pick } from "./anchor";
import { Composer } from "./composer";
import type { Draft } from "./composer";
import { placeOf } from "./place";

const t = strings.prototype.cmt;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly label: string;
}

function boxOf(el: Element, label: string): Box {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height, label };
}

/**
 * Comment mode: point at anything, click, write. While it is mounted the page's own clicks are
 * blocked (the tool's elements excepted), a box follows the pointer, and the bar sits at the
 * bottom. Everything it added to the page is removed again when it unmounts.
 */
export function Picker() {
  const proto = usePrototype();
  const [box, setBox] = useState<Box | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const composing = useRef(false);
  useLayoutEffect(() => {
    composing.current = draft !== null;
  });

  useEffect(() => {
    let frame = 0;
    const move = (event: PointerEvent): void => {
      if (composing.current) {
        return;
      }
      const target = pick(event.target instanceof Element ? event.target : null, event.altKey);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setBox(target === null ? null : boxOf(target, labelOf(target)));
      });
    };
    const block = (event: MouseEvent): void => {
      if (event.target instanceof Element && inCmtUi(event.target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    const click = (event: MouseEvent): void => {
      const from = event.target instanceof Element ? event.target : null;
      if (from !== null && inCmtUi(from)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (composing.current) {
        setDraft(null);
        return;
      }
      const target = pick(from, event.altKey);
      if (target === null) {
        return;
      }
      const state = appStore().getState();
      const anchor = anchorOf(target, event.clientX, event.clientY);
      setDraft({
        x: event.clientX,
        y: event.clientY,
        place: placeOf(target, selectRoute(state), state.ui.peek),
        anchor,
      });
      setBox(boxOf(target, anchor.label));
    };
    document.addEventListener("pointermove", move, true);
    document.addEventListener("mousedown", block, true);
    document.addEventListener("click", click, true);
    document.documentElement.classList.add("cmt-mode");
    return () => {
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("mousedown", block, true);
      document.removeEventListener("click", click, true);
      document.documentElement.classList.remove("cmt-mode");
      cancelAnimationFrame(frame);
    };
  }, []);

  const closeComposer = (): void => {
    setDraft(null);
    setBox(null);
  };
  useKeys(
    {
      escape: () => {
        if (draft !== null) {
          closeComposer();
        } else {
          toggleCommenting(false);
        }
      },
      c: () => {
        if (draft === null) {
          toggleCommenting(false);
        }
      },
    },
    { barrier: true },
  );

  return (
    <>
      {box === null ? null : (
        <div
          className="cmt-hl"
          style={{ left: box.x - 3, top: box.y - 3, width: box.w + 6, height: box.h + 6 }}
        >
          <span className="cmt-hl-l">{box.label}</span>
        </div>
      )}
      {draft === null ? null : <Composer draft={draft} onDone={closeComposer} />}
      <div className="cmt-bar" data-cmt-ui="1" role="status">
        <Icon name="chat" />
        <span>
          <b>{t.barHead}</b> <span className="cmt-bar-alt">{t.barAlt}</span>
        </span>
        <span className="cmt-grow" />
        <button
          type="button"
          className="btn sm"
          onClick={() => {
            setPanel(!proto.panel);
          }}
        >
          {t.openButton(openCount(proto.comments))}
        </button>
        <button
          type="button"
          className="btn sm"
          onClick={() => {
            toggleCommenting(false);
          }}
        >
          {t.barDone} <span className="kbd">{t.barEsc}</span>
        </button>
      </div>
    </>
  );
}
