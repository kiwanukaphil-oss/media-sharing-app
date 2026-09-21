import assert from 'node:assert/strict';
import { createReadOnlyR2InventoryRequest, inventoryR2Objects, parseR2InventoryXml } from '../scripts/inventory-r2-objects.mjs';

const namespace = 'http://s3.amazonaws.com/doc/2006-03-01/';
const date = '2026-09-21T00:00:00.000Z';
const document = (root,content) => `<${root} xmlns="${namespace}">${content}</${root}>`;
const objectXml = key => `<Contents><Key>${key}</Key><Size>12</Size><ETag>&quot;etag&quot;</ETag><LastModified>${date}</LastModified></Contents>`;
const listXml = document('ListBucketResult',`<Name>relay-media-originals</Name><EncodingType>url</EncodingType><IsTruncated>false</IsTruncated><KeyCount>1</KeyCount>${objectXml('safe%2Fkey%2Bname')}`);
const emptyMultipart = document('ListMultipartUploadsResult','<Bucket>relay-media-originals</Bucket><EncodingType>url</EncodingType><IsTruncated>false</IsTruncated>');
const parsed = await parseR2InventoryXml(listXml);
assert.equal(parsed.objects[0].etag,'"etag"');
assert.equal(parsed.objects[0].size,'12');
assert.deepEqual((await parseR2InventoryXml(emptyMultipart)).uploads,[]);
for (const invalid of [listXml.replace(namespace,'https://wrong/'),listXml.replace('</Name>','</Name><Name>another</Name>'),
  listXml.replace('<Size>12</Size>','<Size><value>12</value></Size>'),
  `<!DOCTYPE ListBucketResult [<!ENTITY xxe SYSTEM "file:///not-a-real-private-file">]>${listXml.replace('relay-media-originals','&xxe;')}`,
  listXml.replace('</ListBucketResult>','<CommonPrefixes><Prefix>hidden</Prefix></CommonPrefixes></ListBucketResult>'),
  '<invalid>']) await assert.rejects(parseR2InventoryXml(invalid));
const multipartPage = await parseR2InventoryXml(emptyMultipart);
const calls = [];
const inventory = await inventoryR2Objects(async (mode,cursor) => {
  calls.push({mode,cursor});
  if (mode === 'objects') {
    if (!cursor['continuation-token']) return {...parsed,truncated:'true',nextContinuationToken:'opaque+token'};
    assert.equal(cursor['continuation-token'],'opaque+token');
    return {...parsed,objects:[{...parsed.objects[0],key:'second'}]};
  }
  if (!cursor['key-marker']) return {...multipartPage,truncated:'true',nextKeyMarker:'safe%2Fkey%2Bname',nextUploadIdMarker:'upload-1',
    uploads:[{key:'safe%2Fkey%2Bname',uploadId:'upload-1',initiatedAt:date}]};
  assert.equal(cursor['key-marker'],'safe/key+name');
  assert.equal(cursor['upload-id-marker'],'upload-1');
  return {...multipartPage,uploads:[{key:'safe%2Fkey%2Bname',uploadId:'upload-2',initiatedAt:date}]};
});
assert.equal(inventory.objects.length,2); assert.equal(inventory.unfinishedUploads.length,2);
assert.equal(inventory.objects[0].key,'safe/key+name'); assert.equal(inventory.executable,false);
assert.equal(inventory.atomicSnapshot,false); assert.equal(calls.length,4);
for (const changes of [{bucket:'wrong'},{encoding:'none'},{keyCount:'2'},{truncated:'maybe'},
  {objects:[{...parsed.objects[0],key:'invalid%'}]},{objects:[{...parsed.objects[0],size:'-1'}]},
  {objects:[{...parsed.objects[0],modifiedAt:'invalid'}]}]) {
  await assert.rejects(inventoryR2Objects(async () => ({...parsed,...changes})));
}
await assert.rejects(inventoryR2Objects(async () => ({...parsed,truncated:'true',nextContinuationToken:'cycle'})),/Duplicate/);
await assert.rejects(inventoryR2Objects(async () => ({...parsed,objects:[],keyCount:'0',truncated:'true',nextContinuationToken:'cycle'})),/cursor/);
await assert.rejects(inventoryR2Objects(async () => ({...parsed,truncated:'true',nextContinuationToken:null})),/continuation/);
const signedRequests = [];
const request = createReadOnlyR2InventoryRequest({accessKeyId:'fixture-id',secretAccessKey:'fixture-secret'},async (signed,options) => {
  signedRequests.push(signed);
  assert.equal(signed.method,'GET');
  assert.equal(options.redirect,'error');
  const url = new URL(signed.url);
  assert.equal(url.origin,'https://5afd1facc45c9ddd86114155b09fc2e2.r2.cloudflarestorage.com');
  assert.equal(url.pathname,'/relay-media-originals');
  assert.equal(url.searchParams.get('encoding-type'),'url');
  assert.equal(url.searchParams.has('X-Amz-Credential'),false);
  return new Response(url.searchParams.has('uploads') ? emptyMultipart : listXml);
});
assert.equal((await inventoryR2Objects(request)).objects.length,1);
assert.equal(signedRequests.length,2);
await assert.rejects(request('delete',{}),/Unknown/);
await assert.rejects(request('objects',{prefix:'wider'}),/cursor/);
console.log('PASS: GET-only pinned R2 scope, secure XML, objects/multipart pagination, duplicates, malformed responses and no writes.');
