import { boardLanes } from "@gratovo/core/reach";
import type { BoardLane } from "@gratovo/core/reach";
import { Btn, Icon } from "@gratovo/ui";
import { useMemo, useState } from "react";

import { useNow } from "../lib/use-now";
import { go, useApp } from "../lib/store";
import { isTabShown } from "../lib/wired";
import { strings } from "../strings";
import { BoardCard } from "./board-card";

const text = strings.reach.board;

/** How many Signed cards show before "Show all" (prototype reach.js Lane). */
const signedShown = 6;

function Lane({ lane, now }: { readonly lane: BoardLane; readonly now: number }) {
  const [all, setAll] = useState(false);
  const source = useApp((s) => s.data.source);
  const words = text.lanes[lane.key];
  const empty = text.empty[lane.key];
  const list = lane.items.map((i) => i.creator.id);
  const shown = lane.key === "signed" && !all ? lane.items.slice(0, signedShown) : lane.items;
  return (
    <section className="lane" aria-label={words.name} data-ui={`reach.lane.${lane.key}`}>
      <div className="lane-h">
        <span className="grow">
          <span>{words.name}</span>
          <small>{words.hint}</small>
        </span>
        <span className="m num">{lane.items.length}</span>
      </div>
      {shown.map((item) => (
        <BoardCard key={item.creator.id} item={item} lane={lane.key} list={list} now={now} />
      ))}
      {lane.items.length > shown.length ? (
        <div className="row wrap" data-ui="reach.lane.signed.more">
          <Btn
            size="sm"
            kind="ghost"
            onClick={() => {
              setAll(true);
            }}
          >
            {text.showAll(lane.items.length)}
          </Btn>
          {isTabShown("close", "roster", source) ? (
            <Btn
              size="sm"
              kind="ghost"
              onClick={() => {
                go("close", "roster");
              }}
            >
              {text.roster}
              <Icon name="arrowR" />
            </Btn>
          ) : null}
        </div>
      ) : null}
      {lane.items.length === 0 ? (
        <div className="empty">
          <b>{empty.title}</b>
          <span>{empty.text}</span>
          {empty.action === "" ? null : (
            <Btn
              size="sm"
              onClick={() => {
                go("find", "contacts");
              }}
            >
              {empty.action}
            </Btn>
          )}
        </div>
      ) : null}
    </section>
  );
}

/** Where every outreach stands, one lane per step (D14). */
export function Board() {
  const creators = useApp((s) => s.data.creators);
  const reach = useApp((s) => s.data.reach);
  const source = useApp((s) => s.data.source);
  const now = useNow();
  const lanes = useMemo(
    () =>
      boardLanes({
        creators,
        drafts: reach.drafts,
        threads: reach.threads,
        sequences: reach.sequences,
        source,
      }),
    [creators, reach.drafts, reach.threads, reach.sequences, source],
  );
  return (
    <div className="board" data-ui="reach.board" aria-label={strings.reach.board.label}>
      {lanes.map((lane) => (
        <Lane key={lane.key} lane={lane} now={now} />
      ))}
    </div>
  );
}
