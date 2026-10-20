/**
 * The live source's writes that must reach the server first (plan G8). Only `me.name` does in
 * 3d-2a: the name is sent to `profiles` (the member's own row, which `profiles_self_update`
 * allows), then saved locally, so the next team refresh doesn't undo it. Offline or refused, the
 * whole batch fails and nothing is saved, and the page shows "Not saved". Everything else stays
 * local until 3d-2b's sync.
 */

import { nameMax, type DataSource } from "@gratovo/core/data";

export function withServerWrites(
  source: DataSource,
  o: {
    /** Sets the member's own `display_name` on the server. Throws when it isn't saved there. */
    sendName: (name: string) => Promise<void>;
  },
): DataSource {
  return {
    frame: () => source.frame(),
    async write(writes) {
      let name: string | null = null;
      for (const write of writes) {
        if (write.kind === "me.name") {
          // The same cleaning the local write applies, so both copies agree.
          name = write.name.trim().slice(0, nameMax);
        }
      }
      if (name !== null) {
        await o.sendName(name);
      }
      await source.write(writes);
    },
    close: () => {
      source.close();
    },
  };
}
