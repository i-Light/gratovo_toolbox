import type { DataSource } from "@gratovo/core/data";
import { z } from "zod";

/**
 * The `reach.mailboxes` local setting of the open source (plan step 6b, D20): for each sending
 * mailbox (its address in lower case) whether the owner paused it and whether the slowdown rule
 * has slowed it. Not synced. A missing entry or field reads as "not paused, not slowed". A
 * damaged one reads as paused: the owner may have paused it, and Resume is one click (review of
 * 6b), while a damaged setting as a whole reads as empty.
 */
export interface MailboxFlags {
  readonly paused: boolean;
  readonly slowed: boolean;
}

export const settingName = "reach.mailboxes";

const flagsSchema = z.object({
  paused: z.boolean().catch(true).default(false),
  slowed: z.boolean().catch(false).default(false),
});

/** An entry that is not an object at all. */
const damaged: MailboxFlags = { paused: true, slowed: false };

export const mailboxKey = (address: string): string => address.trim().toLowerCase();

export const noFlags: MailboxFlags = { paused: false, slowed: false };

/** Every mailbox's flags by address in lower case; one bad entry reads as the defaults. */
export function readMailboxFlags(source: DataSource | null): Map<string, MailboxFlags> {
  const flags = new Map<string, MailboxFlags>();
  const raw = source?.readSetting(settingName);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return flags;
  }
  for (const [address, value] of Object.entries(raw)) {
    const parsed = flagsSchema.safeParse(value);
    flags.set(mailboxKey(address), parsed.success ? parsed.data : damaged);
  }
  return flags;
}

/** Stores the flags of one mailbox and leaves the others as they are. */
export function writeMailboxFlags(source: DataSource, address: string, flags: MailboxFlags): void {
  const all = readMailboxFlags(source);
  all.set(mailboxKey(address), flags);
  source.writeSetting(settingName, Object.fromEntries(all));
}

/** Drops a removed mailbox's flags, so adding it again starts fresh. */
export function forgetMailboxFlags(source: DataSource, address: string): void {
  const all = readMailboxFlags(source);
  if (all.delete(mailboxKey(address))) {
    source.writeSetting(settingName, Object.fromEntries(all));
  }
}
