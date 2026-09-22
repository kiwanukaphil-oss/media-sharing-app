import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex} from "@noble/hashes/utils.js";
export type DuplicateFile={id:string;name:string;size:number;sha256:string;revision:number;accessScopeId:string|null};
export const duplicateVerificationLimit=250*1024**2;

// A recorded upload hash is only a candidate hint. Stream both originals without saving them,
// validate their independent hashes/lengths, then recheck current selection authority before success.
export async function verifyDuplicatePair(source:DuplicateFile,candidate:DuplicateFile,options:{signal:AbortSignal;read:(file:DuplicateFile)=>Promise<Response>;revalidate:()=>Promise<void>;onProgress?:(value:number)=>void}){
  if(source.id===candidate.id||source.accessScopeId!==candidate.accessScopeId||source.size!==candidate.size||source.sha256!==candidate.sha256||!/^[a-f0-9]{64}$/.test(source.sha256))throw new Error('These files are not an exact-match candidate pair.');
  if(source.size>duplicateVerificationLimit)throw new Error('In-app verification supports originals up to 250 MiB. Larger matches remain unverified.');
  let processed=0;
  for(const file of [source,candidate]){
    options.signal.throwIfAborted();const response=await options.read(file);
    if(!response.ok||!response.body)throw new Error('An original is unavailable. Refresh the comparison.');
    const reader=response.body.getReader(),hash=sha256.create();let size=0;
    const cancel=()=>{void reader.cancel().catch(()=>{});};options.signal.addEventListener('abort',cancel,{once:true});
    try{
      for(;;){const {value,done}=await reader.read();options.signal.throwIfAborted();if(done)break;size+=value.length;if(size>file.size)throw new Error('An original exceeded its recorded size.');hash.update(value);processed+=value.length;options.onProgress?.(Math.min(99,Math.round(processed/(source.size*2)*100)));}
      if(size!==file.size||bytesToHex(hash.digest())!==file.sha256)throw new Error('The bytes do not match the recorded fingerprint. These files were not verified as duplicates.');
    }finally{options.signal.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});reader.releaseLock();}
  }
  await options.revalidate();options.signal.throwIfAborted();options.onProgress?.(100);
}
