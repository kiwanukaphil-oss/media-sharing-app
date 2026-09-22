# Collaboration implementation contract

Status: preparation under standing project authority, 21 September 2026. Phase 3 implementation/release remains gated by Phase 2. This contract does not change live permissions. The current owner/member policy was checked against `server.ts`, `web-api.ts`, `library-api.ts`, `sections-api.ts`, `space-people.ts` and the legacy permission contract.

## First useful increment

Prioritise **Editor**: a trusted collaborator can organise albums, sections and files without becoming an administrator. Use a single server capability policy shared by account routes, legacy routes and UI capability responses. Hiding an action is presentation only; every mutation must recheck current authority.

| Capability | Owner | Editor | Contributor | Viewer |
| --- | --- | --- | --- | --- |
| Browse authorised library, preview and save originals | Yes | Yes | Yes | Yes |
| Upload and deliberately publish into the space | Yes | Yes | Yes | No |
| Finish own uploads and create their initial previews | Own contributions | Own contributions | Own contributions | No |
| Rename, date or move files between albums/sections | All | All | Own contributions | No |
| Create/rename/reorder/archive albums and sections | Yes | Yes | No | No |
| Move to Trash and restore | All | All | Own contributions | No |
| Cancel unfinished transfers | All | All | Own transfers | No |
| Permanently delete originals | Yes, separate confirmation | No | No | No |
| Invite people, change roles, manage devices and intake grants | Yes | No | No | No |
| Hand over ownership or close the space | Yes, last-owner protection | No | No | No |
| Personal favourites | Own bookmarks only | Own bookmarks only | Own bookmarks only | Own bookmarks only |

“Viewer” includes saving originals: a browser viewer cannot promise that displayed content cannot be copied. Download-disabled review, if introduced later, needs its own explicit semantics. No role grants access to another person's personal space. Restricted albums later narrow these capabilities; a role alone must never bypass an asset's audience.

“Own” means the stable authenticated membership/actor that created the contribution, including independently recorded legacy claims. It does not mean matching an email, filename, device label or current browser. A copied publication has explicit destination attribution. A rejoined membership does not silently inherit a removed membership's editing authority; owner reconciliation must be explicit.

## Compatibility and defaults

Keep existing Owner and Member permissions unchanged during the additive migration. Existing Member currently permits browsing, uploading, saving and cancellation of its own incomplete transfers; it does not generally manage completed files. Do not silently convert Member to Contributor or Editor, since that would grant new editing/Trash authority. Retain Member as a labelled compatibility role for existing memberships and paired devices; flag it for later retirement only after owners explicitly review replacements.

New person invitations default to Contributor with the compact description “View, save and add files; edit own contributions.” Editor is a deliberate owner choice with “Organise files and albums; cannot manage access.” Invitations bind the selected role to the exact space, verified email, expiry and issuer authority. Owners cannot smuggle an ownership grant through invitation parameters; ownership remains a separate named confirmation after acceptance.

Legacy clients retain their existing response contract and server enforcement. Do not encode Editor as Owner to make an older UI work. Add explicit capability metadata for the web app; unsupported legacy operations receive a clear denial. Account-only roles need not become bearer-device roles. Claimed legacy credentials must never preserve greater authority after the associated account is demoted or removed.

## Access management experience

Keep People within the current shared space. Show a concise role subtitle on each person, their membership state, and an owner-only role menu. Preview who and which library a role change affects. Most reversible role changes use an immediate result plus reliable Undo; owner grants, loss of the last owner, and changes that expose a broader audience require a proportionate named confirmation.

Undo must recheck the current actor, target revision and last-owner rule. It cannot restore stale privileges after a second owner makes another change. Revocation aborts future authorised reads/writes, clears open account-library content and stops transfers; already downloaded files and previously issued signed URLs remain subject to the documented limitations. Removing a contributor preserves the shared library's existing originals.

Expose actual permitted actions on cards and in selection tools. For a mixed selection, explain why an action is unavailable or offer an explicit permitted subset with its count. Never silently apply a command only to some selected files. Bulk mutations recheck every affected file and use atomic all-or-nothing writes where practical.

## Upload requests after roles

An owner creates a named destination in one shared space, with expiry, maximum total bytes, maximum files, maximum per-file size and a storage reservation cap. Start with invited recipients or a protected grant; no unbounded anonymous upload. The form shows the receiving library/organiser and limits before accepting a file. Its receipt reveals only the contributor's own submission status.

An intake grant must never become a membership or a library credential. It cannot list/search assets, read thumbnails/originals, inspect other submissions, choose another space, expand its limits or bypass quota. Capture the album/section at grant creation; if the destination disappears or access changes, stop with an explanation rather than rerouting to a broader audience.

Expiry/revocation is enforced at upload initialisation, part signing and finalisation. In-flight bytes may require cleanup, but must not become visible ready assets after authority is lost. Concurrent submissions reserve quota atomically. Preview generation is bounded and isolated from the source bytes; failed previews do not misrepresent original upload completion. Sender names without verified identity are labelled self-reported.

## Verification sequence

1. Add a pure capability matrix and adversarial tests, then apply it to every affected route; inventory privileged calls before replacing owner-only checks.
2. Migrate person roles additively and test legacy owner/member behaviour without broadening access. Exercise role changes during open views, previews, multipart upload, publication, Trash and Undo.
3. Test ownership across two browsers, claimed devices, removal/rejoin and independent published copies. A Contributor must never mutate someone else's file through a bulk or indirect route.
4. Add role-aware invitations and People controls; verify keyboard, touch, screen reader names, mixed selections and stale revisions.
5. Build intake separately, prove no library enumeration or download path, then test expiry/revocation, quota races, destination removal and receipts.
6. Add private favourites and scoped in-app history after the access foundation. Favourites do not alter public approval, sorting or other people's activity.

Release needs hosted representative-role checks, independent backup/restore of membership decisions and an operational intake-abuse response. No guest link is published and no member role is changed by this design document.


## Prepared policy module - 22 September

`lib/collaboration-policy.ts` is a pure, unused-by-production reference for the agreed shared-role policy. It does not add database roles, alter invitations or change any current user's permissions. Integration/release remains dependent on Phase 2.

- [x] Evaluate complete selections atomically at the policy level; mixed ownership never silently becomes a permitted subset. Account attribution is the exact stable membership ID, so a new membership after rejoining does not inherit old editing rights. Legacy cancellation uses the exact device ID.
- [x] Preserve compatibility Member and legacy Owner/Member; reject account-only roles on legacy actors. Editor cannot administer access or permanently delete files.
- [x] Deny inactive/unknown roles, cross-space resources and narrower-audience denial even for an owner. Adversarial fixtures pass; hosted test step added.
- [ ] Build route-specific attribution adapters and transactional authority predicates, then integrate every API/UI path after the Phase 2 gate. This preflight function alone is never sufficient mutation authority.

Actor `id` must be populated from a verified membership (account) or device (legacy), never a client-provided identity or email. `audienceAllowed` must come from server-side audience evaluation. Personal-space policy remains separate.

The [route integration review](COLLABORATION-ROUTE-REVIEW.md) maps both web and compatibility paths, SQL authority, publication destinations, claimed devices and UI assumptions. Prepared `continue-upload` and `create-preview` decisions preserve exact contribution ownership even for Owner/Editor; these actions also require route-specific state, upload identity, checksum and quota checks. Demotion to Viewer denies further byte-producing operations. Hosted CI `35708556464` passed both jobs for the initial policy; the follow-up adds these transfer-specific adversarial cases.
