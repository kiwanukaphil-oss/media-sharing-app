import { createHash } from 'node:crypto';
import { completedOriginals, importSnapshot, sanitizeRestoredAccess } from './relay-backup.mjs';
import { planReadOnlySnapshot, restoreReadOnlySnapshot, schemaQuery } from './backup-d1-readonly.mjs';
import { verifiedLegacyErasureBindings } from './verify-erasure-ledger.mjs';

const reviewedLegacyShapes = new Set([
  'dc2a1bb15f54072ec07640ef071e7f9c1ac777ab7f3945d5b6d6e1459e472096', // Migration 0002: pre-role shared device spaces.
  '0544642fc9d98f28e19e2930c8750df1cbd429417481b5c51ca42b275ed5ac08', // Migration 0006: shared albums/sections, before accounts.
]);

// Only an authenticated, current fulfilled decision plus its digest-bound device evidence can name the
// legacy profiles. All content in these reviewed pre-account schemas was shared; preserve its originals
// and organisation. No name/email inference, cloud IO, schema upgrade or production cutover is possible.
export function minimiseLegacyDeviceSnapshot(sql, envelope, trust, personId, evidenceText, now = Date.now()) {
  const evidence = verifiedLegacyErasureBindings(envelope,trust,personId,evidenceText,now);
  const database = importSnapshot(sql);
  try {
    const shape = database.prepare(`SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*'
      AND name NOT GLOB '_cf_*' AND name<>'__drizzle_migrations' ORDER BY name`).all().map(({name}) =>
      [name,database.prepare('SELECT name,type FROM pragma_table_info(?) ORDER BY cid').all(name)]);
    const schemaDigest = createHash('sha256').update(JSON.stringify(shape)).digest('hex');
    if (!reviewedLegacyShapes.has(schemaDigest)) throw new Error('Historical device schema requires explicit review.');
    const originals = JSON.stringify(completedOriginals(database)), missingBindings = [];
    let minimisedProfiles = 0;
    for (const binding of evidence.legacyDevices) {
      const device = database.prepare('SELECT space_id FROM devices WHERE id=?').get(binding.deviceId);
      if (!device) { missingBindings.push(binding.deviceId); continue; }
      if (device.space_id !== binding.spaceId) throw new Error('Historical device scope differs from authenticated evidence.');
      database.prepare(`UPDATE devices SET name='Deleted member',token_hash='erased-device:' || id,
        expires_at=0,revoked_at=COALESCE(revoked_at,?) WHERE id=? AND space_id=?`).run(now,binding.deviceId,binding.spaceId);
      minimisedProfiles++;
    }
    sanitizeRestoredAccess(database,now);
    if (JSON.stringify(completedOriginals(database)) !== originals) throw new Error('Shared original references changed.');
    const exportPlan = planReadOnlySnapshot(database.prepare(schemaQuery).all());
    return {sql:restoreReadOnlySnapshot(exportPlan,database.prepare(exportPlan.sql).all()),mode:'isolated-review',
      scope:'authenticated-legacy-device-profiles-only',ledgerAuthenticated:true,cutoverAllowed:false,cloudErasureVerified:false,
      schemaDigest,sourceDigest:createHash('sha256').update(sql).digest('hex'),minimisedProfiles,missingBindings,
      historicalBindingsComplete:missingBindings.length === 0};
  } finally { database.close(); }
}
