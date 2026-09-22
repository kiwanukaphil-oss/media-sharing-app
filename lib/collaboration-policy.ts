// Prepared Phase 3 policy only: not imported by live routes. Database mutations must recheck these
// capabilities against current membership, resource attribution, audience and revision in their transaction.
export type SharedAction = "read" | "upload" | "continue-upload" | "create-preview" | "organise-albums" | "edit-files" | "trash-files" |
  "restore-files" | "cancel-upload" | "manage-access" | "delete-permanently";
export type SharedActor = { kind: "account" | "legacy"; id: string; spaceId: string; role: string; active: boolean };
export type SharedResource = { spaceId: string; audienceAllowed: boolean; membershipId: string | null; deviceId: string | null };
type Decision = { allowed: boolean; reason: "allowed" | "access-changed" | "role-denied" | "selection-required" | "selection-denied" };

const roles = new Set(["owner", "editor", "contributor", "viewer", "member"]);
const fileActions = new Set<SharedAction>(["continue-upload", "create-preview", "edit-files", "trash-files", "restore-files", "cancel-upload", "delete-permanently"]);

// Evaluate the entire captured selection. Never silently edit a permitted subset, infer attribution from
// names/emails, map Editor to a legacy Owner, or let shared-space ownership bypass a narrower audience.
export function reviewSharedAction(actor: SharedActor, action: SharedAction, resources: readonly SharedResource[] = []): Decision {
  if (actor.active !== true || !actor.id || !actor.spaceId || !roles.has(actor.role) ||
      (actor.kind !== "account" && actor.kind !== "legacy") ||
      (actor.kind === "legacy" && actor.role !== "owner" && actor.role !== "member")) return { allowed: false, reason: "access-changed" };
  if (resources.some(resource => resource.spaceId !== actor.spaceId || resource.audienceAllowed !== true)) {
    return { allowed: false, reason: "selection-denied" };
  }
  if (fileActions.has(action) && resources.length === 0) return { allowed: false, reason: "selection-required" };
  const own = resources.length > 0 && resources.every(resource =>
    actor.kind === "account" ? resource.membershipId === actor.id : resource.deviceId === actor.id);
  let allowed = false;
  switch (action) {
    case "read": allowed = true; break;
    case "upload": allowed = actor.role !== "viewer"; break;
    // Organisation authority never lets another member supply bytes for an existing contribution.
    // Routes must also enforce exact upload ID, file state, byte/hash bounds and preview immutability.
    case "continue-upload": case "create-preview": allowed = actor.role !== "viewer" && own; break;
    case "organise-albums": allowed = actor.role === "owner" || actor.role === "editor"; break;
    case "edit-files": case "trash-files": case "restore-files":
      allowed = actor.role === "owner" || actor.role === "editor" || (actor.role === "contributor" && own); break;
    case "cancel-upload":
      allowed = actor.role === "owner" || actor.role === "editor" ||
        (["contributor", "member"].includes(actor.role) && own); break;
    case "manage-access": case "delete-permanently": allowed = actor.role === "owner"; break;
  }
  return { allowed, reason: allowed ? "allowed" : "role-denied" };
}
