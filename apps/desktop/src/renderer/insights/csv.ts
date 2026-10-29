import { toast } from "../lib/toast";

/** One cell of a table: text or a number. */
export type Cell = string | number;

function quote(cell: Cell): string {
  const text = String(cell);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The table as CSV: a header line, then one line per row. Cells with quotes, commas or line breaks are quoted. */
export function toCsv(columns: readonly string[], rows: readonly (readonly Cell[])[]): string {
  return [columns, ...rows].map((row) => row.map(quote).join(",")).join("\r\n");
}

/** Puts text on the clipboard and says so in a toast. With no clipboard it says nothing: copying is a convenience. */
export async function copyText(text: string, message: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast({ msg: message, icon: "copy", ms: 2500 });
  } catch {
    // No clipboard, nothing to report.
  }
}
