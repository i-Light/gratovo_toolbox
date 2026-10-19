import { Icon, cx } from "@gratovo/ui";
import { useEffect, useRef } from "react";

import { dismissToast } from "../lib/actions";
import { useApp } from "../lib/store";
import type { Toast as ToastData } from "../lib/store";
import { strings } from "../strings";
import { Floating } from "./floating";

/** How often a toast checks how much of its time is left, in milliseconds. */
const tickMs = 200;

/**
 * One toast. It counts down its own time, but stands still while the pointer is over it or the
 * window is hidden, so a message is never lost before it could be read.
 */
function Toast({ toast }: { readonly toast: ToastData }) {
  const element = useRef<HTMLDivElement>(null);
  const hover = useRef(false);
  const left = useRef(toast.ms);
  const last = useRef(0);
  useEffect(() => {
    last.current = Date.now();
    const el = element.current;
    const enter = (): void => {
      hover.current = true;
    };
    const leave = (): void => {
      hover.current = false;
    };
    el?.addEventListener("mouseenter", enter);
    el?.addEventListener("mouseleave", leave);
    const timer = setInterval(() => {
      const now = Date.now();
      const dt = now - last.current;
      last.current = now;
      if (hover.current || document.hidden) {
        return;
      }
      left.current -= dt;
      if (left.current <= 0) {
        clearInterval(timer);
        dismissToast(toast.id);
      }
    }, tickMs);
    return () => {
      clearInterval(timer);
      el?.removeEventListener("mouseenter", enter);
      el?.removeEventListener("mouseleave", leave);
    };
  }, [toast.id]);
  return (
    <div ref={element} className="toast" role="status">
      <span className={cx("ti", toast.tone === "good" && "good")}>
        <Icon name={toast.icon} />
      </span>
      <div className="tm">
        {toast.msg}
        {toast.sub === undefined ? null : <small>{toast.sub}</small>}
      </div>
      {toast.actions.map((action, i) => (
        <button
          key={i}
          type="button"
          className="btn sm"
          onClick={() => {
            dismissToast(toast.id);
            action.run();
          }}
        >
          {action.label}
        </button>
      ))}
      <button
        type="button"
        className="iconbtn"
        style={{ width: "26px", height: "26px", color: "inherit" }}
        onClick={() => {
          dismissToast(toast.id);
        }}
        aria-label={strings.toasts.dismiss}
      >
        <Icon name="x" size={14} />
      </button>
      <i className="life" style={{ animationDuration: `${String(toast.ms)}ms` }}></i>
    </div>
  );
}

/** The corner stack of toasts (the newest three), above any open dialog. Reads only `ui.toasts`. */
export function Toasts() {
  const toasts = useApp((s) => s.ui.toasts);
  return (
    <Floating>
      <div className="toasts">
        {toasts.map((t) => (
          <Toast key={t.id} toast={t} />
        ))}
      </div>
    </Floating>
  );
}
