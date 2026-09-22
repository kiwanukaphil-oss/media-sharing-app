import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {verifyRecoverySnapshot} from '../scripts/relay-backup.mjs';
import {backupBucketId} from '../scripts/backup-storage.mjs';
const originalFetch=globalThis.fetch,variables=['GITHUB_ACTIONS','GITHUB_RUN_ID','B2_READER_KEY_JSON','BACKUP_VERIFICATION_KEY','RELAY_VERIFICATION_OUTPUT','RELAY_PREVIOUS_VERIFICATION_FILE','RELAY_PREVIOUS_VERIFICATION_RUN'];
const old=Object.fromEntries(variables.map(key=>[key,process.env[key]]));
const directory=resolve('.sites-runtime/verification-flow-'+randomUUID());await mkdir(directory,{recursive:true});
process.env.GITHUB_ACTIONS='true';process.env.B2_READER_KEY_JSON=JSON.stringify({applicationKeyId:'fixture',applicationKey:'fixture'});process.env.BACKUP_VERIFICATION_KEY=randomBytes(32).toString('hex');
let objects=new Map(),manifest,downloads=[],missing=false;
const digest=bytes=>({size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
const record=(name,bytes,id)=>{const entry={fileName:name,fileId:id,...digest(bytes)};objects.set(id,{entry,bytes});return entry;};
// Drive the real verifier through full and incremental cloud-shaped responses; no live credentials or network are used.
async function run(mode,replaceVersion=false){
 const snapshotId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID();objects=new Map();downloads=[];
 const bytes=Buffer.from('test'),hash=digest(bytes).sha256;
 const backup=record('relay/originals/'+hash,bytes,replaceVersion?'new-original-version':'original-version');
 const sql=Buffer.from(`CREATE TABLE spaces(id TEXT PRIMARY KEY);CREATE TABLE devices(id TEXT PRIMARY KEY,revoked_at INTEGER,expires_at INTEGER);CREATE TABLE invitations(id TEXT PRIMARY KEY,expires_at INTEGER,redeemed_at INTEGER);CREATE TABLE media(id TEXT PRIMARY KEY,object_key TEXT,size INTEGER,sha256 TEXT,status TEXT,preview_ready INTEGER,preview_size INTEGER);INSERT INTO spaces VALUES('s');INSERT INTO devices VALUES('d',NULL,9999999999999);INSERT INTO invitations VALUES('i',9999999999999,NULL);INSERT INTO media VALUES('m','source-key',4,'${hash}','ready',0,0);`);
 const database=record(`relay/snapshots/${snapshotId}/database.sql`,sql,'database');
 const content={formatVersion:1,snapshotId,database,tableCounts:{spaces:1,devices:1,invitations:1,media:1},objects:[{id:'m',object_key:'source-key',size:4,sha256:hash,backup}]};
 manifest=record(`relay/snapshots/${snapshotId}/manifest.json`,Buffer.from(JSON.stringify(content)),'manifest');
 await verifyRecoverySnapshot(snapshotId,mode);
 return JSON.parse(await readFile(`.sites-runtime/operations/backups/${snapshotId}/restore-verification.json`,'utf8'));
}
globalThis.fetch=async(url,options)=>{
 const address=new URL(url);
 if(address.pathname.endsWith('b2_authorize_account'))return Response.json({authorizationToken:'fixture',apiInfo:{storageApi:{apiUrl:'https://api.backblazeb2.com',downloadUrl:'https://f001.backblazeb2.com',allowed:{capabilities:['listFiles','readFiles'],buckets:[{id:backupBucketId}],namePrefix:'relay/'}}}});
 if(address.pathname.endsWith('b2_list_file_names'))return Response.json({files:[{...manifest,action:'upload',contentLength:manifest.size,fileInfo:{sha256:manifest.sha256}}]});
 if(address.pathname.endsWith('b2_get_file_info')){const entry=objects.get(JSON.parse(options.body).fileId)?.entry;return Response.json({...entry,fileId:missing?'missing':entry.fileId,bucketId:backupBucketId,action:'upload',contentLength:entry.size,fileInfo:{sha256:entry.sha256},serverSideEncryption:{mode:'SSE-B2'}});}
 if(address.pathname.endsWith('b2_download_file_by_id')){const id=address.searchParams.get('fileId');downloads.push(id);const object=objects.get(id);return new Response(object.bytes,{headers:{'x-bz-file-name':object.entry.fileName,'x-bz-file-id':id}});}
 throw new Error('Unexpected verification fixture request');
};
try{
 process.env.GITHUB_RUN_ID='1';process.env.RELAY_VERIFICATION_OUTPUT=directory+'/full.enc';
 const full=await run('full');assert.equal(full.status,'verified');assert.ok(downloads.includes('original-version'));
 process.env.RELAY_PREVIOUS_VERIFICATION_FILE=directory+'/full.enc';process.env.RELAY_PREVIOUS_VERIFICATION_RUN='1';process.env.GITHUB_RUN_ID='2';process.env.RELAY_VERIFICATION_OUTPUT=directory+'/incremental.enc';
 const incremental=await run('auto');assert.equal(incremental.status,'incremental-verified');assert.equal(incremental.carriedBytes,4);assert.equal(incremental.downloadedBytes,0);assert.deepEqual(downloads,['manifest','database']);
 process.env.RELAY_VERIFICATION_OUTPUT=directory+'/changed.enc';const changed=await run('auto',true);assert.equal(changed.downloadedBytes,4);assert.ok(downloads.includes('new-original-version'));
 process.env.RELAY_VERIFICATION_OUTPUT=directory+'/missing.enc';missing=true;await assert.rejects(run('auto'),/unavailable or changed/);await assert.rejects(readFile(directory+'/missing.enc'));
 console.log('PASS: real verification flow independently reads full originals, carries authenticated exact versions, rereads changed versions and rejects missing old versions without a success receipt.');
}finally{globalThis.fetch=originalFetch;for(const key of variables){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
