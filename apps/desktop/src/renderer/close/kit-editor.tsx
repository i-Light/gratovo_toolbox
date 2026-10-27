import { parseAgeBand } from "@gratovo/core/close";
import { kitCountriesMax } from "@gratovo/core/data";
import type { Creator, KitInput } from "@gratovo/core/data";
import { Btn } from "@gratovo/ui";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { saveKit } from "../lib/close-actions";
import { strings } from "../strings";

const text = strings.close.kit;

/** How many country rows the form shows. */
const countryRows = kitCountriesMax;
const linkMax = 2000;
const rateMax = 1_000_000;

export interface KitForm {
  readonly codes: readonly string[];
  readonly shares: readonly string[];
  readonly age: string;
  readonly engagement: string;
  readonly rate: string;
  readonly link: string;
}

/** What the form says is wrong, by field; empty when it can be saved. */
export type KitErrors = Partial<
  Record<"countries" | "age" | "engagement" | "rate" | "link", string>
>;

const num = (value: string): number => (value.trim() === "" ? Number.NaN : Number(value.trim()));

const trimmed = (list: readonly string[]): string =>
  Array.from({ length: countryRows }, (_, i) => (list[i] ?? "").trim()).join("|");

/**
 * Reads the form into what the IPC schema takes, or says what is wrong. Only what differs from
 * `was` (the values the form started from) is checked and sent, so nothing untouched is rewritten.
 */
export function readKitForm(
  form: KitForm,
  was: KitForm,
): { input: KitInput | null; errors: KitErrors } {
  const errors: KitErrors = {};
  const input: {
    countries?: { code: string; share: number | null }[];
    ageBand?: string | null;
    engagement?: number | null;
    rate?: number | null;
    link?: string | null;
  } = {};
  const changed = (a: string, b: string): boolean => a.trim() !== b.trim();
  if (trimmed(form.codes) !== trimmed(was.codes) || trimmed(form.shares) !== trimmed(was.shares)) {
    const countries: { code: string; share: number | null }[] = [];
    for (let i = 0; i < countryRows; i += 1) {
      const typed = (form.codes[i] ?? "").trim().toUpperCase();
      const code = typed === "UK" ? "GB" : typed;
      const share = (form.shares[i] ?? "").trim();
      if (code === "" && share === "") {
        continue;
      }
      const value = share === "" ? null : num(share);
      if (!/^[A-Z]{2}$/.test(code)) {
        errors.countries = text.errors.code;
      } else if (value !== null && !(value >= 0 && value <= 100)) {
        errors.countries = text.errors.share;
      } else if (countries.some((c) => c.code === code)) {
        errors.countries = text.errors.dupe;
      } else {
        countries.push({ code, share: value });
      }
    }
    input.countries = countries;
  }
  if (changed(form.age, was.age)) {
    const band = form.age.trim().replace(/[–—]/g, "-");
    if (band !== "" && !(/^\d{2}-\d{2}$/.test(band) && parseAgeBand(band) !== null)) {
      errors.age = text.errors.age;
    }
    input.ageBand = band === "" ? null : band;
  }
  if (changed(form.engagement, was.engagement)) {
    const engagement = num(form.engagement);
    if (form.engagement.trim() !== "" && !(engagement >= 0 && engagement <= 100)) {
      errors.engagement = text.errors.engagement;
    }
    input.engagement = form.engagement.trim() === "" ? null : engagement;
  }
  if (changed(form.rate, was.rate)) {
    const rate = num(form.rate.replace(/[$,\s]/g, ""));
    if (form.rate.trim() !== "" && !(Number.isInteger(rate) && rate >= 1 && rate <= rateMax)) {
      errors.rate = text.errors.rate;
    }
    input.rate = form.rate.trim() === "" ? null : rate;
  }
  if (changed(form.link, was.link)) {
    const link = form.link.trim();
    if (link.length > linkMax) {
      errors.link = text.errors.linkLong;
    } else if (link !== "" && (!link.startsWith("https://") || !URL.canParse(link))) {
      errors.link = text.errors.link;
    }
    input.link = link === "" ? null : link;
  }
  return Object.keys(errors).length > 0 ? { input: null, errors } : { input, errors };
}

const start = (creator: Creator): KitForm => {
  const kit = creator.kit;
  const list = kit?.countries ?? [];
  return {
    codes: Array.from({ length: countryRows }, (_, i) => list[i]?.code ?? ""),
    shares: Array.from({ length: countryRows }, (_, i) => {
      const share = list[i]?.share;
      return share == null ? "" : String(share);
    }),
    age: kit?.ageBand ?? "",
    engagement: kit?.engagement == null ? "" : String(kit.engagement),
    rate: kit?.rate == null ? "" : String(kit.rate),
    link: kit?.link ?? "",
  };
};

function Err({ id, message }: { readonly id: string; readonly message: string | undefined }) {
  return message === undefined ? null : (
    <span id={id} className="small kit-err" role="alert">
      {message}
    </span>
  );
}

/**
 * The form for the media kit numbers (plan step 8, D3): up to five countries, the age band,
 * engagement, the rate and the kit link. Offered only to a viewer who sees money, because it
 * writes the rate. Esc closes it without saving.
 */
export function KitEditor({
  creator,
  onDone,
}: {
  readonly creator: Creator;
  readonly onDone: () => void;
}) {
  const [was] = useState<KitForm>(() => start(creator));
  const [form, setForm] = useState<KitForm>(was);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    first.current?.focus();
  }, []);
  const [errors, setErrors] = useState<KitErrors>({});
  const [busy, setBusy] = useState(false);
  const base = useId();
  const set = (patch: Partial<KitForm>): void => {
    setForm((was) => ({ ...was, ...patch }));
  };
  const at = (list: readonly string[], index: number, value: string): string[] =>
    list.map((old, i) => (i === index ? value : old));
  const save = (): void => {
    if (busy) {
      return;
    }
    const { input, errors: found } = readKitForm(form, was);
    setErrors(found);
    if (input === null) {
      return;
    }
    if (Object.keys(input).length === 0) {
      onDone();
      return;
    }
    setBusy(true);
    void saveKit(creator.id, input).then((ok) => {
      setBusy(false);
      if (ok) {
        onDone();
      }
    });
  };
  const onKey = (event: KeyboardEvent<HTMLFormElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onDone();
    }
  };
  const field = (
    name: keyof KitErrors,
  ): { "aria-invalid": boolean; "aria-describedby"?: string } =>
    errors[name] === undefined
      ? { "aria-invalid": false }
      : { "aria-invalid": true, "aria-describedby": `${base}-${name}` };
  return (
    // Esc on any control in the form closes it; the form takes no other keys.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <form
      className="col kit-editor"
      data-ui="record.audience.editor"
      aria-label={text.title}
      noValidate
      onKeyDown={onKey}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <fieldset className="kit-countries">
        <legend className="small">{text.countries}</legend>
        {Array.from({ length: countryRows }, (_, i) => (
          <div className="row" key={i}>
            <input
              ref={i === 0 ? first : undefined}
              className="inp sm kit-code"
              value={form.codes[i] ?? ""}
              maxLength={2}
              placeholder={text.codePlaceholder}
              aria-label={text.country(i + 1)}
              {...field("countries")}
              onChange={(e) => {
                set({ codes: at(form.codes, i, e.target.value.toUpperCase()) });
              }}
            />
            <input
              className="inp sm kit-share"
              value={form.shares[i] ?? ""}
              inputMode="decimal"
              placeholder={text.sharePlaceholder}
              aria-label={text.share(i + 1)}
              onChange={(e) => {
                set({ shares: at(form.shares, i, e.target.value) });
              }}
            />
          </div>
        ))}
        <Err id={`${base}-countries`} message={errors.countries} />
      </fieldset>
      <label className="field">
        {text.ageBand}
        <input
          className="inp sm"
          value={form.age}
          placeholder={text.agePlaceholder}
          {...field("age")}
          onChange={(e) => {
            set({ age: e.target.value });
          }}
        />
        <Err id={`${base}-age`} message={errors.age} />
      </label>
      <label className="field">
        {text.engagement}
        <input
          className="inp sm"
          value={form.engagement}
          inputMode="decimal"
          {...field("engagement")}
          onChange={(e) => {
            set({ engagement: e.target.value });
          }}
        />
        <Err id={`${base}-engagement`} message={errors.engagement} />
      </label>
      <label className="field">
        {text.rate}
        <input
          className="inp sm"
          value={form.rate}
          inputMode="numeric"
          {...field("rate")}
          onChange={(e) => {
            set({ rate: e.target.value });
          }}
        />
        <Err id={`${base}-rate`} message={errors.rate} />
      </label>
      <label className="field">
        {text.link}
        <input
          className="inp sm"
          value={form.link}
          placeholder={text.linkPlaceholder}
          {...field("link")}
          onChange={(e) => {
            set({ link: e.target.value });
          }}
        />
        <Err id={`${base}-link`} message={errors.link} />
      </label>
      <div className="row">
        <Btn kind="pri" size="sm" icon="check" disabled={busy} onClick={save}>
          {busy ? text.saving : text.save}
        </Btn>
        <Btn kind="ghost" size="sm" onClick={onDone}>
          {text.cancel}
        </Btn>
      </div>
    </form>
  );
}
