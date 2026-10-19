/** The ten colours an avatar can take, as the prototype has them. */
const palette = [
  "#2c6e9b",
  "#7b4fae",
  "#a3471f",
  "#1f7a5a",
  "#9a3b62",
  "#3d5aa8",
  "#86651a",
  "#2f7f86",
  "#6b5ca5",
  "#a8452e",
] as const;

/** A 32-bit FNV-1a hash of the text: the same text always gives the same number. */
export function hash(text: string): number {
  let x = 2166136261;
  for (let i = 0; i < text.length; i++) {
    x ^= text.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return x >>> 0;
}

/** Up to two capital letters for a name: first letters of the first two words, or the first two letters of one word. "?" when empty. */
export function initials(name: string): string {
  const words = name.replace(/^@/, "").split(/\s+/).filter(Boolean);
  const first = words[0] ?? "";
  const second = words[1];
  const letters = (first[0] ?? "?") + (second !== undefined ? (second[0] ?? "") : (first[1] ?? ""));
  return letters.toUpperCase();
}

/** A steady colour for a seed (a name or a handle), picked from the ten avatar colours. */
export function avatarColor(seed: string): string {
  return palette[hash(seed) % palette.length] ?? "#2c6e9b";
}
