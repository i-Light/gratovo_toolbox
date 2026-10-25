import type { DataSource } from "@gratovo/core/data";
import { z } from "zod";

/**
 * The `reach.mailboxes` local setting of the open source (plan step 6b, D20): for each sending
 * mailbox (its address in lower case) whether the owner paused it and whether the slowdown rule
 * has slowed it. Not synced. A bad value reads as "not paused, not slowed", so a bad row never
 * stops a send.
 */
export interface MailboxFlags {
  readonly paused: boolean;
  readonly slowed: boolean;
}

export const settingName = "reach.mailboxes";

const flagsSchema = z.object({
  paused: z.boolean().catch(false).default(false),
  slowed: z.boolean().catch(false).default(false),
});

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
    flags.set(mailboxKey(address), parsed.success ? parsed.data : noFlags);
  }
  return flags;
}

/** Stores the flags of one mailbox and leaves the others as they are. */
export function writeMailboxFlags(source: DataSource, address: string, flags: MailboxFlags): void {
  const all = readMailboxFlags(source);
  all.set(mailboxKey(address), flags);
  source.writeSetting(settingName, Object.fromEntries(all));
}
