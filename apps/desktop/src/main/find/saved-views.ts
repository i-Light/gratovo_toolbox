import type { DataSource } from "@gratovo/core/data";
import { savedViewsMax, type SavedView } from "@gratovo/core/find";
import { savedViewsSchema, type ChannelResponse } from "@gratovo/ipc";

/**
 * The gallery's saved views (plan step 5, D16 and D20): kept per data source in its
 * `local_settings`, so example data and the live account each have their own.
 */

/** The `local_settings` key the views live under. */
export const viewsKey = "find.views";

/**
 * The stored views. A value that isn't a list of views (an older shape, a hand edit) reads as
 * none, and stays as it is until the next save replaces it.
 */
export function readViews(source: DataSource): SavedView[] {
  const parsed = savedViewsSchema.safeParse(source.readSetting(viewsKey));
  return parsed.success ? parsed.data : [];
}

/** Replaces the stored views; more than `savedViewsMax` is refused and nothing is stored. */
export function writeViews(
  source: DataSource,
  views: readonly SavedView[],
): ChannelResponse<"find:views-set"> {
  if (views.length > savedViewsMax) {
    return { ok: false, problem: "too_many" };
  }
  source.writeSetting(viewsKey, views);
  return { ok: true };
}
