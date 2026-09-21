import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { inventoryHistoricalSnapshots, inspectHistoricalSnapshot, reconcileHistoricalManifests } from '../scripts/inventory-historical-snapshots.mjs';
import { planReadOnlySnapshot, restoreReadOnlySnapshot, schemaQuery } from '../scripts/backup-d1-readonly.mjs';

const database = new DatabaseSync(':memory:');
let oldSql, currentSql;
try {
  const journal = JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')).entries;
  for (const [index,migration] of journal.entries()) {
    database.exec(await readFile(`drizzle/${migration.tag}.sql`,'utf8'));
    if (index === 6) {
      const plan = planReadOnlySnapshot(database.prepare(schemaQuery).all());
      oldSql = restoreReadOnlySnapshot(plan,database.prepare(plan.sql).all());
    }
  }
  const plan = planReadOnlySnapshot(database.prepare(schemaQuery).all());
  currentSql = restoreReadOnlySnapshot(plan,database.prepare(plan.sql).all());
} finally { database.close(); }
const oldReport = inspectHistoricalSnapshot(oldSql);
assert.equal(oldReport.identityTablesPresent,false);
assert.equal(oldReport.minimisationSchemaReviewed,false);
assert.equal(inspectHistoricalSnapshot(currentSql).minimisationSchemaReviewed,true);
const fileName = 'relay/snapshots/2026-09-21T09-04-10-836Z-76478b50-0d2d-4ba9-97a3-73fea8e7536b/database.sql';
const record = (id,sql) => ({fileId:id,fileName,action:'upload',size:Buffer.byteLength(sql),sha256:createHash('sha256').update(sql).digest('hex')});
const catalog = {listingComplete:true,fingerprint:'fixture',versions:[record('old',oldSql),record('new',currentSql)]};
const readIds = [];
const readPinned = async entry => {readIds.push(entry.fileId); return entry.fileId === 'old' ? oldSql : currentSql;};
const report = await inventoryHistoricalSnapshots(catalog,readPinned);
assert.deepEqual(readIds,['old','new']);
assert.equal(report.sqlUploadVersionsInspected,2);
assert.equal(report.manifestContentsInspected,false);
assert.equal(report.cutoverAllowed,false);
assert.equal(report.snapshots[0].minimisationSchemaReviewed,false);
await assert.rejects(inventoryHistoricalSnapshots({...catalog,listingComplete:false},readPinned));
await assert.rejects(inventoryHistoricalSnapshots(catalog,async () => currentSql),/digest/);
for (const changes of [{sha256:null},{fileName:'relay/snapshots/unknown'},{size:17*1024*1024},{fileId:''}]) {
  await assert.rejects(inventoryHistoricalSnapshots({...catalog,versions:[{...catalog.versions[0],...changes}]},readPinned),/review/);
}
await assert.rejects(inventoryHistoricalSnapshots({...catalog,versions:[catalog.versions[0],catalog.versions[0]]},readPinned),/review/);
const manifest = {formatVersion:1,snapshotId:fileName.split('/')[2],database:catalog.versions[1],
  tableCounts:report.snapshots[1].tableCounts,objects:[]};
const manifestText = JSON.stringify(manifest);
const manifestRecord = {...record('manifest',manifestText),fileName:fileName.replace('database.sql','manifest.json')};
const manifestCatalog = {...catalog,versions:[...catalog.versions,manifestRecord]};
const reconciled = await reconcileHistoricalManifests(manifestCatalog,report,async () => manifestText);
assert.equal(reconciled.manifests.length,1);
assert.deepEqual(reconciled.sqlVersionsWithoutManifest,['old']);
assert.equal(reconciled.originalBytesVerified,false);
await assert.rejects(reconcileHistoricalManifests({...manifestCatalog,versions:[catalog.versions[0],manifestRecord]},report,async () => manifestText),/missing/);
await assert.rejects(reconcileHistoricalManifests(manifestCatalog,report,async () => manifestText+' '),/digest/);
await assert.rejects(reconcileHistoricalManifests(manifestCatalog,{...report,catalogFingerprint:'other'},async () => manifestText),/agree/);
console.log('PASS: all pinned SQL versions, old-schema review, private/shared dependencies, tamper and incomplete catalog denial.');
