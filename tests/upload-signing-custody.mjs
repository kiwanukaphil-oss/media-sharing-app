import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle=await build({entryPoints:['lib/server.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{
  name:'isolated-binding',setup(builder){
    builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'fixture',namespace:'fixture'}));
    builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const env = {};',loader:'js'}));
  },
}]});
const {signedObjectUrl}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const fixtures={R2_ACCOUNT_ID:'fixture',R2_BUCKET_NAME:'fixture',R2_ACCESS_KEY_ID:'fixture',R2_SECRET_ACCESS_KEY:'fixture-only'};
const previous=Object.fromEntries(Object.keys(fixtures).map(key=>[key,process.env[key]]));
try {
  Object.assign(process.env,fixtures);
  const signedAt=Date.UTC(2026,8,22,9,0,0);
  const url=new URL(await signedObjectUrl('fixture/original','PUT',{uploadId:'fixture-upload',partNumber:'2'},16,signedAt));
  assert.equal(url.searchParams.get('X-Amz-Date'),'20260922T090000Z');
  assert.equal(Number(url.searchParams.get('X-Amz-Expires')),3600);
  assert.equal(url.searchParams.get('uploadId'),'fixture-upload');
  assert.equal(url.searchParams.get('partNumber'),'2');
  assert.ok(url.searchParams.get('X-Amz-SignedHeaders').split(';').includes('content-length'));
  assert.ok(url.searchParams.get('X-Amz-Signature'));
  const defaultUrl=new URL(await signedObjectUrl('fixture/read','GET'));
  assert.ok(defaultUrl.searchParams.get('X-Amz-Date'));
} finally {
  for(const [key,value] of Object.entries(previous)) {
    if(value===undefined) delete process.env[key]; else process.env[key]=value;
  }
}
console.log('PASS: presigned part deadline matches recorded issuance time, exact multipart target and signed byte length.');
