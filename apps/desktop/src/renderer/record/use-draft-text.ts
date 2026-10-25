import type { OutreachDraft } from "@gratovo/core/data";
import { useCallback, useEffect, useRef, useState } from "react";

import { typeDraft } from "../lib/reach-actions";

/** How long after the last key the typed text is written. */
export const typeDelayMs = 600;

type Field = "subject" | "body";

/**
 * The subject and body of a draft as the person types them. The text is kept here while a field
 * is in use and written 600 ms after the last key, when the field loses focus, and when the card
 * goes away. New text from the server (a rewrite, an edit elsewhere) is taken for a field only
 * while it isn't focused. `flush` writes at once: call it before sending or rewriting.
 */
export function useDraftText(draft: OutreachDraft): {
  readonly subject: string;
  readonly body: string;
  readonly change: (field: Field, value: string) => void;
  readonly focus: (field: Field) => void;
  readonly blur: () => void;
  readonly flush: () => void;
} {
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const latest = useRef({ subject: draft.subject, body: draft.body });
  const focused = useRef<Field | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = draft.id;

  const flush = useCallback((): void => {
    clearTimeout(timer.current);
    timer.current = undefined;
    void typeDraft(id, latest.current.subject, latest.current.body);
  }, [id]);

  useEffect(() => {
    if (focused.current !== "subject" && draft.subject !== latest.current.subject) {
      latest.current.subject = draft.subject;
      setSubject(draft.subject);
    }
  }, [draft.subject]);
  useEffect(() => {
    if (focused.current !== "body" && draft.body !== latest.current.body) {
      latest.current.body = draft.body;
      setBody(draft.body);
    }
  }, [draft.body]);
  // Taking the card away (the peek steps on, the tab changes) must not lose what is typed.
  useEffect(
    () => () => {
      if (timer.current !== undefined) {
        flush();
      }
    },
    [flush],
  );

  const change = (field: Field, value: string): void => {
    latest.current[field] = value;
    if (field === "subject") {
      setSubject(value);
    } else {
      setBody(value);
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, typeDelayMs);
  };
  const focus = (field: Field): void => {
    focused.current = field;
  };
  const blur = (): void => {
    focused.current = null;
    if (timer.current !== undefined) {
      flush();
    }
  };
  return { subject, body, change, focus, blur, flush };
}
