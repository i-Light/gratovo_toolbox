/** When a rejected channel is archived for good (plan step 5, D6 and D35). */

const dayMs = 86_400_000;

/** The server's trigger always sets the due date 7 days after the reject (D6). */
const serverArchiveDays = 7;

/**
 * In ms: the server's due date moved to the owner's `archiveDays`; with no due date (a reject the
 * tag trigger never saw), the reject time plus `archiveDays`; with neither, null. A null date is
 * never swept, since the old app never archived those either.
 */
export function archiveDate(
  c: { readonly archiveDueAt: number | null; readonly rejectedAt: number | null },
  archiveDays: number,
): number | null {
  if (c.archiveDueAt !== null) {
    return c.archiveDueAt + (archiveDays - serverArchiveDays) * dayMs;
  }
  if (c.rejectedAt !== null) {
    return c.rejectedAt + archiveDays * dayMs;
  }
  return null;
}
