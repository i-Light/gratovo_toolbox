import { agencyRoles } from "./types";
import type { AgencyRole } from "./types";

/**
 * What a member may do beyond access: their agency roles and the "sees money" switch (Supabase's
 * `member_access`). Pure functions, used by the main process to strip money before a frame leaves
 * it and by the renderer for the owner checks.
 */

/** A member's agency roles and their "sees money" switch. */
export interface MemberAccess {
  readonly roles: readonly AgencyRole[];
  readonly seesMoney: boolean;
}

/** A member with no row: no roles and no money. */
export const noAccess: MemberAccess = { roles: [], seesMoney: false };

/** Whether a value is one of the agency roles. */
export function isAgencyRole(value: unknown): value is AgencyRole {
  return (agencyRoles as readonly unknown[]).includes(value);
}

/** Whether the member holds the Owner role. */
export function isOwner(access: { readonly roles: readonly AgencyRole[] }): boolean {
  return access.roles.includes("owner");
}

/** Whether the member may see money: an Owner always does, anyone else only with the switch on. */
export function seesMoney(access: MemberAccess): boolean {
  return isOwner(access) || access.seesMoney;
}

/** The roles in the fixed display order (Owner, Scout, Outreach, Deal lead, Delivery), each once. */
export function sortRoles(roles: readonly AgencyRole[]): AgencyRole[] {
  return agencyRoles.filter((role) => roles.includes(role));
}
