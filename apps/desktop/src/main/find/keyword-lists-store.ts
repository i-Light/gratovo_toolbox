import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { defaultAngles, defaultTools } from "@gratovo/core/find";
import { z } from "zod";

/**
 * The generator's tools and angles and where each queued keyword came from (plan S6, K3, K4):
 * `keywords.json` beside `find.json`, written the same way. A missing or invalid file means the
 * core defaults. Removing a tool never touches the origins: the yield history stays.
 */

export const keywordListsFileName = "keywords.json";
export const originsMax = 50_000;

const term = z.string().min(1).max(60);
const fileSchema = z.strictObject({
  tools: z.array(term).max(500),
  angles: z.array(term).max(100),
  origins: z
    .record(z.string(), z.strictObject({ tool: term, angle: term }))
    .refine((o) => Object.keys(o).length <= originsMax),
});

export type KeywordLists = z.output<typeof fileSchema>;

export function defaultKeywordLists(): KeywordLists {
  return { tools: [...defaultTools], angles: [...defaultAngles], origins: {} };
}

/** Keeps an unreadable file as `keywords.json.bad` (an older one is replaced) so a later write
 * cannot destroy the saved origins. */
function keepBad(file: string): void {
  try {
    renameSync(file, `${file}.bad`);
  } catch {
    // Nothing more can be done; the defaults still apply.
  }
}

/** zod's record drops an own "__proto__" key; a keyword with that name must keep its origin. */
function restoreProtoOrigin(raw: unknown, data: KeywordLists): void {
  const origins = (raw as { origins?: object }).origins;
  if (origins === undefined || !Object.hasOwn(origins, "__proto__")) return;
  const checked = fileSchema.shape.origins.safeParse({
    x: Reflect.get(origins, "__proto__") as unknown,
  });
  const origin = checked.success ? checked.data["x"] : undefined;
  if (origin === undefined) return;
  Object.defineProperty(data.origins, "__proto__", {
    value: origin,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

export function readKeywordLists(folder: string): KeywordLists {
  const file = join(folder, keywordListsFileName);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return defaultKeywordLists();
  }
  try {
    const raw: unknown = JSON.parse(text);
    const parsed = fileSchema.safeParse(raw);
    if (parsed.success) {
      restoreProtoOrigin(raw, parsed.data);
      return parsed.data;
    }
  } catch {
    // Falls through to keeping the file.
  }
  keepBad(file);
  return defaultKeywordLists();
}

/** Writes to a temporary file, then renames it over the real one. */
export function writeKeywordLists(folder: string, value: KeywordLists): void {
  mkdirSync(folder, { recursive: true });
  const file = join(folder, keywordListsFileName);
  const temp = `${file}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, file);
}
