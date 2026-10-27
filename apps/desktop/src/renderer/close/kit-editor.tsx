import { parseAgeBand } from "@gratovo/core/close";
import { kitCountriesMax } from "@gratovo/core/data";
import type { Creator, KitInput } from "@gratovo/core/data";
import { Btn } from "@gratovo/ui";
import { useId, useState } from "react";
import type { KeyboardEvent } from "react";

import { saveKit } from "../lib/close-actions";
import { strings } from "../strings";

const text = strings.close.kit;

/** How many country rows the form shows. */
const countryRows = Math.min(3, kitCountriesMax);
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

/** Reads the form into what the IPC schema takes, or says what is wrong. */
export function readKitForm(form: KitForm): { input: KitInput | null; errors: KitErrors } {
  const errors: KitErrors = {};
  const countries: { code: string; share: number | null }[] = [];
  for (let i = 0; i < countryRows; i += 1) {
    const code = (form.codes[i] ?? "").trim().toUpperCase();
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
  const band = form.age.trim().replace(/[–—]/g, "-");
  if (band !== "" && !(/^\d{2}-\d{2}$/.test(band) && parseAgeBand(band) !== null)) {
    errors.age = text.errors.age;
  }
  const engagement = num(form.engagement);
  if (form.engagement.trim() !== "" && !(engagement >= 0 && engagement <= 100)) {
    errors.engagement = text.errors.engagement;
  }
  const rate = num(form.rate.replace(/[$,\s]/g, ""));
  if (form.rate.trim() !== "" && !(Number.isInteger(rate) && rate >= 1 && rate <= rateMax)) {
    errors.rate = text.errors.rate;
  }
  const link = form.link.trim();
  if (link !== "") {
    if (link.length > linkMax) {
      errors.link = text.errors.linkLong;
    } else if (!link.startsWith("https://") || !URL.canParse(link)) {
      errors.link = text.errors.link;
    }
  }
  if (Object.keys(errors).length > 0) {
    return { input: null, errors };
  }
  return {
    errors,
    input: {
      countries,
      ageBand: band === "" ? null : band,
      engagement: form.engagement.trim() === "" ? null : engagement,
      rate: form.rate.trim() === "" ? null : rate,
      link: link === "" ? null : link,
    },
  };
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
 * The form for the media kit numbers (plan step 8, D3): up to three countries, the age band,
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
  const [form, setForm] = useState<KitForm>(() => start(creator));
  const [errors, setErrors] = useState<KitErrors>({});
  const [busy, setBusy] = useState(false);
  const base = useId();
  const set = (patch: Partial<KitForm>): void => {
    setForm((was) => ({ ...was, ...patch }));
  };
  const at = (list: readonly string[], index: number, value: string): string[] =>
    list.map((old, i) => (i === index ? value : old));
  const save = (): void => {
    const { input, errors: found } = readKitForm(form);
    setErrors(found);
    if (input === null) {
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
  const onKey = (event: KeyboardEvent<HTMLInputElement>): void => {
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
    <form
      className="col kit-editor"
      data-ui="record.audience.editor"
      aria-label={text.title}
      noValidate
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
              onKeyDown={onKey}
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
              onKeyDown={onKey}
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
          onKeyDown={onKey}
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
          onKeyDown={onKey}
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
          onKeyDown={onKey}
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
          onKeyDown={onKey}
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
