import { Avatar, Btn, Icon, IconBtn, avatarColor, cx } from "@gratovo/ui";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { closeTray, markAllRead, openSetting, readNotification } from "../lib/actions";
import { showConflictChoice } from "../lib/conflicts";
import { ago, clock } from "../lib/format";
import { useReturnFocus } from "../lib/focus";
import { useKeys } from "../lib/keys";
import { notifShown } from "../lib/settings";
import { go, useApp } from "../lib/store";
import type { Job } from "../lib/store";
import { strings } from "../strings";

const { trays } = strings;

/** A notification for an open conflict has this id prefix; clicking it asks which value to keep. */
const conflictPrefix = "conflict:";

/** One background job: its icon, what it is doing and a progress bar while it runs. */
function JobRow({ job }: { readonly job: Job }) {
  const value = job.progress + 0.3;
  const max = job.total || 3;
  const pct = Math.max(0, Math.min(100, (100 * value) / max));
  const sub = job.done
    ? (job.note ?? trays.jobFinished)
    : job.kind === "search"
      ? trays.jobKeyword(job.progress + 1, job.total)
      : trays.jobChecking;
  return (
    <div className="tray-i">
      <Icon name={job.done ? "checkc" : job.kind === "search" ? "scan" : "at"} />
      <div className="tx">
        {job.label}
        <small>{sub}</small>
        {job.done ? null : (
          <span
            className="meter"
            style={{ width: "100%" }}
            role="meter"
            aria-valuenow={value}
            aria-valuemax={max}
            aria-label={job.label}
          >
            <i style={{ width: `${String(pct)}%` }}></i>
          </span>
        )}
      </div>
    </div>
  );
}

/** Esc closes the open tray. Each tray adds its own layer, so the one opened last is on top (E2). */
function useTrayKeys(): void {
  useKeys({ escape: closeTray });
}

/** What is running in the background: your own jobs, then a teammate's search. */
function JobsTray() {
  useTrayKeys();
  const jobs = useApp((s) => s.ui.jobs);
  const mate = useApp((s) => s.data.mateRun);
  const mateName = useApp((s) => s.data.team.find((m) => m.id === mate?.by));
  return (
    <div className="tray" role="dialog" aria-label={strings.top.jobs}>
      <div className="row" style={{ padding: "6px 8px" }}>
        <h4 className="grow">{trays.jobsHeading}</h4>
        <span className="hint">{trays.jobsHint}</span>
      </div>
      {jobs.length > 0 ? (
        jobs.map((job) => <JobRow key={job.id} job={job} />)
      ) : (
        <p className="hint" style={{ padding: "6px 9px" }}>
          {trays.noJobs}
        </p>
      )}
      {mate !== null && mateName !== undefined ? (
        <Fragment>
          <hr className="divider" />
          <div className="tray-i">
            <Avatar
              name={mateName.name}
              color={avatarColor(mateName.name)}
              size="s"
              status="online"
              tip={strings.rail.memberTip(mateName.name, mateName.role)}
              decorative
            />
            <div className="tx">
              {trays.mateRunning(mateName.name, mate.current, mate.total)}
              <small>{trays.mateStarted(clock(mate.at))}</small>
            </div>
          </div>
        </Fragment>
      ) : null}
      <div className="row" style={{ padding: "4px 8px" }}>
        <Btn
          size="sm"
          kind="ghost"
          icon="scan"
          onClick={() => {
            go("find", "search");
            closeTray();
          }}
        >
          {trays.openSearch}
        </Btn>
      </div>
    </div>
  );
}

/** The bell's list: newest first as stored, unread ones marked with a dot. */
function NotificationsTray() {
  useTrayKeys();
  const data = useApp((s) => s.data);
  const notifications = useMemo(
    () => data.notifications.filter((n) => notifShown(data, n)),
    [data],
  );
  const [now] = useState(() => Date.now());
  return (
    <div className="tray" role="dialog" aria-label={strings.top.notifications}>
      <div className="row" style={{ padding: "6px 8px" }}>
        <h4 className="grow">{trays.notificationsHeading}</h4>
        <Btn size="sm" kind="ghost" onClick={markAllRead}>
          {trays.markAllRead}
        </Btn>
        <IconBtn
          icon="gear"
          label={trays.chooseBell}
          onClick={() => {
            closeTray();
            openSetting("notifications", "notify");
          }}
        />
      </div>
      {notifications.length === 0 ? (
        <p className="hint" style={{ padding: "6px 9px" }}>
          {trays.nothingNew}
        </p>
      ) : null}
      {notifications.map((n) => (
        <button
          key={n.id}
          type="button"
          className={cx("tray-i", !n.read && "unread")}
          onClick={() => {
            readNotification(n.id);
            closeTray();
            if (n.id.startsWith(conflictPrefix)) {
              showConflictChoice(n.id.slice(conflictPrefix.length));
              return;
            }
            go(n.go.screen, n.go.tab);
          }}
        >
          <Icon name={n.icon} />
          <div className="tx">
            {n.text}
            <small>{trays.notificationSub(n.sub, ago(n.at, now))}</small>
          </div>
          {n.read ? null : (
            <i
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: "var(--accent)",
                marginTop: "6px",
                flex: "none",
              }}
            ></i>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * The jobs and notifications trays under the top bar. One tray is open at a time (`ui.tray`). A
 * press outside closes it, except on the top bar, whose buttons toggle it; Esc closes it too, as
 * a plain key layer, so the layer opened last closes first (E2). Closed with focus inside it, it
 * gives focus back to the button that opened it.
 */
export function Trays() {
  const tray = useApp((s) => s.ui.tray);
  const ref = useRef<HTMLDivElement>(null);
  useReturnFocus(tray !== null);
  useEffect(() => {
    if (tray === null) {
      return undefined;
    }
    const off = (event: MouseEvent): void => {
      const target = event.target;
      if (
        ref.current !== null &&
        target instanceof Element &&
        !ref.current.contains(target) &&
        target.closest(".top") === null
      ) {
        closeTray();
      }
    };
    document.addEventListener("mousedown", off);
    return () => {
      document.removeEventListener("mousedown", off);
    };
  }, [tray]);
  if (tray === null) {
    return null;
  }
  return (
    <div ref={ref} style={{ display: "contents" }}>
      {tray === "jobs" ? <JobsTray /> : <NotificationsTray />}
    </div>
  );
}
