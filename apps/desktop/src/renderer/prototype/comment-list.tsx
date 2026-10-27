import type { Comment } from "@gratovo/ipc";
import { Btn, Icon, Seg, cx } from "@gratovo/ui";
import { useMemo, useState } from "react";

import { ago } from "../lib/format";
import { useKeys } from "../lib/keys";
import { useNow } from "../lib/use-now";
import { openCount, setPanel, toggleCommenting, usePrototype } from "../lib/prototype";
import { appStore, selectRoute, useApp } from "../lib/store";
import { strings } from "../strings";
import { copyOpenForClaude, exportForClaude, visitComment } from "./comment-actions";
import { isHere, numberOf, whereText } from "./place";

const text = strings.prototype;
const t = text.cmt;

type Which = "open" | "done" | "all";
type Where = "all" | "here";

const whichOptions = [
  { value: "open", label: t.filterOpen },
  { value: "done", label: t.filterDone },
  { value: "all", label: t.filterAll },
];
const whereOptions = [
  { value: "all", label: t.whereAll },
  { value: "here", label: t.whereHere },
];

function close(): void {
  setPanel(false);
}

/** Every comment, newest first, with filters; a click goes to where the comment was left. */
export function CommentList() {
  const proto = usePrototype();
  const route = useApp(selectRoute);
  const peek = useApp((s) => s.ui.peek);
  const [which, setWhich] = useState<Which>("open");
  const [where, setWhere] = useState<Where>("all");
  useKeys({ escape: close });

  const list = proto.comments;
  const openN = openCount(list);
  const shown = useMemo(
    () =>
      list
        .filter(
          (c) =>
            (which === "all" || (which === "done") === (c.status === "done")) &&
            (where === "all" || isHere(c.place, route, peek)),
        )
        .reverse(),
    [list, which, where, route, peek],
  );
  const data = appStore().getState().data;
  const now = useNow();

  const row = (c: Comment) => {
    const n = numberOf(list, c.id);
    return (
      <button
        key={c.id}
        type="button"
        className="tray-i"
        style={proto.open === c.id ? { background: "var(--accent-soft)" } : undefined}
        onClick={() => {
          visitComment(c);
        }}
      >
        <span className={cx("cmt-pin", "static", c.status === "done" && "done")}>{n}</span>
        <div className="tx">
          <span className="row" style={{ gap: "6px" }}>
            <b className="cmt-ell cmt-label">{c.anchor.label}</b>
            <span className="tiny muted cmt-fixed">{text.forClaude.kinds[c.kind]}</span>
          </span>
          <span className="cmt-clamp">{c.text}</span>
          <small>{`${whereText(c, data)} · ${ago(c.at, now)}`}</small>
        </div>
      </button>
    );
  };

  return (
    <aside className="cmt-side" data-cmt-ui="1" aria-label={t.listLabel}>
      <div className="cmt-side-h">
        <Icon name="chat" className="cmt-accent" />
        <b className="cmt-grow">
          {t.listHead} <span className="muted num cmt-light">{t.listOpen(openN)}</span>
        </b>
        <button type="button" className="iconbtn cmt-small" onClick={close} aria-label={t.hideList}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="row wrap cmt-side-f">
        <Seg
          label={t.whichLabel}
          value={which}
          options={whichOptions}
          onPick={(next) => {
            setWhich(next as Which);
          }}
        />
        <Seg
          label={t.whereLabel}
          value={where}
          options={whereOptions}
          onPick={(next) => {
            setWhere(next as Where);
          }}
        />
      </div>
      <div className="cmt-side-list">
        {shown.length > 0 ? (
          shown.map(row)
        ) : (
          <div className="col tight cmt-empty">
            <b>{list.length > 0 ? t.nothingHere : t.none}</b>
            <span className="hint">{t.noneHint}</span>
          </div>
        )}
      </div>
      <div className="col tight cmt-side-b">
        <div className="row wrap">
          <Btn
            size="sm"
            icon="chat"
            {...(proto.commenting ? { kind: "pri" } : {})}
            onClick={() => {
              toggleCommenting();
            }}
          >
            {proto.commenting ? t.stopCommenting : t.addComment}{" "}
            <span className="kbd">{strings.prototype.commentHint}</span>
          </Btn>
          <Btn
            size="sm"
            kind="ghost"
            icon="copy"
            disabled={openN === 0}
            onClick={() => {
              copyOpenForClaude(list);
            }}
          >
            {text.copyOpen}
          </Btn>
          <Btn size="sm" kind="ghost" icon="forward" onClick={exportForClaude}>
            {text.exportAll}
          </Btn>
        </div>
        <span className="tiny muted">{t.kept}</span>
      </div>
    </aside>
  );
}
