import { fitOf, formatCount, uploadsUnread, type CatalogItem } from "@gratovo/core/find";
import { Icon, Tag } from "@gratovo/ui";
import { memo, useMemo, useState } from "react";

import { setGallerySort, type GallerySort } from "../lib/find-gallery-state";
import { ago, shortDate } from "../lib/format";
import { strings } from "../strings";
import { FitChip } from "./fit-chip";
import { ThumbAvatar } from "./thumb";

const text = strings.findGallery.table;

interface RowProps {
  readonly item: CatalogItem;
  readonly selected: boolean;
  readonly now: number;
  readonly onOpen: (id: string) => void;
  readonly onPick: (id: string, shiftKey: boolean) => void;
}

/** "Not read yet" on one line, the last known figure under it: a column stays narrow (D45). */
function Unread({ lastKnown }: { readonly lastKnown: string | null }) {
  return (
    <span className="tbl-unread">
      <span>{strings.unread.label}</span>
      {lastKnown === null ? null : <small>{strings.unread.lastKnownShort(lastKnown)}</small>}
    </span>
  );
}

const Row = memo(function Row({ item, selected, now, onOpen, onPick }: RowProps) {
  const fit = useMemo(() => fitOf(item), [item]);
  const unread = uploadsUnread(item);
  const latest = item.latestUploadAt === null ? text.none : ago(item.latestUploadAt, now);
  return (
    <tr
      className="click"
      aria-selected={selected}
      onClick={(event) => {
        if (event.shiftKey || event.ctrlKey || event.metaKey) {
          onPick(item.id, event.shiftKey);
        } else {
          onOpen(item.id);
        }
      }}
    >
      <td
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <input
          type="checkbox"
          checked={selected}
          aria-label={strings.findGallery.card.select(item.name)}
          onClick={(event) => {
            onPick(item.id, event.shiftKey);
          }}
          onChange={() => undefined}
        />
      </td>
      <td>
        <span className="row" style={{ gap: 8 }}>
          <ThumbAvatar pic={item.pic} name={item.name} alt={item.name} />
          <span className="col t2" style={{ minWidth: 0 }}>
            <button
              type="button"
              className="tbl-open ell"
              aria-label={strings.findGallery.card.open(item.name)}
              onClick={(event) => {
                event.stopPropagation();
                onOpen(item.id);
              }}
            >
              {item.name}
            </button>
            <span className="small muted ell">{item.handle}</span>
          </span>
        </span>
      </td>
      <td>
        <Tag>{strings.record.stages[item.stage]}</Tag>
      </td>
      <td
        className="n"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <FitChip fit={fit} />
      </td>
      <td className="n">
        {unread ? (
          <Unread lastKnown={item.medianViews > 0 ? formatCount(item.medianViews) : null} />
        ) : item.hasNumbers ? (
          formatCount(item.medianViews)
        ) : (
          text.none
        )}
      </td>
      <td className="n">{item.subscribers === null ? text.none : formatCount(item.subscribers)}</td>
      <td className="n">
        {unread ? (
          <Unread lastKnown={item.latestUploadAt === null ? null : ago(item.latestUploadAt, now)} />
        ) : (
          latest
        )}
      </td>
      <td>{item.country ?? text.none}</td>
      <td>
        {item.emailConfirmed ? (
          <Tag tone="good">{text.emailConfirmed}</Tag>
        ) : item.email !== null || item.emails.length > 0 ? (
          <Tag tone="warn">{text.emailFound}</Tag>
        ) : (
          <span className="muted">{text.emailNone}</span>
        )}
      </td>
      <td className="n">{item.foundAt === null ? text.none : shortDate(item.foundAt)}</td>
    </tr>
  );
});

export interface GalleryTableProps {
  readonly items: readonly CatalogItem[];
  readonly sort: GallerySort;
  readonly selected: ReadonlySet<string>;
  readonly onOpen: (id: string) => void;
  readonly onPick: (id: string, shiftKey: boolean) => void;
}

/** The table view (find.js `Table`): the same channels in rows; five headers sort. */
export function GalleryTable({ items, sort, selected, onOpen, onPick }: GalleryTableProps) {
  // Read once when the table opens; "n d" does not need a ticking clock.
  const [now] = useState(() => Date.now());
  const header = (key: GallerySort | null, label: string, numeric: boolean) => {
    const on = key !== null && sort === key;
    return (
      <th className={numeric ? "n" : undefined} aria-sort={on ? "descending" : undefined}>
        {key === null ? (
          label
        ) : (
          <button
            type="button"
            className="btn ghost sm tbl-sort"
            aria-pressed={on}
            aria-label={text.sortBy(label)}
            onClick={() => {
              setGallerySort(key);
            }}
          >
            {label}
            {on ? <Icon name="chevD" size={12} /> : null}
          </button>
        )}
      </th>
    );
  };
  return (
    <div className="tw">
      <table className="tbl" aria-label={text.label}>
        <thead>
          <tr>
            <th>
              <span className="sr">{text.select}</span>
            </th>
            {header(null, text.channel, false)}
            {header(null, text.stage, false)}
            {header("fit", text.fit, true)}
            {header("median", text.median, true)}
            {header("subs", text.subs, true)}
            {header("latest", text.latest, true)}
            {header(null, text.country, false)}
            {header(null, text.email, false)}
            {header("found", text.found, true)}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <Row
              key={item.id}
              item={item}
              selected={selected.has(item.id)}
              now={now}
              onOpen={onOpen}
              onPick={onPick}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
