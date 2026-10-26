import type { ReplyFact, ReplyReading } from "@gratovo/core/data";
import { Btn, Icon } from "@gratovo/ui";
import { useEffect } from "react";
import type { MouseEvent } from "react";

import { openMenu } from "../lib/actions";
import { loadSituations, reclassifyReply, saveReplyFact } from "../lib/reach-actions";
import type { Situation } from "../lib/reach-actions";
import { useApp } from "../lib/store";
import type { MenuItem } from "../lib/store";
import { strings } from "../strings";

const text = strings.reach.reading;

/** A fact as its chip says it: "Rate $1,200", "US 45% · UK 20%", "Age 25-34". */
export function factWords(fact: ReplyFact): string {
  switch (fact.key) {
    case "rate":
      return text.rate(`$${fact.rate.toLocaleString("en-US")}`);
    case "countries":
      return text.countries(
        fact.countries
          .map((c) => (c.share === null ? c.code : `${c.code} ${String(c.share)}%`))
          .join(" · "),
      );
    case "age":
      return text.age(fact.band);
  }
}

/**
 * Gemini's reading of a creator's last reply (D23; prototype W.AiRead): the intent, the summary,
 * the facts to save to the record, and "That's not it". The page's own thread summary is read
 * first, so a save or a correction shows at once; `message.reading` is what the loaded thread had.
 * A reading still to come says Gemini is reading it, or hasn't yet; a bounce shows nothing.
 */
export function Reading({
  creatorId,
  message,
}: {
  readonly creatorId: string;
  readonly message: { readonly id: string; readonly reading: ReplyReading | null };
}) {
  const live = useApp((s) => {
    const lastIn = s.data.reach.threads.find((t) => t.creator === creatorId)?.lastIn;
    return lastIn?.id === message.id ? lastIn.reading : null;
  });
  const writing = useApp((s) =>
    s.data.reach.drafts.some(
      (d) => d.creator === creatorId && d.kind === "reply" && d.state === "drafting",
    ),
  );
  const bounce = useApp(
    (s) => s.data.reach.threads.find((t) => t.creator === creatorId)?.lastIn?.bounce === true,
  );
  const reading = live ?? message.reading;
  const has = reading !== null;
  // Fetched once for the session, so the menu opens at once.
  useEffect(() => {
    if (has) {
      void loadSituations();
    }
  }, [has]);
  if (reading === null) {
    // A mail server's bounce has nothing to read; its own callout says what happened.
    return bounce ? null : (
      <div className="rd-read" role="status" data-ui="record.reading">
        <div className="row">
          <Icon name="sparkle" size={14} />
          <span className="small muted">{writing ? text.reading : text.notRead}</span>
        </div>
      </div>
    );
  }
  const side = reading.side === "brand" ? "brand" : "influencer";
  const notIt = (event: MouseEvent<HTMLButtonElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    void loadSituations().then((list) => {
      if (list === null || list.length === 0) {
        const why = list === null ? text.situationsFailed : text.situationsNone;
        openMenu(box, [{ kind: "heading", label: why }], text.menu, "start");
        return;
      }
      const pick = (s: Situation): MenuItem => ({
        kind: "item",
        label: s.label,
        checked: s.id === reading.replyType,
        run: () => {
          void reclassifyReply(creatorId, message.id, s);
        },
      });
      const mine = list.filter((s) => s.side === side).map(pick);
      const any = list.filter((s) => s.side === "any").map(pick);
      const items: MenuItem[] = [...mine];
      if (any.length > 0) {
        items.push({ kind: "separator" }, ...any);
      }
      openMenu(box, items, text.menu, "start");
    });
  };
  return (
    <div className="rd-read" data-ui="record.reading" role="group" aria-label={text.group}>
      <div className="row wrap">
        <Icon name="sparkle" size={14} />
        <b>{reading.label}</b>
        <span className="small muted">{text.label}</span>
        {reading.corrected ? <span className="small rd-corrected">{text.corrected}</span> : null}
        <span className="sp"></span>
        <Btn size="sm" kind="ghost" onClick={notIt} tip={text.notItTip}>
          {text.notIt}
        </Btn>
      </div>
      <span className="small">{reading.summary}</span>
      {reading.facts.length > 0 ? (
        <div className="row wrap" style={{ gap: "6px" }}>
          {reading.facts.map((fact) => (
            <span key={fact.key} className={fact.saved ? "fact saved" : "fact"}>
              <span>{factWords(fact)}</span>
              <button
                type="button"
                disabled={fact.saved}
                onClick={() => {
                  void saveReplyFact(creatorId, message.id, fact.key);
                }}
              >
                {fact.saved ? text.saved : text.save}
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
