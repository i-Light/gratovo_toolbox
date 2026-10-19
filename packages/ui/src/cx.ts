/** Joins the class names that are set and drops the rest (`false`, `null`, `undefined`, empty text). */
export function cx(...parts: readonly (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
