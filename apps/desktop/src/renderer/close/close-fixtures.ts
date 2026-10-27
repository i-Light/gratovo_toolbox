import type { Creator, CreatorKit } from "@gratovo/core/data";

import { adoptServerData } from "../lib/persist";
import { aiCreator } from "../reach/reach-fixtures";

/** A kit that passes all four checks; `over` changes any field. */
export function passingKit(over: Partial<CreatorKit> = {}): CreatorKit {
  return {
    countries: [
      { code: "US", share: 52 },
      { code: "GB", share: 14 },
      { code: "CA", share: 9 },
    ],
    ageBand: "25-34",
    engagement: 4.6,
    rate: 3400,
    link: "https://example.com/kit",
    fromReply: false,
    ...over,
  };
}

/** Puts these creators in the store as saved data; `seesMoney` says whether the viewer sees rates. */
export function seedCreators(creators: readonly Creator[], seesMoney = true): void {
  adoptServerData((d) => {
    d.creators = creators as typeof d.creators;
    d.seesMoney = seesMoney;
  });
}

export const kitCreator = (kit: CreatorKit | null, stage: Creator["stage"] = "kit"): Creator =>
  aiCreator("c1", "Prompt Lab", { stage, kit });
