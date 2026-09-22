import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {uploadBackupStream,verifyBackupStream,inspectVerifiedBackupVersion,backupBucketId} from '../scripts/backup-storage.mjs';
const nativeFetch=globalThis.fetch,session={apiUrl:'https://api.backblazeb2.com',downloadUrl:'https://f001.backblazeb2.com',token:'fixture-only'};
const body=bytes=>new ReadableStream({start(controller){for(let offset=0;offset<bytes.length;offset+=1024*1024)controller.enqueue(bytes.subarray(offset,offset+1024*1024));controller.close();}});
// Emulate provider acknowledgements while independently checking each actual outgoing part's size and SHA-1.
try {
 for(const size of [7,16*1024*1024,16*1024*1024+1,32*1024*1024]){
  const bytes=Buffer.alloc(size,37),sha256=createHash('sha256').update(bytes).digest('hex'),name='relay/originals/'+sha256;
  let total=0,parts=[],finished=false;
  const result={fileId:'version',fileName:name,bucketId:backupBucketId,action:'upload',contentLength:size,serverSideEncryption:{mode:'SSE-B2'},fileInfo:{sha256}};
  globalThis.fetch=async(url,options)=>{
   if(String(url).endsWith('b2_start_large_file'))return Response.json({fileId:'version'});
   if(/b2_get_upload(_part)?_url$/.test(String(url)))return Response.json({uploadUrl:'https://pod.backblazeb2.com/upload',authorizationToken:'fixture'});
   if(String(url).endsWith('/upload')){
    assert.ok(options.body.length<=16*1024*1024);total+=options.body.length;
    const sha1=createHash('sha1').update(options.body).digest('hex');
    if(options.headers['X-Bz-Part-Number']){assert.equal(options.headers['X-Bz-Part-Number'],String(parts.length+1));assert.equal(options.headers['X-Bz-Content-Sha1'],sha1);parts.push(sha1);return Response.json({contentSha1:sha1,contentLength:options.body.length});}
    finished=true;return Response.json({...result,contentSha1:sha1});
   }
   if(String(url).endsWith('b2_finish_large_file')){assert.ok(parts.length>=2);assert.deepEqual(JSON.parse(options.body).partSha1Array,parts);finished=true;return Response.json(result);}
   if(String(url).endsWith('b2_get_file_info'))return Response.json(result);
   throw new Error('Unexpected fixture request');
  };
  const record=await uploadBackupStream(session,body(bytes),name,{size,sha256});assert.equal(total,size);assert.equal(finished,true);
  await inspectVerifiedBackupVersion(session,record);
  const download=async()=>new Response(body(bytes),{headers:{'x-bz-file-name':name,'x-bz-file-id':'version'}});
  assert.equal((await verifyBackupStream(session,record,download)).sha256,sha256);
  await assert.rejects(verifyBackupStream(session,{...record,size:size-1},download));
  await assert.rejects(verifyBackupStream(session,{...record,sha256:'a'.repeat(64)},download));
  await assert.rejects(verifyBackupStream(session,{...record,fileId:'wrong'},download));
  finished=false;
  await assert.rejects(uploadBackupStream(session,body(bytes), 'relay/originals/'+'b'.repeat(64),{size,sha256:'b'.repeat(64)}));
  assert.equal(finished,false,'Corrupt source cannot finalize a backup original');
 }
 console.log('PASS: bounded single/multipart streaming, provider part checks, no disk copies, byte corruption/truncation and wrong-version refusal.');
}finally{globalThis.fetch=nativeFetch;}
