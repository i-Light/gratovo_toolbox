import type { Readable } from "node:stream";

/**
 * Splits a child's stdout into lines for the JSON-lines protocols (ADR 0013). A line longer than
 * `maxLength` is dropped whole, never read in pieces: `onTooLong` gets its first part, and the rest
 * of it, up to the next newline, is skipped. A trailing `\r` is removed.
 */
export interface LineReader {
  /** The unfinished last line, read when the process has closed. */
  flush(): void;
}

export function readLines(
  stream: Readable,
  o: { maxLength: number; onLine: (line: string) => void; onTooLong: (start: string) => void },
): LineReader {
  let pending = "";
  let skipping = false;
  const strip = (line: string): string => (line.endsWith("\r") ? line.slice(0, -1) : line);

  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    let rest = chunk;
    let newline = rest.indexOf("\n");
    while (newline >= 0) {
      const line = pending + rest.slice(0, newline);
      pending = "";
      rest = rest.slice(newline + 1);
      if (skipping) {
        skipping = false;
      } else {
        o.onLine(strip(line));
      }
      newline = rest.indexOf("\n");
    }
    if (skipping) {
      return;
    }
    pending += rest;
    if (pending.length > o.maxLength) {
      o.onTooLong(pending);
      pending = "";
      skipping = true;
    }
  });

  return {
    flush() {
      if (pending !== "" && !skipping) {
        const last = pending;
        pending = "";
        o.onLine(strip(last));
      }
    },
  };
}
