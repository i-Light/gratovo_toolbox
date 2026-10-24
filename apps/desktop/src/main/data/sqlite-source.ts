import type { DatabaseSync } from "node:sqlite";

import { creatorStages, nameMax, noAccess, notifyKind, seesMoney } from "@gratovo/core/data";
import type {
  CreatorStage,
  DataSource,
  DataWrite,
  Frame,
  FrameSource,
  MateRun,
  RailCounts,
  TeamMember,
} from "@gratovo/core/data";

import {
  addLogEntry,
  getNotify,
  getProfile,
  getSetting,
  setSetting,
  listBrands,
  listConflicts,
  markResolved,
  setBrand,
  setCreatorStage,
  setDealStep,
  listCreators,
  listDeals,
  listMemberAccess,
  listNotifications,
  listProfiles,
  newestLog,
  removeLogEntry,
  setDisplayName,
  setNotificationRead,
  setNotify,
} from "./repositories";
import { linesFor } from "./repositories/activity-log";
import {
  creatorStates,
  parseTags,
  readNotes,
  setCreatorTags,
  storedNotes,
  writeCreatorNotes,
  writeCreatorStage,
} from "./repositories/creators";

/** What the database has no table for: presence, rail counts and a teammate's running search. */
export interface FrameExtras {
  presence(id: string): { readonly status: "online" | "away"; readonly doing: string };
  counts(): RailCounts;
  mateRun(): MateRun | null;
}

export interface SqliteSourceOptions {
  /** Which data this is: the frame carries it so the page knows what live mode may show. */
  readonly source: FrameSource;
  /** The signed-in member's id. */
  readonly me: string;
  readonly extras: FrameExtras;
  /** The clock, in ms. Defaults to `Date.now`; tests inject a fixed one. */
  readonly now?: () => number;
  /** Runs inside the batch's transaction for each write; must call applyLocal() unless it writes locally itself. */
  readonly onWrite?: (db: DatabaseSync, write: DataWrite, applyLocal: () => void) => void;
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
    const access = listMemberAccess(db);
    const team: TeamMember[] = listProfiles(db).map((profile) => {
      const presence = extras.presence(profile.id);
      return {
        id: profile.id,
        name: profile.displayName,
        role: profile.role,
        // In display order already; no row means no roles.
        roles: access.get(profile.id)?.roles ?? [],
        status: presence.status,
        doing: presence.doing,
      };
    });
    const myName = getProfile(db, me)?.displayName ?? "";
    // Money is stripped here, so the page never holds a number it must hide.
    const money = seesMoney(access.get(me) ?? noAccess);
    const deals = listDeals(db);
    const notifications = listNotifications(db, { seesMoney: money });
    return {
      source: options.source,
      me,
      myName: myName === "" ? null : myName,
      team,
      counts: extras.counts(),
      notifications: money
        ? notifications
        : notifications.filter((n) => notifyKind(n.icon) !== "money"),
      log: newestLog(db, { seesMoney: money }),
      conflicts: listConflicts(db),
      creators: listCreators(db),
      brands: listBrands(db),
      deals: money ? deals : deals.map((deal) => ({ ...deal, price: null })),
      mateRun: extras.mateRun(),
      notify: getNotify(db),
      seesMoney: money,
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
        addLogEntry(db, me, {
          id: write.id,
          at: write.at,
          who: "",
          text: write.text,
          ref: write.ref,
          action: write.action,
          detail: write.detail,
        });
        return;
      case "log.remove":
        removeLogEntry(db, write.id);
        return;
      case "creator.stage":
        writeCreatorStage(db, write, clock());
        return;
      case "creator.notes":
        writeCreatorNotes(db, write, clock());
        return;
      case "brand.set":
        setBrand(db, write, clock());
        return;
      case "deal.step":
        setDealStep(db, write.id, write.step);
        return;
      case "conflict.resolve": {
        const settled = markResolved(db, write.id);
        // Keeping yours puts your stage, your tags or your notes back; keeping theirs needs
        // nothing (the server's value is here).
        if (settled === null || write.choice !== "mine") {
          return;
        }
        if (
          settled.field === "creator_stage" &&
          typeof settled.mine === "string" &&
          (creatorStages as readonly string[]).includes(settled.mine)
        ) {
          setCreatorStage(db, settled.channelId, settled.mine as CreatorStage);
        } else if (settled.field === "channel_tags" && Array.isArray(settled.mine)) {
          setCreatorTags(db, settled.channelId, parseTags(JSON.stringify(settled.mine)), clock());
        } else if (
          settled.field === "notes" &&
          (settled.mine === null || typeof settled.mine === "string")
        ) {
          db.prepare("UPDATE channel_state SET notes = ? WHERE channel_id = ?").run(
            settled.mine === null ? null : storedNotes(settled.mine),
            settled.channelId,
          );
        }
        return;
      }
    }
  }

  return {
    // The database is synchronous; the promises keep callers ready for it to move elsewhere.
    frame: () => settle(readFrame),
    creatorStates: () => settle(() => creatorStates(db)),
    creatorNotes: (id) => settle(() => readNotes(db, id) ?? null),
    // Money is hidden as the frame hides it: a member without it gets no money line.
    logFor: (ref, limit) =>
      settle(() =>
        linesFor(db, ref, {
          seesMoney: seesMoney(listMemberAccess(db).get(me) ?? noAccess),
          limit,
        }),
      ),
    write: (writes) =>
      settle(() => {
        inTransaction(db, () => {
          for (const write of writes) {
            if (options.onWrite === undefined) {
              apply(write);
            } else {
              options.onWrite(db, write, () => {
                apply(write);
              });
            }
          }
        });
      }),
    readSetting: (key) => getSetting(db, key),
    writeSetting: (key, value) => {
      setSetting(db, key, value);
    },
    seedChannelNames(rows) {
      let changed = 0;
      inTransaction(db, () => {
        const insert = db.prepare(
          "INSERT INTO channels (channel_id, name) VALUES (?, ?) ON CONFLICT (channel_id) DO UPDATE SET name = excluded.name WHERE channels.name = ''",
        );
        for (const row of rows) {
          changed += Number(insert.run(row.channelId, row.name).changes);
        }
      });
      return changed;
    },
    // A second close is a no-op, so a failed start and `will-quit` can both close safely.
    close: () => {
      if (db.isOpen) {
        db.close();
      }
    },
  };
}
