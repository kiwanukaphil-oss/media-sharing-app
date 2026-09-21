import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inventoryBackupVersions } from './inventory-backup-versions.mjs';
import { authorizeBackupRole, downloadBackupFile, operationsDirectory, storageRequest } from './backup-storage.mjs';
import { completedOriginals, importSnapshot } from './relay-backup.mjs';
import { providerIdentityDigest } from './minimise-erased-snapshot.mjs';

const reviewedSchemaDigest = 'b59ead9f977608a709cc1569f7fa90b6427f18b12908bb3babc57dad12902201';
const snapshotName = /^relay\/snapshots\/\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9-]{36}\/database\.sql$/;

// Inspect only downloaded, digest-verified SQL in a fresh in-memory database. Older schemas are inventoried
// but explicitly require separate minimisation review; absent modern tables never mean no historical data.
export function inspectHistoricalSnapshot(sql) {
  const database = importSnapshot(sql);
  try {
    const tables = database.prepare(`SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*'
      AND name NOT GLOB '_cf_*' AND name<>'__drizzle_migrations' ORDER BY name`).all();
    const shape = tables.map(({name}) => [name, database.prepare('SELECT name,type FROM pragma_table_info(?) ORDER BY cid').all(name)]);
    const schemaDigest = createHash('sha256').update(JSON.stringify(shape)).digest('hex');
    const hasPeople = tables.some(table => table.name === 'people');
    const hasPersonalSpaces = tables.some(table => table.name === 'personal_spaces');
    const people = hasPeople ? database.prepare('SELECT id,issuer,subject FROM people ORDER BY id').all().map(person => ({
      personId:person.id, identityDigest:person.issuer === 'urn:relay:erased' ? person.subject : providerIdentityDigest(person.issuer,person.subject),
      tombstone:person.issuer === 'urn:relay:erased',
    })) : [];
    const personalSpaces = hasPersonalSpaces ? database.prepare('SELECT space_id,person_id FROM personal_spaces ORDER BY space_id').all() : [];
    const completed = completedOriginals(database);
    const ownership = new Map(database.prepare('SELECT id,space_id FROM media').all().map(row => [row.id,row.space_id]));
    const personalOwners = new Map(personalSpaces.map(row => [row.space_id,row.person_id]));
    const content = new Map();
    for (const original of completed) {
      const entry = content.get(original.sha256) ?? {sha256:original.sha256, references:[]};
      entry.references.push({mediaId:original.id,spaceId:ownership.get(original.id),
        personalOwner:personalOwners.get(ownership.get(original.id)) ?? null});
      content.set(original.sha256,entry);
    }
    return {schemaDigest, minimisationSchemaReviewed:schemaDigest === reviewedSchemaDigest,
      identityTablesPresent:hasPeople, personalOwnershipTablePresent:hasPersonalSpaces,
      people, personalSpaces, completedOriginalReferences:completed.length,
      contentReferences:[...content.values()].sort((a,b) => a.sha256.localeCompare(b.sha256)),
      nonReadyMedia:database.prepare("SELECT COUNT(*) AS n FROM media WHERE status<>'ready'").get().n,
      cutoverAllowed:false};
  } finally { database.close(); }
}

// Visit every SQL upload version, including superseded versions of the same name. Never follow a latest-name
// pointer. A missing hash, malformed snapshot name or unreadable version prevents a complete report.
export async function inventoryHistoricalSnapshots(catalog, readPinnedSql) {
  if (catalog?.listingComplete !== true || !Array.isArray(catalog.versions)) throw new Error('Complete backup catalog required.');
  const versions = catalog.versions.filter(record => record.action === 'upload' && record.fileName.startsWith('relay/snapshots/'));
  const reports = [], ids = new Set();
  for (const record of versions) {
    if (record.fileName.endsWith('/manifest.json')) continue;
    if (!snapshotName.test(record.fileName) || !/^[a-f0-9]{64}$/.test(record.sha256 ?? '') ||
        !Number.isSafeInteger(record.size) || record.size <= 0 || record.size > 16 * 1024 * 1024 ||
        typeof record.fileId !== 'string' || !record.fileId || ids.has(record.fileId))
      throw new Error('Historical snapshot version requires private review.');
    ids.add(record.fileId);
    const sql = await readPinnedSql(record);
    if (typeof sql !== 'string' || Buffer.byteLength(sql) !== record.size ||
        createHash('sha256').update(sql).digest('hex') !== record.sha256) throw new Error('Historical snapshot digest mismatch.');
    reports.push({fileId:record.fileId,fileName:record.fileName,sha256:record.sha256,...inspectHistoricalSnapshot(sql)});
  }
  return {formatVersion:1,mode:'review-only',executable:false,cutoverAllowed:false,
    catalogFingerprint:catalog.fingerprint,sqlUploadVersionsInspected:reports.length,
    manifestContentsInspected:false,atomicSnapshot:false,snapshots:reports};
}

// Use the existing read-only backup credential and keep all identifying details in ignored local storage.
// Re-list after downloads to detect catalog movement. Even equal catalogs do not establish a write freeze.
async function saveHistoricalSnapshotInventory() {
  const reader = await authorizeBackupRole('reader');
  const list = () => inventoryBackupVersions((operation,parameters) => storageRequest(reader,operation,parameters));
  const before = await list();
  const directory = resolve(operationsDirectory,'historical-snapshot-inventories',randomUUID());
  await mkdir(directory,{recursive:true});
  let index = 0;
  const report = await inventoryHistoricalSnapshots(before,async record => {
    const destination = resolve(directory,`${index++}.sql`);
    await downloadBackupFile(reader,record,destination);
    return readFile(destination,'utf8');
  });
  const after = await list();
  if (before.fingerprint !== after.fingerprint) throw new Error('Backup catalog changed during historical review.');
  await writeFile(resolve(directory,'inventory.json'),JSON.stringify({...report,generatedAt:new Date().toISOString(),
    catalogUnchangedAcrossReads:true},null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:'private-historical-inventory-saved',sqlVersions:report.sqlUploadVersionsInspected,
    olderSchemas:report.snapshots.filter(snapshot => !snapshot.minimisationSchemaReviewed).length,
    executable:false,cutoverAllowed:false}));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await saveHistoricalSnapshotInventory(); }
  catch { console.error('Historical snapshot review incomplete; inspect private records. No deletion or restore cutover authorised.'); process.exitCode=1; }
}
