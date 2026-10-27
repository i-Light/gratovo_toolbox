import type { Migration } from "../migrate";

// Step 8: a draft can carry a goal. `decline` is the kind no to a creator whose audience misses
// the brand's bar; `ask_kit` asks for the numbers the kit lacks. Null is every other draft.
const sql = `
ALTER TABLE outreach_drafts ADD COLUMN goal TEXT CHECK (goal IS NULL OR goal IN ('decline','ask_kit'));
`;

export const draftGoal: Migration = { version: 6, name: "draft-goal", sql };
