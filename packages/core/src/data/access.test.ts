import { describe, expect, it } from "vitest";

import { isAgencyRole, isOwner, noAccess, seesMoney, sortRoles } from "./access";
import { agencyRoles, notifyKind } from "./types";

describe("isAgencyRole", () => {
  it("knows exactly the five roles", () => {
    for (const role of agencyRoles) {
      expect(isAgencyRole(role)).toBe(true);
    }
    for (const value of ["Owner", "admin", "", null, undefined, 1, ["owner"]]) {
      expect(isAgencyRole(value)).toBe(false);
    }
  });
});

describe("isOwner", () => {
  it("is true only with the owner role", () => {
    expect(isOwner({ roles: ["owner"] })).toBe(true);
    expect(isOwner({ roles: ["scout", "owner"] })).toBe(true);
    expect(isOwner({ roles: ["scout", "outreach", "deal_lead", "delivery"] })).toBe(false);
    expect(isOwner({ roles: [] })).toBe(false);
  });
});

describe("seesMoney", () => {
  it("is always true for an Owner, whatever the switch says", () => {
    expect(seesMoney({ roles: ["owner"], seesMoney: false })).toBe(true);
    expect(seesMoney({ roles: ["owner"], seesMoney: true })).toBe(true);
  });

  it("follows the switch for everyone else", () => {
    expect(seesMoney({ roles: ["deal_lead"], seesMoney: true })).toBe(true);
    expect(seesMoney({ roles: ["deal_lead"], seesMoney: false })).toBe(false);
    expect(seesMoney({ roles: [], seesMoney: true })).toBe(true);
  });

  it("is false for a member with no row", () => {
    expect(noAccess).toEqual({ roles: [], seesMoney: false });
    expect(seesMoney(noAccess)).toBe(false);
  });
});

describe("sortRoles", () => {
  it("puts the roles in display order, each once", () => {
    expect(sortRoles(["delivery", "owner", "scout", "delivery", "owner"])).toEqual([
      "owner",
      "scout",
      "delivery",
    ]);
    expect(sortRoles(["delivery", "deal_lead", "outreach", "scout", "owner"])).toEqual([
      ...agencyRoles,
    ]);
    expect(sortRoles([])).toEqual([]);
  });

  it("returns a new list and leaves its input alone", () => {
    const input = ["scout", "owner"] as const;
    const sorted = sortRoles(input);
    expect(sorted).not.toBe(input);
    expect(input).toEqual(["scout", "owner"]);
  });
});

describe("notifyKind", () => {
  it("maps each icon to the kind a person can turn off, and alerts to problems", () => {
    expect(notifyKind("reply")).toBe("reply");
    expect(notifyKind("wallet")).toBe("money");
    expect(notifyKind("unlock")).toBe("money");
    expect(notifyKind("forward")).toBe("handoff");
    expect(notifyKind("alert")).toBe("problem");
    expect(notifyKind("pause")).toBe("search");
    expect(notifyKind("scan")).toBe("search");
    expect(notifyKind("check")).toBe("search");
    expect(notifyKind("bell")).toBe("search");
  });
});
