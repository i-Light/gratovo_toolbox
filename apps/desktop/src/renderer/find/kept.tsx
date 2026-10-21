import type { FindState } from "@gratovo/ipc";

import { compactCount } from "../lib/find";
import { strings } from "../strings";

const text = strings.findSearch.kept;

const count = (n: number | null): string => (n === null ? text.unknown : compactCount(n));

/** The newest channels the rules kept. */
export function Kept({ kept }: { readonly kept: FindState["kept"] }) {
  return (
    <section className="card" aria-labelledby="find-kept-h">
      <div className="card-h">
        <h3 id="find-kept-h">
          {text.title}{" "}
          <span className="muted num" style={{ fontWeight: 400 }}>
            {kept.length}
          </span>
        </h3>
      </div>
      {kept.length === 0 ? (
        <p className="hint">{text.empty}</p>
      ) : (
        <ul className="kept-list" aria-label={text.listLabel}>
          {kept.map((c) => (
            <li key={c.channelId} className="kept-i">
              <span className="kept-name">
                <b className="ell" title={c.name}>
                  {c.name}
                </b>
                {c.handle === null ? null : (
                  <span className="muted ell" title={c.handle}>
                    {c.handle}
                  </span>
                )}
              </span>
              <span className="kept-meta small muted">
                <span>{text.subscribers(count(c.subscribers))}</span>
                <span>{text.medianViews(count(c.medianViews))}</span>
                {c.country === null ? null : <span>{c.country}</span>}
                {c.keyword === null ? null : (
                  <span className="ell" title={c.keyword}>
                    {text.keyword(c.keyword)}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
