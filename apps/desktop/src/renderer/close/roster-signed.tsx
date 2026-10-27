import type { Creator } from "@gratovo/core/data";
import { emptyFindFilter, formatCount } from "@gratovo/core/find";
import type { FindFilter } from "@gratovo/core/find";
import { avatarColor, Avatar, Btn, Empty } from "@gratovo/ui";

import { peek } from "../lib/actions";
import { useCatalogQuery } from "../lib/find-catalog";
import { go, useApp } from "../lib/store";
import { strings } from "../strings";
import { rateWords } from "./rate-words";

const text = strings.closeScreen.roster;

/** The Gallery's filter (no search words, no median floor) narrowed to the signed stage. */
const signedFilter: FindFilter = { ...emptyFindFilter, stages: ["signed"] };
/** The most one `find:query` page holds. */
const pageMax = 120;
/** How many countries the Audience column names. */
const topShown = 3;

interface Numbers {
  readonly subscribers: number | null;
  readonly median: number | null;
}

function Audience({ creator }: { readonly creator: Creator }) {
  const top = (creator.kit?.countries ?? []).slice(0, topShown);
  if (top.length === 0) {
    return <span className="muted">{text.none}</span>;
  }
  return (
    <>
      {top.map((c) => (
        <span key={c.code}>
          <b>{c.code}</b>
          {c.share === null ? "" : ` ${String(c.share)}%`}
        </span>
      ))}
    </>
  );
}

function Row({
  creator,
  numbers,
  list,
}: {
  readonly creator: Creator;
  readonly numbers: Numbers | undefined;
  readonly list: readonly string[];
}) {
  const selected = useApp((s) => s.ui.peek?.record.id === creator.id);
  const open = (): void => {
    peek({ kind: "creator", id: creator.id }, list);
  };
  const subs = numbers?.subscribers ?? null;
  const median = numbers?.median ?? null;
  const rate = rateWords(creator.kit);
  return (
    <tr className="click" data-ui="close.roster.row" data-selected={selected} onClick={open}>
      <td>
        <button
          type="button"
          className="lnk"
          aria-label={text.openCreator(creator.name)}
          onClick={(event) => {
            event.stopPropagation();
            open();
          }}
        >
          <Avatar name={creator.name} color={avatarColor(creator.handle)} size="s" decorative />
          <span className="col t2" style={{ minWidth: 0 }}>
            <b className="ell">{creator.name}</b>
            <small className="muted ell">
              {subs === null
                ? creator.handle
                : `${creator.handle} · ${text.subscribers(formatCount(subs))}`}
            </small>
          </span>
        </button>
      </td>
      <td className="n">{rate ?? text.none}</td>
      <td className="n">{median === null ? text.none : formatCount(median)}</td>
      <td className="aud">
        <Audience creator={creator} />
      </td>
    </tr>
  );
}

/** "Signed creators": the frame's signed creators, with subscribers and median views from the catalog. */
export function RosterSigned({
  signed,
  kitsWaiting,
}: {
  readonly signed: readonly Creator[];
  readonly kitsWaiting: boolean;
}) {
  const query = useCatalogQuery({
    filter: signedFilter,
    sort: "median",
    offset: 0,
    limit: pageMax,
    facets: false,
  });
  const known = new Map<string, Numbers>(
    query.items.map((i) => [
      i.id,
      { subscribers: i.subscribers, median: i.hasNumbers ? i.medianViews : null },
    ]),
  );
  const median = (c: Creator): number => known.get(c.id)?.median ?? -1;
  const rows = [...signed].sort((a, b) => median(b) - median(a) || a.name.localeCompare(b.name));
  const list = rows.map((c) => c.id);
  return (
    <section className="card" data-ui="close.roster.signed" aria-labelledby="close-signed-h">
      <div className="card-h">
        <h3 id="close-signed-h">
          {text.signedTitle}{" "}
          <span className="muted num" style={{ fontWeight: 400 }}>
            {rows.length}
          </span>
        </h3>
      </div>
      {rows.length === 0 ? (
        <Empty
          icon="users"
          title={text.emptyTitle}
          action={
            <Btn
              icon="reply"
              onClick={() => {
                go("reach", "board");
              }}
            >
              {text.emptyAction}
            </Btn>
          }
        >
          {kitsWaiting ? text.emptyWithKits : text.emptyNoKits}
        </Empty>
      ) : (
        <div className="tw" data-ui="close.roster.table">
          <table className="tbl rt" aria-label={text.tableLabel}>
            <thead>
              <tr>
                <th>{text.columns.creator}</th>
                <th className="n">{text.columns.rate}</th>
                <th className="n">{text.columns.median}</th>
                <th>{text.columns.audience}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <Row key={c.id} creator={c} numbers={known.get(c.id)} list={list} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
