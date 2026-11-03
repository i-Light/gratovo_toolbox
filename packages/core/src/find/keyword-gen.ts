import { keywordKey } from "./keyword-lists";

export const keywordMax = 200;

export interface CrossedKeyword {
  keyword: string;
  tool: string;
  angle: string;
}

/** Tools x angles in diagonal order, so a partial add covers every tool and angle early. */
export function crossKeywords(
  tools: readonly string[],
  angles: readonly string[],
): CrossedKeyword[] {
  const out: CrossedKeyword[] = [];
  const seen = new Set<string>();
  const a = angles.length;
  for (let r = 0; r < a; r += 1) {
    for (let t = 0; t < tools.length; t += 1) {
      const tool = tools[t] as string;
      const angle = angles[(t + r) % a] as string;
      const text = angle.includes("{tool}") ? angle.split("{tool}").join(tool) : `${tool} ${angle}`;
      const keyword = keywordKey(text).slice(0, keywordMax).trim();
      const key = keywordKey(keyword);
      if (key === "" || seen.has(key)) continue;
      seen.add(key);
      out.push({ keyword, tool, angle });
    }
  }
  return out;
}
