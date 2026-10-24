import { contactNameMax, emailMax, emailPattern } from "@gratovo/core/data";
import type { CatalogItem, FoundEmail } from "@gratovo/core/find";
import { Btn, cx, Icon, Tag } from "@gratovo/ui";
import { useId, useState } from "react";

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
}: {
  readonly item: CatalogItem;
  /** Opens on the list even when an address is confirmed (the record's Change). */
  readonly startOpen?: boolean;
  /** Called after an address is confirmed. */
  readonly onDone?: () => void;
}) {
  const base = useId();
  // The page's own creator holds the address once it is confirmed (it leads main's catalog).
  const creator = useApp((s) => s.data.creators.find((c) => c.id === item.id));
  const confirmed = creator?.emailConfirmed ?? item.emailConfirmed;
  const email = creator?.email ?? item.email;
  const readerName = creator === undefined ? item.contactName : creator.contactName;
  const [changing, setChanging] = useState(startOpen);
  const [picked, setPicked] = useState<string | null>(null);
  const [name, setName] = useState(readerName ?? "");
  const [typed, setTyped] = useState("");
  const found = item.emails;
  const pick = picked ?? found[0]?.email ?? null;
  const chosen = found.find((f) => f.email === pick);
  const typedAddress = typed.trim();
  const typedBad = typedAddress !== "" && !emailPattern.test(typedAddress);
  const typedLong = typedAddress.length > emailMax;
  const typedOk = typedAddress !== "" && !typedBad && !typedLong;
  const typedProblem = typedLong ? text.typeLong(emailMax) : typedBad ? text.typeBad : null;

  const confirm = (choice: Parameters<typeof confirmAddress>[1]): void => {
    if (confirmAddress(item, choice)) {
      setChanging(false);
      setTyped("");
      onDone?.();
    }
  };

  if (confirmed && email !== null && !changing) {
    return (
      <div className="ct-done" aria-label={text.confirmedLabel}>
        <Icon name="checkc" />
        <span className="mono">{email}</span>
        {readerName === null ? null : <span className="small muted">{text.by(readerName)}</span>}
        <span className="sp"></span>
        <Btn
          size="sm"
          kind="ghost"
          onClick={() => {
            setPicked(email);
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
        <p className="small ink2">{text.none}</p>
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
        <label className="field grow">
          {text.typeAnother}
          <input
            className="inp sm"
            type="email"
            value={typed}
            placeholder={text.typePlaceholder}
            aria-label={text.typeLabel}
            aria-invalid={typedProblem !== null}
            aria-describedby={typedProblem === null ? undefined : `${base}-bad`}
            onChange={(e) => {
              setTyped(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && typedOk) {
                e.preventDefault();
                confirm({
                  email: typedAddress,
                  contactName: name,
                  source: "typed",
                  confidence: null,
                });
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
          {text.confirm}
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
