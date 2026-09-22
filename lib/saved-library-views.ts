import { z } from "zod";

const optionalId = z.union([z.literal(""), z.string().uuid()]);
const date = z.string().max(10).refine(value => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value));
export const libraryViewStateSchema = z.object({
  category: z.enum(["all", "original", "final", "trash"]), search: z.string().max(200),
  query: z.object({ scope: z.union([optionalId,z.literal("accessible")]).default(""), album: z.union([optionalId,z.literal("unorganised")]),
    section: z.union([optionalId,z.literal("unsectioned")]), dateMode: z.enum(["uploaded","captured"]),
    from: date, to: date, sort: z.enum(["newest","oldest"]), batch: optionalId,
    type: z.enum(["","photo","video","other"]), uploader: z.enum(["","me"]), favorites: z.enum(["","1"]).default(""),
  }),
});
export type LibraryViewState = z.infer<typeof libraryViewStateSchema>;
const savedViewsSchema = z.array(z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(60),
  view: libraryViewStateSchema })).max(8).refine(views => new Set(views.map(view => view.id)).size === views.length);
export type SavedLibraryView = z.infer<typeof savedViewsSchema>[number];

// Browser state is untrusted and carries no credentials or authorisation. Corrupt/oversized data is
// discarded as a whole; callers always apply a view within their currently authorised library.
export function readSavedLibraryViews(raw: string | null): SavedLibraryView[] {
  if (!raw || raw.length > 12000) return [];
  try { const parsed = savedViewsSchema.safeParse(JSON.parse(raw)); return parsed.success ? parsed.data : []; }
  catch { return []; }
}

export function savedLibraryViewsKey(spaceId: string, actorId: string, authentication: string) {
  return `relay-tab-views-v1:${authentication}:${spaceId}:${actorId}`;
}
