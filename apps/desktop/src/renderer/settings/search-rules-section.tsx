import { Btn, Empty, Seg, Switch, Tag } from "@gratovo/ui";
import { useRef, useState } from "react";

import { cleanBands } from "../find/rules";
import { flashSetting } from "../lib/actions";
import { compactCount, useFind } from "../lib/find";
import { toast } from "../lib/toast";
import { strings } from "../strings";
import { CountriesRow } from "./search-rules/countries-row";
import {
  baseCountries,
  checkDraft,
  draftOf,
  labelMax,
  type CleanAction,
  type Draft,
  type Errors,
} from "./search-rules/draft";
import { NumberField } from "./search-rules/number-field";
import { Problem } from "./search-rules/problem";
import { Row } from "./row";

const text = strings.settings.searchRules;
const rows = strings.settings.rows;

const cleanOptions = (["sweep", "delay", "off"] as const).map((value) => ({
  value,
  label: text.actions[value],
}));

/** Settings › Search rules: what every search keeps, as tags, with an Edit mode. */
export function SearchRulesSection() {
  const { state, load, reload } = useFind();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  if (state === null) {
    return load === "failed" ? (
      <div className="card tight" data-ui="settings.search.rules">
        <Empty
          icon="alert"
          title={text.loadFailed}
          action={
            <Btn size="sm" onClick={reload}>
              {strings.findSearch.retry}
            </Btn>
          }
        />
      </div>
    ) : null;
  }
  const rules = state.rules;
  const set = (patch: Partial<Draft>): void => {
    setDraft((d) => (d === null ? d : { ...d, ...patch }));
  };
  const checked = draft === null ? null : checkDraft(draft, rules);
  const next = checked?.rules ?? null;
  const errors: Errors = checked?.errors ?? {};
  const countryList = [
    ...baseCountries,
    ...rules.countries.filter((c) => !(baseCountries as readonly string[]).includes(c)),
  ];
  const save = (): void => {
    if (next === null || saving.current) {
      return;
    }
    saving.current = true;
    setBusy(true);
    setFailed(false);
    const done = (ok: boolean): void => {
      saving.current = false;
      setBusy(false);
      if (!ok) {
        setFailed(true);
        return;
      }
      setDraft(null);
      flashSetting("rulesBand");
      toast({ msg: text.savedToast, sub: text.savedSub, icon: "check", tone: "good" });
    };
    window.gratovo.invoke("rules:set", { rules: next }).then(
      (result) => {
        done(result.ok);
      },
      () => {
        done(false);
      },
    );
  };
  const bands = cleanBands(rules.autoClean);
  return (
    <>
      <div className="row wrap" style={{ padding: "10px 4px 4px", gap: "10px" }}>
        {draft === null ? (
          <Btn
            size="sm"
            icon="sliders"
            onClick={() => {
              setFailed(false);
              setDraft(draftOf(rules));
            }}
          >
            {text.edit}
          </Btn>
        ) : (
          <>
            <Btn kind="pri" size="sm" icon="check" disabled={next === null || busy} onClick={save}>
              {text.save}
            </Btn>
            <Btn
              size="sm"
              kind="ghost"
              disabled={busy}
              onClick={() => {
                setDraft(null);
                setFailed(false);
              }}
            >
              {text.cancel}
            </Btn>
            <span className="hint">{failed ? text.saveFailed : text.apply}</span>
          </>
        )}
      </div>
      <CountriesRow draft={draft} rules={rules} countryList={countryList} set={set} />
      <Row
        id="rulesMedian"
        label={rows.rulesMedian.label}
        scope="team"
        desc={rows.rulesMedian.desc}
        ui="settings.search.median"
      >
        {draft === null ? (
          <Tag tone="good" icon="check">
            {rules.minMedianViews === null
              ? text.medianAny
              : text.keepMedian(compactCount(rules.minMedianViews))}
          </Tag>
        ) : (
          <NumberField
            label={rows.rulesMedian.label}
            value={draft.median}
            error={errors.median}
            errorId="set-err-median"
            hint={text.numberHint}
            onChange={(median) => {
              set({ median });
            }}
          />
        )}
      </Row>
      <Row
        id="rulesUploads"
        label={rows.rulesUploads.label}
        scope="team"
        desc={rows.rulesUploads.desc}
        ui="settings.search.uploads"
      >
        {draft === null ? (
          <Tag tone="good" icon="check">
            {rules.minUploads30 === null
              ? text.uploadsAny
              : text.keepUploads(String(rules.minUploads30))}
          </Tag>
        ) : (
          <NumberField
            label={rows.rulesUploads.label}
            value={draft.uploads}
            error={errors.uploads}
            errorId="set-err-uploads"
            hint={text.numberHint}
            onChange={(uploads) => {
              set({ uploads });
            }}
          />
        )}
      </Row>
      <Row
        id="rulesPerKeyword"
        label={rows.rulesPerKeyword.label}
        scope="team"
        desc={rows.rulesPerKeyword.desc}
        ui="settings.search.per-keyword"
      >
        {draft === null ? (
          <Tag>{strings.findSearch.rules.perKeyword(rules.perKeyword)}</Tag>
        ) : (
          <NumberField
            label={rows.rulesPerKeyword.label}
            value={draft.perKeyword}
            error={errors.perKeyword}
            errorId="set-err-perkeyword"
            onChange={(perKeyword) => {
              set({ perKeyword });
            }}
          />
        )}
      </Row>
      <Row
        id="rulesArchive"
        label={rows.rulesArchive.label}
        scope="team"
        desc={rows.rulesArchive.desc}
        ui="settings.search.archive"
      >
        {draft === null ? (
          <Tag icon="trash">{text.archiveAfter(rules.archiveDays)}</Tag>
        ) : (
          <NumberField
            label={rows.rulesArchive.label}
            value={draft.archive}
            error={errors.archive}
            errorId="set-err-archive"
            onChange={(archive) => {
              set({ archive });
            }}
          />
        )}
      </Row>
      <Row
        id="rulesBand"
        label={rows.rulesBand.label}
        scope="team"
        desc={rows.rulesBand.desc}
        ui="settings.search.band"
      >
        {draft === null ? (
          <div className="fchips">
            {bands.length === 0 ? (
              <Tag>{text.bandOff}</Tag>
            ) : (
              bands.map((band) => (
                <Tag key={band} icon="trash">
                  {band}
                </Tag>
              ))
            )}
          </div>
        ) : (
          <div className="col" style={{ gap: "10px", minWidth: 0 }}>
            <div className="row" style={{ gap: "10px" }}>
              <Switch
                on={draft.clean}
                label={text.autoClean}
                onChange={(clean) => {
                  set({ clean });
                }}
              />
              <span>{text.autoClean}</span>
            </div>
            {draft.clean ? (
              <>
                <div className="grid2" style={{ gap: "10px" }}>
                  <label className="field">
                    {text.minSubscribers}
                    <input
                      className="inp num"
                      inputMode="numeric"
                      value={draft.minSubs}
                      aria-invalid={errors.band !== undefined}
                      onChange={(event) => {
                        set({ minSubs: event.currentTarget.value });
                      }}
                    />
                  </label>
                  <label className="field">
                    {text.maxSubscribers}
                    <input
                      className="inp num"
                      inputMode="numeric"
                      value={draft.maxSubs}
                      aria-invalid={errors.band !== undefined}
                      onChange={(event) => {
                        set({ maxSubs: event.currentTarget.value });
                      }}
                    />
                  </label>
                </div>
                <Seg
                  label={text.belowMin}
                  value={draft.below}
                  options={cleanOptions}
                  onPick={(below) => {
                    set({ below: below as CleanAction });
                  }}
                />
                <Seg
                  label={text.aboveMax}
                  value={draft.above}
                  options={cleanOptions}
                  onPick={(above) => {
                    set({ above: above as CleanAction });
                  }}
                />
                <label className="field">
                  {text.cleanLabel}
                  <input
                    className="inp"
                    value={draft.label}
                    maxLength={labelMax + 20}
                    onChange={(event) => {
                      set({ label: event.currentTarget.value });
                    }}
                  />
                </label>
              </>
            ) : null}
            <Problem id="set-err-band" message={errors.band} />
          </div>
        )}
      </Row>
    </>
  );
}
