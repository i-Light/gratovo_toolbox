import { notesMax } from "@gratovo/core/data";
import { useEffect, useRef, useState } from "react";

import { toast } from "../lib/toast";
import { strings } from "../strings";
import type { CreatorDetail } from "./detail";

const text = strings.creatorRecord;
/** The counter shows once fewer characters than this are left. */
const counterAt = 1000;
const flashMs = 1700;

/**
 * The notes box. It saves when you leave it, and only if the text changed (D24): straight through
 * `data:write`, not undoable, like your name. A note the server holds longer than the limit comes
 * back cut and shows read-only, so a save can never drop the rest.
 */
export function CreatorNotes({ item }: { readonly item: CreatorDetail }) {
  const [value, setValue] = useState(item.notes);
  const [saved, setSaved] = useState(false);
  // The text the store holds, as far as this box knows.
  const base = useRef(item.notes);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );
  // A newer stored note replaces the box only while nothing unsaved is in it.
  useEffect(() => {
    const before = base.current;
    base.current = item.notes;
    setValue((current) => (current === before ? item.notes : current));
  }, [item.notes]);
  const fail = (): void => {
    toast({ msg: text.notesFailed, sub: text.notesFailedSub, icon: "alert" });
  };
  const save = (): void => {
    if (item.notesCut || value === base.current) {
      return;
    }
    const notes = value;
    window.gratovo
      .invoke("data:write", {
        writes: [
          { kind: "creator.notes", id: item.id, notes, handle: item.handle, name: item.name },
        ],
      })
      .then((result) => {
        if (!result.ok) {
          fail();
          return;
        }
        base.current = notes;
        setSaved(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          setSaved(false);
        }, flashMs);
      }, fail);
  };
  const left = notesMax - value.length;
  return (
    <>
      <textarea
        className="cr-notes"
        aria-label={text.notesLabel}
        value={value}
        maxLength={notesMax}
        readOnly={item.notesCut}
        onChange={(e) => {
          setValue(e.target.value);
        }}
        onBlur={save}
      />
      <div className="cr-notes-foot small">
        <span className="muted">{item.notesCut ? text.notesCut : text.notesHint}</span>
        {left < counterAt && !item.notesCut ? (
          <span className="num muted">{text.notesLeft(left)}</span>
        ) : null}
        <span className="cr-saved" role="status">
          {saved ? text.notesSaved : ""}
        </span>
      </div>
    </>
  );
}
