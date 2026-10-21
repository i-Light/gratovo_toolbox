import { canGoBack, canGoForward } from "@gratovo/core";
import { Avatar, Icon, IconBtn, avatarColor, cx } from "@gratovo/ui";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import { ago } from "../lib/format";
import { setPalette, toggleTray } from "../lib/actions";
import { screens } from "../lib/routes";
import { toast } from "../lib/toast";
import { notifShown } from "../lib/settings";
import { back, forward, recordName, selectRoute, setRailOpen, useApp } from "../lib/store";
import { strings } from "../strings";
import { railId } from "./rail";

/** The Menu button's id, so focus can come back to it when the drawer closes. */
export const menuButtonId = "menu-button";

/**
 * The crumbs: the screen's name, then the tab's name when the route has one. On a record page they
 * are the screen it was opened from ("Records" when unknown) and the record's name.
 */
function Crumbs() {
  const screen = useApp((s) => selectRoute(s).screen);
  const tab = useApp((s) => selectRoute(s).tab);
  const from = useApp((s) => selectRoute(s).from);
  const recordLabel = useApp((s) => {
    const record = selectRoute(s).record;
    return record === undefined ? null : recordName(s.data, record);
  });
  const info = screens[screen];
  const tabName = info.tabs.find((t) => t.key === tab)?.name;
  const crumbs =
    screen === "record" && recordLabel !== null
      ? [from === undefined ? strings.record.crumbFallback : screens[from].name, recordLabel]
      : tabName === undefined
        ? [info.name]
        : [info.name, tabName];
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
  const unread = useApp(
    (s) => s.data.notifications.filter((n) => !n.read && notifShown(s.data, n)).length,
  );
  const pressed = useApp((s) => s.ui.tray === "notifications");
  return (
    <IconBtn
      icon="bell"
      label={unread > 0 ? strings.top.notificationsUnread(unread) : strings.top.notifications}
      tip={strings.top.notifications}
      {...(unread > 0 ? { badge: unread } : {})}
      pressed={pressed}
      onClick={() => {
        toggleTray("notifications");
      }}
    />
  );
}

/**
 * The jobs button: a ring with the first running job's progress and a count badge while jobs run,
 * the layers icon otherwise. Its name and tip come from the first running job.
 */
function JobsButton() {
  const jobs = useApp((s) => s.ui.jobs);
  const pressed = useApp((s) => s.ui.tray === "jobs");
  const running = useMemo(() => jobs.filter((j) => !j.done), [jobs]);
  const first = running[0];
  const pct = first === undefined ? 0 : first.progress / (first.total || 1);
  const label = first === undefined ? strings.top.jobs : first.label;
  return (
    <button
      type="button"
      className="iconbtn"
      aria-label={label}
      data-tip={first === undefined ? strings.top.jobsNone : first.label}
      aria-pressed={pressed}
      onClick={() => {
        toggleTray("jobs");
      }}
    >
      {first === undefined ? (
        <Icon name="layers" size={17} />
      ) : (
        <svg className="ring-prog" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="7.5" fill="none" stroke="var(--sunk-2)" strokeWidth="2.5" />
          <circle
            cx="10"
            cy="10"
            r="7.5"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2.5"
            strokeDasharray="47.1"
            strokeDashoffset={47.1 * (1 - Math.max(0.08, pct))}
            strokeLinecap="round"
          />
        </svg>
      )}
      {first === undefined ? null : (
        <span className="badge" style={{ background: "var(--accent)" }}>
          {running.length}
        </span>
      )}
    </button>
  );
}

/**
 * "Saved", "Saving…", "Not saved" or "Not synced", with a dot and a tip that says what is true. The
 * local states win while saving or after a failure; "Not synced" shows when changes wait for a server
 * that can't be reached or keeps failing.
 */
function SaveState() {
  const saving = useApp((s) => s.ui.saving);
  const savedAt = useApp((s) => s.ui.savedAt);
  const failed = useApp((s) => s.ui.saveFailed);
  const sync = useApp((s) => s.ui.sync);
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
  const unsynced = !saving && !failed && sync.pending > 0 && sync.state === "offline";
  const stuck = !saving && !failed && sync.pending > 0 && sync.state === "stuck";
  const notSynced = unsynced || stuck;
  const label = saving
    ? strings.top.saving
    : failed
      ? strings.top.notSaved
      : notSynced
        ? strings.top.notSynced
        : strings.top.saved;
  const syncedAgo = sync.lastSyncedAt === null ? savedAt : sync.lastSyncedAt;
  const tip = saving
    ? strings.top.savingTip
    : failed
      ? strings.top.notSavedTip
      : stuck
        ? strings.top.notSyncedStuckTip
        : unsynced
          ? strings.top.notSyncedOfflineTip(sync.pending)
          : strings.top.savedTip(ago(syncedAgo, now));
  return (
    <span
      className={cx(
        "save",
        saving && "busy",
        !saving && failed && "failed",
        !saving && !failed && notSynced && "unsynced",
        "hide-narrow",
      )}
      role="status"
      data-tip={tip}
    >
      <i></i>
      {/* The longest label sits unseen behind this one (save-state.css), so the width holds. */}
      <span className="save-label" data-longest={strings.top.notSynced}>
        <span>{label}</span>
      </span>
    </span>
  );
}

/** Shows a toast each time the count of changes the server refused grows. */
function RefusedToast() {
  const refused = useApp((s) => s.ui.sync.refused);
  const state = useApp((s) => s.ui.sync.state);
  const seen = useRef(refused);
  // The page starts at "off" with nothing refused; the first real status may carry a count from
  // before this page loaded, which is not news.
  const primed = useRef(state !== "off");
  useEffect(() => {
    if (!primed.current) {
      primed.current = state !== "off";
      seen.current = refused;
      return;
    }
    if (refused > seen.current) {
      toast({
        msg: strings.top.refusedToast,
        sub: strings.top.refusedToastSub,
        icon: "alert",
      });
    }
    seen.current = refused;
  }, [refused, state]);
  return null;
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
          color={avatarColor(m.owner ? "owner" : m.name)}
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
      <button
        type="button"
        className="cmdk"
        onClick={() => {
          setPalette(true);
        }}
      >
        <Icon name="search" />
        <span className="grow">{strings.top.search}</span>
        <span className="kbd">{strings.keys.ctrlK}</span>
      </button>
      <div className="row" style={{ gap: "2px" }}>
        <JobsButton />
        <Bell />
        <SaveState />
        <RefusedToast />
        <Presence />
      </div>
    </header>
  );
});
