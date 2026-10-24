import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DataSource } from "@gratovo/core/data";
import type { ConnectionsStatus, GeminiStatus } from "@gratovo/ipc";
import { afterEach, beforeEach } from "vitest";

import { openExampleSource } from "../data/example-source";
import type { JobOutcome } from "../pipeline/jobs";
import type { ResultMessage, Start } from "../pipeline/protocol";
import type { SecretStore } from "../secret-store";

import {
  createConnectionsService,
  type ConnectionsDeps,
  type ConnectionsServiceFull,
} from "./connections-service";

/** Test-only: the connections service on an example source, a fake store and a fake quick lane. */

export const gemini: GeminiStatus = {
  state: "stopped",
  addon: { state: "missing", version: null },
  browser: null,
  problem: null,
};
export const keyId = "AKIAEXAMPLEKEY12345";
export const clientSecretText = "client-secret-value";
export const tokenText = "refresh-token-value";

export type FakeStore = SecretStore & { values: Map<string, string> };

export function fakeStore(initial: Record<string, string> = {}): FakeStore {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get: (n) => Promise.resolve(values.get(n)),
    set: (n, v) => {
      values.set(n, v);
      return Promise.resolve();
    },
    delete: (n) => Promise.resolve(values.delete(n)),
    has: (n) => Promise.resolve(values.has(n)),
    names: () => Promise.resolve([...values.keys()].sort()),
  };
}

export function done(result: ResultMessage | null): JobOutcome {
  return {
    ok: true,
    replies: [],
    exit: {
      kind: "ended",
      end: { type: "end", state: "done", at: 0, found: 0, kept: 0 },
      result,
    },
  };
}

export interface Harness {
  folder: string;
  source: DataSource | null;
  store: FakeStore;
  python: string | null;
  starts: Start[];
  job: () => JobOutcome;
  emitted: ConnectionsStatus[];
  existing: Set<string>;
  /** How many times a status was built (it asks for the Gemini state once each time). */
  statusBuilds: number;
  service: ConnectionsServiceFull;
}

/** A fresh harness before each test (its fields are replaced), cleaned up after it. */
export function useConnections(): Harness {
  const h = {} as Harness;
  beforeEach(async () => {
    h.folder = await mkdtemp(join(tmpdir(), "gratovo-connections-"));
    h.source = openExampleSource(join(h.folder, "example.db"));
    h.store = fakeStore();
    h.python = "python.exe";
    h.starts = [];
    h.job = () => done(null);
    h.emitted = [];
    h.existing = new Set();
    h.statusBuilds = 0;
    const deps: ConnectionsDeps = {
      secrets: h.store,
      source: () => h.source,
      gemini: {
        status: () => {
          h.statusBuilds += 1;
          return gemini;
        },
      },
      pythonPath: () => h.python,
      youtubeKeyAvailable: () => Promise.resolve(true),
      syncState: () => "synced",
      jobContext: () => ({ dataDir: h.folder, worker: "user-1" }),
      runQuickJob: (start) => {
        h.starts.push(start);
        return Promise.resolve(h.job());
      },
      pickFolder: () => Promise.resolve(join(h.folder, "course")),
      pathExists: (p) => Promise.resolve(h.existing.has(p)),
      emit: (s) => h.emitted.push(s),
      now: () => Date.UTC(2026, 9, 24, 10, 0, 0),
    };
    h.service = createConnectionsService(deps);
  });
  afterEach(async () => {
    h.source?.close();
    await rm(h.folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  return h;
}
