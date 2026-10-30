import type { Brand, Creator, Deal } from "../../lib/store";

import { strings } from "../../strings";

/** What the words need to name a brand, a creator or a deal, and the time "ago" is counted from. */
export interface Names {
  readonly brand: (id: string) => string;
  readonly creator: (id: string) => string;
  /** "Brand × Creator". */
  readonly deal: (id: string) => string;
  /** The brand and the creator of a deal. */
  readonly dealBrand: (id: string) => string;
  readonly dealCreator: (id: string) => string;
  /** Whether the frame has the record. */
  readonly known: (kind: "brand" | "creator" | "deal", id: string) => boolean;
  readonly now: number;
}

const t = strings.insights.money.names;

/** Names built from the frame's brands, creators and deals. An unknown id reads as a plain noun. */
export function namesFrom(
  data: {
    readonly brands: readonly Brand[];
    readonly creators: readonly Creator[];
    readonly deals: readonly Deal[];
  },
  now: number,
  /** Names the report itself carries (id to name); they come before the frame's. */
  reportNames: Readonly<Record<string, string>> = {},
): Names {
  const brands = new Map(data.brands.map((b) => [b.id, b.name]));
  const creators = new Map(data.creators.map((c) => [c.id, c.name]));
  for (const [id, name] of Object.entries(reportNames)) {
    // An id is a brand's or a creator's, never both: the report's name goes on whichever holds it.
    if (brands.has(id)) brands.set(id, name);
    else if (creators.has(id)) creators.set(id, name);
    else {
      brands.set(id, name);
      creators.set(id, name);
    }
  }
  const deals = new Map(data.deals.map((d) => [d.id, d]));
  const brand = (id: string): string => brands.get(id) ?? t.brand;
  const creator = (id: string): string => creators.get(id) ?? t.creator;
  return {
    brand,
    creator,
    dealBrand: (id) => {
      const d = deals.get(id);
      return d === undefined ? t.brand : brand(d.brand);
    },
    dealCreator: (id) => {
      const d = deals.get(id);
      return d === undefined ? t.creator : creator(d.creator);
    },
    deal: (id) => {
      const d = deals.get(id);
      return d === undefined ? t.deal : t.dealOf(brand(d.brand), creator(d.creator));
    },
    known: (kind, id) =>
      kind === "brand" ? brands.has(id) : kind === "creator" ? creators.has(id) : deals.has(id),
    now,
  };
}

/** Names for a place with no frame (tests, an empty frame). */
export const noNames: Names = namesFrom({ brands: [], creators: [], deals: [] }, 0);
