import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { oldMessagesMax, readOldEmails } from "./old-mail";

let root: string;
let oldDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gratovo-old-mail-"));
  oldDir = join(root, "old data");
  mkdirSync(oldDir);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** An old gratovo.db with the mirror tables the old app kept (legacy mirror_schema.dart). */
function oldDatabase(): string {
  const file = join(oldDir, "gratovo.db");
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE outreach_threads (
      id TEXT PRIMARY KEY, channel_id TEXT, deal_id TEXT, status TEXT,
      updated_at TEXT, owner_id TEXT, brand_id TEXT, contact_email TEXT
    );
    CREATE TABLE outreach_messages (
      id TEXT PRIMARY KEY, thread_id TEXT, direction TEXT, method TEXT,
      subject TEXT, body TEXT, peer_email TEXT, at TEXT,
      is_ai_drafted INTEGER, template_id TEXT, updated_at TEXT, classification TEXT
    );
    INSERT INTO outreach_threads (id, channel_id) VALUES ('t1', 'UCagent'), ('t2', NULL);
    INSERT INTO outreach_messages (id, thread_id, direction, method, subject, body, peer_email, at)
    VALUES
      ('m2', 't1', 'inbound', 'email', 'Re: AI tools', 'Sounds good, what is the brand?',
        'noor@agentlab.test', '2025-03-02T10:00:00.000Z'),
      ('m1', 't1', 'outbound', 'email', 'AI tools', 'Hi Noor, loved your agents video.',
        'noor@agentlab.test', '2025-03-01T10:00:00.000Z'),
      ('m3', 't1', 'outbound', 'instagram', '', 'A DM', NULL, '2025-03-03T10:00:00.000Z'),
      ('m4', 't2', 'outbound', 'email', 'No creator', 'x', NULL, '2025-03-04T10:00:00.000Z'),
      ('m5', 't1', 'outbound', 'email', 'Bad time', 'x', NULL, 'not a time');
  `);
  db.close();
  return file;
}

describe("readOldEmails", () => {
  it("reads the old email log oldest first, leaving out DMs, rows with no creator and bad times", () => {
    const file = oldDatabase();
    const before = readFileSync(file);
    const { messages, capped } = readOldEmails(file);
    expect(capped).toBe(false);
    expect(messages.map((m) => [m.id, m.creator, m.direction, m.source])).toEqual([
      ["imported-m1", "UCagent", "out", "imported"],
      ["imported-m2", "UCagent", "in", "imported"],
    ]);
    expect(messages[1]).toMatchObject({
      subject: "Re: AI tools",
      body: "Sounds good, what is the brand?",
      peer: "noor@agentlab.test",
      at: Date.parse("2025-03-02T10:00:00.000Z"),
      mailbox: null,
      reading: null,
    });
    // Opened immutable: the old file is unchanged and nothing is written beside it.
    expect(readFileSync(file).equals(before)).toBe(true);
    expect(readdirSync(oldDir)).toEqual(["gratovo.db"]);
  });

  it("reads nothing from an old database without the outreach tables", () => {
    const file = join(oldDir, "gratovo.db");
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE channels (channel_id TEXT)");
    db.close();
    expect(readOldEmails(file)).toEqual({ messages: [], capped: false });
  });
});

describe("readOldEmails, its limits (review of 6e)", () => {
  it("cuts a long subject and address, skips ids and creators the frame can't take", () => {
    const file = oldDatabase();
    const db = new DatabaseSync(file);
    db.prepare(
      `INSERT INTO outreach_threads (id, channel_id) VALUES ('t3', ?), ('t4', 'UCagent')`,
    ).run("x".repeat(65));
    db.prepare(
      `INSERT INTO outreach_messages (id, thread_id, direction, method, subject, body, peer_email, at)
       VALUES ('m6', 't4', 'outbound', 'email', ?, 'Hi', ?, '2025-03-05T10:00:00.000Z'),
              (?, 't4', 'outbound', 'email', 'Long id', 'x', NULL, '2025-03-06T10:00:00.000Z'),
              ('m8', 't3', 'outbound', 'email', 'Long creator', 'x', NULL, '2025-03-07T10:00:00.000Z')`,
    ).run("s".repeat(1200), `${"p".repeat(400)}@ai.test`, "i".repeat(92));
    db.close();
    const { messages } = readOldEmails(file);
    expect(messages.map((m) => m.id)).toEqual(["imported-m1", "imported-m2", "imported-m6"]);
    expect(messages[2]?.subject).toHaveLength(998);
    expect(messages[2]?.peer).toHaveLength(320);
  });

  it(`keeps the newest ${String(oldMessagesMax)} when the log is longer, and says so`, () => {
    const file = oldDatabase();
    const db = new DatabaseSync(file);
    // A row whose time isn't one sorts as text among the newest; this test counts only good rows.
    db.exec("DELETE FROM outreach_messages WHERE id = 'm5'");
    const insert = db.prepare(
      `INSERT INTO outreach_messages (id, thread_id, direction, method, subject, body, at)
       VALUES (?, 't1', 'outbound', 'email', 'AI tools', 'Hi', ?)`,
    );
    db.exec("BEGIN");
    for (let i = 0; i < oldMessagesMax; i += 1) {
      insert.run(
        `n${String(i).padStart(6, "0")}`,
        new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(),
      );
    }
    db.exec("COMMIT");
    db.close();
    const { messages, capped } = readOldEmails(file);
    expect(capped).toBe(true);
    expect(messages).toHaveLength(oldMessagesMax);
    // The oldest (m1, m2 in 2025) are the ones left out; oldest first in what is kept.
    expect(messages[0]?.id).toBe("imported-n000000");
    expect(messages.at(-1)?.id).toBe(`imported-n${String(oldMessagesMax - 1).padStart(6, "0")}`);
  });
});
