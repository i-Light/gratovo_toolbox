import { isOwner, sortRoles } from "@gratovo/core/data";
import type { Frame, FrameNotification, TeamMember } from "@gratovo/core/data";
import { icons } from "@gratovo/ui";
import type { IconName } from "@gratovo/ui";

import { strings } from "../strings";
import type { AppData, Member, Notification } from "./store";
import { screens } from "./routes";
import type { Route, ScreenKey } from "./routes";

const todayRoute: Route = { screen: "today", tab: null };

/** A route from the frame's screen and tab; anything the renderer does not know goes to Today. */
function routeOf(go: FrameNotification["go"]): Route {
  if (!Object.hasOwn(screens, go.screen) || go.screen === "record") {
    return todayRoute;
  }
  const screen = go.screen as ScreenKey;
  if (go.tab === null || !screens[screen].tabs.some((t) => t.key === go.tab)) {
    return { screen, tab: null };
  }
  return { screen, tab: go.tab };
}

function iconOf(icon: string): IconName {
  return Object.hasOwn(icons, icon) ? (icon as IconName) : "bell";
}

/**
 * The role line shown for a member: their agency roles in display order joined by " · " ("Scout ·
 * Outreach"), or their access ("Team member") when they hold none.
 */
export function roleLabel(member: Pick<TeamMember, "role" | "roles">): string {
  const roles = sortRoles(member.roles);
  return roles.length === 0
    ? strings.team.roles[member.role]
    : roles.map((role) => strings.team.agencyRoles[role]).join(" · ");
}

function memberOf(member: TeamMember, me: string): Member {
  return {
    id: member.id,
    name: member.id === me ? strings.team.you : member.name,
    role: roleLabel(member),
    owner: isOwner(member),
    status: member.status,
    doing: member.doing,
  };
}

function notificationOf(n: FrameNotification): Notification {
  return {
    id: n.id,
    at: n.at,
    icon: iconOf(n.icon),
    text: n.text,
    sub: n.sub,
    go: routeOf(n.go),
    read: n.read,
  };
}

/** The renderer's data from what the main process sends: role labels, routes and icons checked. */
export function toAppData(frame: Frame): AppData {
  return {
    me: frame.me,
    myName: frame.myName,
    seesMoney: frame.seesMoney,
    team: frame.team.map((m) => memberOf(m, frame.me)),
    counts: frame.counts,
    notifications: frame.notifications.map(notificationOf),
    log: frame.log,
    creators: frame.creators,
    brands: frame.brands,
    deals: frame.deals,
    mateRun: frame.mateRun,
    settings: { notify: frame.notify },
  };
}
