import { canGoBack, canGoForward } from "@gratovo/core";
import { Avatar, Icon, IconBtn, avatarColor, cx } from "@gratovo/ui";
import { memo, useEffect, useMemo, useState } from "react";

import { ago } from "../lib/format";
import { screens } from "../lib/routes";
import { back, forward, selectRoute, setRailOpen, useApp } from "../lib/store";
import { strings } from "../strings";
import { railId } from "./rail";

/** The Menu button's id, so focus can come back to it when the drawer closes. */
export const menuButtonId = "menu-button";

/** The crumbs: the screen's name, then the tab's name when the route has one. */
function Crumbs() {
  const screen = useApp((s) => selectRoute(s).screen);
  const tab = useApp((s) => selectRoute(s).tab);
  const info = screens[screen];
  const tabName = info.tabs.find((t) => t.key === tab)?.name;
  const crumbs = tabName === undefined ? [info.name] : [info.name, tabName];
  return (
    <nav className="crumbs hide-narrow" aria-label={strings.top.crumbs}>
      {crumbs.map((name, i) =>
        i === crumbs.length - 1 ? (
          <b key={i}>{name}</b>
        ) : (
          <span key={i} className="row" style={{ gap: "6px" }}>
            {name}
            <Icon name="chevR" size={12} className="flip" />
          </span>
        ),
      )}
    </nav>
  );
}

/** Back and Forward, enabled only when the app's own history has somewhere to go. */
function HistoryButtons() {
  const canBack = useApp((s) => canGoBack(s.ui.history));
  const canForward = useApp((s) => canGoForward(s.ui.history));
  return (
    <div className="row hide-narrow" style={{ gap: "2px" }}>
      <IconBtn
        icon="chevL"
        iconClassName="flip"
        label={strings.top.back}
        kbd={strings.keys.altLeft}
        disabled={!canBack}
        onClick={back}
      />
      <IconBtn
        icon="chevR"
        iconClassName="flip"
        label={strings.top.forward}
        kbd={strings.keys.altRight}
        disabled={!canForward}
        onClick={forward}
      />
    </div>
  );
}

/** The bell, with the count of unread notifications. */
function Bell() {
  const unread = useApp((s) => s.data.notifications.filter((n) => !n.read).length);
  return (
    <IconBtn
      icon="bell"
      label={strings.top.notifications}
      {...(unread > 0 ? { badge: unread } : {})}
      pressed={false}
      onClick={() => {
        // The notifications tray arrives in step 3c-2.
      }}
    />
  );
}

/** "Saved" or "Saving…", with a dot and a tip that says when it was saved. */
function SaveState() {
  const saving = useApp((s) => s.ui.saving);
  const savedAt = useApp((s) => s.ui.savedAt);
  // The tip says "synced 2 min ago", so the clock moves on while the bar stays mounted.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 30000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return (
    <span
      className={cx("save", saving && "busy", "hide-narrow")}
      role="status"
      data-tip={saving ? strings.top.savingTip : strings.top.savedTip(ago(savedAt, now))}
    >
      <i></i>
      {saving ? strings.top.saving : strings.top.saved}
    </span>
  );
}

/** Small avatars of the teammates who are online. */
function Presence() {
  const team = useApp((s) => s.data.team);
  const me = useApp((s) => s.data.me);
  const online = useMemo(
    () => team.filter((m) => m.status === "online" && m.id !== me),
    [team, me],
  );
  return (
    <span className="avs hide-narrow" style={{ marginInlineStart: "6px" }}>
      {online.map((m) => (
        <Avatar
          key={m.id}
          name={m.name}
          color={avatarColor(m.id === "u1" ? "owner" : m.name)}
          size="s"
          status="online"
          tip={strings.rail.memberTip(m.name, m.role)}
        />
      ))}
    </span>
  );
}

/** Opens and closes the rail's drawer at narrow widths. */
function MenuButton() {
  const railOpen = useApp((s) => s.ui.railOpen);
  return (
    <button
      type="button"
      id={menuButtonId}
      className="iconbtn only-narrow"
      onClick={() => {
        setRailOpen(!railOpen);
      }}
      aria-label={strings.top.menu}
      aria-expanded={railOpen}
      aria-controls={railId}
    >
      <Icon name="sidebar" />
    </button>
  );
}

/**
 * The bar across the top: drawer button (narrow screens), back and forward, crumbs, the search
 * button, jobs, notifications, save state and who is online. Each part reads only its own slice.
 */
export const TopBar = memo(function TopBar() {
  return (
    <header className="top">
      <MenuButton />
      <HistoryButtons />
      <Crumbs />
      {/* The command palette arrives in step 3c-2; until then this button does nothing. */}
      <button type="button" className="cmdk">
        <Icon name="search" />
        <span className="grow">{strings.top.search}</span>
        <span className="kbd">{strings.keys.ctrlK}</span>
      </button>
      <div className="row" style={{ gap: "2px" }}>
        {/* Background jobs arrive in step 3c-2; for now none are running. */}
        <button
          type="button"
          className="iconbtn"
          aria-label={strings.top.jobs}
          data-tip={strings.top.jobsNone}
          aria-pressed={false}
        >
          <Icon name="layers" size={17} />
        </button>
        <Bell />
        <SaveState />
        <Presence />
      </div>
    </header>
  );
});
