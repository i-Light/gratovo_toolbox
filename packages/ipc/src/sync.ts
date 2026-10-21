import { z } from "zod";

/** Where the sync stands. `off` means there is no live source (unconfigured, signed out, waiting). */
export const syncStates = ["off", "syncing", "synced", "offline", "stuck"] as const;
export type SyncState = (typeof syncStates)[number];

export interface SyncStatus {
  readonly state: SyncState;
  /** Changes saved on this computer and not yet on the server. */
  readonly pending: number;
  /** Changes the server refused; they stay on this computer only. */
  readonly refused: number;
  /** When the last pass finished, in milliseconds, or null if none has. */
  readonly lastSyncedAt: number | null;
}

const count = z.number().int().min(0).max(1_000_000);

export const syncStatusSchema: z.ZodType<SyncStatus> = z.strictObject({
  state: z.enum(syncStates),
  pending: count,
  refused: count,
  lastSyncedAt: z.number().int().nonnegative().nullable(),
});
