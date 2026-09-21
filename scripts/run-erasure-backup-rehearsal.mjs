import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { operationsDirectory, runPrivateCommand, storageRequest } from './backup-storage.mjs';
import { authorizeRehearsalCredential } from './erasure-rehearsal-storage.mjs';
import { rehearsalBucketId, rehearsalPrefix, planGeneratedVersionRemoval } from './erasure-rehearsal-scope.mjs';
import { minimiseErasedSnapshot, providerIdentityDigest } from './minimise-erased-snapshot.mjs';
import { importSnapshot } from './relay-backup.mjs';
import { planReadOnlySnapshot, restoreReadOnlySnapshot, schemaQuery } from './backup-d1-readonly.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

// Decrypt only in memory; the temporary credential is never printed or passed on a process command line.
async function loadRehearsalCredential() {
  const sealed=await readFile(resolve(operationsDirectory,'erasure-isolated-test.dpapi'),'utf8');
  const plaintext=await runPrivateCommand('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    '$ErrorActionPreference="Stop"; $sealed=[Console]::In.ReadToEnd(); $value=ConvertTo-SecureString $sealed; $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($value); try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }'],sealed);
  const credential=JSON.parse(plaintext);
  if(!Number.isSafeInteger(credential.savedAt)||Date.now()-credential.savedAt>3300000||Date.now()<credential.savedAt)throw new Error('Temporary credential is stale.');
  return credential;
}

// Build a real-schema snapshot entirely from generated identities and bytes. No production export is read.
async function generatedSnapshot(bytes) {
  const database=new DatabaseSync(':memory:');
  try {
    const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')).entries;
    for(const migration of journal)database.exec(await readFile(`drizzle/${migration.tag}.sql`,'utf8'));
    database.exec(`INSERT INTO people(id,issuer,subject,display_name,verified_email,created_at) VALUES
      ('erased-test','https://synthetic.invalid/','erased-subject','Generated private name','erased@example.test',1),
      ('kept-test','https://synthetic.invalid/','kept-subject','Generated keeper','kept@example.test',1);
      INSERT INTO spaces VALUES ('test-personal','Generated private library',1),('test-shared','Generated shared library',1);
      INSERT INTO personal_spaces VALUES ('test-personal','erased-test',1024);
      INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES
        ('private-member','erased-test','test-personal','owner',1),('shared-member','erased-test','test-shared','owner',1),
        ('kept-member','kept-test','test-shared','owner',1);
      INSERT INTO devices(id,space_id,name,token_hash,created_at,expires_at) VALUES
        ('private-device','test-personal','Generated private device','synthetic-private-token',1,999),
        ('shared-device','test-shared','Generated shared device','synthetic-shared-token',1,999);
      INSERT INTO account_space_actors VALUES ('private-member','private-device'),('shared-member','shared-device');
      INSERT INTO account_deletion_requests VALUES ('synthetic-request','erased-test',1,'pending',1);`);
    const insert=database.prepare(`INSERT INTO media(id,space_id,device_id,name,mime,size,sha256,category,object_key,upload_id,part_size,status,created_at)
      VALUES (?,?,?,'Generated original','application/octet-stream',?,?,'original',?,'synthetic-upload',16,'ready',1)`);
    insert.run('private-original','test-personal','private-device',bytes.length,digest(bytes),'test-personal/original');
    insert.run('shared-copy','test-shared','shared-device',bytes.length,digest(bytes),'test-shared/copy');
    const plan=planReadOnlySnapshot(database.prepare(schemaQuery).all());
    return restoreReadOnlySnapshot(plan,database.prepare(plan.sql).all());
  } finally {database.close();}
}

// Pin each uploaded version and require both provider SHA-1 acknowledgement and metadata/size agreement.
async function uploadGeneratedVersion(session,fileName,bytes,purpose) {
  if(!fileName.startsWith(rehearsalPrefix)||bytes.length>1048576)throw new Error('Generated fixture exceeds its scope.');
  const target=await storageRequest(session,'b2_get_upload_url',{bucketId:rehearsalBucketId});
  const url=new URL(target.uploadUrl);
  if(url.protocol!=='https:'||url.username||url.password||url.port||!/\.backblaze(?:b2)?\.com$/.test(url.hostname))throw new Error('Unexpected upload endpoint.');
  const sha256=digest(bytes),sha1=createHash('sha1').update(bytes).digest('hex');
  const response=await fetch(url,{method:'POST',headers:{Authorization:target.authorizationToken,
    'Content-Type':'application/octet-stream','Content-Length':String(bytes.length),'X-Bz-File-Name':encodeURIComponent(fileName),
    'X-Bz-Content-Sha1':sha1,'X-Bz-Info-sha256':sha256,'X-Bz-Server-Side-Encryption':'AES256'},body:bytes,
    redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error('Generated fixture upload failed.');
  const version=await response.json();
  if(version.bucketId!==rehearsalBucketId||version.fileName!==fileName||version.contentLength!==bytes.length||
      version.contentSha1!==sha1||version.action!=='upload'||version.serverSideEncryption?.mode!=='SSE-B2')throw new Error('Generated upload acknowledgement differs.');
  return {fileId:version.fileId,fileName,size:bytes.length,sha256,purpose};
}

async function listGeneratedVersions(session) {
  const result=await storageRequest(session,'b2_list_file_versions',{bucketId:rehearsalBucketId,prefix:rehearsalPrefix,maxFileCount:1000});
  if(!Array.isArray(result.files)||result.nextFileId!==null||result.nextFileName!==null)throw new Error('Test catalog is unexpectedly large or incomplete.');
  return result.files;
}

async function restoreGeneratedVersion(session,record) {
  const url=new URL('/b2api/v4/b2_download_file_by_id',session.downloadUrl);
  url.searchParams.set('fileId',record.fileId);
  const response=await fetch(url,{headers:{Authorization:session.token},redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok||response.headers.get('x-bz-file-id')!==record.fileId||decodeURIComponent(response.headers.get('x-bz-file-name')??'')!==record.fileName)throw new Error('Pinned test restoration failed.');
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length!==record.size||digest(bytes)!==record.sha256)throw new Error('Restored generated bytes differ.');
  return bytes;
}

// Mutations are confined to a separate bucket and an exact generated-version manifest. Preserve controls
// are downloaded and verified before obsolete versions are removed, then independently checked again.
async function rehearseCloudErasure() {
  const session=await authorizeRehearsalCredential(await loadRehearsalCredential());
  if((await listGeneratedVersions(session)).length)throw new Error('Rehearsal prefix is not empty; review previous evidence first.');
  const runId=randomUUID(),directory=resolve(operationsDirectory,'erasure-rehearsals',runId);
  await mkdir(directory,{recursive:true});
  const bytes=Buffer.from(`Relay generated shared-copy preservation fixture ${runId}`);
  const oldSql=await generatedSnapshot(bytes);
  const minimised=minimiseErasedSnapshot(oldSql,{formatVersion:1,personId:'erased-test',
    identityDigest:providerIdentityDigest('https://synthetic.invalid/','erased-subject')});
  const base=`${rehearsalPrefix}${runId}/`,records=[];
  for(const [name,content,purpose] of [
    ['old.sql',Buffer.from(oldSql),'obsolete-private'],['old.sql',Buffer.from(oldSql),'obsolete-private'],
    ['private.bin',bytes,'obsolete-private'],['shared.bin',bytes,'retained-shared'],
    ['minimised.sql',Buffer.from(minimised.sql),'retained-snapshot'],
  ]) {
    records.push(await uploadGeneratedVersion(session,base+name,content,purpose));
    await writeFile(resolve(directory,'generated-manifest.json'),JSON.stringify({runId,records},null,2),{mode:0o600});
  }
  const plan=planGeneratedVersionRemoval(records,await listGeneratedVersions(session));
  for(const record of plan.preserve)await restoreGeneratedVersion(session,record);
  for(const record of plan.remove) {
    const result=await storageRequest(session,'b2_delete_file_version',{fileName:record.fileName,fileId:record.fileId});
    if(result.fileId!==record.fileId||result.fileName!==record.fileName)throw new Error('Generated version deletion acknowledgement differs.');
  }
  const remaining=await listGeneratedVersions(session);
  if(remaining.length!==plan.preserve.length||remaining.some(version=>!plan.preserve.some(record=>record.fileId===version.fileId)))throw new Error('Final test inventory differs.');
  for(const record of plan.preserve) {
    const restored=await restoreGeneratedVersion(session,record);
    if(record.purpose==='retained-snapshot') {
      const database=importSnapshot(restored.toString('utf8'));
      try {
        const media=database.prepare('SELECT id,sha256 FROM media').all();
        if(media.length!==1||media[0].id!=='shared-copy'||media[0].sha256!==digest(bytes)||
          database.prepare("SELECT COUNT(*) AS n FROM people WHERE issuer='https://synthetic.invalid/' AND subject='erased-subject'").get().n||
          database.prepare('SELECT COUNT(*) AS n FROM devices WHERE revoked_at IS NULL').get().n)throw new Error('Minimised cloud restoration failed.');
      } finally {database.close();}
    }
  }
  const report={runId,status:'passed-generated-only',bucketId:rehearsalBucketId,uploadedVersions:records.length,
    removedObsoleteVersions:plan.remove.length,retainedVerifiedVersions:plan.preserve.length,productionDataChanged:false,
    ledgerIntegrated:false,providerErasureTested:false,verifiedAt:new Date().toISOString()};
  await writeFile(resolve(directory,'verification.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify(report));
}

try {await rehearseCloudErasure();}
catch {console.error('Isolated cloud rehearsal stopped. Review private generated manifests; no production scope is permitted.');process.exitCode=1;}
