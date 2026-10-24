import { Icon, IconBtn, Seg } from "@gratovo/ui";
import { useEffect, useRef, useState } from "react";

import {
  gallerySorts,
  patchGalleryFilter,
  setGallerySize,
  setGallerySort,
  setGalleryShow,
  setGalleryView,
  type GallerySize,
  type GallerySort,
  type GalleryShow,
  type GalleryView,
  type ShowToggle,
} from "../lib/find-gallery-state";
import { strings } from "../strings";

const text = strings.findGallery.toolbar;

/** The search box takes at most this many characters (main refuses a longer filter). */
const searchMax = 200;

/** How long typing rests before the search is applied. */
export const searchDebounceMs = 200;

const showToggles: readonly (readonly [ShowToggle, string])[] = [
  ["pics", text.pictures],
  ["latest", text.latestVideo],
  ["signals", text.signals],
];

/** The search box: the filter's text follows 200 ms after the last key. */
function Search({ q }: { readonly q: string }) {
  const [draft, setDraft] = useState(q);
  // What this box last sent, so a change from outside (Clear all, a saved view) can be told apart.
  const sent = useRef(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (q !== sent.current) {
      sent.current = q;
      setDraft(q);
    }
  }, [q]);
  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  function send(value: string): void {
    sent.current = value;
    patchGalleryFilter({ q: value });
  }

  return (
    <span className="row grow gal-search">
      <Icon name="search" size={14} />
      <input
        className="gal-search-in"
        placeholder={text.searchPlaceholder}
        aria-label={text.search}
        value={draft}
        maxLength={searchMax}
        onChange={(e) => {
          const value = e.target.value;
          setDraft(value);
          if (timer.current !== null) {
            clearTimeout(timer.current);
          }
          timer.current = setTimeout(() => {
            timer.current = null;
            send(value);
          }, searchDebounceMs);
        }}
      />
      {draft === "" ? null : (
        <IconBtn
          icon="x"
          size={13}
          label={text.clearSearch}
          onClick={() => {
            if (timer.current !== null) {
              clearTimeout(timer.current);
              timer.current = null;
            }
            setDraft("");
            send("");
          }}
        />
      )}
    </span>
  );
}

/** Search, sort, view and size, and what the cards show. */
export function GalleryToolbar({
  q,
  sort,
  view,
  size,
  show,
}: {
  readonly q: string;
  readonly sort: GallerySort;
  readonly view: GalleryView;
  readonly size: GallerySize;
  readonly show: GalleryShow;
}) {
  const gallery = view === "gallery";
  return (
    <>
      <div className="row wrap">
        <Search q={q} />
        <label className="row small muted" style={{ gap: "6px" }}>
          {text.sort}
          <select
            className="sel sm"
            style={{ width: "auto" }}
            value={sort}
            onChange={(e) => {
              setGallerySort(e.target.value as GallerySort);
            }}
          >
            {gallerySorts.map((key) => (
              <option key={key} value={key}>
                {text.sorts[key]}
              </option>
            ))}
          </select>
        </label>
        <Seg
          label={text.view}
          value={view}
          options={[
            { value: "gallery", label: text.gallery, icon: "grid" },
            { value: "table", label: text.table, icon: "list" },
          ]}
          onPick={(v) => {
            setGalleryView(v as GalleryView);
          }}
        />
        {gallery ? (
          <Seg
            label={text.size}
            value={size}
            options={[
              { value: "s", label: text.small },
              { value: "m", label: text.medium },
              { value: "l", label: text.large },
            ]}
            onPick={(v) => {
              setGallerySize(v as GallerySize);
            }}
          />
        ) : null}
      </div>
      {gallery ? (
        <div className="row wrap" style={{ gap: "6px" }} role="group" aria-label={text.show}>
          <span className="small muted">{text.show}</span>
          {showToggles.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className="chip"
              aria-pressed={show[key]}
              onClick={() => {
                setGalleryShow(key, !show[key]);
              }}
            >
              {show[key] ? <Icon name="check" size={12} /> : null}
              {label}
            </button>
          ))}
          <span className="sp" />
          <span className="hint">{text.hint}</span>
        </div>
      ) : null}
    </>
  );
}
