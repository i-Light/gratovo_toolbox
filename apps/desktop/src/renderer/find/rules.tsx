import type { FindState } from "@gratovo/ipc";
import { Btn, Tag } from "@gratovo/ui";

import { openSetting } from "../lib/actions";
import { compactCount } from "../lib/find";
import { strings } from "../strings";

const text = strings.findSearch.rules;

/** The auto-clean bands as plain sentences. Empty when auto-clean is off. */
export function cleanBands(clean: FindState["rules"]["autoClean"]): string[] {
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

/** What a search keeps. The rules are changed in Settings › Search rules. */
export function Rules({ rules }: { readonly rules: FindState["rules"] }) {
  const bands = cleanBands(rules.autoClean);
  return (
    <section className="card" data-ui="find.search.rules" aria-labelledby="find-rules-h">
      <div className="card-h">
        <h3 id="find-rules-h">{text.title}</h3>
        <Btn
          size="sm"
          kind="ghost"
          icon="sliders"
          onClick={() => {
            openSetting("search");
          }}
        >
          {text.editRules}
        </Btn>
      </div>
      <div className="fchips">
        <Tag icon="globe">
          {rules.countries.length > 0 ? rules.countries.join(" · ") : text.noCountries}
        </Tag>
        <Tag tone="good" icon="check">
          {rules.minMedianViews === null
            ? text.medianAny
            : text.keepMedian(compactCount(rules.minMedianViews))}
        </Tag>
        <Tag tone="good" icon="check">
          {rules.minUploads30 === null
            ? text.uploadsAny
            : text.keepUploads(String(rules.minUploads30))}
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
        <Tag icon="trash">{text.archiveAfter(rules.archiveDays)}</Tag>
      </div>
      <p className="hint">{text.hint}</p>
    </section>
  );
}
