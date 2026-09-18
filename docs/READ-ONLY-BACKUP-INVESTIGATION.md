# Read-only D1 backup investigation

Verified on 2026-09-18 with the existing approved D1:Read token.

## Findings

The native export endpoint rejects this token (HTTP 401 / code 10000), while the documented query endpoint accepts D1 Read. A live SELECT-only prototype successfully obtained schema and all application rows in a single SQLite statement using UNION ALL. The returned metadata reported rows_written=0 and changed_db=false.

The generated SQL was imported into isolated local SQLite and passed integrity and foreign-key checks. Restored counts were: spaces 2, devices 7, invitations 9, media 5. The SQL was 10,891 bytes. Private SQL and the non-secret report are under ignored .sites-runtime/operations/read-only-prototype.*. No production rows, credentials, permissions, deployment, scheduled jobs or heartbeat state were changed.

## Recommended implementation

Replace the hosted native export command with a SELECT-only logical exporter using the existing token and fixed Relay database ID. No new service, public endpoint or write credential is needed. Local operator exports can retain the native command.

1. Discover schema and column metadata using read-only queries, and reject unsupported virtual/generated structures rather than silently omit them.
2. Capture schema, table row counts and serialized rows in one final SQL statement so concurrent app writes cannot produce a mixture of table snapshots. Compare the captured schema against planning metadata and retry or fail if it changed.
3. Serialize values inside SQLite, preserving full integer precision, NULL, binary values and text containing embedded zero bytes; avoid conversion through JavaScript numeric values. Recreate indexes/views/triggers after data import and retain relevant sequence state.
4. Enforce query/response limits and compare restored counts to counts captured in the same snapshot. Fail closed on oversized or incomplete responses; do not quietly paginate into inconsistent snapshots.
5. Test data-type edge cases, schema changes, truncated results, failed API responses and integrity checks, then run the existing independent Backblaze restore verification with the new exporter.

The prototype deliberately uses column metadata from a prior native export; it is evidence of feasibility, not production implementation. The token remains account-wide read-only, as previously approved; the implementation targets only Relay. This approach does not reduce the credential's existing account-wide read scope.

## Alternatives and activation

Account-wide D1 Edit would allow native exports but introduces modification/deletion capabilities; it is not recommended or approved. A custom Worker would introduce a new authenticated endpoint and deployment and is unnecessary for the verified SELECT approach.

The user approved implementation. scripts/backup-d1-readonly.mjs now discovers live schema without a prior export, preserves SQLite values and sequence state, enforces response limits, and validates an isolated restore. Nineteen backup tests and targeted lint passed. A complete environment-secret copy and independent Backblaze restore passed locally on 2026-09-18; no GitHub run or heartbeat activation has occurred. Commit/push and schedule activation still require separate confirmation after implementation and verification. Existing manual Backblaze recovery points remain valid.

References: [Cloudflare query API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/) and [export API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/).
