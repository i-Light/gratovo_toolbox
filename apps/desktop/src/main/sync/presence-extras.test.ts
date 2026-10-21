import { presenceMembersSchema } from "@gratovo/ipc";
import { describe, expect, it } from "vitest";

import { strings } from "../strings";

import type { PresenceState } from "./live";
import { presenceExtras, presenceMembers } from "./presence-extras";

const me = "u-me";
const sara = "u-sara";
const omar = "u-omar";
const team = [me, sara, omar];
const here: PresenceState = { screen: "today", idle: false };

function membersOf(entries: Record<string, PresenceState>): ReadonlyMap<string, PresenceState> {
  return new Map(Object.entries(entries));
}

describe("presenceExtras", () => {
  it("shows a present member online, doing the screen they are on", () => {
    const of = presenceExtras(
      membersOf({ [sara]: { screen: "reach", idle: false } }),
      team,
      me,
      here,
    );
    expect(of(sara)).toEqual({ status: "online", doing: "Reach" });
  });

  it("names a record as looking at one", () => {
    const of = presenceExtras(
      membersOf({ [sara]: { screen: "record", idle: false } }),
      team,
      me,
      here,
    );
    expect(of(sara)).toEqual({ status: "online", doing: "Looking at a record" });
  });

  it("shows an idle member away and idle, and an absent one away with nothing", () => {
    const of = presenceExtras(
      membersOf({ [sara]: { screen: "find", idle: true } }),
      team,
      me,
      here,
    );
    expect(of(sara)).toEqual({ status: "away", doing: "Idle" });
    expect(of(omar)).toEqual({ status: "away", doing: "" });
  });

  it("ignores a key that isn't in the team", () => {
    const of = presenceExtras(
      membersOf({ stranger: { screen: "deliver", idle: false } }),
      team,
      me,
      here,
    );
    expect(of("stranger")).toEqual({ status: "away", doing: "" });
  });

  it("takes your own entry from your own state, not from the server", () => {
    const echoed = membersOf({ [me]: { screen: "team", idle: true } });
    expect(presenceExtras(echoed, team, me, { screen: "settings", idle: false })(me)).toEqual({
      status: "online",
      doing: "Settings",
    });
    expect(presenceExtras(new Map(), team, me, { screen: "close", idle: true })(me)).toEqual({
      status: "away",
      doing: "Idle",
    });
  });

  it("uses the words it is given", () => {
    const words = { ...strings.presence, idle: "Resting", screens: { reach: "Outreach" } };
    const of = presenceExtras(
      membersOf({
        [sara]: { screen: "reach", idle: false },
        [omar]: { screen: "find", idle: true },
      }),
      team,
      me,
      here,
      words,
    );
    expect(of(sara)).toEqual({ status: "online", doing: "Outreach" });
    expect(of(omar)).toEqual({ status: "away", doing: "Resting" });
  });
});

describe("presenceMembers", () => {
  it("lists every team member in team order, you included, and nobody else", () => {
    const payload = presenceMembers(
      membersOf({
        [sara]: { screen: "insights", idle: false },
        stranger: { screen: "reach", idle: false },
      }),
      team,
      me,
      { screen: "toolbox", idle: false },
    );
    expect(payload).toEqual({
      members: [
        { id: me, status: "online", doing: "Toolbox" },
        { id: sara, status: "online", doing: "Insights" },
        { id: omar, status: "away", doing: "" },
      ],
    });
    expect(presenceMembersSchema.safeParse(payload).success).toBe(true);
  });

  it("stays within the event's 50 members", () => {
    const big = Array.from({ length: 60 }, (_, i) => `u-${String(i)}`);
    const payload = presenceMembers(new Map(), big, "u-0", here);
    expect(payload.members).toHaveLength(50);
    expect(presenceMembersSchema.safeParse(payload).success).toBe(true);
  });
});
