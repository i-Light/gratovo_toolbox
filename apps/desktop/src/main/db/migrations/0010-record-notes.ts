import type { Migration } from "../migrate";

// Plan step P2 (R7): notes on a brand and on a deal, typed on the record. Local only: there is no
// Supabase column for them yet, and the sync's lists (`mirror-tables.ts`, `whole-tables.ts`) don't
// name these columns. The reader prefers this note and falls back to the synced `brands.notes` /
// `deals.notes`. Null is "no local note yet" (the synced one shows); a written empty note clears
// the text and is kept as an empty string so the synced one does not come back.
const sql = `
ALTER TABLE brand_details ADD COLUMN notes TEXT;
ALTER TABLE deal_details ADD COLUMN notes TEXT;
`;

export const recordNotes: Migration = { version: 10, name: "record-notes", sql };
