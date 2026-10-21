/**
 * What presence shows (plan D26): each team member's `status` ("online" or "away") and `doing`
 * (one line), from the live client's `members()` and your own state.
 *
 * Only team members count: a key that isn't in the team is ignored, whatever it carries. A member
 * present and not idle is online, doing the screen they are on ("Looking at a record" for a
 * record); idle is away, "Idle"; absent is away with nothing. Your own entry comes from your own
 * state, not from what the server echoes, so it shows even with Realtime off.
 */

import type { AppEventPayload } from "@gratovo/ipc";

import type { FrameExtras } from "../data";
import { strings } from "../strings";

import type { PresenceState } from "./live";

/** The words presence is shown in (the default is the app's own, `strings.presence`). */
export interface PresenceWords {
  readonly idle: string;
  readonly record: string;
  readonly screens: Readonly<Record<string, string>>;
}
type Shown = ReturnType<FrameExtras["presence"]>;

/** `presence:changed` holds at most this many members (its schema's limit). */
const eventMembersMax = 50;
const absent: Shown = { status: "away", doing: "" };

function shown(state: PresenceState, words: PresenceWords): Shown {
  if (state.idle) {
    return { status: "away", doing: words.idle };
  }
  const doing = state.screen === "record" ? words.record : (words.screens[state.screen] ?? "");
  return { status: "online", doing };
}

/** The frame's presence: a member's status and line by id (D26). */
export function presenceExtras(
  members: ReadonlyMap<string, PresenceState>,
  team: Iterable<string>,
  me: string,
  ownState: PresenceState,
  words: PresenceWords = strings.presence,
): FrameExtras["presence"] {
  const inTeam = new Set(team);
  return (id) => {
    if (id === me) {
      return shown(ownState, words);
    }
    if (!inTeam.has(id)) {
      return absent;
    }
    const state = members.get(id);
    return state === undefined ? absent : shown(state, words);
  };
}

/** The `presence:changed` payload: every team member (in team order, at most 50), you included. */
export function presenceMembers(
  members: ReadonlyMap<string, PresenceState>,
  team: readonly string[],
  me: string,
  ownState: PresenceState,
  words: PresenceWords = strings.presence,
): AppEventPayload<"presence:changed"> {
  const of = presenceExtras(members, team, me, ownState, words);
  const ids = [...new Set(team)].slice(0, eventMembersMax);
  return { members: ids.map((id) => ({ id, ...of(id) })) };
}
