/**
 * What main's Insights services read and write in the open source's local tables (plan step P8a,
 * decisions A5 and A6). The page never sees this: it reads `insights:read`. Every method is
 * synchronous (node:sqlite), as the source's own.
 */
export interface InsightsStore {
  /**
   * Upserts this week's live, waiting and archive totals (`catalog_weeks`), counted from
   * `pipeline.db` at `pipelineDbPath` and the creator stages. False when `pipeline.db` can't be
   * read: a week is never recorded as zero for want of data.
   */
  recordCatalogWeek(pipelineDbPath: string, now: number): boolean;
}
