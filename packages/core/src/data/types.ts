/**
 * The data contract between the app and where its data lives: the domain types, what one read
 * returns (`Frame`), the changes the app can write (`DataWrite`), and the `DataSource` that serves
 * both. Pure types and constants, exported as `@gratovo/core/data` so the main process can use
 * them without pulling in the store's immer.
 */

/** What a person may do in the app; the only roles Supabase's `profiles.role` knows. */
export type AppRole = "unauthorized" | "basic" | "full";

/**
 * The agency roles a person can hold, any number at once, in the order they are shown. They live in
 * Supabase's `member_access`, apart from access (`AppRole`).
 */
export const agencyRoles = ["owner", "scout", "outreach", "deal_lead", "delivery"] as const;

export type AgencyRole = (typeof agencyRoles)[number];

/** Every creator stage, in the order a creator moves through them. */
export const creatorStages = [
  "new",
  "shortlisted",
  "contact",
  "emailed",
  "replied",
  "kit",
  "audience",
  "signed",
  "rejected",
  "parked",
  "never",
] as const;

/** Where a creator is on the way to signing. */
export type CreatorStage = (typeof creatorStages)[number];

/** The kinds of notification a person can turn off. */
export const notifyKinds = ["reply", "money", "handoff", "search"] as const;

export type NotifyKind = (typeof notifyKinds)[number];

/** Team-wide notification switches. A kind is on unless it is false here. */
export type NotifySettings = Readonly<Partial<Record<NotifyKind, boolean>>>;

/** The icons a notification can show; each is also an icon name in the UI kit. */
export const notificationIcons = [
  "reply",
  "wallet",
  "unlock",
  "forward",
  "alert",
  "pause",
  "scan",
  "check",
] as const;

export type NotificationIcon = (typeof notificationIcons)[number];

/**
 * The kind of a notification, from its icon; problems (`alert`) can't be turned off. Any other
 * icon counts as a search. It takes any icon name, so the renderer can use it with its own icons.
 */
export function notifyKind(icon: string): NotifyKind | "problem" {
  switch (icon) {
    case "reply":
      return "reply";
    case "wallet":
    case "unlock":
      return "money";
    case "forward":
      return "handoff";
    case "alert":
      return "problem";
    default:
      return "search";
  }
}

/** The longest name kept; a longer one is cut to this. */
export const nameMax = 80;

/** A person on the team. */
export interface TeamMember {
  readonly id: string;
  /** `""` while the person hasn't set a name. */
  readonly name: string;
  readonly role: AppRole;
  /** In display order, no duplicates; empty when the person holds none. */
  readonly roles: readonly AgencyRole[];
  readonly status: "online" | "away";
  readonly doing: string;
}

/** One line in the notifications tray. */
export interface FrameNotification {
  readonly id: string;
  readonly at: number;
  readonly icon: NotificationIcon;
  readonly text: string;
  readonly sub: string;
  /** Where clicking it goes: a screen key and an optional tab, checked by the renderer. */
  readonly go: { readonly screen: string; readonly tab: string | null };
  readonly read: boolean;
}

/** The numbers beside the rail items. */
export interface RailCounts {
  readonly today: number;
  readonly plannedMinutes: number;
  readonly find: number;
  readonly reach: number;
  readonly close: number;
  readonly deliver: number;
}

/** One line in the activity log. */
export interface LogEntry {
  readonly id: string;
  readonly at: number;
  /** The member id of whoever made the change. */
  readonly who: string;
  readonly text: string;
}

/** A YouTube creator the agency finds and signs. */
export interface Creator {
  readonly id: string;
  readonly name: string;
  readonly handle: string;
  readonly stage: CreatorStage;
  readonly email: string | null;
}

/** A company that sponsors creators. */
export interface Brand {
  readonly id: string;
  readonly name: string;
  /** What the brand sells, in a few words. */
  readonly sells: string;
  /** Where the brand is: found, qualified, pitched, negotiating or won. */
  readonly status: string;
}

/** A sponsorship between one brand and one creator. */
export interface Deal {
  readonly id: string;
  /** A brand id. */
  readonly brand: string;
  /** A creator id. */
  readonly creator: string;
  /** An index into DEAL_FLOW. */
  readonly step: number;
  /** What the brand pays, in dollars; null when the signed-in member may not see money. */
  readonly price: number | null;
}

/** A teammate's search that is running now. */
export interface MateRun {
  /** A member id. */
  readonly by: string;
  readonly at: number;
  readonly current: number;
  readonly total: number;
}

/** Everything the frame, the palette, the peek and the record page show: one read. */
export interface Frame {
  /** A member id. */
  readonly me: string;
  /** Null until set in Settings > Profile. */
  readonly myName: string | null;
  readonly team: readonly TeamMember[];
  /** Until the Today engine (step 4) computes them. */
  readonly counts: RailCounts;
  /** Newest first. */
  readonly notifications: readonly FrameNotification[];
  /** Newest first, at most 50. */
  readonly log: readonly LogEntry[];
  readonly creators: readonly Creator[];
  readonly brands: readonly Brand[];
  readonly deals: readonly Deal[];
  readonly mateRun: MateRun | null;
  readonly notify: NotifySettings;
  /** Whether `me` may see money. When false, every price is null and no money notification is here. */
  readonly seesMoney: boolean;
}

/** One change the app writes: exactly the changes it makes today. */
export type DataWrite =
  /** An unknown id is a no-op. */
  | { readonly kind: "notification.read"; readonly id: string; readonly read: boolean }
  /** Replaces the whole map. */
  | { readonly kind: "notify.set"; readonly notify: NotifySettings }
  /** Trimmed, at most `nameMax`; `""` means unset. No profile row for `me`: a no-op. */
  | { readonly kind: "me.name"; readonly name: string }
  /** `id` is a UUID; the actor is always `me`. */
  | { readonly kind: "log.add"; readonly id: string; readonly at: number; readonly text: string }
  /** An unknown id is a no-op. */
  | { readonly kind: "log.remove"; readonly id: string };

/** Where the app's data lives: one read and one write, both async so the database can move. */
export interface DataSource {
  frame(): Promise<Frame>;
  /** In order, in one transaction: all or none. */
  write(writes: readonly DataWrite[]): Promise<void>;
  close(): void;
}
