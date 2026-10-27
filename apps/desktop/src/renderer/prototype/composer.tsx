import { commentKinds } from "@gratovo/ipc";
import type { CommentAnchor, CommentPlace } from "@gratovo/ipc";
import { Btn, Icon, Seg } from "@gratovo/ui";
import type { IconName } from "@gratovo/ui";
import { useEffect, useRef, useState } from "react";

import { addComment, deleteComment, getPrototype } from "../lib/prototype";
import { appStore } from "../lib/store";
import { toast } from "../lib/toast";
import { strings } from "../strings";
import { whereText } from "./place";

const text = strings.prototype;
const t = text.cmt;

export type CommentKind = (typeof commentKinds)[number];

export const kindIcons: Readonly<Record<CommentKind, IconName>> = {
  fix: "wrench",
  idea: "sparkle",
  question: "help",
};

const kindOptions = commentKinds.map((kind) => ({
  value: kind,
  label: text.forClaude.kinds[kind],
  icon: kindIcons[kind],
}));

/** The spot on screen and what is being commented on. */
export interface Draft {
  readonly x: number;
  readonly y: number;
  readonly place: CommentPlace;
  readonly anchor: CommentAnchor;
}

function isKind(value: string): value is CommentKind {
  return (commentKinds as readonly string[]).includes(value);
}

/** The small box next to the click: what should change here? */
export function Composer({
  draft,
  onDone,
}: {
  readonly draft: Draft;
  readonly onDone: () => void;
}) {
  const [value, setValue] = useState("");
  const [kind, setKind] = useState<CommentKind>("fix");
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    area.current?.focus();
  }, []);

  const save = (): void => {
    const body = value.trim();
    if (body === "" || busy.current) {
      return;
    }
    busy.current = true;
    setSaving(true);
    void addComment({ kind, text: body, place: draft.place, anchor: draft.anchor }).then(
      (result) => {
        busy.current = false;
        onDone();
        if (!result.ok) {
          toast({ msg: t.saveFailed, icon: "alert", tone: "info" });
          return;
        }
        const saved = result.value;
        const n = getPrototype().comments.findIndex((c) => c.id === saved.id) + 1;
        toast({
          msg: t.saved(n),
          sub: t.savedSub,
          icon: "chat",
          tone: "good",
          ms: 4000,
          actions: [
            {
              label: t.undo,
              run: () => {
                void deleteComment(saved.id);
              },
            },
          ],
        });
      },
    );
  };

  const width = Math.min(330, window.innerWidth - 24);
  const left = Math.min(Math.max(draft.x + 14, 12), Math.max(12, window.innerWidth - width - 12));
  const top = Math.min(Math.max(draft.y + 14, 64), Math.max(64, window.innerHeight - 270));
  const where = whereText(
    {
      id: "",
      at: 0,
      status: "open",
      doneAt: null,
      kind,
      text: "",
      scenario: "normal",
      place: draft.place,
      anchor: draft.anchor,
    },
    appStore().getState().data,
  );

  return (
    <div
      className="cmt-pop"
      data-cmt-ui="1"
      role="dialog"
      aria-label={t.newComment}
      style={{ left, top, width }}
    >
      <div className="row">
        <Icon name="chat" className="cmt-accent" />
        <b className="small cmt-ell cmt-grow">{draft.anchor.label}</b>
      </div>
      <span className="tiny muted cmt-ell">{where}</span>
      <textarea
        ref={area}
        className="ta"
        rows={3}
        placeholder={t.placeholder}
        value={value}
        aria-label={t.commentLabel}
        onChange={(event) => {
          setValue(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            event.stopPropagation();
            save();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onDone();
          }
        }}
      />
      <div className="row wrap" style={{ gap: "6px" }}>
        <Seg
          label={t.kindLabel}
          value={kind}
          options={kindOptions}
          onPick={(next) => {
            if (isKind(next)) {
              setKind(next);
            }
          }}
        />
        <span className="cmt-grow" />
        <Btn size="sm" kind="ghost" onClick={onDone}>
          {t.cancel}
        </Btn>
        <Btn size="sm" kind="pri" disabled={saving || value.trim() === ""} onClick={save}>
          {t.save} <span className="kbd">{t.saveKeys}</span>
        </Btn>
      </div>
    </div>
  );
}
