# Relay backup and recovery

## Operator commands

Requires Node 24, Windows DPAPI access to the two approved restricted keys, and the existing Cloudflare operator login. Run from the repository root:

```powershell
node --disable-warning=ExperimentalWarning scripts/relay-backup.mjs create
node --disable-warning=ExperimentalWarning scripts/relay-backup.mjs verify <snapshot-id>
```

`create` exports the live D1 database, checks SQLite integrity and foreign keys, and reads every completed original referenced by that exact export, including Trash. Local native exports briefly block other database queries. Hosted backups instead use a single read-only SELECT statement through the D1 query API, capturing schema, counts and rows together. Files are checked against the recorded size and SHA-256 before upload. A missing or concurrently deleted original fails the job. Files still uploading or being deleted are not claimed as protected completed originals.

The upload identity has only `writeFiles`. It cannot list, read, delete, change encryption, or change bucket lifecycle settings. SQL snapshots and manifests have unique names. Original content is addressed by SHA-256 and reusable immutable B2 version IDs. Local reuse uses a previously verified snapshot; hosted reuse uses an authenticated encrypted destination inventory followed by full independent restore verification. Losing the local index may cause duplicate versions, but cannot remove backup data. Multipart uploads use bounded 64 MiB chunks. Failed/ambiguous uploads are left for review rather than deleted or blindly retried.

`verify` uses the separate read-only identity, discovers the manifest in Backblaze, then downloads its pinned SQL and original-file versions. It checks all original SHA-256 values, lengths, database row counts and foreign keys. The restore inputs come from Backblaze, not the source R2 bucket or local source files. Only a fully successful check produces `restore-verification.json`. No success heartbeat is emitted by either command.

## Storage and access

The private destination uses explicit SSE-B2/AES256 encryption for each uploaded object. Credentials are decrypted in memory from Windows DPAPI files outside source control. The setup master key is not required by these commands. DPAPI files are tied to the current Windows user and machine; they are not portable recovery-key escrow. The user retains the Backblaze master credential separately and can create a new restricted restore reader after losing this computer.

Private exports, original-file copies, manifests and restored databases are under ignored `.sites-runtime/operations/backups`. Its Windows ACL is restricted to the current user and SYSTEM. These local test artifacts are not independently encrypted by the backup script; protect the computer and disk accordingly. They remain as cleanup candidates pending user approval. Do not attach them to issues or commit them.

Local commands can use the existing operator login. Hosted execution uses the approved D1:Read token and bucket-restricted R2 reader. The dedicated source credentials and complete environment-secret path have been verified locally; publication and the first real GitHub backup/restore run completed successfully on 2026-09-18. Recovery credentials remain separate from the upload job.

## Restore safety

Each check writes to a new isolated local directory. Before the restored SQLite database can be used by an app, the checker revokes all existing devices, expires every invitation, resets regenerable preview references, and marks unfinished media for cancellation. It also revokes account sessions, invalidates pending sign-in/owner-claim attempts, expires person invitations and suspends all restored person memberships. It preserves records and relationships. The downloaded raw SQL remains an unmodified historical artifact and still contains old access records: never activate that raw export directly.

A real cutover must map every manifest `object_key` to its restored bytes, import into a separate D1 database, apply any required migrations, confirm the account/space owners, and issue new pairing access through an approved recovery process. Local SQLite restoration does not prove a cloud cutover or a full browser-based recovery. Never point the live app at a restore until this review is complete.

## Retention and automation status

The user selected GitHub-hosted runners on 2026-09-18. `.github/workflows/daily-backup.yml` is prepared locally for 00:00 UTC (03:00 Nairobi) and manual dispatch on `main` in the original repository only. It is published and active. [The first GitHub run](https://github.com/kiwanukaphil-oss/media-sharing-app/actions/runs/35314135923) completed successfully on 2026-09-18, including independent restoration and the first success heartbeat; the first cron-triggered execution is still future. Standard hosted runners are free for this public repository; GitHub schedules can be delayed or disabled after prolonged repository inactivity. Better Stack's independent missed-beat check is intended to detect a missed run, including a disabled workflow.

The hosted design separates three data-processing jobs: a read-only destination inventory, source-read/destination-upload copying, and read-only restoration. The copy job receives an AES-256-GCM encrypted index bound to its GitHub run ID, not the restore credential. This inventory can reference existing objects directly from Backblaze on a clean runner; source hashes and the final independent restore still verify their actual bytes. There is no dependency on a cache from this computer. The sole GitHub artifact is that encrypted index with one-day retention; no originals, SQL, plaintext manifests or restore reports are uploaded as artifacts.

GitHub environments `relay-backup-copy`, `relay-backup-verify`, and `relay-backup-alerts` are limited to the `main` branch. The approved B2 roles and an inventory-encryption key have been stored as encrypted environment secrets. The heartbeat URL is stored in the verification and alert environments. Both approved source credentials have been created and stored: account-scoped D1:Read (Cloudflare's UI does not offer a single-database restriction), and Object Read only for `relay-media-originals`. The R2 reader passed a checksum-verified download. The native D1 export endpoint rejected D1:Read, so scripts/backup-d1-readonly.mjs implements a SELECT-only logical exporter. A live backup and full independent restore passed using the read-only token. The D1 account scope includes other D1 databases in this account; the implementation exports only Relay's configured database. No Cloudflare write or deletion permissions have been granted. No broader D1 permission is needed. The exporter preserves SQL types and row identifiers, validates schema stability and captured row counts, and rejects unsupported structures or responses above 8 MiB. Growth beyond these bounds requires review, not silent truncation or inconsistent pagination.

The heartbeat reports success only after a fresh, matching restore report passes integrity and access-revocation checks. Failure reporting sends only a status request, never logs or content. After explicit publication approval, the first GitHub run passed and sent the genuine success heartbeat. Better Stack was verified Up. Its one-day interval plus two-hour grace detects overdue verified backups; explicit job failures use the failure endpoint. No synthetic success was sent.

The bucket keeps all versions. The target is at least 30 days of recovery snapshots, with original versions retained while any kept manifest references them. The scheduled runner and backup heartbeat are active. There is currently no automatic pruning. Keeping all versions is conservative protection but can consume more than 30 days of storage. Never install a blanket upload-age deletion rule on originals.

Pruning must be a separately authorized process: enumerate retained manifests and exact version references, preserve anything referenced by them, preserve the newest verified recovery point, and flag unreferenced expired candidates for review. The regular upload identity cannot purge them. The daily configuration targets a 24-hour recovery point objective; scheduling delays, failures and capacity limits can extend it and must be acted upon when alerted.

## References

- [Cloudflare D1 exports](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [Backblaze uploads and encryption](https://www.backblaze.com/apidocs/b2-upload-file)
- [Backblaze multipart checksums](https://www.backblaze.com/apidocs/b2-finish-large-file)
- [Backblaze independent file catalog](https://www.backblaze.com/apidocs/b2-list-file-names)


### Membership reconciliation after restore

An older snapshot cannot prove that a previously active membership remains authorised today. Restore sanitization therefore sets a revocation timestamp on every still-active membership, including personal ownership, while preserving earlier revocations, roles, attribution and event records. A fresh provider login alone cannot reopen these libraries. Before cutover, an operator must reconcile current ownership and removal/deletion decisions against the surviving live database and incident evidence, then deliberately restore only verified access. Do not bulk-clear these timestamps or use old invitation/claim links as recovery proof. If current authorisation cannot be established, leave the affected library inaccessible until its ownership is resolved. This prioritises privacy over automatic access restoration; local tests do not constitute a live recovery drill.
