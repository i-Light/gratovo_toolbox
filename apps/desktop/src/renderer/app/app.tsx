import { cx } from "@gratovo/ui";
import { memo, useEffect, useLayoutEffect, useRef } from "react";

import { useKeys } from "../lib/keys";
import { useNarrow } from "../lib/media";
import { usePref } from "../lib/prefs";
import { usePrototype } from "../lib/prototype";
import { selectProblems, selectRoute, setRailOpen, useApp } from "../lib/store";
import { useFirstRun } from "./first-run";
import { useGlobalKeys, useKeyListener } from "./global-keys";
import { CommentLayer } from "../prototype/comment-layer";
import { MenuLayer } from "../overlays/menu-layer";
import { Palette } from "../overlays/palette";
import { Peek } from "../overlays/peek";
import { Shortcuts } from "../overlays/shortcuts";
import { SettingsScreen } from "../settings/settings-screen";
import { Toasts } from "../overlays/toasts";
import { Tooltip } from "../overlays/tooltip";
import { Trays } from "../overlays/trays";
import { FindScreen } from "../find/find-screen";
import { ReachScreen } from "../reach/reach-screen";
import { ToolboxScreen } from "../toolbox/toolbox-screen";
import { PlaceholderScreen } from "./placeholder-screen";
import { ProblemsBar } from "./problems-bar";
import { RecordPage } from "./record-page";
import { Rail, railId } from "./rail";
import { TopBar, menuButtonId } from "./top-bar";

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
    <div className="bars" ref={ref} data-ui="frame.bars">
      <ProblemsBar problems={problems} />
    </div>
  );
});

/** The scrolling content area. It holds the current screen and goes back to the top on each route change. */
const Content = memo(function Content() {
  const screen = useApp((s) => selectRoute(s).screen);
  const tab = useApp((s) => selectRoute(s).tab);
  const kind = useApp((s) => selectRoute(s).record?.kind);
  const id = useApp((s) => selectRoute(s).record?.id);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [screen, tab, kind, id]);
  return (
    <main className="content" id="content" ref={ref} data-ui="frame.content">
      {screen === "record" ? (
        <RecordPage
          key={`${String(kind)}${String(id)}`}
          record={kind === undefined || id === undefined ? undefined : { kind, id }}
        />
      ) : screen === "settings" ? (
        <SettingsScreen key={screen} />
      ) : screen === "find" ? (
        <FindScreen key={screen} />
      ) : screen === "reach" ? (
        <ReachScreen key={screen} />
      ) : screen === "toolbox" ? (
        <ToolboxScreen key={screen} />
      ) : (
        <PlaceholderScreen key={screen} screen={screen} />
      )}
    </main>
  );
});

/** The area under the bars: the content, and the peek panel beside it while one is open. */
const Body = memo(function Body() {
  const peeking = useApp((s) => s.ui.peek !== null);
  return (
    <div className={cx("body", peeking && "has-peek")}>
      <Content />
      <Peek />
    </div>
  );
});

/**
 * Moves focus into the drawer when it opens (to the current screen's button), and back to the Menu
 * button when it closes with focus inside it or lost (the closed drawer is inert).
 */
function useDrawerFocus(open: boolean): void {
  const wasOpen = useRef(false);
  useEffect(() => {
    const rail = document.getElementById(railId);
    if (open && !wasOpen.current) {
      const current = rail?.querySelector<HTMLElement>('.nav[aria-current="page"]');
      (current ?? rail?.querySelector<HTMLElement>(".nav"))?.focus();
    } else if (!open && wasOpen.current) {
      const active = document.activeElement;
      if (active === null || active === document.body || rail?.contains(active) === true) {
        document.getElementById(menuButtonId)?.focus();
      }
    }
    wasOpen.current = open;
  }, [open]);
}

/**
 * The app frame: rail, top bar, problems bar and the content area, plus the narrow-width drawer
 * and the document key listener. It subscribes only to the rail preference and the drawer state;
 * each part below reads its own slice, so a change to one does not re-render the others.
 */
export function App() {
  useGlobalKeys();
  useKeyListener();
  useFirstRun();
  const railMin = usePref("rail") === "min";
  const railOpen = useApp((s) => s.ui.railOpen);
  const narrow = useNarrow();
  const proto = usePrototype();
  const protoOn = proto.status?.on === true;
  const drawerOpen = narrow && railOpen;
  // A drawer left open while the window widens would come back open later, so it closes.
  useEffect(() => {
    if (!narrow) {
      setRailOpen(false);
    }
  }, [narrow]);
  useDrawerFocus(drawerOpen);
  useKeys(
    {
      escape: () => {
        setRailOpen(false);
      },
    },
    { active: drawerOpen },
  );
  return (
    <div
      className={cx(
        "app",
        railMin && "rail-min",
        railOpen && "rail-open",
        protoOn && proto.panel && "cmt-panel-on",
      )}
    >
      <Rail />
      {drawerOpen ? (
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
        <Body />
      </div>
      <Trays />
      <Palette />
      <Shortcuts />
      <MenuLayer />
      <Toasts />
      <Tooltip />
      {protoOn ? <CommentLayer /> : null}
    </div>
  );
}
