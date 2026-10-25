import type { LogEntry } from "@gratovo/core/data";
import type { ChannelResponse } from "@gratovo/ipc";
import { Avatar, Btn, Empty, Icon, avatarColor } from "@gratovo/ui";
import { useEffect, useMemo, useRef, useState } from "react";

import { peek } from "../lib/actions";
import { clock, shortDate } from "../lib/format";
import { useApp } from "../lib/store";
import { strings } from "../strings";

const text = strings.toolbox.log;
const shared = strings.toolbox;

/** Lines per page (plan D40). */
const pageSize = 30;
const dayMs = 86_400_000;
/** How often the clock is read again. */
const clockMs = 60_000;
const idLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Page = ChannelResponse<"log:page">;
type Person = Page["people"][number];

interface Loaded {
  /** The person the lines are for: null is everyone. */
  readonly who: string | null;
  readonly lines: readonly LogEntry[];
  readonly more: boolean;
  readonly moreFailed: boolean;
}

const dayKey = (at: number): string => {
  const d = new Date(at);
  return `${String(d.getFullYear())}-${String(d.getMonth())}-${String(d.getDate())}`;
};

function dayName(at: number, now: number): string {
  if (dayKey(at) === dayKey(now)) {
    return text.today;
  }
  if (dayKey(at) === dayKey(now - dayMs)) {
    return text.yesterday;
  }
  return shortDate(at);
}

/**
 * The log a page at a time for one person (null: everyone). The first page is read again when the
 * frame’s newest line changes; lines already loaded below it stay. A failed first read is
 * `failed`; a failed later one only marks "Show more".
 */
function useLog(who: string | null): {
  readonly status: "loading" | "ready" | "failed";
  readonly lines: readonly LogEntry[];
  readonly more: boolean;
  readonly moreFailed: boolean;
  readonly people: readonly Person[];
  /** Everyone's lines, as main counts them; null until the first page has come. */
  readonly total: number | null;
  readonly loadMore: () => void;
} {
  const newest = useApp((s) => s.data.log[0]?.id ?? "");
  const [people, setPeople] = useState<readonly Person[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const busy = useRef(false);
  const key = JSON.stringify(who);
  useEffect(() => {
    let stopped = false;
    window.gratovo.invoke("log:page", { before: null, limit: pageSize, who }).then(
      (result) => {
        if (stopped) {
          return;
        }
        if (!result.ok) {
          setFailed(key);
          return;
        }
        const page = result.value;
        setFailed(null);
        setPeople(page.people);
        setTotal(page.total);
        setLoaded((cur) => {
          const last = page.lines.at(-1);
          const at =
            cur?.who === who && last !== undefined
              ? cur.lines.findIndex((l) => l.id === last.id)
              : -1;
          if (cur === null || cur.who !== who || at < 0) {
            return { who, lines: page.lines, more: page.more, moreFailed: false };
          }
          return {
            who,
            lines: [...page.lines, ...cur.lines.slice(at + 1)],
            more: cur.more,
            moreFailed: cur.moreFailed,
          };
        });
      },
      () => {
        if (!stopped) {
          setFailed(key);
        }
      },
    );
    return () => {
      stopped = true;
    };
  }, [who, key, newest]);
  const mine = loaded !== null && loaded.who === who ? loaded : null;
  const loadMore = (): void => {
    const last = mine?.lines.at(-1);
    if (mine === null || last === undefined || busy.current || !mine.more) {
      return;
    }
    busy.current = true;
    window.gratovo
      .invoke("log:page", { before: { at: last.at, id: last.id }, limit: pageSize, who })
      .then(
        (result) => {
          busy.current = false;
          setLoaded((cur) => {
            if (cur === null || cur.who !== who) {
              return cur;
            }
            if (!result.ok) {
              return { ...cur, moreFailed: true };
            }
            const seen = new Set(cur.lines.map((l) => l.id));
            return {
              ...cur,
              lines: [...cur.lines, ...result.value.lines.filter((l) => !seen.has(l.id))],
              more: result.value.more,
              moreFailed: false,
            };
          });
        },
        () => {
          busy.current = false;
          setLoaded((cur) =>
            cur === null || cur.who !== who ? cur : { ...cur, moreFailed: true },
          );
        },
      );
  };
  return {
    status: mine !== null ? "ready" : failed === key ? "failed" : "loading",
    lines: mine?.lines ?? [],
    more: mine?.more ?? false,
    moreFailed: mine?.moreFailed ?? false,
    people,
    total,
    loadMore,
  };
}

/**
 * Toolbox › Activity log (D40): every change anyone made, newest first, 30 a page, grouped by day,
 * with a chip for each person. A line about a creator opens that creator’s peek.
 */
export function LogTool() {
  const me = useApp((s) => s.data.me);
  const team = useApp((s) => s.data.team);
  const creators = useApp((s) => s.data.creators);
  const [who, setWho] = useState<string | null>(null);
  const log = useLog(who);
  // Read again each minute so Today and Yesterday stay right past midnight.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, clockMs);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const myName = useApp((s) => s.data.myName);
  // The real name, for the avatar: the people main counted, then the team, then the profile.
  const realName = (id: string): string => {
    const found =
      log.people.find((p) => p.who === id)?.name ??
      team.find((m) => m.id === id)?.name ??
      (id === me ? myName : null);
    return found !== null && found !== "" ? found : "?";
  };
  const nameOf = (id: string): string => {
    if (id === me) {
      return text.you;
    }
    const found = log.people.find((p) => p.who === id)?.name ?? team.find((m) => m.id === id)?.name;
    return found !== undefined && found !== "" ? found : idLike.test(id) ? text.someone : id;
  };
  const total = log.total ?? 0;
  const days = useMemo(() => {
    const out: { key: string; at: number; lines: LogEntry[] }[] = [];
    for (const line of log.lines) {
      const key = dayKey(line.at);
      const last = out[out.length - 1];
      if (last?.key === key) {
        last.lines.push(line);
      } else {
        out.push({ key, at: line.at, lines: [line] });
      }
    }
    return out;
  }, [log.lines]);
  const creatorName = (ref: string): string | null =>
    creators.find((c) => c.id === ref)?.name ?? null;
  return (
    <div className="col">
      <div className="tb-chips" role="group" aria-label={text.peopleLabel}>
        <button
          type="button"
          className="chip"
          aria-pressed={who === null}
          onClick={() => {
            setWho(null);
          }}
        >
          {text.everyone} <span className="c">{total}</span>
        </button>
        {log.people.map((p) => (
          <button
            key={p.who}
            type="button"
            className="chip"
            aria-pressed={who === p.who}
            onClick={() => {
              setWho(p.who);
            }}
          >
            {p.who === me ? text.you : p.name} <span className="c">{p.count}</span>
          </button>
        ))}
      </div>
      {log.status === "failed" ? (
        <Empty icon="alert" title={shared.loadFailed} />
      ) : log.status === "loading" ? null : days.length === 0 ? (
        <Empty icon="list" title={text.emptyTitle}>
          {text.emptyHint}
        </Empty>
      ) : (
        days.map((day) => (
          <section key={day.key} className="bucket" aria-label={dayName(day.at, now)}>
            <div className="bucket-h">
              {dayName(day.at, now)}
              <span className="m">{text.changes(day.lines.length)}</span>
            </div>
            {day.lines.map((line) => {
              const person = nameOf(line.who);
              const avatar = realName(line.who);
              const about = line.ref === null ? null : creatorName(line.ref);
              const inner = (
                <>
                  <Avatar name={avatar} color={avatarColor(avatar)} size="s" decorative />
                  <span className="lt">
                    <b className="tb-line">{line.text}</b>
                    <small>
                      {[text.by(person, clock(line.at)), about]
                        .filter((x) => x !== null)
                        .join(" · ")}
                    </small>
                  </span>
                  {line.ref === null ? null : <Icon name="chevR" size={14} className="flip" />}
                </>
              );
              const ref = line.ref;
              return ref === null ? (
                <div key={line.id} className="li">
                  {inner}
                </div>
              ) : (
                <button
                  key={line.id}
                  type="button"
                  className="li"
                  onClick={() => {
                    peek({ kind: "creator", id: ref });
                  }}
                >
                  {inner}
                </button>
              );
            })}
          </section>
        ))
      )}
      {log.more ? (
        <div>
          <Btn size="sm" onClick={log.loadMore}>
            {log.moreFailed ? shared.moreFailed : shared.showMore}
          </Btn>
        </div>
      ) : null}
    </div>
  );
}
