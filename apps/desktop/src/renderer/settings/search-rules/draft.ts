import type { FindState } from "@gratovo/ipc";

import { strings } from "../../strings";

const text = strings.settings.searchRules;

export type Rules = FindState["rules"];
export type CleanAction = Rules["autoClean"]["belowMin"];

/** The countries you can pick; any other country already in the rules is kept and shown too. */
export const baseCountries = ["AU", "CA", "GB", "IE", "NZ", "US", "IN", "DE"] as const;

const ruleCountMax = 100_000_000;
const uploadsMax = 10_000;
const perKeywordMax = 1000;
const archiveMax = 90;
export const labelMax = 40;

/** What the form holds: every number as the text typed, so a half-typed value is not lost. */
export interface Draft {
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
export type Errors = Partial<Record<Field, string>>;

export function draftOf(rules: Rules): Draft {
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
export function checkDraft(
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
