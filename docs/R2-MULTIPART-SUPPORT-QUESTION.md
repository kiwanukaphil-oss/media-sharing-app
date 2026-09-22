# Cloudflare R2 multipart cancellation guarantee

Submitted 22 September 2026 after explicit user authorisation. Cloudflare confirmed case **#02338622**: https://support.cloudflare.com/s/case/500Nv00000jQYdoIAG . Priority P4 (general question), no attachments or additional recipients. Response pending.

## Proposed recipient and subject

Cloudflare account support, R2 engineering/support.

Subject: R2 multipart abort guarantees for an in-flight UploadPart request

## Proposed message

We are implementing account-deletion handling for an application using R2 multipart uploads. Authenticated application endpoints issue presigned UploadPart URLs, and only our server can complete the multipart upload. Before cleanup, we revoke application access, stop issuing URLs and prevent completion.

The Workers API documentation says awaited R2MultipartUpload.abort() resolves after successful abort. In an isolated generated-data test, a later UploadPart and CompleteMultipartUpload both failed after abort, and HEAD found no object. We have not assumed this proves what happens to requests admitted before abort.

Please clarify the R2-specific guarantees for this sequence:

1. A presigned UploadPart request starts and is still transmitting its body.
2. The Worker successfully awaits abort() for that exact upload ID.
3. The earlier UploadPart request finishes transmitting after abort returns.

Can that in-flight request leave retained part data, recreate an upload, or allow any later completion? If retained part data is possible, which supported API and observation sequence establishes cleanup, and is there a documented maximum cleanup period? Does ListParts returning NoSuchUpload after abort establish that no previously admitted part request can retain data afterwards?

We need the guarantee specific to Cloudflare R2, rather than assuming Amazon S3 behaviour from API compatibility. We are asking about the customer-visible multipart lifecycle and provider-managed part retention, not physical media sanitisation. A documentation reference or written clarification would help us choose a correct deletion workflow.

No customer content, object keys, upload IDs, credentials or account identifiers are included in this message.

## Why this matters

The completed test and [R2 API documentation](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#r2multipartupload-definition) establish post-abort behaviour, but the documentation does not explicitly settle this in-flight case. Until the guarantee is established, the closure protocol keeps direct-upload capabilities unresolved. The inquiry does not request a configuration change or deletion.
