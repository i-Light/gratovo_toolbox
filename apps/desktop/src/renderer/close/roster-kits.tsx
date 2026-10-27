import { checkAudience } from "@gratovo/core/close";
import type { Creator } from "@gratovo/core/data";
import { avatarColor, Avatar, Btn, Tag } from "@gratovo/ui";
import { useState } from "react";

import { peek } from "../lib/actions";
import { money } from "../lib/format";
import { useApp } from "../lib/store";
import { strings } from "../strings";
import { AudienceCheck } from "./audience-check";

const text = strings.closeScreen.roster;

/** Where a creator waits for the check: Media kit in, or Audience checked. */
export const waitingForCheck = (c: Creator): boolean => c.stage === "kit" || c.stage === "audience";

function verdictOf(creator: Creator): { tone: "good" | "crit" | "warn"; words: string } {
  const result = checkAudience(creator.kit);
  if (result.verdict === "pass") {
    return { tone: "good", words: text.verdict.pass };
  }
  if (result.verdict === "fail" && result.firstFail !== null) {
    return {
      tone: "crit",
      words: text.verdict.fail(strings.reach.board.checkNames[result.firstFail]),
    };
  }
  return { tone: "warn", words: text.verdict.missing };
}

function KitRow({
  creator,
  list,
  open,
  onToggle,
}: {
  readonly creator: Creator;
  readonly list: readonly string[];
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const selected = useApp((s) => s.ui.peek?.record.id === creator.id);
  const verdict = verdictOf(creator);
  const rate = creator.kit?.rate ?? null;
  return (
    <div className="cl-sub" data-ui="close.roster.kit.row">
      <div className="cl-row row">
        <button
          type="button"
          className="rowbtn grow"
          aria-pressed={selected}
          aria-label={text.openCreator(creator.name)}
          data-ui="close.roster.kit.open"
          onClick={() => {
            peek({ kind: "creator", id: creator.id }, list);
          }}
        >
          <Avatar name={creator.name} color={avatarColor(creator.handle)} size="s" decorative />
          <span className="col" style={{ minWidth: 0 }}>
            <b className="ell">{creator.name}</b>
            <small className="muted ell">
              {rate === null
                ? creator.handle
                : `${creator.handle} \u00b7 ${text.asks(money(rate))}`}
            </small>
          </span>
        </button>
        <Tag tone={verdict.tone}>{verdict.words}</Tag>
        <Btn size="sm" expanded={open} icon={open ? "chevU" : "chevD"} onClick={onToggle}>
          <span data-ui="close.roster.kit.toggle">{open ? text.hide : text.show}</span>
        </Btn>
      </div>
      {open ? (
        <div className="kit-body" data-ui="close.roster.kit.body">
          <AudienceCheck creator={creator} />
        </div>
      ) : null}
    </div>
  );
}

/** "Waiting for an audience check": one row for each creator whose kit is in, one check open at a time. */
export function RosterKits({ kits }: { readonly kits: readonly Creator[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (kits.length === 0) {
    return null;
  }
  const list = kits.map((c) => c.id);
  return (
    <section className="card" data-ui="close.roster.kits" aria-labelledby="close-kits-h">
      <div className="card-h">
        <h3 id="close-kits-h">
          {text.kitsTitle}{" "}
          <span className="muted num" style={{ fontWeight: 400 }}>
            {kits.length}
          </span>
        </h3>
      </div>
      <p className="hint">{text.kitsHint}</p>
      <div className="col" style={{ gap: 6 }} role="list" aria-label={text.kitsListLabel}>
        {kits.map((c) => (
          <div key={c.id} role="listitem">
            <KitRow
              creator={c}
              list={list}
              open={openId === c.id}
              onToggle={() => {
                setOpenId(openId === c.id ? null : c.id);
              }}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
