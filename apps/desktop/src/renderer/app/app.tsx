import { cx } from "@gratovo/ui";
import { memo, useEffect, useLayoutEffect, useRef } from "react";

import { useKeys } from "../lib/keys";
import { usePref } from "../lib/prefs";
import { selectProblems, selectRoute, setRailOpen, useApp } from "../lib/store";
import { useGlobalKeys, useKeyListener } from "./global-keys";
import { PlaceholderScreen } from "./placeholder-screen";
import { ProblemsBar } from "./problems-bar";
import { Rail } from "./rail";
import { TopBar } from "./top-bar";

/** The bars under the top bar. Writes their height to `--bars-h` so later overlays can sit below them. */
const Bars = memo(function Bars() {
  const problems = useApp(selectProblems);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty("--bars-h", `${String(el.offsetHeight)}px`);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);
  return (
    <div className="bars" ref={ref}>
      <ProblemsBar problems={problems} />
    </div>
  );
});

/** The scrolling content area. It holds the current screen and goes back to the top on each route change. */
const Content = memo(function Content() {
  const screen = useApp((s) => selectRoute(s).screen);
  const tab = useApp((s) => selectRoute(s).tab);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [screen, tab]);
  return (
    <main className="content" id="content" ref={ref}>
      <PlaceholderScreen key={screen} screen={screen} />
    </main>
  );
});

/**
 * The app frame: rail, top bar, problems bar and the content area, plus the narrow-width drawer
 * and the document key listener. It subscribes only to the rail preference and the drawer state;
 * each part below reads its own slice, so a change to one does not re-render the others.
 */
export function App() {
  useGlobalKeys();
  useKeyListener();
  const railMin = usePref("rail") === "min";
  const railOpen = useApp((s) => s.ui.railOpen);
  useKeys(
    {
      escape: () => {
        setRailOpen(false);
      },
    },
    { active: railOpen },
  );
  return (
    <div className={cx("app", railMin && "rail-min", railOpen && "rail-open")}>
      <Rail />
      {railOpen ? (
        <div
          className="scrim only-narrow"
          role="presentation"
          style={{ zIndex: 85 }}
          onClick={() => {
            setRailOpen(false);
          }}
        ></div>
      ) : null}
      <div className="main">
        <TopBar />
        <Bars />
        <div className="body">
          <Content />
        </div>
      </div>
    </div>
  );
}
