import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * The reply situations of the course's playbook (plan step 6d, D23): the 47 kinds of reply the
 * engine reads, 20 for a creator, 22 for a brand and 5 for either. Main reads `situations.json`
 * from the pipeline's playbook folder once and keeps it; the picker of "That's not it" and the
 * reading's label come from here. A file that is missing or does not fit gives an empty list and
 * a log line with no content.
 */

export type SituationSide = "influencer" | "brand" | "any";

export interface Situation {
  readonly id: string;
  readonly label: string;
  readonly side: SituationSide;
}

export interface Situations {
  /** Every reply situation, creator ones first. Empty when the file can't be read. */
  list(): Promise<readonly Situation[]>;
  /** The label of a situation id, or null when it is not in the list. */
  labelOf(id: string): Promise<string | null>;
}

const sides: readonly SituationSide[] = ["influencer", "brand", "any"];
const idPattern = /^[a-z]+\.[a-z0-9_]+$/;
const maxFileChars = 2_000_000;

/**
 * The playbook's `situations.json` when unpackaged (`appPath` is `apps/desktop`, as for the writing
 * rules); null when packaged, until the build ships it (step T5), or when the file is missing.
 */
export function situationsFile(o: {
  packaged: boolean;
  appPath: string;
  exists: (path: string) => boolean;
}): string | null {
  if (o.packaged) {
    return null;
  }
  const file = resolve(
    o.appPath,
    "..",
    "..",
    "services",
    "pipeline",
    "data",
    "comms",
    "playbook",
    "situations.json",
  );
  return o.exists(file) ? file : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The reply situations in a parsed `situations.json`; one that doesn't fit is left out. */
export function parseSituations(json: unknown): Situation[] {
  const replies = isRecord(json) ? json["replies"] : undefined;
  if (!isRecord(replies)) {
    return [];
  }
  const list: Situation[] = [];
  const seen = new Set<string>();
  for (const side of sides) {
    const items = replies[side];
    for (const item of Array.isArray(items) ? (items as unknown[]) : []) {
      if (
        !isRecord(item) ||
        typeof item["id"] !== "string" ||
        typeof item["label"] !== "string" ||
        !idPattern.test(item["id"]) ||
        item["id"].length > 80 ||
        item["label"].trim() === "" ||
        seen.has(item["id"])
      ) {
        continue;
      }
      seen.add(item["id"]);
      list.push({ id: item["id"], label: item["label"].trim().slice(0, 300), side });
    }
  }
  return list;
}

export function createSituations(o: {
  file: string | null;
  log?: (line: string) => void;
}): Situations {
  const log =
    o.log ??
    ((line: string) => {
      console.error(line);
    });
  let loaded: Promise<readonly Situation[]> | null = null;

  async function load(): Promise<readonly Situation[]> {
    if (o.file === null) {
      return [];
    }
    try {
      const text = await readFile(o.file, "utf8");
      if (text.length > maxFileChars) {
        throw new Error("too big");
      }
      const list = parseSituations(JSON.parse(text));
      if (list.length === 0) {
        log("Reach: the situations file has no reply situations.");
      }
      return list;
    } catch {
      log("Reach: the situations file couldn't be read.");
      return [];
    }
  }

  return {
    async list() {
      loaded ??= load();
      const list = await loaded;
      // An empty answer is not kept: a file put in place later is read on the next ask.
      if (list.length === 0) {
        loaded = null;
      }
      return list;
    },
    async labelOf(id) {
      return (await this.list()).find((situation) => situation.id === id)?.label ?? null;
    },
  };
}
