import type { WritingRules } from "@gratovo/ipc";
import { Btn, Empty } from "@gratovo/ui";
import { useCallback, useEffect, useState } from "react";

import { strings } from "../strings";

const text = strings.settings.writingRules;

type Rule = WritingRules["rules"][number];
type Load = "loading" | "ready" | "failed";

/** Areas in the order the course teaches them; others follow, A to Z. */
const areaOrder = ["foundations", "influencer", "brand"];

/** A heading for an area: the known ones by name, any other title-cased. */
function areaTitle(area: string): string {
  return (
    text.areas[area] ??
    area
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

/** Rules that match the search (by ID or words, ignoring case), grouped by area in the teaching order. */
function groupRules(
  rules: readonly Rule[],
  query: string,
): readonly { readonly area: string; readonly rules: readonly Rule[] }[] {
  const q = query.trim().toLowerCase();
  const shown = rules.filter(
    (r) =>
      q === "" ||
      r.id.toLowerCase().includes(q) ||
      r.title.toLowerCase().includes(q) ||
      r.rule.toLowerCase().includes(q),
  );
  const areas = [...new Set(shown.map((r) => r.area))].sort((a, b) => {
    const ia = areaOrder.indexOf(a);
    const ib = areaOrder.indexOf(b);
    if (ia >= 0 || ib >= 0) {
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    }
    return a.localeCompare(b);
  });
  return areas.map((area) => ({ area, rules: shown.filter((r) => r.area === area) }));
}

/** Settings › Writing rules: the course's rules, read only, searchable by ID or words. */
export function WritingRulesSection() {
  const [data, setData] = useState<WritingRules | null>(null);
  const [load, setLoad] = useState<Load>("loading");
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  useEffect(() => {
    let stopped = false;
    window.gratovo.invoke("writing:rules", {}).then(
      (result) => {
        if (stopped) {
          return;
        }
        if (result.ok) {
          setData(result.value);
          setLoad("ready");
        } else {
          setLoad("failed");
        }
      },
      () => {
        if (!stopped) {
          setLoad("failed");
        }
      },
    );
    return () => {
      stopped = true;
    };
  }, [attempt]);
  const retry = useCallback(() => {
    setLoad("loading");
    setAttempt((n) => n + 1);
  }, []);
  if (data === null) {
    return load === "failed" ? (
      <div className="card tight" data-ui="settings.writing.card">
        <Empty
          icon="alert"
          title={text.loadFailed}
          action={
            <Btn size="sm" onClick={retry}>
              {text.retry}
            </Btn>
          }
        />
      </div>
    ) : null;
  }
  if (!data.found) {
    return (
      <p
        className="small ink2"
        role="status"
        id="set-writingRules"
        data-ui="settings.writing.not-found"
      >
        {text.notFound}
      </p>
    );
  }
  const groups = groupRules(data.rules, query);
  return (
    <div className="col" id="set-writingRules" data-ui="settings.writing.rules">
      <input
        className="inp"
        type="search"
        placeholder={text.placeholder}
        aria-label={text.searchLabel}
        value={query}
        onChange={(event) => {
          setQuery(event.currentTarget.value);
        }}
      />
      {groups.map((group) => (
        <section
          key={group.area}
          className="col tight"
          aria-label={text.groupLabel(areaTitle(group.area))}
        >
          <h4>{areaTitle(group.area)}</h4>
          {group.rules.map((rule) => (
            <div key={rule.id} className="row top set-rule">
              <span className="tag line mono set-rule-id">{rule.id}</span>
              <span className="grow col t2">
                <b>{rule.title}</b>
                <span className="ink2">{rule.rule}</span>
              </span>
              <span className="tiny muted set-rule-level">{text.levels[rule.level]}</span>
            </div>
          ))}
        </section>
      ))}
      {groups.length === 0 ? (
        <Empty icon="search" title={data.rules.length === 0 ? text.none : text.noMatch}>
          {data.rules.length === 0 ? null : text.noMatchHint}
        </Empty>
      ) : null}
    </div>
  );
}
