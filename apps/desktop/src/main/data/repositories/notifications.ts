import type { DatabaseSync } from "node:sqlite";

import { mentionsMoney, notificationIcons, notifyKind } from "@gratovo/core/data";
import type { FrameNotification, NotificationIcon } from "@gratovo/core/data";

/**
 * Adds a notification or replaces the one with the same id. `at` is in ms. The `money` column
 * marks one about money: `options.money` when given, else whether its text or sub mentions it.
 */
export function upsertNotification(
  db: DatabaseSync,
  n: FrameNotification,
  options: { money?: boolean } = {},
): void {
  const money = options.money ?? (mentionsMoney(n.text) || mentionsMoney(n.sub));
  db.prepare(
    `INSERT INTO notifications (id, at, icon, text, sub, go_screen, go_tab, read, money)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       at = excluded.at, icon = excluded.icon, text = excluded.text, sub = excluded.sub,
       go_screen = excluded.go_screen, go_tab = excluded.go_tab, read = excluded.read,
       money = excluded.money`,
  ).run(n.id, n.at, n.icon, n.text, n.sub, n.go.screen, n.go.tab, n.read ? 1 : 0, money ? 1 : 0);
}

/** Marks a notification read or unread; false when there is no such notification. */
export function setNotificationRead(db: DatabaseSync, id: string, read: boolean): boolean {
  const result = db.prepare("UPDATE notifications SET read = ? WHERE id = ?").run(read ? 1 : 0, id);
  return Number(result.changes) > 0;
}

/** The most notifications a frame carries (the IPC list limit). */
const notificationCap = 5000;

/**
 * Newest first, at most 5000; notifications from the same moment come in id order. A member
 * without money (`seesMoney` false) gets none of kind `money`, none flagged `money`, and none
 * whose text or sub mentions money (D14).
 */
export function listNotifications(
  db: DatabaseSync,
  o: { seesMoney?: boolean } = {},
): FrameNotification[] {
  const seesMoney = o.seesMoney ?? true;
  const rows = db
    .prepare(
      `SELECT id, at, icon, text, sub, go_screen, go_tab, read, money FROM notifications
       ${seesMoney ? "" : "WHERE money = 0"} ORDER BY at DESC, id LIMIT ?`,
    )
    .all(notificationCap);
  return rows
    .map((row) => ({
      id: String(row["id"]),
      at: Number(row["at"]),
      icon: toIcon(row["icon"]),
      text: String(row["text"]),
      sub: String(row["sub"]),
      go: {
        screen: String(row["go_screen"]),
        tab: row["go_tab"] === null ? null : String(row["go_tab"]),
      },
      read: Number(row["read"]) !== 0,
    }))
    .filter(
      (n) =>
        seesMoney ||
        (notifyKind(n.icon) !== "money" && !mentionsMoney(n.text) && !mentionsMoney(n.sub)),
    );
}

function toIcon(value: unknown): NotificationIcon {
  return (notificationIcons as readonly unknown[]).includes(value)
    ? (value as NotificationIcon)
    : "check";
}
