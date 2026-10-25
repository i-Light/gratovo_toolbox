import type { Creator, ReachData } from "@gratovo/core/data";

import { adoptServerData } from "../lib/persist";

/** An AI creator, at Contact with a confirmed address; `over` changes any field. */
export function aiCreator(id: string, name: string, over: Partial<Creator> = {}): Creator {
  return {
    id,
    name,
    handle: `@${name.toLowerCase().replace(/\s+/g, "")}`,
    stage: "contact",
    email: `hello@${name.toLowerCase().replace(/\s+/g, "")}.example`,
    emailConfirmed: true,
    contactName: null,
    contactSource: null,
    contactConfidence: null,
    rejectReason: null,
    rejectedAt: null,
    neverReason: null,
    archiveDueAt: null,
    ...over,
  };
}

/** Puts these creators and this Reach in the store as saved (server) data, on live or example data. */
export function seedReach(
  creators: readonly Creator[],
  reach: ReachData,
  source: "example" | "live" = "example",
): void {
  adoptServerData((d) => {
    d.creators = creators as typeof d.creators;
    d.reach = reach as typeof d.reach;
    d.source = source;
  });
}
