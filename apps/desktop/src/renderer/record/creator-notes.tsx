import { notesMax } from "@gratovo/core/data";
import { useEffect, useRef, useState } from "react";

import { toast } from "../lib/toast";
import { strings } from "../strings";
import { isChannelId, type CreatorDetail } from "./detail";

const text = strings.creatorRecord;
/** The counter shows once fewer characters than this are left. */
const counterAt = 1000;
const flashMs = 1700;

/** Writes a creator's note straight through `data:write`; true when it was stored. */
function creatorWriter(item: CreatorDetail): (notes: string, base: string) => Promise<boolean> {
  return async (notes, base) => {
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
  };
}

/**
 * The notes box. It saves when you leave it, and only if the text changed (D24): straight through
 * `data:write`, not undoable, like your name. Taking the box away (Esc, Alt+arrow) saves too. Each
 * write carries the text the box started from, so a teammate's newer note makes a clash to choose
 * from instead of being overwritten. A note the server holds longer than the limit comes back cut
 * and shows read-only, so a save can never drop the rest; so does an id the server can't keep.
 */
export function CreatorNotes({ item }: { readonly item: CreatorDetail }) {
  return (
    <NotesBox
      notes={item.notes}
      cut={item.notesCut}
      locked={!isChannelId(item.id)}
      lockedHint={text.notesChannelOnly}
      label={text.notesLabel}
      hint={text.notesHint}
      write={creatorWriter(item)}
    />
  );
}

/** The text a notes box starts from, and how it writes; creators, brands and deals each pass theirs. */
export interface NotesBoxProps {
  readonly notes: string;
  /** The stored text was longer than the limit: shown cut and read only. */
  readonly cut: boolean;
  /** Read only for another reason, with its own hint. */
  readonly locked?: boolean;
  readonly lockedHint?: string;
  readonly label: string;
  readonly hint: string;
  /** Stores the text; `base` is what the box started from. True when it was stored. */
  readonly write: (notes: string, base: string) => Promise<boolean>;
}

export function NotesBox({
  notes: stored,
  cut,
  locked = false,
  lockedHint,
  label,
  hint,
  write,
}: NotesBoxProps) {
  const [value, setValue] = useState(stored);
  const [saved, setSaved] = useState(false);
  const [changedUnder, setChangedUnder] = useState(false);
  const readOnly = cut || locked;
  // The text the box started from: the last text it was in step with the store on.
  const base = useRef(stored);
  // The latest text, and the text already on its way to the store (no second write for it).
  const latest = useRef(stored);
  const sent = useRef<string | null>(null);
  const writeRef = useRef(write);
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
    void writeRef.current(notes, from).then((ok) => {
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
    writeRef.current = write;
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
    if (stored === before) {
      return;
    }
    if (latest.current === before) {
      base.current = stored;
      latest.current = stored;
      setValue(stored);
    } else if (stored !== latest.current) {
      setChangedUnder(true);
    }
  }, [stored]);
  const left = notesMax - value.length;
  return (
    <>
      <textarea
        className="cr-notes"
        data-ui="record.notes.text"
        aria-label={label}
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
          {cut ? text.notesCut : readOnly ? (lockedHint ?? hint) : hint}
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
