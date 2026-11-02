import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { forgetPipelineFacts, readPipelineFacts } from "./pipeline-facts";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "routes-facts-"));
  forgetPipelineFacts();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeDb(name: string, withRoutes: boolean): string {
  const path = join(dir, name);
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE runs (run_id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'search');
    INSERT INTO runs (started_at) VALUES ('2026-10-01T08:00:00Z'), ('2026-10-20T08:00:00Z');`);
  if (withRoutes) {
    db.exec(`CREATE TABLE run_routes (run_id INTEGER, kind TEXT, label TEXT, requests INTEGER,
      successes INTEGER, blocks INTEGER, connection_failures INTEGER, bytes INTEGER,
      keywords_finished INTEGER, channels_found INTEGER, in_range_found INTEGER,
      seconds_used REAL, seconds_resting REAL, PRIMARY KEY (run_id, kind, label));
      INSERT INTO run_routes VALUES (1,'aws','us-east-1',100,95,5,0,5000000,2,10,6,50.5,0),
        (2,'free','203.0.113.9',40,20,15,5,2000000,0,3,1,20,300),
        (2,'odd','x',1,1,0,0,0,0,0,0,0,0);`);
  }
  db.close();
  return path;
}

describe("readPipelineFacts routes", () => {
  it("is null when the file has no run_routes table", () => {
    expect(readPipelineFacts(makeDb("none.db", false)).routes).toBeNull();
  });

  it("is null for a missing file", () => {
    expect(readPipelineFacts(join(dir, "missing.db")).routes).toBeNull();
  });

  it("reads each row with its run's start, and skips an unknown kind", () => {
    const routes = readPipelineFacts(makeDb("full.db", true)).routes;
    expect(routes).toHaveLength(2);
    expect(routes?.[0]).toEqual({
      runStartedAt: Date.UTC(2026, 9, 1, 8),
      kind: "aws",
      label: "us-east-1",
      requests: 100,
      successes: 95,
      blocks: 5,
      connectionFailures: 0,
      bytes: 5_000_000,
      keywordsFinished: 2,
      channelsFound: 10,
      inRangeFound: 6,
      secondsUsed: 50.5,
      secondsResting: 0,
    });
    expect(routes?.[1]).toMatchObject({ kind: "free", label: "203.0.113.9", secondsResting: 300 });
  });

  it("is empty, not null, for an empty table", () => {
    const path = makeDb("empty.db", true);
    const db = new DatabaseSync(path);
    db.exec("DELETE FROM run_routes");
    db.close();
    expect(readPipelineFacts(path).routes).toEqual([]);
  });
});
