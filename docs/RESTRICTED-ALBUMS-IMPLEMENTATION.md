# Restricted albums: access contract

P4-01 / D08, 22 September 2026. The standing execution authority covers these implementation decisions. This document defines the policy; restricted albums are **not available or enforced in production yet**. No existing file or audience changes during this design increment.

## Access belongs to the asset

Each shared-space asset belongs to exactly one access scope: the general library or a named restricted scope. Every album also belongs to one scope; sections inherit it. An album reference is valid only when the asset and album have the same space and scope. Identical audience lists do not make two scopes interchangeable: their future grant changes could diverge.

Files keep their scope when an album is archived, removed or restored. Restricted files without an active album remain in restricted recovery/unorganised storage. General library queries exclude restricted assets even for a person who has a restricted grant. An explicit restricted view, and a separately labelled Everything I can access view, may include permitted restricted content.

Scope never changes by adding/removing an album reference or renaming a section. Moving content across scopes requires an explicit independently verified copy with an audience preview. A general original remains generally exposed until separately removed; making a restricted copy cannot recall existing copies or links. An already shared file must never be described as newly confidential.

## Membership and administrator access

- Restricted scopes require a current account membership and an explicit active grant to that exact membership. Legacy device credentials cannot access restricted content, including explicitly claimed legacy credentials; sign-in is required.
- Space roles still limit actions. A grant gives audience access, not a promotion: Viewer stays read-only, Contributor edits attributable files, and Editor organises. Owner-only actions remain Owner-only.
- Shared-space owners manage scope grants but do not silently read restricted files. An owner who lacks a grant must deliberately request their own administrator access, with a named audience confirmation and a durable audit event. The owner must already belong to that shared space. This does not create access to another person's personal space.
- The owner-only access-administration screen may list opaque scope IDs, creators and current membership grants so the owner can manage access or request their own audited grant. This is an explicit administrative metadata permission, not a content permission: no album/file titles, covers, item counts or activity content are disclosed without a grant. Ordinary readers cannot enumerate that catalog.
- Initial restricted-scope creation includes an explicit creator grant and a preview of the selected current memberships. Only owners manage audiences in the first increment; editors with access organise within the existing audience.
- Leaving/removing a shared membership revokes its restricted grants in the same transaction. Rejoining, matching an email or restoring an old backup does not revive them. Role changes within an uninterrupted membership change capabilities under the same audience; they do not create grants.
- Personal spaces keep their existing owner-only policy. Shared-space administration can neither enumerate nor grant access to personal-space content.

## Disclosure contract

| Surface | Required behaviour |
| --- | --- |
| Feed, search, suggestions, counts and covers | Filter by current audience before ordering, counting or choosing covers. No restricted names, totals or empty-group hints for a person without a grant. |
| Albums, sections and filename collision checks | Require the same current scope. Collision messages may refer only to accessible same-scope content. |
| Original/preview URLs and ranges | Recheck audience before bytes or a new signed capability. Existing signed URLs retain their documented bounded lifetime; downloaded copies cannot be recalled. |
| Upload queue, publication and import layout | Capture the intended scope at selection time. Recheck at reservation, every new capability and the ready-state commit. A changed destination never falls back to general storage. |
| Rename, organisation, Trash and permanent deletion | Require both current scope and role/attribution for every selected item in the committing statement. Mixed selections fail as a whole. |
| Favourites, metadata exports and future packages | A bookmark cannot outlive read authority as an access grant. Exports require all selected scopes at creation and retrieval; no partial disclosure. |
| Activity and in-app notices | Every referenced resource must remain readable. Hide the whole event if any reference is outside the current audience; hidden events cannot affect notices or pagination counts. Removed restricted resources retain their scope attribution in history. |
| Storage and administration | Ordinary readers see accessible content only. An owner may see a clearly labelled aggregate billed/reserved total for the shared space, but no hidden filenames or item counts. The separate owner-only access catalog exposes only the administrative fields described above. These exceptions support quota/access management, not browsing. |
| Browser state and recovery | Clear cached results after access loss and re-evaluate grants on refresh/restore. Restore quarantines memberships and restricted grants. No rollback to code that ignores populated restricted scopes. |

## Implementation sequence and acceptance

- [x] Define asset/album compatibility, inherited sections, personal-space exclusion, administrator grants and offboarding rules.
- [ ] Introduce additive scope/grant/audit records and central SQL predicates. Rehearse against a private export before any migration.
- [ ] Integrate every disclosure surface above, including current activity/portability work, before enabling scope creation.
- [ ] Add explicit scope management, audience preview, restricted navigation and cross-scope copy.
- [ ] Exercise owner-without-grant, Viewer, Contributor, Editor, legacy, private-space and multi-album adversarial cases; revocation races and restoration must preserve scope.
- [ ] Complete hosted, migration, independent restore and live verification. Enable the feature only when the full surface inventory is covered.

The pure policy fixture records expected semantics and is not a substitute for database/route enforcement. P4-01 is a design deliverable; completing it does not complete any of P4-02 through P4-06 or claim deployed privacy.

## Verified isolated schema preparation

`docs/prototypes/restricted-scope-schema.sql` is outside the active migration journal. `lib/asset-scope-authority.ts` is not imported by application routes. The prototype adds immutable asset/album scope references, exact-membership grants, minimal grant events and retained history scopes. Database triggers reject incompatible references and revoke restricted grants on departure.

`tests/asset-scope-authority.mjs` passes with SQLite and Cloudflare's local D1 engine. It verifies owner/legacy denial, explicit Viewer grants, whole-event filtering after the original is removed, leave/rejoin revocation and restore preservation of triggers/quarantine. Existing snapshot tooling preserves triggers after data import. This does not establish runtime coverage: the full inventory above remains the activation gate.
