import { useEffect, useState } from "react";

import { clock, shortDate } from "../lib/format";
import { useApp } from "../lib/store";
import { strings } from "../strings";

const text = strings.creatorRecord;

interface Line {
  readonly id: string;
  readonly at: number;
  readonly who: string;
  readonly text: string;
}

type Load =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "ready"; readonly lines: readonly Line[]; readonly now: number };

const idLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const dayKey = (at: number): string => {
  const d = new Date(at);
  return `${String(d.getFullYear())}-${String(d.getMonth())}-${String(d.getDate())}`;
};

function dayName(at: number, now: number): string {
  if (dayKey(at) === dayKey(now)) return text.today;
  if (dayKey(at) === dayKey(now - 86_400_000)) return text.yesterday;
  return shortDate(at);
}

/** The lines on a record, newest first, grouped by day. Asks again when the catalog changes. */
export function RecordActivity({
  refId,
  empty = text.activityNone,
}: {
  readonly refId: string;
  /** What to say when there are no lines. */
  readonly empty?: string;
}) {
  const [tick, setTick] = useState(0);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const team = useApp((s) => s.data.team);
  useEffect(
    () =>
      window.gratovo.on("find:catalog", () => {
        setTick((n) => n + 1);
      }),
    [],
  );
  useEffect(() => {
    let stopped = false;
    window.gratovo.invoke("log:for", { ref: refId, limit: 50 }).then(
      (result) => {
        if (!stopped) {
          setLoad(
            result.ok
              ? { status: "ready", lines: result.value.lines, now: Date.now() }
              : { status: "failed" },
          );
        }
      },
      () => {
        if (!stopped) setLoad({ status: "failed" });
      },
    );
    return () => {
      stopped = true;
    };
  }, [refId, tick]);
  if (load.status === "loading") {
    return <p className="hint">{text.loading}</p>;
  }
  if (load.status === "failed") {
    return <p className="hint">{text.activityFailed}</p>;
  }
  if (load.lines.length === 0) {
    return <p className="hint">{empty}</p>;
  }
  const now = load.now;
  const days: { key: string; at: number; lines: Line[] }[] = [];
  for (const line of load.lines) {
    const key = dayKey(line.at);
    const last = days[days.length - 1];
    if (last?.key === key) {
      last.lines.push(line);
    } else {
      days.push({ key, at: line.at, lines: [line] });
    }
  }
  // Old-app lines carry a name, not an id: show it. Only a stray id reads as "Someone".
  const nameOf = (who: string): string =>
    team.find((m) => m.id === who)?.name ?? (idLike.test(who) ? text.someone : who);
  return (
    <div className="col" data-ui="record.activity" aria-label={text.activityLabel}>
      {days.map((day) => (
        <section key={day.key} className="cr-day">
          <h4>{dayName(day.at, now)}</h4>
          <ul className="cr-lines">
            {day.lines.map((l) => (
              <li key={l.id}>
                <span>{l.text}</span>
                <span className="small muted">
                  {l.who === "" ? clock(l.at) : text.lineBy(nameOf(l.who), clock(l.at))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
