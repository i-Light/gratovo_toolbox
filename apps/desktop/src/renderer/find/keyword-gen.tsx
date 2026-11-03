import { Btn, Icon } from "@gratovo/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import { openSetting } from "../lib/actions";
import { strings } from "../strings";

const text = strings.findSearch.generate;

type Kind = "tools" | "angles";
const kinds: readonly Kind[] = ["tools", "angles"];
const termMax = 60;
const toolsMax = 500;
const anglesMax = 100;
const limit: Record<Kind, number> = { tools: toolsMax, angles: anglesMax };
/** How long the count waits after the last tick. */
const debounceMs = 300;

interface Lists {
  readonly tools: readonly string[];
  readonly angles: readonly string[];
}
type Ticks = Readonly<Record<Kind, ReadonlySet<string>>>;

/** A count, and the ticks it was made for (it is stale when they have changed). */
type Count =
  | { readonly phase: "none" }
  | {
      readonly phase: "ready";
      readonly key: string;
      readonly fresh: number;
      readonly repeats: number;
      readonly overCap: number;
      readonly sample: readonly string[];
    };

type Proposals =
  | { readonly phase: "idle" }
  | { readonly phase: "loading"; readonly kind: Kind }
  | {
      readonly phase: "ready";
      readonly kind: Kind;
      readonly terms: readonly string[];
      readonly chosen: ReadonlySet<string>;
    }
  | {
      readonly phase: "problem";
      readonly problem: "bridge_off" | "busy" | "failed" | "thinking_not_set";
    };

const kindName = (kind: Kind): string => (kind === "tools" ? text.tools : text.angles);

function ListEditor(props: {
  readonly kind: Kind;
  readonly terms: readonly string[];
  readonly ticked: ReadonlySet<string>;
  readonly onTick: (kind: Kind, term: string) => void;
  readonly onAll: (kind: Kind, on: boolean) => void;
  readonly onRemove: (kind: Kind, term: string) => void;
  readonly onAddTerm: (kind: Kind, term: string) => void;
}) {
  const { kind, terms, ticked, onTick, onAll, onRemove, onAddTerm } = props;
  const [draft, setDraft] = useState("");
  const submit = (): void => {
    const term = draft.trim();
    if (term !== "") {
      onAddTerm(kind, term);
      setDraft("");
    }
  };
  return (
    <div className="col tight gen-list">
      <div className="row wrap">
        <b style={{ fontWeight: 600 }}>{kindName(kind)}</b>
        <span className="muted num small">{`${String(ticked.size)}/${String(terms.length)}`}</span>
        <Btn
          size="sm"
          kind="ghost"
          onClick={() => {
            onAll(kind, true);
          }}
        >
          {text.all}
        </Btn>
        <Btn
          size="sm"
          kind="ghost"
          onClick={() => {
            onAll(kind, false);
          }}
        >
          {text.none}
        </Btn>
      </div>
      {terms.length === 0 ? (
        <p className="hint">{text.empty}</p>
      ) : (
        <div className="fchips gen-chips" role="group" aria-label={kindName(kind)}>
          {terms.map((term) => {
            const on = ticked.has(term);
            return (
              <span key={term} className="gen-chip">
                <button
                  type="button"
                  className="chip"
                  aria-pressed={on}
                  aria-label={text.tickLabel(term)}
                  onClick={() => {
                    onTick(kind, term);
                  }}
                >
                  {on ? <Icon name="check" size={12} /> : null}
                  {term}
                </button>
                <button
                  type="button"
                  className="gen-x"
                  aria-label={text.remove(term)}
                  onClick={() => {
                    onRemove(kind, term);
                  }}
                >
                  <Icon name="x" size={11} />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <div className="row">
        <input
          className="inp sm"
          type="text"
          maxLength={termMax}
          value={draft}
          aria-label={kind === "tools" ? text.newTool : text.newAngle}
          placeholder={kind === "tools" ? text.newTool : text.newAngle}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        />
        <Btn size="sm" icon="plus" disabled={draft.trim() === ""} onClick={submit}>
          {text.addTerm}
        </Btn>
      </div>
    </div>
  );
}

/** Find › Keywords › "Make keywords": cross the ticked tools with the ticked angles (plan S6, K3). */
export function KeywordGen() {
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState<Lists | null>(null);
  const [ticks, setTicks] = useState<Ticks>({ tools: new Set(), angles: new Set() });
  const [count, setCount] = useState<Count>({ phase: "none" });
  const [note, setNote] = useState<{ readonly text: string; readonly bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [proposals, setProposals] = useState<Proposals>({ phase: "idle" });
  const loaded = useRef(false);
  const asking = useRef(false);
  const countId = useRef(0);

  // The lists load the first time the panel opens.
  useEffect(() => {
    if (!open || loaded.current) {
      return;
    }
    loaded.current = true;
    void (async () => {
      try {
        const result = await window.gratovo.invoke("find:lists", {});
        if (result.ok) {
          setLists(result.value);
          setTicks({
            tools: new Set(result.value.tools),
            angles: new Set(result.value.angles),
          });
        } else {
          loaded.current = false;
        }
      } catch {
        loaded.current = false;
      }
    })();
  }, [open]);

  const tickedTools = lists?.tools.filter((t) => ticks.tools.has(t));
  const tickedAngles = lists?.angles.filter((a) => ticks.angles.has(a));
  const key = JSON.stringify([tickedTools, tickedAngles]);
  const canCount = (tickedTools?.length ?? 0) > 0 && (tickedAngles?.length ?? 0) > 0;
  const shown = count.phase === "ready" && count.key === key ? count : null;

  // The count follows the ticks, 300 ms after the last change.
  useEffect(() => {
    countId.current += 1;
    const id = countId.current;
    if (!open || tickedTools === undefined || tickedAngles === undefined) {
      return undefined;
    }
    if (tickedTools.length === 0 || tickedAngles.length === 0) {
      return undefined;
    }
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await window.gratovo.invoke("find:generate", {
            tools: [...tickedTools],
            angles: [...tickedAngles],
            add: false,
          });
          if (id !== countId.current) {
            return;
          }
          setCount(
            result.ok && result.value.ok
              ? {
                  phase: "ready",
                  key,
                  fresh: result.value.fresh,
                  repeats: result.value.repeats,
                  overCap: result.value.overCap,
                  sample: result.value.sample,
                }
              : { phase: "none" },
          );
        } catch {
          if (id === countId.current) {
            setCount({ phase: "none" });
          }
        }
      })();
    }, debounceMs);
    return () => {
      clearTimeout(timer);
    };
    // The ticked arrays are rebuilt each render; the sets and lists are what change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lists, ticks]);

  /** Saves the lists; answers whether main took them. */
  const save = useCallback(async (next: Lists): Promise<boolean> => {
    try {
      const result = await window.gratovo.invoke("find:lists-set", {
        tools: [...next.tools],
        angles: [...next.angles],
      });
      return result.ok;
    } catch {
      return false;
    }
  }, []);

  /** Adds terms (already trimmed) to a list, ticks them, and saves. */
  const addTerms = async (kind: Kind, terms: readonly string[]): Promise<boolean> => {
    if (lists === null) {
      return false;
    }
    const have = new Set(lists[kind].map((t) => t.toLowerCase()));
    const fresh = terms.filter((t, i) => {
      const key = t.toLowerCase();
      if (have.has(key)) {
        return false;
      }
      have.add(key);
      return terms.findIndex((u) => u.toLowerCase() === key) === i;
    });
    const room = limit[kind] - lists[kind].length;
    const take = fresh.slice(0, Math.max(0, room));
    if (take.length === 0) {
      return true;
    }
    const next = { ...lists, [kind]: [...lists[kind], ...take] };
    setLists(next);
    setTicks((cur) => ({ ...cur, [kind]: new Set([...cur[kind], ...take]) }));
    const ok = await save(next);
    setNote(ok ? null : { text: text.saveFailed, bad: true });
    return ok;
  };

  const removeTerm = (kind: Kind, term: string): void => {
    if (lists === null) {
      return;
    }
    const next = { ...lists, [kind]: lists[kind].filter((t) => t !== term) };
    setLists(next);
    setTicks((cur) => {
      const set = new Set(cur[kind]);
      set.delete(term);
      return { ...cur, [kind]: set };
    });
    void save(next).then((ok) => {
      setNote(ok ? null : { text: text.saveFailed, bad: true });
    });
  };

  const tick = (kind: Kind, term: string): void => {
    setTicks((cur) => {
      const set = new Set(cur[kind]);
      if (set.has(term)) {
        set.delete(term);
      } else {
        set.add(term);
      }
      return { ...cur, [kind]: set };
    });
  };

  const tickAll = (kind: Kind, on: boolean): void => {
    setTicks((cur) => ({ ...cur, [kind]: new Set(on ? (lists?.[kind] ?? []) : []) }));
  };

  const add = async (): Promise<void> => {
    if (busy || tickedTools === undefined || tickedAngles === undefined) {
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const result = await window.gratovo.invoke("find:generate", {
        tools: [...tickedTools],
        angles: [...tickedAngles],
        add: true,
      });
      if (!result.ok) {
        setNote({ text: text.failed, bad: true });
      } else if (!result.value.ok) {
        setNote({ text: text.running, bad: true });
      } else {
        setNote({ text: text.added(result.value.fresh), bad: false });
        // What was just queued is now "already queued"; count again.
        setTicks((cur) => ({ ...cur }));
      }
    } catch {
      setNote({ text: text.failed, bad: true });
    }
    setBusy(false);
  };

  const suggest = (kind: Kind): void => {
    if (asking.current) {
      return;
    }
    asking.current = true;
    setProposals({ phase: "loading", kind });
    const done = (next: Proposals): void => {
      asking.current = false;
      setProposals(next);
    };
    void (async () => {
      try {
        const result = await window.gratovo.invoke("find:suggest-terms", { kind });
        if (!result.ok) {
          done({ phase: "problem", problem: "failed" });
        } else if (!result.value.ok) {
          done({ phase: "problem", problem: result.value.problem });
        } else {
          done({ phase: "ready", kind, terms: result.value.terms, chosen: new Set() });
        }
      } catch {
        done({ phase: "problem", problem: "failed" });
      }
    })();
  };

  const toggleProposal = (term: string): void => {
    setProposals((cur) => {
      if (cur.phase !== "ready") {
        return cur;
      }
      const chosen = new Set(cur.chosen);
      if (chosen.has(term)) {
        chosen.delete(term);
      } else {
        chosen.add(term);
      }
      return { ...cur, chosen };
    });
  };

  const addChosen = async (): Promise<void> => {
    if (proposals.phase !== "ready" || proposals.chosen.size === 0) {
      return;
    }
    const ok = await addTerms(
      proposals.kind,
      proposals.terms.filter((t) => proposals.chosen.has(t)),
    );
    if (ok) {
      setProposals({ phase: "idle" });
    }
  };

  const fresh = shown?.fresh ?? 0;
  const proposalTerms =
    proposals.phase === "ready" && lists !== null
      ? proposals.terms.filter(
          (t) => !lists[proposals.kind].some((x) => x.toLowerCase() === t.toLowerCase()),
        )
      : [];

  return (
    <div className="gen" data-ui="find.search.generate">
      <div className="row wrap">
        <Btn
          size="sm"
          icon="plus"
          {...(open ? { kind: "pri" } : {})}
          expanded={open}
          onClick={() => {
            setOpen(!open);
          }}
        >
          {text.open}
        </Btn>
      </div>
      {open ? (
        <div className="ai-read gen-panel" role="group" aria-label={text.panelLabel}>
          <p className="hint">{text.hint}</p>
          {lists === null ? null : (
            <div className="gen-lists">
              {kinds.map((kind) => (
                <ListEditor
                  key={kind}
                  kind={kind}
                  terms={lists[kind]}
                  ticked={ticks[kind]}
                  onTick={tick}
                  onAll={tickAll}
                  onRemove={removeTerm}
                  onAddTerm={(k, term) => {
                    void addTerms(k, [term]);
                  }}
                />
              ))}
            </div>
          )}
          <div className="row wrap">
            <Btn
              size="sm"
              icon="sparkle"
              disabled={proposals.phase === "loading"}
              onClick={() => {
                suggest("tools");
              }}
            >
              {text.suggestTools}
            </Btn>
            <Btn
              size="sm"
              icon="sparkle"
              disabled={proposals.phase === "loading"}
              onClick={() => {
                suggest("angles");
              }}
            >
              {text.suggestAngles}
            </Btn>
          </div>
          {proposals.phase === "loading" ? (
            <div className="row">
              <Icon name="refresh" className="spin" size={13} />
              <span className="small">{text.suggesting}</span>
            </div>
          ) : null}
          {proposals.phase === "problem" ? (
            <div className="row wrap" role="status">
              <span className="small">
                {proposals.problem === "bridge_off"
                  ? text.bridgeOff
                  : proposals.problem === "busy"
                    ? text.busy
                    : proposals.problem === "thinking_not_set"
                      ? text.thinkingNotSet
                      : text.suggestFailed}
              </span>
              {proposals.problem === "bridge_off" ? (
                <Btn
                  size="sm"
                  onClick={() => {
                    openSetting("connections");
                  }}
                >
                  {text.openConnections}
                </Btn>
              ) : null}
            </div>
          ) : null}
          {proposals.phase === "ready" ? (
            <div className="col tight">
              {proposalTerms.length === 0 ? (
                <p className="hint" role="status">
                  {text.noProposals}
                </p>
              ) : (
                <>
                  <p className="hint">
                    {text.proposalTitle(kindName(proposals.kind).toLowerCase())}
                  </p>
                  <div
                    className="fchips"
                    role="group"
                    aria-label={text.proposalsLabel(kindName(proposals.kind).toLowerCase())}
                  >
                    {proposalTerms.map((term) => {
                      const on = proposals.chosen.has(term);
                      return (
                        <button
                          key={term}
                          type="button"
                          className="chip"
                          aria-pressed={on}
                          onClick={() => {
                            toggleProposal(term);
                          }}
                        >
                          {on ? <Icon name="check" size={12} /> : null}
                          {term}
                        </button>
                      );
                    })}
                  </div>
                  <div className="row">
                    <Btn
                      size="sm"
                      kind="pri"
                      icon="plus"
                      disabled={proposals.chosen.size === 0}
                      onClick={() => {
                        void addChosen();
                      }}
                    >
                      {text.addChosen(proposals.chosen.size)}
                    </Btn>
                    <Btn
                      size="sm"
                      kind="ghost"
                      onClick={() => {
                        setProposals({ phase: "idle" });
                      }}
                    >
                      {text.dismiss}
                    </Btn>
                  </div>
                </>
              )}
            </div>
          ) : null}
          <div className="col tight gen-result" role="status">
            {canCount && shown === null ? <span className="small">{text.counting}</span> : null}
            {!canCount && lists !== null ? <span className="small muted">{text.pick}</span> : null}
            {shown !== null ? (
              <>
                <span className="small">
                  {text.count(shown.fresh, shown.repeats, shown.overCap)}
                </span>
                {shown.sample.length > 0 ? (
                  <span className="small muted gen-sample">
                    {text.sample}: {shown.sample.join(" · ")}
                  </span>
                ) : null}
              </>
            ) : null}
            {note !== null ? (
              <span className={note.bad ? "small kw-bad" : "small"}>{note.text}</span>
            ) : null}
          </div>
          <div className="row">
            <Btn
              size="sm"
              kind="pri"
              icon="plus"
              disabled={busy || fresh === 0}
              onClick={() => {
                void add();
              }}
            >
              {text.add(fresh)}
            </Btn>
          </div>
        </div>
      ) : null}
    </div>
  );
}
