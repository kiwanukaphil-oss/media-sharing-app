import { runClosureStorageEffect } from "./account-closure-fence";

type ObjectBody = Parameters<R2Bucket["put"]>[1];

// A request-scoped adapter preserves the native R2 interface while journalling every mutation before
// dispatch. The caller owns admission, metadata generation checks and final settlement. It is not wired
// into production until writer coverage and the protocol migration are reviewed together.
export function createClosureTrackedBucket(database: D1Database, admissionId: string, bucket: R2Bucket): R2Bucket {
  function put(key: string, value: ObjectBody, options: R2PutOptions & { onlyIf: R2Conditional | Headers }): Promise<R2Object | null>;
  function put(key: string, value: ObjectBody, options?: R2PutOptions): Promise<R2Object>;
  function put(key: string, value: ObjectBody, options?: R2PutOptions): Promise<R2Object | null> {
    return runClosureStorageEffect(database, admissionId, { objectKey: key, operation: "put" }, async () =>
      ({ value: await bucket.put(key, value, options) }));
  }

  // Resuming a multipart handle performs no storage request. Every operation on the returned handle
  // still obtains a fresh durable effect reservation, including handles created before a closure fence.
  function wrapMultipart(upload: R2MultipartUpload): R2MultipartUpload {
    const effect = { objectKey: upload.key, uploadId: upload.uploadId };
    return {
      key: upload.key, uploadId: upload.uploadId,
      uploadPart: (partNumber, value, options) => runClosureStorageEffect(database, admissionId,
        { ...effect, operation: "multipart_part", partNumber }, async () => ({ value: await upload.uploadPart(partNumber, value, options) })),
      complete: parts => runClosureStorageEffect(database, admissionId,
        { ...effect, operation: "multipart_complete" }, async () => ({ value: await upload.complete(parts) })),
      abort: () => runClosureStorageEffect(database, admissionId,
        { ...effect, operation: "multipart_abort" }, async () => ({ value: await upload.abort() })),
    };
  }

  return {
    head: bucket.head.bind(bucket), get: bucket.get.bind(bucket), list: bucket.list.bind(bucket), put,
    createMultipartUpload: (key, options) => runClosureStorageEffect(database, admissionId,
      { objectKey: key, operation: "multipart_create" }, async () => {
        const upload = await bucket.createMultipartUpload(key, options);
        return { value: wrapMultipart(upload), uploadId: upload.uploadId };
      }),
    resumeMultipartUpload: (key, uploadId) => wrapMultipart(bucket.resumeMultipartUpload(key, uploadId)),
    // Each key gets its own durable receipt. If a later key fails, prior outcomes remain reviewable.
    delete: async keys => {
      for (const key of typeof keys === "string" ? [keys] : keys) {
        await runClosureStorageEffect(database, admissionId, { objectKey: key, operation: "delete" },
          async () => ({ value: await bucket.delete(key) }));
      }
    },
  };
}
