import type { DatabaseSync } from "node:sqlite";

import { notificationIcons } from "@gratovo/core/data";
import type { FrameNotification, NotificationIcon } from "@gratovo/core/data";

/** Adds a notification or replaces the one with the same id. `at` is in ms. */
export function upsertNotification(db: DatabaseSync, n: FrameNotification): void {
  db.prepare(
    `INSERT INTO notifications (id, at, icon, text, sub, go_screen, go_tab, read)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       at = excluded.at, icon = excluded.icon, text = excluded.text, sub = excluded.sub,
       go_screen = excluded.go_screen, go_tab = excluded.go_tab, read = excluded.read`,
  ).run(n.id, n.at, n.icon, n.text, n.sub, n.go.screen, n.go.tab, n.read ? 1 : 0);
}

/** Marks a notification read or unread; false when there is no such notification. */
export function setNotificationRead(db: DatabaseSync, id: string, read: boolean): boolean {
  const result = db.prepare("UPDATE notifications SET read = ? WHERE id = ?").run(read ? 1 : 0, id);
  return Number(result.changes) > 0;
}

/** Newest first; notifications from the same moment come in id order. */
export function listNotifications(db: DatabaseSync): FrameNotification[] {
  const rows = db
    .prepare(
      "SELECT id, at, icon, text, sub, go_screen, go_tab, read FROM notifications ORDER BY at DESC, id",
    )
    .all();
  return rows.map((row) => ({
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
  }));
}

function toIcon(value: unknown): NotificationIcon {
  return (notificationIcons as readonly unknown[]).includes(value)
    ? (value as NotificationIcon)
    : "check";
}
