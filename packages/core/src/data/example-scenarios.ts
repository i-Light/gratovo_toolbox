import type { ExampleSeed } from "./example";
import type { FrameNotification } from "./types";

/**
 * The "first day" and "something broke" variants of the example seed (D9). They start from the
 * normal seed, which example.ts passes in, so this file never imports a value from it.
 */

/** A time on the day of `now` plus `dayOffset` days, at that hour and minute (local time). */
function dayTime(now: number, dayOffset: number, hours: number, minutes: number): number {
  const date = new Date(now);
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
}

/** The local date of `now`, `YYYY-MM-DD`. */
function localDate(now: number): string {
  const date = new Date(now);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Only you, nothing found yet, and one mailbox that started warming up today. */
export function firstSeed(base: ExampleSeed, now: number): ExampleSeed {
  const first = base.mailSettings.mailboxes[0];
  if (first === undefined) throw new Error("The example has no mailbox");
  return {
    ...base,
    profiles: base.profiles.filter((profile) => profile.id === base.me),
    access: base.access.filter((entry) => entry.profileId === base.me),
    presence: Object.fromEntries(Object.entries(base.presence).filter(([id]) => id === base.me)),
    counts: { today: 0, plannedMinutes: 0, find: 0, reach: 0, close: 0, deliver: 0 },
    creators: [],
    kits: {},
    brands: [],
    deals: [],
    notifications: [],
    mailSettings: {
      ...base.mailSettings,
      mailboxes: [{ address: first.address, dailyCap: 10, warmupStartedOn: localDate(now) }],
    },
    reachMailboxes: {},
    outreach: { drafts: [], messages: [], sequences: [] },
    health: null,
  };
}

/** The normal data with a signed-out mailbox, a silent Gemini bridge and three alerts on top. */
export function brokeSeed(base: ExampleSeed, now: number): ExampleSeed {
  const mailbox = base.mailSettings.mailboxes[0];
  if (mailbox === undefined) throw new Error("The example has no mailbox");
  const alerts: readonly FrameNotification[] = [
    {
      id: "n-broke-search",
      at: dayTime(now, 0, 9, 40),
      icon: "alert",
      text: "Today's search stopped: YouTube's daily limit",
      sub: "Resets at midnight Pacific time · everything found is saved",
      go: { screen: "find", tab: "search" },
      read: false,
    },
    {
      id: "n-broke-gemini",
      at: dayTime(now, 0, 8, 52),
      icon: "alert",
      text: "The Gemini bridge stopped answering",
      sub: "Drafts can't be written or rewritten until it's back",
      go: { screen: "settings", tab: "connections" },
      read: false,
    },
    {
      id: "n-broke-mailbox",
      at: dayTime(now, -1, 18, 5),
      icon: "alert",
      text: `${mailbox.address.split("@")[0] ?? mailbox.address} is signed out of Gmail`,
      sub: "Nothing is sent from it until it is signed in again",
      go: { screen: "reach", tab: "mailboxes" },
      read: false,
    },
  ];
  return {
    ...base,
    notifications: [...alerts, ...base.notifications],
    health: { signedOut: [mailbox.address], geminiOffline: true },
  };
}
