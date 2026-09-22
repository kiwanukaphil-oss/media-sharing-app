import { z } from "zod";
import { ApiError, database, readJson, type ActiveDevice } from "./server";
import { transferAuthority } from "./transfer-authority";

// Viewer read access is sufficient for a private bookmark, never shared metadata. Recheck it in the
// same SQL write, bind the authenticated person, and cap retained bookmarks across all their spaces.
export async function changePersonalFavorite(request: Request, device: ActiveDevice, mediaId: string) {
  if (device.authentication !== "account" || !device.personId) throw new ApiError(403, "Sign in to keep private favourites.");
  if (!z.string().uuid().safeParse(mediaId).success) throw new ApiError(404, "This file is unavailable.");
  const { favorite } = await readJson(request, z.object({ favorite: z.boolean() }));
  const authority = transferAuthority(device, Date.now(), "read");
  const available = `EXISTS (SELECT 1 FROM media WHERE id=? AND space_id=? AND status='ready') AND ${authority.sql}`;
  const bindings = [mediaId, device.space_id, ...authority.bindings];
  if (favorite) {
    const result = await database().prepare(`INSERT INTO personal_favorites(person_id,media_id,created_at)
      SELECT ?,?,? WHERE ${available} AND ((SELECT COUNT(*) FROM personal_favorites WHERE person_id=?) < 10000
        OR EXISTS (SELECT 1 FROM personal_favorites WHERE person_id=? AND media_id=?))
      ON CONFLICT(person_id,media_id) DO UPDATE SET created_at=personal_favorites.created_at`)
      .bind(device.personId, mediaId, Date.now(), ...bindings, device.personId, device.personId, mediaId).run();
    if (!result.meta.changes) throw new ApiError(409, "Access changed or your 10,000-favourite limit was reached. Refresh before trying again.");
  } else {
    await database().prepare(`DELETE FROM personal_favorites WHERE person_id=? AND media_id=? AND ${available}`)
      .bind(device.personId, mediaId, ...bindings).run();
    if (!await database().prepare(`SELECT 1 WHERE ${available}`).bind(...bindings).first())
      throw new ApiError(409, "Library access changed. Refresh before updating favourites.");
  }
  return Response.json({ favorite });
}
