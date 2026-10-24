import type { FindState } from "@gratovo/ipc";
import { Btn, Empty, Seg, Switch, Tag } from "@gratovo/ui";
import { useRef, useState } from "react";

import { cleanBands } from "../find/rules";
import { flashSetting } from "../lib/actions";
import { compactCount, useFind } from "../lib/find";
import { toast } from "../lib/toast";
import { strings } from "../strings";
import { Row } from "./row";

const text = strings.settings.searchRules;
const rows = strings.settings.rows;

type Rules = FindState["rules"];
type CleanAction = Rules["autoClean"]["belowMin"];

/** The countries you can pick; any other country already in the rules is kept and shown too. */
const baseCountries = ["AU", "CA", "GB", "IE", "NZ", "US", "IN", "DE"] as const;

const ruleCountMax = 100_000_000;
const uploadsMax = 10_000;
const perKeywordMax = 1000;
const archiveMax = 90;
const labelMax = 40;

/** What the form holds: every number as the text typed, so a half-typed value is not lost. */
interface Draft {
  readonly countries: readonly string[];
  readonly median: string;
  readonly uploads: string;
  readonly perKeyword: string;
  readonly archive: string;
  readonly clean: boolean;
  readonly minSubs: string;
  readonly maxSubs: string;
  readonly below: CleanAction;
  readonly above: CleanAction;
  readonly label: string;
}

type Field = "median" | "uploads" | "perKeyword" | "archive" | "band";
type Errors = Partial<Record<Field, string>>;

function draftOf(rules: Rules): Draft {
  return {
    countries: rules.countries,
    median: rules.minMedianViews === null ? "" : String(rules.minMedianViews),
    uploads: rules.minUploads30 === null ? "" : String(rules.minUploads30),
    perKeyword: String(rules.perKeyword),
    archive: String(rules.archiveDays),
    clean: rules.autoClean.enabled,
    minSubs: String(rules.autoClean.minSubscribers),
    maxSubs: String(rules.autoClean.maxSubscribers),
    below: rules.autoClean.belowMin,
    above: rules.autoClean.aboveMax,
    label: rules.autoClean.label,
  };
}

const digits = /^\s*\d{1,12}\s*$/;

/** A whole number in a range, or null when the text isn't one. */
function whole(value: string, min: number, max: number): number | null {
  if (!digits.test(value)) {
    return null;
  }
  const n = Number(value.trim());
  return n >= min && n <= max ? n : null;
}

/** Checks the form: the rules to save, or a plain sentence for every field that is wrong. */
function checkDraft(
  draft: Draft,
  current: Rules,
): { readonly rules: Rules | null; readonly errors: Errors } {
  const errors: Errors = {};
  const blank = (value: string): boolean => value.trim() === "";
  const median = blank(draft.median) ? null : whole(draft.median, 0, ruleCountMax);
  if (!blank(draft.median) && median === null) {
    errors.median = digits.test(draft.median) ? text.errMedianRange : text.errNumber;
  }
  const uploads = blank(draft.uploads) ? null : whole(draft.uploads, 0, uploadsMax);
  if (!blank(draft.uploads) && uploads === null) {
    errors.uploads = digits.test(draft.uploads) ? text.errUploadsRange : text.errNumber;
  }
  const perKeyword = whole(draft.perKeyword, 1, perKeywordMax);
  if (perKeyword === null) {
    errors.perKeyword = text.errPerKeyword;
  }
  const archive = whole(draft.archive, 1, archiveMax);
  if (archive === null) {
    errors.archive = text.errArchive;
  }
  const minSubs = whole(draft.minSubs, 0, ruleCountMax);
  const maxSubs = whole(draft.maxSubs, 0, ruleCountMax);
  const label = draft.label.trim();
  if (draft.clean) {
    if (minSubs === null || maxSubs === null) {
      errors.band = text.errSubscribers;
    } else if (minSubs > maxSubs) {
      errors.band = text.errBandOrder;
    } else if (label.length < 1 || label.length > labelMax) {
      errors.band = text.errLabel;
    }
  }
  if (
    Object.keys(errors).length > 0 ||
    perKeyword === null ||
    archive === null ||
    (draft.clean && (minSubs === null || maxSubs === null))
  ) {
    return { rules: null, errors };
  }
  const was = current.autoClean;
  return {
    errors,
    rules: {
      ...current,
      countries: [...draft.countries],
      perKeyword,
      minMedianViews: median,
      minUploads30: uploads,
      archiveDays: archive,
      autoClean: draft.clean
        ? {
            enabled: true,
            minSubscribers: minSubs ?? was.minSubscribers,
            maxSubscribers: maxSubs ?? was.maxSubscribers,
            belowMin: draft.below,
            aboveMax: draft.above,
            label,
          }
        : // Switched off: the other values stay as they were, so turning it on again finds them.
          { ...was, enabled: false },
    },
  };
}

function Problem({ id, message }: { readonly id: string; readonly message: string | undefined }) {
  return message === undefined ? null : (
    <span id={id} className="hint set-err" role="alert">
      {message}
    </span>
  );
}

/** One number field, with its inline problem. */
function NumberField(props: {
  readonly label: string;
  readonly value: string;
  readonly error: string | undefined;
  readonly errorId: string;
  readonly hint?: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="col tight" style={{ minWidth: 0 }}>
      <input
        className="inp num set-num"
        inputMode="numeric"
        value={props.value}
        aria-label={props.label}
        aria-invalid={props.error !== undefined}
        aria-describedby={props.error === undefined ? undefined : props.errorId}
        onChange={(event) => {
          props.onChange(event.currentTarget.value);
        }}
      />
      <Problem id={props.errorId} message={props.error} />
      {props.hint !== undefined && props.error === undefined ? (
        <span className="hint">{props.hint}</span>
      ) : null}
    </div>
  );
}

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
      <div className="card tight">
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
      <Row
        id="rulesCountries"
        label={rows.rulesCountries.label}
        scope="team"
        desc={rows.rulesCountries.desc}
        ui="settings.search.countries"
      >
        {draft === null ? (
          <div className="fchips">
            <Tag icon="globe">
              {rules.countries.length > 0
                ? rules.countries.join(" · ")
                : strings.findSearch.rules.noCountries}
            </Tag>
          </div>
        ) : (
          <div className="fchips" role="group" aria-label={text.countriesGroup}>
            {countryList.map((country) => {
              const on = draft.countries.includes(country);
              return (
                <button
                  key={country}
                  type="button"
                  className="chip"
                  aria-pressed={on}
                  onClick={() => {
                    set({
                      countries: countryList.filter((c) =>
                        c === country ? !on : draft.countries.includes(c),
                      ),
                    });
                  }}
                >
                  {country}
                </button>
              );
            })}
          </div>
        )}
      </Row>
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
        ui="settings.search.perKeyword"
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
