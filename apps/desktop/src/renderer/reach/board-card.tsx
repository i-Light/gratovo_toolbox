import { avatarColor, Avatar, Btn, Icon, Tag } from "@gratovo/ui";
import type { KeyboardEvent } from "react";
import type { BoardItem, BoardLaneKey } from "@gratovo/core/reach";

import { openRecord, peek } from "../lib/actions";
import { ago } from "../lib/format";
import { draftNow, gatesOf } from "../lib/reach-actions";
import { useApp } from "../lib/store";
import { strings } from "../strings";
import { cardInfo, dueWords } from "./reach-view";
import type { CardAction, CardInfo } from "./reach-view";

const t = strings.reach;

const actionLabel: Record<CardAction, string> = {
  draftIt: t.board.draftIt,
  writing: t.board.writing,
  review: t.board.review,
  answer: t.board.answer,
};

function Chip({ chip, now }: { readonly chip: CardInfo["chip"]; readonly now: number }) {
  if (chip === null) {
    return null;
  }
  if (chip.kind === "finished") {
    return <Tag>{t.board.finished}</Tag>;
  }
  if (chip.kind === "age") {
    return <span className="due">{ago(chip.at, now)}</span>;
  }
  return (
    <span className={chip.at <= now ? "due late" : "due"}>
      <Icon name="clock" />
      {dueWords(chip.at, now)}
    </span>
  );
}

/** Moves focus to the next or previous card of the same lane. */
function moveFocus(from: HTMLElement, by: 1 | -1): void {
  const sibling = by === 1 ? from.nextElementSibling : from.previousElementSibling;
  if (sibling instanceof HTMLElement && sibling.classList.contains("kcard")) {
    sibling.focus();
  }
}

/**
 * One creator on the board. A click or Enter opens the peek on the Emails tab, stepping through
 * the lane; O opens the full record; J and K move between the lane's cards.
 */
export function BoardCard({
  item,
  lane,
  list,
  now,
}: {
  readonly item: BoardItem;
  readonly lane: BoardLaneKey;
  readonly list: readonly string[];
  readonly now: number;
}) {
  const { creator, draft } = item;
  const selected = useApp((s) => s.ui.peek?.record.id === creator.id);
  const gate = lane === "waiting" && draft !== null ? (gatesOf(draft)[0] ?? null) : null;
  const info = cardInfo(item, lane, now, gate === null ? null : t.gatesShort[gate.key]);
  const ref = { kind: "creator", id: creator.id } as const;
  const open = (): void => {
    peek(ref, list, { tab: "emails" });
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    } else if (event.key === "o" || event.key === "O") {
      event.preventDefault();
      openRecord(ref);
    } else if (event.key === "j" || event.key === "k") {
      event.preventDefault();
      moveFocus(event.currentTarget, event.key === "j" ? 1 : -1);
    }
  };
  return (
    <div
      className="kcard"
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      data-ui="reach.card"
      onClick={open}
      onKeyDown={onKey}
    >
      <div className="row">
        <Avatar name={creator.name} color={avatarColor(creator.handle)} size="s" decorative />
        <b className="grow ell" data-tip={creator.name}>
          {creator.name}
        </b>
      </div>
      <span className={info.need ? "rc-sub need" : "rc-sub"}>
        {info.need ? <Icon name="alert" /> : null}
        <span>{info.sub}</span>
      </span>
      {info.chip !== null || info.action !== null ? (
        <div className="rc-foot">
          <Chip chip={info.chip} now={now} />
          <span className="sp"></span>
          {info.action === null ? null : (
            <Btn
              size="sm"
              kind="ghost"
              disabled={info.action === "writing"}
              onClick={(event) => {
                event.stopPropagation();
                if (info.action === "draftIt") {
                  void draftNow(creator.id);
                } else {
                  open();
                }
              }}
            >
              {actionLabel[info.action]}
            </Btn>
          )}
        </div>
      ) : null}
    </div>
  );
}
