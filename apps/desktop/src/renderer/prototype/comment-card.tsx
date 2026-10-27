import type { Comment } from "@gratovo/ipc";
import { Btn, Icon, IconBtn, Tag, cx } from "@gratovo/ui";
import { useState } from "react";

import { ago } from "../lib/format";
import { useKeys } from "../lib/keys";
import { useNow } from "../lib/use-now";
import { deleteComment, patchComment, restoreComment, setOpen } from "../lib/prototype";
import { appStore } from "../lib/store";
import { toast } from "../lib/toast";
import { strings } from "../strings";
import { copyText } from "./comment-actions";
import { kindIcons } from "./composer";
import { whereText } from "./place";

const text = strings.prototype;
const t = text.cmt;

function focusOnMount(el: HTMLTextAreaElement | null): void {
  el?.focus();
}

function close(): void {
  setOpen(null);
}

/** One comment, opened from its pin or the list. */
export function CommentCard({
  comment,
  n,
  spot,
  moved,
  missing,
}: {
  readonly comment: Comment;
  readonly n: number;
  /** Where its pin is on screen, when it has one. */
  readonly spot: { readonly x: number; readonly y: number } | null;
  readonly moved: boolean;
  readonly missing: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  useKeys({
    escape: () => {
      if (draft !== null) {
        setDraft(null);
      } else {
        close();
      }
    },
  });

  const now = useNow();
  const done = comment.status === "done";
  const where = whereText(comment, appStore().getState().data);
  const scenario =
    comment.scenario === "normal" ? "" : ` · ${text.scenarios[comment.scenario].name}`;

  const saveEdit = (): void => {
    const body = draft?.trim() ?? "";
    if (body !== "") {
      void patchComment({ id: comment.id, text: body }).then((result) => {
        if (result.ok) {
          setDraft(null);
        } else {
          toast({ msg: t.updateFailed, icon: "alert", tone: "info" });
        }
      });
    }
  };
  const markDone = (): void => {
    void patchComment({ id: comment.id, status: "done" }).then((result) => {
      if (!result.ok) {
        toast({ msg: t.updateFailed, icon: "alert", tone: "info" });
        return;
      }
      close();
      toast({
        msg: t.markedDone(n),
        icon: "check",
        tone: "good",
        ms: 3500,
        actions: [
          {
            label: t.undo,
            run: () => {
              void patchComment({ id: comment.id, status: "open" });
            },
          },
        ],
      });
    });
  };
  const remove = (): void => {
    void deleteComment(comment.id).then((result) => {
      if (!result.ok) {
        toast({ msg: t.deleteFailed, icon: "alert", tone: "info" });
        return;
      }
      const gone = result.value;
      close();
      toast({
        msg: t.deleted(n),
        icon: "trash",
        tone: "info",
        ms: 5000,
        actions:
          gone === null
            ? []
            : [
                {
                  label: t.undo,
                  run: () => {
                    void restoreComment(gone);
                  },
                },
              ],
      });
    });
  };

  const width = Math.min(330, window.innerWidth - 24);
  const place =
    spot === null
      ? { left: "50%", top: "30%", transform: "translateX(-50%)" }
      : {
          left: Math.min(Math.max(spot.x + 18, 12), Math.max(12, window.innerWidth - width - 12)),
          top: Math.min(Math.max(spot.y - 10, 64), Math.max(64, window.innerHeight - 280)),
        };

  return (
    <div
      className="cmt-pop"
      data-cmt-ui="1"
      role="dialog"
      aria-label={t.cardLabel(n)}
      style={{ width, ...place }}
    >
      <div className="row">
        <span className={cx("cmt-pin", "static", done && "done")}>{n}</span>
        <Tag icon={kindIcons[comment.kind]}>{text.forClaude.kinds[comment.kind]}</Tag>
        {done ? (
          <Tag tone="good" icon="check">
            {t.done}
          </Tag>
        ) : null}
        <span className="cmt-grow" />
        <button type="button" className="iconbtn cmt-small" onClick={close} aria-label={t.close}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <b className="small">{comment.anchor.label}</b>
      {draft === null ? (
        <p className="cmt-body">{comment.text}</p>
      ) : (
        <textarea
          ref={focusOnMount}
          className="ta"
          rows={3}
          value={draft}
          aria-label={t.editLabel}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              event.stopPropagation();
              saveEdit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setDraft(null);
            }
          }}
        />
      )}
      <span className="tiny muted">{`${ago(comment.at, now)} · ${where}${scenario}`}</span>
      {moved ? <span className="hint">{t.movedHint}</span> : null}
      {missing ? <span className="hint">{t.missingHint}</span> : null}
      <div className="row wrap" style={{ gap: "6px" }}>
        {draft !== null ? (
          <>
            <Btn size="sm" kind="pri" onClick={saveEdit}>
              {t.save}
            </Btn>
            <Btn
              size="sm"
              kind="ghost"
              onClick={() => {
                setDraft(null);
              }}
            >
              {t.cancel}
            </Btn>
          </>
        ) : (
          <>
            {done ? (
              <Btn
                size="sm"
                icon="undo"
                onClick={() => {
                  void patchComment({ id: comment.id, status: "open" });
                }}
              >
                {t.reopen}
              </Btn>
            ) : (
              <Btn size="sm" kind="pri" icon="check" onClick={markDone}>
                {t.markDone}
              </Btn>
            )}
            <Btn
              size="sm"
              kind="ghost"
              icon="edit"
              onClick={() => {
                setDraft(comment.text);
              }}
            >
              {t.edit}
            </Btn>
            <Btn
              size="sm"
              kind="ghost"
              icon="copy"
              onClick={() => {
                copyText(
                  `${text.forClaude.kinds[comment.kind]} · ${where} · ${comment.anchor.label}\n${comment.text}`,
                  t.copiedOne,
                );
              }}
            >
              {t.copy}
            </Btn>
            <span className="cmt-grow" />
            <IconBtn icon="trash" label={t.delete} onClick={remove} />
          </>
        )}
      </div>
    </div>
  );
}
