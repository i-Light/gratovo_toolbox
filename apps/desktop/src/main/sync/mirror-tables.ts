/**
 * The four tables the keyset pull mirrors (D3). `columns` are the server columns the pull
 * selects, all of which also exist locally (a test checks them against the SQL migrations);
 * local-only columns (`activity_log.at_ms`) are never selected. Timestamps stay as the server's
 * text. jsonb and array columns are stored as JSON text.
 */

import type { DatabaseSync, SQLInputValue, StatementSync } from "node:sqlite";

import type { FramePart } from "@gratovo/ipc";

import { serverTimeMs } from "./server-time";

export interface MirrorTable {
  readonly name: "channel_state" | "brands" | "deals" | "activity_log";
  readonly columns: readonly string[];
  readonly cursor: string;
  readonly key: string;
  readonly jsonColumns: readonly string[];
  readonly part: FramePart;
}

export const mirrorTables: readonly MirrorTable[] = [
  {
    name: "channel_state",
    columns: [
      "channel_id",
      "handle",
      "vetting_status",
      "relevance_criteria",
      "notes",
      "pipeline_stage",
      "channel_tags",
      "contacts",
      "provided_data",
      "archive_due_at",
      "last_deal_at",
      "last_edited_by",
      "last_edited_by_name",
      "updated_at",
      "owner_id",
      "manual_engagement_rate",
      "manual_engagement_note",
      "manual_engagement_updated_at",
      "media_kit",
      "creator_gender",
      "creator_stage",
    ],
    cursor: "updated_at",
    key: "channel_id",
    jsonColumns: ["relevance_criteria", "channel_tags", "contacts", "provided_data", "media_kit"],
    part: "creators",
  },
  {
    name: "brands",
    columns: [
      "id",
      "name",
      "contact_name",
      "contact_email",
      "contact_phone",
      "website",
      "budget",
      "campaign_brief",
      "preferred_criteria",
      "notes",
      "created_at",
      "updated_at",
      "category",
      "country",
      "contacts",
      "budget_currency",
      "source",
      "sells",
      "status",
    ],
    cursor: "updated_at",
    key: "id",
    jsonColumns: ["preferred_criteria", "contacts"],
    part: "brands",
  },
  {
    name: "deals",
    columns: [
      "id",
      "brand_id",
      "channel_id",
      "stage",
      "brand_price",
      "influencer_payout",
      "deliverables",
      "deadline",
      "contract_url",
      "notes",
      "working_days_estimate",
      "created_at",
      "updated_at",
      "campaign_id",
      "owner_id",
      "currency",
      "brand_invoice_sent_at",
      "brand_invoice_paid_at",
      "creator_payout_due_at",
      "creator_payout_paid_at",
      "payment_method",
      "payment_reference",
      "payment_terms",
      "tracking_link",
      "creator_contract_url",
      "creator_contract_status",
      "creator_signed_at",
      "brand_contract_url",
      "brand_contract_status",
      "brand_signed_at",
      "flow_step",
    ],
    cursor: "updated_at",
    key: "id",
    jsonColumns: [],
    part: "deals",
  },
  {
    name: "activity_log",
    columns: [
      "id",
      "at",
      "actor_id",
      "actor_name",
      "actor_role",
      "action",
      "entity_type",
      "entity_id",
      "entity_label",
      "field",
      "old_value",
      "new_value",
      "detail",
      "received_at",
    ],
    cursor: "received_at",
    key: "id",
    jsonColumns: ["detail"],
    part: "log",
  },
];

/** The columns a row is written with: the pulled ones, plus the local `at_ms` of a log line. */
function writeColumns(t: MirrorTable): readonly string[] {
  return t.name === "activity_log" ? [...t.columns, "at_ms"] : t.columns;
}

function toValue(value: unknown, json: boolean): SQLInputValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (json) {
    return JSON.stringify(value);
  }
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  return JSON.stringify(value);
}

/** A server row as a local row, or null when it has no text key. */
export function toLocalRow(t: MirrorTable, remote: unknown): Record<string, SQLInputValue> | null {
  if (typeof remote !== "object" || remote === null || Array.isArray(remote)) {
    return null;
  }
  const source = remote as Readonly<Record<string, unknown>>;
  const key = source[t.key];
  if (typeof key !== "string" || key === "") {
    return null;
  }
  const row: Record<string, SQLInputValue> = {};
  for (const column of t.columns) {
    row[column] = toValue(source[column], t.jsonColumns.includes(column));
  }
  if (t.name === "activity_log") {
    row["at_ms"] = typeof row["at"] === "string" ? serverTimeMs(row["at"]) : null;
  }
  return row;
}

const statements = new WeakMap<DatabaseSync, Map<string, StatementSync>>();

function statementFor(db: DatabaseSync, t: MirrorTable): StatementSync {
  let byTable = statements.get(db);
  if (byTable === undefined) {
    byTable = new Map();
    statements.set(db, byTable);
  }
  let statement = byTable.get(t.name);
  if (statement === undefined) {
    const columns = writeColumns(t);
    // Not INSERT OR REPLACE: that deletes the row first, which changes its rowid (the frame's
    // order) and drops local-only columns.
    statement = db.prepare(
      `INSERT INTO ${t.name} (${columns.join(", ")})
       VALUES (${columns.map(() => "?").join(", ")})
       ON CONFLICT (${t.key}) DO UPDATE SET ${columns
         .filter((c) => c !== t.key)
         .map((c) => `${c} = excluded.${c}`)
         .join(", ")}`,
    );
    byTable.set(t.name, statement);
  }
  return statement;
}

/** Adds the row or updates the one with the same key, over every pulled column. */
export function upsertRow(
  db: DatabaseSync,
  t: MirrorTable,
  row: Record<string, SQLInputValue>,
): void {
  statementFor(db, t).run(...writeColumns(t).map((c) => row[c] ?? null));
}
