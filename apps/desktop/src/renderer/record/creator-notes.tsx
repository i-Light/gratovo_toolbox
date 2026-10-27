import { notesMax } from "@gratovo/core/data";
import { useEffect, useRef, useState } from "react";

import { toast } from "../lib/toast";
import { strings } from "../strings";
import { isChannelId, type CreatorDetail } from "./detail";

const text = strings.creatorRecord;
/** The counter shows once fewer characters than this are left. */
const counterAt = 1000;
const flashMs = 1700;

/** Writes a note straight through `data:write`; true when it was stored. */
async function writeNotes(item: CreatorDetail, notes: string, base: string): Promise<boolean> {
  try {
    const result = await window.gratovo.invoke("data:write", {
      writes: [
        { kind: "creator.notes", id: item.id, notes, base, handle: item.handle, name: item.name },
      ],
    });
    return result.ok;
  } catch {
    return false;
  }
}

/**
 * The notes box. It saves when you leave it, and only if the text changed (D24): straight through
 * `data:write`, not undoable, like your name. Taking the box away (Esc, Alt+arrow) saves too. Each
 * write carries the text the box started from, so a teammate's newer note makes a clash to choose
 * from instead of being overwritten. A note the server holds longer than the limit comes back cut
 * and shows read-only, so a save can never drop the rest; so does an id the server can't keep.
 */
export function CreatorNotes({ item }: { readonly item: CreatorDetail }) {
  const [value, setValue] = useState(item.notes);
  const [saved, setSaved] = useState(false);
  const [changedUnder, setChangedUnder] = useState(false);
  const readOnly = item.notesCut || !isChannelId(item.id);
  // The text the box started from: the last text it was in step with the store on.
  const base = useRef(item.notes);
  // The latest text, and the text already on its way to the store (no second write for it).
  const latest = useRef(item.notes);
  const sent = useRef<string | null>(null);
  const itemRef = useRef(item);
  const readOnlyRef = useRef(readOnly);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fail = (): void => {
    toast({ msg: text.notesFailed, sub: text.notesFailedSub, icon: "alert" });
  };
  const send = (): void => {
    const notes = latest.current;
    if (readOnlyRef.current || notes === base.current || notes === sent.current) {
      return;
    }
    const from = base.current;
    sent.current = notes;
    void writeNotes(itemRef.current, notes, from).then((ok) => {
      if (!ok) {
        sent.current = null;
        fail();
        return;
      }
      base.current = notes;
      sent.current = null;
      setChangedUnder(false);
      setSaved(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setSaved(false);
      }, flashMs);
    });
  };
  const sendRef = useRef(send);
  // Kept current after every render, so the unmount write sees the latest item and rules.
  useEffect(() => {
    itemRef.current = item;
    readOnlyRef.current = readOnly;
    sendRef.current = send;
  });
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      // Unmounted with unsaved text (Esc, Alt+arrow, a closed page): write it now.
      sendRef.current();
    },
    [],
  );
  // A newer stored note replaces the box only while nothing unsaved is in it; otherwise the draft
  // stays, the starting text stays (so the save clashes instead of overwriting), and a line says so.
  useEffect(() => {
    const before = base.current;
    if (item.notes === before) {
      return;
    }
    if (latest.current === before) {
      base.current = item.notes;
      latest.current = item.notes;
      setValue(item.notes);
    } else if (item.notes !== latest.current) {
      setChangedUnder(true);
    }
  }, [item.notes]);
  const left = notesMax - value.length;
  return (
    <>
      <textarea
        className="cr-notes"
        data-ui="record.notes.text"
        aria-label={text.notesLabel}
        value={value}
        maxLength={notesMax}
        readOnly={readOnly}
        onChange={(e) => {
          latest.current = e.target.value;
          setValue(e.target.value);
        }}
        onBlur={send}
      />
      <div className="cr-notes-foot small">
        <span className="muted">
          {item.notesCut ? text.notesCut : readOnly ? text.notesChannelOnly : text.notesHint}
        </span>
        {changedUnder && !readOnly ? <span className="small">{text.notesChanged}</span> : null}
        {left < counterAt && !readOnly ? (
          <span className="num muted">{text.notesLeft(left)}</span>
        ) : null}
        <span className="cr-saved" role="status">
          {saved ? text.notesSaved : ""}
        </span>
      </div>
    </>
  );
}
