import { openRecord, peek } from "../lib/actions";
import type { RecordRef } from "../lib/routes";

/** Opens a record the way the one it is opened from is shown: beside it in the peek, or on its page. */
export function openFrom(layout: "peek" | "page", ref: RecordRef): void {
  if (layout === "peek") {
    peek({ kind: ref.kind, id: ref.id });
  } else {
    openRecord({ kind: ref.kind, id: ref.id });
  }
}
