import type { FindState } from "@gratovo/ipc";
import { Tag } from "@gratovo/ui";

import { compactCount } from "../lib/find";
import { strings } from "../strings";

const text = strings.findSearch.rules;

/** The auto-clean bands as plain sentences. Empty when auto-clean is off. */
function cleanBands(clean: FindState["rules"]["autoClean"]): string[] {
  if (!clean.enabled) {
    return [];
  }
  const bands: string[] = [];
  if (clean.belowMin === "sweep") {
    bands.push(text.archiveUnder(compactCount(clean.minSubscribers)));
  } else if (clean.belowMin === "delay") {
    bands.push(text.leaveUnder(compactCount(clean.minSubscribers)));
  }
  if (clean.aboveMax === "sweep") {
    bands.push(text.archiveOver(compactCount(clean.maxSubscribers)));
  } else if (clean.aboveMax === "delay") {
    bands.push(text.leaveOver(compactCount(clean.maxSubscribers)));
  }
  return bands;
}

/** What a search keeps, read-only here (editing comes in a later step). */
export function Rules({ rules }: { readonly rules: FindState["rules"] }) {
  const bands = cleanBands(rules.autoClean);
  return (
    <section className="card" aria-labelledby="find-rules-h">
      <div className="card-h">
        <h3 id="find-rules-h">{text.title}</h3>
      </div>
      <div className="fchips">
        <Tag icon="globe">
          {rules.countries.length > 0 ? rules.countries.join(" · ") : text.noCountries}
        </Tag>
        <Tag>{text.perKeyword(rules.perKeyword)}</Tag>
        {bands.length === 0 ? (
          <Tag>{text.cleanOff}</Tag>
        ) : (
          bands.map((band) => (
            <Tag key={band} icon="trash">
              {band}
            </Tag>
          ))
        )}
      </div>
      <p className="hint">{text.hint}</p>
    </section>
  );
}
