import type { OutreachDraft } from "@gratovo/core/data";
import { avatarColor, Avatar, Btn, Empty } from "@gratovo/ui";
import { useMemo } from "react";

import { peek } from "../lib/actions";
import { cancelScheduled, dayWords } from "../lib/reach-actions";
import { useApp } from "../lib/store";
import { strings } from "../strings";

const text = strings.toolbox.scheduled;

/** The scheduled drafts, soonest first (the Toolbox count reads the same list). */
export function useScheduled(): readonly OutreachDraft[] {
  const drafts = useApp((s) => s.data.reach.drafts);
  return useMemo(
    () =>
      drafts
        .filter((d) => d.state === "scheduled")
        .sort((a, b) => (a.sendAt ?? 0) - (b.sendAt ?? 0) || a.id.localeCompare(b.id)),
    [drafts],
  );
}

const two = (n: number): string => String(n).padStart(2, "0");
const timeOf = (at: number): string =>
  `${two(new Date(at).getHours())}:${two(new Date(at).getMinutes())}`;
const firstLine = (body: string): string =>
  body
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l !== "") ?? "";

/**
 * Toolbox › Scheduled (D21): emails waiting for their send time, soonest first. A row opens the
 * creator's peek on its Emails tab; Cancel send puts the draft back to `ready` (an undo step).
 */
export function ScheduledTool() {
  const scheduled = useScheduled();
  const creators = useApp((s) => s.data.creators);
  if (scheduled.length === 0) {
    return (
      <Empty icon="clock" title={text.emptyTitle}>
        {text.emptyHint}
      </Empty>
    );
  }
  const list = scheduled.map((d) => d.creator);
  return (
    <ul className="col tight" aria-label={text.listLabel} data-ui="toolbox.scheduled">
      {scheduled.map((d) => {
        const creator = creators.find((c) => c.id === d.creator);
        const name = creator?.name ?? "";
        const at = d.sendAt;
        return (
          <li key={d.id} className="row wrap" style={{ gap: "6px" }}>
            <button
              type="button"
              className="li"
              style={{ flex: "1 1 280px" }}
              aria-label={text.openLabel(name)}
              onClick={() => {
                peek({ kind: "creator", id: d.creator }, list, { tab: "emails" });
              }}
            >
              <Avatar
                name={name}
                color={avatarColor(creator?.handle ?? name)}
                size="s"
                decorative
              />
              <span className="lt">
                <b>{name}</b>
                <small>{firstLine(d.body) || text.noLine}</small>
              </span>
              <span className="col t2" style={{ alignItems: "flex-end", flex: "none" }}>
                <b className="small num" style={{ fontWeight: 600 }}>
                  {at === null ? "" : `${dayWords(at)} ${timeOf(at)}`}
                </b>
                <span className="tiny muted">{text.from(d.mailbox)}</span>
              </span>
            </button>
            <Btn
              size="sm"
              icon="x"
              label={text.cancelLabel(name)}
              onClick={() => {
                cancelScheduled(d.id);
              }}
            >
              {text.cancel}
            </Btn>
          </li>
        );
      })}
    </ul>
  );
}
