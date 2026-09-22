import { transferAuthority } from "./transfer-authority";
import { ApiError, type ActiveDevice } from "./server";

export function requireFileEditor(device: ActiveDevice) {
  if (device.role !== "owner" && !(device.authentication === "account" && ["editor", "contributor"].includes(device.role)))
    throw new ApiError(403, "An owner or editor can organise files; contributors can edit their own files.");
}

// Use only these source-controlled aliases. Attribution follows the exact membership or its recorded
// legacy claim; live role/session checks stay inside the same statement as every selected-file mutation.
export function fileEditAuthority(device: ActiveDevice, alias: "media" | "candidate" | "m" = "media") {
  const organiser = transferAuthority(device, Date.now(), "organiser");
  if (device.authentication !== "account") return organiser;
  const upload = transferAuthority(device);
  return { sql: `((${organiser.sql}) OR ((${upload.sql}) AND EXISTS (
    SELECT 1 FROM account_space_actors editor_actor JOIN space_memberships editor_member ON editor_member.id=editor_actor.membership_id
    WHERE editor_actor.device_id=? AND editor_member.space_id=${alias}.space_id AND editor_member.role='contributor'
    AND (${alias}.device_id=editor_actor.device_id OR EXISTS (SELECT 1 FROM legacy_owner_claims claim
      WHERE claim.membership_id=editor_member.id AND claim.device_id=${alias}.device_id)))))`,
    bindings: [...organiser.bindings, ...upload.bindings, device.id] };
}
