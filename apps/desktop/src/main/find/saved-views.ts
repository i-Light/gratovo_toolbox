import type { DataSource } from "@gratovo/core/data";
import { savedViewsMax, type SavedView } from "@gratovo/core/find";
import { savedViewSchema, type ChannelResponse } from "@gratovo/ipc";

/**
 * The gallery's saved views (plan step 5, D16 and D20): kept per data source in its
 * `local_settings`, so example data and the live account each have their own.
 */

/** The `local_settings` key the views live under. */
export const viewsKey = "find.views";

/**
 * The stored views. Each is read on its own, so one that no longer parses (an older filter shape,
 * a hand edit) is dropped and the others are kept; a value that isn't a list reads as none. The
 * stored value stays as it is until the next save replaces it.
 */
export function readViews(source: DataSource): SavedView[] {
  const stored: unknown = source.readSetting(viewsKey);
  if (!Array.isArray(stored)) {
    return [];
  }
  const views: SavedView[] = [];
  for (const item of stored) {
    const parsed = savedViewSchema.safeParse(item);
    if (parsed.success) {
      views.push(parsed.data);
    }
  }
  // The answer holds at most `savedViewsMax`; a longer list (a hand edit) keeps the first.
  return views.slice(0, savedViewsMax);
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
