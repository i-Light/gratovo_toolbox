import type { Comment } from "@gratovo/ipc";
import { cx } from "@gratovo/ui";
import { useEffect, useMemo, useState } from "react";

import { setOpen, usePrototype } from "../lib/prototype";
import { selectRoute, useApp } from "../lib/store";
import { strings } from "../strings";
import { locate } from "./anchor";
import { CommentCard } from "./comment-card";
import { isHere, numberOf } from "./place";

const t = strings.prototype.cmt;

/** How often the pins re-measure, for layouts that shift without a scroll or resize. */
const measureMs = 450;

interface Spot {
  readonly comment: Comment;
  /** Null when the element is not on screen at all. */
  readonly at: { readonly x: number; readonly y: number; readonly off: boolean } | null;
  readonly moved: boolean;
}

function measure(list: readonly Comment[]): Spot[] {
  return list.map((comment) => {
    const found = locate(comment.anchor);
    if (found === null) {
      return { comment, at: null, moved: false };
    }
    const box = found.el.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) {
      return { comment, at: null, moved: found.moved };
    }
    return {
      comment,
      moved: found.moved,
      at: {
        x: box.left + box.width * comment.anchor.rx,
        y: box.top + box.height * comment.anchor.ry,
        off: box.bottom < 56 || box.top > window.innerHeight - 4,
      },
    };
  });
}

function sameSpots(a: readonly Spot[], b: readonly Spot[]): boolean {
  return (
    a.length === b.length &&
    a.every((s, i) => {
      const o = b[i];
      return (
        o !== undefined &&
        s.comment === o.comment &&
        s.moved === o.moved &&
        s.at?.x === o.at?.x &&
        s.at?.y === o.at?.y &&
        s.at?.off === o.at?.off
      );
    })
  );
}

/**
 * The numbered pins for the comments that belong on what is open, and the open comment's card.
 * Pins sit where the comment was clicked and follow their element; one whose exact spot is gone
 * is dashed and sits on its section. `showPins` false hides the pins but still shows the card.
 */
export function Pins({ showPins }: { readonly showPins: boolean }) {
  const proto = usePrototype();
  const route = useApp(selectRoute);
  const peek = useApp((s) => s.ui.peek);
  const [spots, setSpots] = useState<readonly Spot[]>([]);

  const want = useMemo(
    () =>
      proto.comments.filter(
        (c) =>
          isHere(c.place, route, peek) &&
          (proto.showDone || c.status !== "done" || proto.open === c.id),
      ),
    [proto.comments, proto.showDone, proto.open, route, peek],
  );

  useEffect(() => {
    let frame = 0;
    const run = (): void => {
      setSpots((prev) => {
        const next = measure(want);
        return sameSpots(prev, next) ? prev : next;
      });
    };
    const soon = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(run);
    };
    run();
    const timer = setInterval(run, measureMs);
    window.addEventListener("scroll", soon, true);
    window.addEventListener("resize", soon);
    return () => {
      clearInterval(timer);
      window.removeEventListener("scroll", soon, true);
      window.removeEventListener("resize", soon);
      cancelAnimationFrame(frame);
    };
  }, [want]);

  const openSpot = spots.find((s) => s.comment.id === proto.open);
  const openComment = want.find((c) => c.id === proto.open);
  return (
    <>
      {showPins
        ? spots.map((spot) => {
            if (spot.at === null || spot.at.off) {
              return null;
            }
            const c = spot.comment;
            const n = numberOf(proto.comments, c.id);
            const shortText = c.text.length > 80 ? `${c.text.slice(0, 80)}…` : c.text;
            return (
              <button
                key={c.id}
                type="button"
                data-cmt-ui="1"
                className={cx("cmt-pin", c.status === "done" && "done", spot.moved && "approx")}
                style={{
                  left: Math.min(Math.max(spot.at.x - 4, 4), window.innerWidth - 30),
                  top: Math.min(Math.max(spot.at.y - 24, 58), window.innerHeight - 30),
                }}
                aria-label={t.pinLabel(n, c.text, spot.moved)}
                aria-expanded={proto.open === c.id}
                data-tip={shortText}
                onClick={() => {
                  setOpen(proto.open === c.id ? null : c.id);
                }}
              >
                {n}
              </button>
            );
          })
        : null}
      {openComment === undefined ? null : (
        <CommentCard
          key={openComment.id}
          comment={openComment}
          n={numberOf(proto.comments, openComment.id)}
          spot={openSpot?.at == null ? null : { x: openSpot.at.x, y: openSpot.at.y }}
          moved={openSpot?.moved === true && openSpot.at !== null}
          missing={openSpot?.at == null}
        />
      )}
    </>
  );
}
