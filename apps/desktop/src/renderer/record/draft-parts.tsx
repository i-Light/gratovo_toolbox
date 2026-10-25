import type { OutreachDraft } from "@gratovo/core/data";
import { Btn, Icon } from "@gratovo/ui";
import { useLayoutEffect, useRef } from "react";

import { useApp } from "../lib/store";
import { strings } from "../strings";
import { neverContactCreator } from "./draft-actions";

const text = strings.reach.card;

/** A text box that grows with its text. */
export function AutoText({
  value,
  label,
  readOnly,
  onChange,
  onFocus,
  onBlur,
}: {
  readonly value: string;
  readonly label: string;
  readonly readOnly: boolean;
  readonly onChange: (value: string) => void;
  readonly onFocus: () => void;
  readonly onBlur: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el !== null) {
      el.style.height = "auto";
      el.style.height = `${String(el.scrollHeight + 2)}px`;
    }
  }, [value]);
  return (
    <textarea
      ref={ref}
      className="bodyta"
      value={value}
      readOnly={readOnly}
      aria-label={label}
      spellCheck
      onChange={(event) => {
        onChange(event.target.value);
      }}
      onFocus={onFocus}
      onBlur={onBlur}
    />
  );
}

/** "Never contact X?" with its yes and no, in the card (the app's inline confirm). */
export function NeverAsk({
  draft,
  onDone,
}: {
  readonly draft: OutreachDraft;
  readonly onDone: () => void;
}) {
  const creator = useApp((s) => s.data.creators.find((c) => c.id === draft.creator));
  if (creator === undefined) {
    return null;
  }
  return (
    <div className="gate block" role="alertdialog" aria-label={text.never(creator.name)}>
      <Icon name="ban" />
      <span className="grow">{text.neverSure(creator.name)}</span>
      <Btn
        size="sm"
        kind="pri"
        onClick={() => {
          neverContactCreator(creator);
          onDone();
        }}
      >
        {text.neverYes}
      </Btn>
      <Btn size="sm" kind="ghost" onClick={onDone}>
        {text.neverKeep}
      </Btn>
    </div>
  );
}
