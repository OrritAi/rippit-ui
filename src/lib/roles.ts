import type { Role } from "@/app/lib/api";

/*
 * What each role may do in the customer UI. The API enforces the same matrix;
 * this only decides what to show. Member = view-only.
 *
 *                              owner  admin  member
 *   rename / transfer            ✓      –      –
 *   invite owner                 ✓      –      –
 *   invite admin+member          ✓      ✓      –
 *   resend / revoke invites      ✓      ✓      –
 *   change role / remove       anyone  members  –
 *   add / resync / disconnect    ✓      ✓      –
 */

export type Capability =
  | "rename"
  | "transfer"
  | "inviteOwner"
  | "invite"
  | "manageInvites"
  | "manageConnections";

const OWNER_ONLY: ReadonlySet<Capability> = new Set(["rename", "transfer", "inviteOwner"]);

export function can(role: Role, capability: Capability): boolean {
  if (role === "owner") return true;
  if (role === "admin") return !OWNER_ONLY.has(capability);
  return false;
}

/** Owners manage everyone but themselves; admins manage members only. */
export function canManageMember(viewer: Role, target: Role, isSelf: boolean): boolean {
  if (isSelf) return false;
  if (viewer === "owner") return true;
  if (viewer === "admin") return target === "member";
  return false;
}

/** Roles the viewer may invite with. */
export function inviteRoleOptions(role: Role): Role[] {
  if (role === "owner") return ["owner", "admin", "member"];
  if (role === "admin") return ["admin", "member"];
  return [];
}

export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", member: "Member" };

/** "an admin" / "a member" — for toasts. */
export function roleNoun(role: Role): string {
  return role === "owner" ? "the owner" : role === "admin" ? "an admin" : "a member";
}
