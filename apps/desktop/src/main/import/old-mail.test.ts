import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { copyOldMailbox, readOldEmails } from "./old-mail";

let root: string;
let oldDir: string;
let dataDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gratovo-old-mail-"));
  oldDir = join(root, "old");
  dataDir = join(root, "pipeline");
  mkdirSync(oldDir);
  mkdirSync(dataDir);
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
    const messages = readOldEmails(oldDatabase());
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
  });

  it("reads nothing from an old database without the outreach tables", () => {
    const file = join(oldDir, "gratovo.db");
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE channels (channel_id TEXT)");
    db.close();
    expect(readOldEmails(file)).toEqual([]);
  });
});

describe("copyOldMailbox", () => {
  function oldMailbox(): void {
    const db = new DatabaseSync(join(oldDir, "mailbox.db"));
    db.exec("CREATE TABLE inbound_messages (gmail_message_id TEXT PRIMARY KEY)");
    db.exec("INSERT INTO inbound_messages VALUES ('g1')");
    db.close();
  }

  it("copies the old mailbox.db when the pipeline has none, and leaves no temporary file", () => {
    oldMailbox();
    expect(copyOldMailbox(oldDir, dataDir)).toBe("copied");
    const db = new DatabaseSync(join(dataDir, "mailbox.db"), { readOnly: true });
    expect(db.prepare("SELECT gmail_message_id AS id FROM inbound_messages").all()).toEqual([
      { id: "g1" },
    ]);
    db.close();
    expect(readdirSync(dataDir)).toEqual(["mailbox.db"]);
  });

  it("keeps a mailbox.db the pipeline has already", () => {
    oldMailbox();
    writeFileSync(join(dataDir, "mailbox.db"), "in use");
    expect(copyOldMailbox(oldDir, dataDir)).toBe("kept");
  });

  it("does nothing when the old app had no mailbox.db", () => {
    expect(copyOldMailbox(oldDir, dataDir)).toBe("none");
    expect(existsSync(join(dataDir, "mailbox.db"))).toBe(false);
  });
});
