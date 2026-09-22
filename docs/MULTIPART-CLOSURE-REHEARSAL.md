# Multipart closure rehearsal

Prepared 22 September 2026. Component verification only; no full closure or production storage mutation.

## Exact scope

- Existing isolated Worker, D1 and R2: `relay-publication-rehearsal`.
- D1 ID: `a22d670e-2a20-4266-9f07-0601406a0d56`; the established isolated-storage marker is required.
- Only object key: `closure-multipart-rehearsal/2026-09-22/20ce059c-53bd-48ae-94fb-31efc0e55122`.
- Seed creates one multipart upload and records its exact returned ID in the isolated D1 marker table. No user file is uploaded.
- Run uploads one small generated text part, aborts that exact upload, attempts a later part and completion, and requires both to fail plus HEAD absence. No caller-provided key, upload ID, SQL or URL is accepted.
- The existing rehearsal signing key stays in encrypted local custody; a one-hour deployment expiry and disabled run flag protect preparation. No new credential or broader access is required.
- An ambiguous allocation or interrupted run requires review; no automatic reseeding. Passed execution is repeat-safe without repeating storage mutation.

## Progress

- [x] Implement exact-target seed/run and isolated local tests.
- [x] Pass TypeScript, focused lint and isolated deployment dry run.
- [x] Seed the hosted generated upload and independently read its exact key, recorded upload-ID presence and seeded phase from isolated D1. Prepared Worker `0c1e91c0-eea6-44ee-a538-7a369430f40e`.
- [x] User explicitly approved this exact generated-upload test on 22 September.
- [x] Execute successfully on Worker `6a6aa604-4a57-4e8c-aea3-2a1e33aeab7a`; independent D1 readback confirms passed, late-part rejection and completion rejection at 07:45:36 UTC. Disable again as `8a970823-89b4-458d-8f35-225baee87025` with expiry zero and run false; public endpoint rejects with 403. No production objects changed.

## Evidence boundary

Cloudflare documents successful awaited abort and warns that a multipart handle does not itself prove an active upload exists. It does not provide a bound here for all previously started remote part requests. [Cloudflare R2 API reference](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#r2multipartupload-definition).

Amazon S3 separately warns that in-progress parts can survive an abort and recommends checking parts. This is a reason to avoid assuming quiescence from S3 compatibility, not proof of identical Cloudflare behaviour. [Amazon S3 AbortMultipartUpload](https://docs.aws.amazon.com/AmazonS3/latest/API/API_AbortMultipartUpload.html).

This test records only post-abort rejection. Its receipt explicitly retains `quiescenceProven: false`. Direct capability settlement, in-flight request reconciliation, independently authenticated disposition and full lifecycle verification remain separate requirements.
