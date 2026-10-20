import type { DatabaseSync } from "node:sqlite";

import { nameMax } from "@gratovo/core/data";
import type {
  DataSource,
  DataWrite,
  Frame,
  MateRun,
  RailCounts,
  TeamMember,
} from "@gratovo/core/data";

import {
  addLogEntry,
  getNotify,
  getProfile,
  listBrands,
  listCreators,
  listDeals,
  listNotifications,
  listProfiles,
  newestLog,
  removeLogEntry,
  setDisplayName,
  setNotificationRead,
  setNotify,
} from "./repositories";

/** What the database has no table for: presence, rail counts and a teammate's running search. */
export interface FrameExtras {
  presence(id: string): {
    readonly status: "online" | "away";
    readonly doing: string;
    readonly title: string | null;
  };
  counts(): RailCounts;
  mateRun(): MateRun | null;
}

export interface SqliteSourceOptions {
  /** The signed-in member's id. */
  readonly me: string;
  readonly extras: FrameExtras;
  /** The clock, in ms. Defaults to `Date.now`; tests inject a fixed one. */
  readonly now?: () => number;
}

/** Runs `fn` in one transaction: it commits when `fn` returns and rolls back when it throws. */
export function inTransaction(db: DatabaseSync, fn: () => void): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    fn();
    db.exec("COMMIT");
  } catch (error) {
    // A failed COMMIT, or SQL that ended the transaction itself, leaves nothing to roll back.
    if (db.isTransaction) {
      db.exec("ROLLBACK");
    }
    throw error;
  }
}

/** Runs `fn` now and returns its outcome as a promise: a throw becomes a rejection. */
function settle<T>(fn: () => T): Promise<T> {
  return new Promise((resolve) => {
    resolve(fn());
  });
}

/** A `DataSource` over the local database. Both the example and the live source are this. */
export function createSqliteSource(db: DatabaseSync, options: SqliteSourceOptions): DataSource {
  const { me, extras } = options;
  const clock = options.now ?? Date.now;

  function readFrame(): Frame {
    const profiles = listProfiles(db);
    const team: TeamMember[] = profiles.map((profile) => {
      const presence = extras.presence(profile.id);
      return {
        id: profile.id,
        name: profile.displayName,
        role: profile.role,
        title: presence.title,
        status: presence.status,
        doing: presence.doing,
      };
    });
    const myName = getProfile(db, me)?.displayName ?? "";
    return {
      me,
      myName: myName === "" ? null : myName,
      team,
      counts: extras.counts(),
      notifications: listNotifications(db),
      log: newestLog(db),
      creators: listCreators(db),
      brands: listBrands(db),
      deals: listDeals(db),
      mateRun: extras.mateRun(),
      notify: getNotify(db),
    };
  }

  function apply(write: DataWrite): void {
    switch (write.kind) {
      case "notification.read":
        setNotificationRead(db, write.id, write.read);
        return;
      case "notify.set":
        setNotify(db, write.notify);
        return;
      case "me.name":
        setDisplayName(db, me, write.name.trim().slice(0, nameMax), clock());
        return;
      case "log.add":
        addLogEntry(db, me, { id: write.id, at: write.at, who: "", text: write.text });
        return;
      case "log.remove":
        removeLogEntry(db, write.id);
        return;
    }
  }

  return {
    // The database is synchronous; the promises keep callers ready for it to move elsewhere.
    frame: () => settle(readFrame),
    write: (writes) =>
      settle(() => {
        inTransaction(db, () => {
          for (const write of writes) {
            apply(write);
          }
        });
      }),
    // A second close is a no-op, so a failed start and `will-quit` can both close safely.
    close: () => {
      if (db.isOpen) {
        db.close();
      }
    },
  };
}
