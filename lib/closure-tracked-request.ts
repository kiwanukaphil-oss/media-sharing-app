import { admitClosureTrackedWrite, settleClosureTrackedWrite, type ClosureWriteActor } from "./account-closure-fence";
import { createClosureTrackedBucket } from "./closure-tracked-bucket";

// The response is returned only after all awaited work has been accounted for. Issued direct capabilities
// or caught ambiguous storage failures preserve uncertainty without discarding an otherwise valid response.
// A failed request never automatically clears its admission; a failed journal update leaves it active.
export async function runClosureTrackedRequest<T>(database: D1Database, storage: R2Bucket, actor: ClosureWriteActor,
  dispatch: (storage: R2Bucket, admissionId: string) => Promise<T>): Promise<T> {
  const admission = await admitClosureTrackedWrite(database, actor);
  try {
    const value = await dispatch(createClosureTrackedBucket(database, admission.id, storage), admission.id);
    const unresolved = await database.prepare("SELECT 1 FROM closure_storage_effects WHERE admission_id=? AND state<>'acknowledged' LIMIT 1")
      .bind(admission.id).first();
    await settleClosureTrackedWrite(database, admission.id, unresolved ? "uncertain" : "settled");
    return value;
  } catch (failure) {
    try { await settleClosureTrackedWrite(database, admission.id, "uncertain"); }
    catch { /* An existing active/uncertain record remains a closure blocker if this acknowledgement fails. */ }
    throw failure;
  }
}
