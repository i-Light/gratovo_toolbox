import { keywordKey } from "../find/keyword-lists";

/**
 * The example history's generated keywords (S6-j): 12 AI tools crossed with 6 angles, 72 done
 * keywords whose in-range numbers differ by tool and by angle (Claude Code and MCP find the most,
 * ChatGPT and pricing the least), so the Insights yield panel has something to rank. Each keyword's
 * tool and angle are in `exampleKeywordOrigins`, keyed by `keywordKey`, as `keywords.json` holds them.
 */

export interface HistoryYieldKeyword {
  keyword: string;
  status: "done";
  channels_found: number;
  new_found: number;
  in_range_found: number;
  added_at: string;
  completed_at: string;
}

const DAY = 86_400_000;

/** In-range channels a keyword of the tool finds, on average. */
const tools: readonly (readonly [string, number])[] = [
  ["claude code", 1.9],
  ["mcp", 1.7],
  ["cursor", 1.4],
  ["n8n", 1.25],
  ["perplexity", 1.1],
  ["gemini", 1],
  ["notion ai", 0.9],
  ["midjourney", 0.85],
  ["elevenlabs", 0.75],
  ["runway", 0.7],
  ["copilot", 0.6],
  ["chatgpt", 0.45],
];

/** The same for an angle. */
const angles: readonly (readonly [string, number])[] = [
  ["tutorial", 1.5],
  ["automation", 1.3],
  ["hacks", 1.05],
  ["review", 0.9],
  ["alternatives", 0.7],
  ["pricing", 0.45],
];

const keywordOf = (tool: string, angle: string): string => `${tool} ${angle}`;

export const exampleKeywordOrigins: Readonly<
  Record<string, { readonly tool: string; readonly angle: string }>
> = Object.fromEntries(
  tools.flatMap(([tool]) =>
    angles.map(([angle]) => [keywordKey(keywordOf(tool, angle)), { tool, angle }] as const),
  ),
);

/** The 72 done keywords, finished over the 28 days before `now`. */
export function exampleYieldKeywords(
  now: number,
  iso: (t: number) => string,
): HistoryYieldKeyword[] {
  const out: HistoryYieldKeyword[] = [];
  let i = 0;
  for (const [tool, toolFactor] of tools) {
    for (const [angle, angleFactor] of angles) {
      // A small fixed wobble so no two rows tie.
      const wobble = 0.85 + ((i * 7) % 11) / 33;
      const inRange = Math.max(0, Math.round(4 * toolFactor * angleFactor * wobble));
      const newFound = inRange + 6 + ((i * 5) % 9) + Math.round(8 * toolFactor);
      const done = now - (1 + ((i * 11) % 27)) * DAY - ((i * 7) % 20) * 3_600_000;
      out.push({
        keyword: keywordOf(tool, angle),
        status: "done",
        channels_found: newFound + 4 + ((i * 3) % 7),
        new_found: newFound,
        in_range_found: inRange,
        added_at: iso(done - 6 * 3_600_000),
        completed_at: iso(done),
      });
      i += 1;
    }
  }
  return out;
}
