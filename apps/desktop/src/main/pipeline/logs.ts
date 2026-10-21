import { closeSync, mkdirSync, openSync, readdirSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";

import type { Start } from "./protocol";

/**
 * One log file per pipeline job, `<userData>/logs/pipeline-<stamp>.log`: the process's stderr, its
 * log events, lines it sent that didn't parse, and how it exited (ADR 0013). The pipeline already
 * keeps secrets out of what it writes; every line is also checked against the job's own secrets
 * here, so a slip on that side still never reaches the disk.
 */

export const keptLogs = 40;

const shortestSecret = 6;

export interface PipelineLog {
  write(kind: string, text: string): void;
  close(): void;
}

/** The job's secrets as text that could turn up in a log: the key, each URL, and its login. */
export function secretsOf(start: Pick<Start, "secrets">): string[] {
  const { youtubeKey, proxyUrls, gatewayUrls } = start.secrets;
  const found: string[] = youtubeKey === null ? [] : [youtubeKey];
  for (const raw of [...proxyUrls, ...gatewayUrls]) {
    found.push(raw);
    try {
      const url = new URL(raw);
      found.push(raw.slice(url.protocol.length + 2));
      found.push(decodeURIComponent(url.username), decodeURIComponent(url.password));
    } catch {
      // Not a URL: the whole text is already on the list.
    }
  }
  return found;
}

/** Blanks every secret in text, longest first so a URL goes before the login inside it. */
export function redact(text: string, secrets: readonly string[]): string {
  const usable = secrets.filter((s) => s.length >= shortestSecret);
  usable.sort((a, b) => b.length - a.length);
  let out = text;
  for (const secret of usable) {
    out = out.split(secret).join("[secret]");
  }
  return out;
}

function stamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[:.]/g, "-");
}

/** Opens a new log in folder, keeping the newest `keptLogs` with it. */
export function openPipelineLog(o: {
  folder: string;
  now: () => number;
  secrets: readonly string[];
}): PipelineLog {
  mkdirSync(o.folder, { recursive: true });
  const name = `pipeline-${stamp(o.now())}.log`;
  const older = readdirSync(o.folder)
    .filter((n) => /^pipeline-.+\.log$/.test(n) && n !== name)
    .sort();
  for (const old of older.slice(0, Math.max(0, older.length - (keptLogs - 1)))) {
    rmSync(join(o.folder, old), { force: true });
  }
  let fd: number | null = openSync(join(o.folder, name), "a");

  return {
    write(kind, text) {
      if (fd === null) {
        return;
      }
      const at = new Date(o.now()).toISOString();
      const lines = redact(text, o.secrets).split(/\r?\n/);
      if (lines.at(-1) === "") {
        lines.pop();
      }
      writeSync(fd, lines.map((line) => `${at} ${kind} ${line}\n`).join(""));
    },
    close() {
      if (fd !== null) {
        closeSync(fd);
        fd = null;
      }
    },
  };
}
