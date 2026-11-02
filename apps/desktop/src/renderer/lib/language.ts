import { unknownLanguage } from "@gratovo/core/find";

import { strings } from "../strings";

const text = strings.languages;

let names: Intl.DisplayNames | null | undefined;

/** A language's name from its two-letter code: the common ones from the strings, others from `Intl`, else the code. */
export function languageName(code: string): string {
  if (code === unknownLanguage) {
    return text.notKnown;
  }
  const known = text.names[code];
  if (known !== undefined) {
    return known;
  }
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames(["en"], { type: "language" });
    } catch {
      names = null;
    }
  }
  try {
    const name = names?.of(code);
    return name === undefined || name === code ? code.toUpperCase() : name;
  } catch {
    return code.toUpperCase();
  }
}

/** The names of some codes, joined with a middle dot. */
export function languageNames(codes: readonly string[]): string {
  return codes.map(languageName).join(" · ");
}
