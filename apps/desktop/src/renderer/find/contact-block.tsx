import { contactNameMax, emailMax, emailPattern } from "@gratovo/core/data";
import type { CatalogItem, FoundEmail } from "@gratovo/core/find";
import { Btn, cx, Icon, Tag } from "@gratovo/ui";
import { useEffect, useId, useRef, useState } from "react";

import { confirmAddress } from "../lib/find-actions";
import { useApp } from "../lib/store";
import { strings } from "../strings";

const text = strings.findContacts.block;

/** Where an address was seen, in words: "About page and 2 videos", "3 video descriptions". */
export function sourceWords(found: FoundEmail): string {
  if (found.source === "about") {
    return found.videos > 0 ? text.aboutAndVideos(found.videos) : text.aboutPage;
  }
  return text.videos(found.videos);
}

/**
 * Every address found for a channel, where it came from and how sure, to pick one and confirm,
 * with the reader's name and a way to type another address (D31, D32). Shared by Find › Contacts
 * and the record. A channel with a confirmed address shows it, with Change to open the list again.
 */
export function ContactBlock({
  item,
  startOpen = false,
  onDone,
  looking = false,
}: {
  readonly item: CatalogItem;
  /** Opens on the list even when an address is confirmed (the record's Change). */
  readonly startOpen?: boolean;
  /** Called after an address is confirmed. */
  readonly onDone?: () => void;
  /** The email lookup is running: a channel with nothing yet says it is being looked up. */
  readonly looking?: boolean;
}) {
  const base = useId();
  // The page's own creator holds the address once it is confirmed (it leads main's catalog).
  const creator = useApp((s) => s.data.creators.find((c) => c.id === item.id));
  const confirmed = creator?.emailConfirmed ?? item.emailConfirmed;
  const email = creator?.email ?? item.email;
  const readerName = creator === undefined ? item.contactName : creator.contactName;
  const [changing, setChanging] = useState(startOpen);
  const found = item.emails;
  // Change starts on the confirmed address only when it is one of the found ones; a typed one is
  // not in the list, and picking it would leave nothing to confirm.
  const inFound = (address: string | null): string | null =>
    address !== null && found.some((f) => f.email === address) ? address : null;
  const [picked, setPicked] = useState<string | null>(
    startOpen && confirmed ? inFound(email) : null,
  );
  const [name, setName] = useState(readerName ?? "");
  const [typed, setTyped] = useState("");
  const [typedSeen, setTypedSeen] = useState(false);
  const doneRow = useRef<HTMLDivElement>(null);
  const justDone = useRef(false);
  const pick = picked ?? found[0]?.email ?? null;
  const chosen = found.find((f) => f.email === pick);
  const typedAddress = typed.trim();
  const typedBad = typedAddress !== "" && !emailPattern.test(typedAddress);
  const typedLong = typedAddress.length > emailMax;
  const typedOk = typedAddress !== "" && !typedBad && !typedLong;
  // The problem shows once the person has left the field or pressed Enter, not while typing.
  const typedProblem = !typedSeen
    ? null
    : typedLong
      ? text.typeLong(emailMax)
      : typedBad
        ? text.typeBad
        : null;
  const typedId = `${base}-typed`;

  // After a confirm that leaves this block on its done row, focus goes there.
  useEffect(() => {
    if (justDone.current && doneRow.current !== null) {
      justDone.current = false;
      doneRow.current.focus();
    }
  }, [changing, confirmed]);

  const confirm = (choice: Parameters<typeof confirmAddress>[1]): void => {
    if (confirmAddress(item, choice)) {
      setChanging(false);
      setTyped("");
      setTypedSeen(false);
      justDone.current = true;
      onDone?.();
    }
  };

  if (confirmed && email !== null && !changing) {
    return (
      <div
        ref={doneRow}
        tabIndex={-1}
        className="ct-done"
        role="group"
        aria-label={text.confirmedLabel}
      >
        <Icon name="checkc" />
        <span className="mono">{email}</span>
        {readerName === null ? null : <span className="small muted">{text.by(readerName)}</span>}
        <span className="sp"></span>
        <Btn
          size="sm"
          kind="ghost"
          onClick={() => {
            setPicked(inFound(email));
            setName(readerName ?? "");
            setChanging(true);
          }}
        >
          {text.change}
        </Btn>
      </div>
    );
  }

  return (
    <div className="ct-blk">
      {found.length === 0 ? (
        <p className="small ink2">{looking ? text.looking : text.none}</p>
      ) : (
        <>
          <span className="small ink2">{text.found(found.length)}</span>
          <div className="ct-list" role="radiogroup" aria-label={text.listLabel}>
            {found.map((f) => {
              const on = f.email === pick;
              return (
                <label key={f.email} className={cx("ct-row", on && "on")}>
                  <input
                    type="radio"
                    name={`${base}-pick`}
                    checked={on}
                    onChange={() => {
                      setPicked(f.email);
                    }}
                  />
                  <span className="ct-t">
                    <span className="mono">{f.email}</span>
                    <small>{sourceWords(f)}</small>
                  </span>
                  {f.business ? <Tag>{text.business}</Tag> : null}
                  <span className="num small muted ct-sure">{text.sure(f.confidence)}</span>
                </label>
              );
            })}
          </div>
        </>
      )}
      <label className="field">
        {text.nameLabel}
        <input
          className="inp sm"
          value={name}
          maxLength={contactNameMax}
          placeholder={text.namePlaceholder}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </label>
      {chosen === undefined ? null : (
        <div className="row">
          <Btn
            kind="pri"
            size="sm"
            icon="check"
            onClick={() => {
              confirm({
                email: chosen.email,
                contactName: name,
                source: chosen.source,
                confidence: chosen.confidence,
              });
            }}
          >
            {text.confirm}
          </Btn>
        </div>
      )}
      <div className="ct-type">
        <label className="field grow" htmlFor={typedId}>
          {text.typeAnother}
          <input
            id={typedId}
            className="inp sm"
            type="email"
            value={typed}
            placeholder={text.typePlaceholder}
            aria-invalid={typedProblem !== null}
            aria-describedby={typedProblem === null ? undefined : `${base}-bad`}
            onChange={(e) => {
              setTyped(e.target.value);
              setTypedSeen(false);
            }}
            onBlur={() => {
              setTypedSeen(true);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter") {
                return;
              }
              e.preventDefault();
              if (typedOk) {
                confirm({
                  email: typedAddress,
                  contactName: name,
                  source: "typed",
                  confidence: null,
                });
              } else {
                setTypedSeen(true);
              }
            }}
          />
        </label>
        <Btn
          size="sm"
          disabled={!typedOk}
          onClick={() => {
            confirm({ email: typedAddress, contactName: name, source: "typed", confidence: null });
          }}
        >
          {text.typeConfirm}
        </Btn>
      </div>
      {typedProblem === null ? null : (
        <p id={`${base}-bad`} className="small ct-bad" role="alert">
          {typedProblem}
        </p>
      )}
    </div>
  );
}
