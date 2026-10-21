/**
 * The keyset page query (plan D4): rows after the stored cursor, ordered by the cursor column
 * then the key. Every value is double-quoted for PostgREST and every parameter value is
 * percent-encoded, so a `+00:00` offset never turns into a space.
 */

export interface KeysetCursor {
  readonly at: string;
  readonly key: readonly string[];
}

/** `"…"` with `"` and `\` escaped, as PostgREST's logic-tree values need. */
export function quoteValue(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function keysetQuery(o: {
  columns: readonly string[];
  cursorColumn: string;
  keyColumns: readonly string[];
  cursor: KeysetCursor | null;
  limit: number;
  /** Already encoded `col=op.value` parts. */
  filters?: readonly string[];
}): string {
  const { cursorColumn, keyColumns, cursor } = o;
  const order = [cursorColumn, ...keyColumns].map((c) => `${c}.asc`).join(",");
  const parts = [
    `select=${encodeURIComponent(o.columns.join(","))}`,
    `order=${encodeURIComponent(order)}`,
    `limit=${String(o.limit)}`,
    ...(o.filters ?? []),
  ];
  if (cursor !== null) {
    if (cursor.key.length !== keyColumns.length) {
      throw new Error("The cursor key does not match the key columns.");
    }
    const at = quoteValue(cursor.at);
    // (c, k1, k2) > (cv, v1, v2) as nested or/and terms.
    const terms = [`${cursorColumn}.gt.${at}`];
    for (let i = 0; i < keyColumns.length; i += 1) {
      const equal = [
        `${cursorColumn}.eq.${at}`,
        ...keyColumns.slice(0, i).map((c, j) => `${c}.eq.${quoteValue(cursor.key[j] ?? "")}`),
        `${keyColumns[i] ?? ""}.gt.${quoteValue(cursor.key[i] ?? "")}`,
      ];
      terms.push(`and(${equal.join(",")})`);
    }
    parts.push(`or=${encodeURIComponent(`(${terms.join(",")})`)}`);
  }
  return parts.join("&");
}
