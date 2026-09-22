import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex} from "@noble/hashes/utils.js";

export type PackageFile={id:string;name:string;size:number;sha256:string;suggestedPath:string};
export type PackageManifest={files:PackageFile[];[key:string]:unknown};
export type PackageSink={write:(bytes:Uint8Array)=>Promise<void>;close:()=>Promise<void>;abort:()=>Promise<void>};
export const packageByteLimit=2*1024**3,packageMemoryLimit=64*1024**2;
const encoder=new TextEncoder();
const crcTable=Uint32Array.from({length:256},(_,value)=>{for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);return value>>>0;});
const updateCrc=(crc:number,bytes:Uint8Array)=>{for(const byte of bytes)crc=(crc>>>8)^crcTable[(crc^byte)&255];return crc;};
const record=(length:number)=>{const bytes=new Uint8Array(length);return {bytes,view:new DataView(bytes.buffer)};};

// ZIP paths are generated separately from display names. Never accept traversal or reserved paths
// from a manifest, even if its transport came from the same application origin.
export function validatePackageManifest(manifest:PackageManifest,limit=packageByteLimit){
  if(!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>100)throw new Error("Choose between 1 and 100 originals.");
  const ids=new Set<string>(),paths=new Set<string>();let total=0;
  for(const file of manifest.files){
    if(!/^[a-f0-9-]{36}$/.test(file.id)||ids.has(file.id)||!Number.isSafeInteger(file.size)||file.size<1||!/^[a-f0-9]{64}$/.test(file.sha256))throw new Error("The package selection is invalid.");
    const path=file.suggestedPath;
    if(typeof path!=="string"||!path.startsWith(`files/${file.id}/`)||path.split('/').length!==3||/[\u0000-\u001f\u007f\\:*?"<>|]/.test(path)||path.split('/').some(part=>!part||part==='.'||part==='..')||encoder.encode(path).length>512||paths.has(path.toLowerCase()))throw new Error("A package filename is unsafe.");
    ids.add(file.id);paths.add(path.toLowerCase());total+=file.size;
  }
  if(total>limit)throw new Error(`Choose a smaller selection (up to ${limit===packageMemoryLimit?'64 MiB in this browser':'2 GiB'}).`);
  return total;
}

// A stored ZIP needs only a small central directory in memory. Each original is independently
// SHA-256 checked; CRC32 makes the resulting archive interoperable with ordinary ZIP readers.
// No central directory or sink commit is written after cancellation, access loss or partial bytes.
export async function writeOriginalPackage(manifest:PackageManifest,sink:PackageSink,options:{signal:AbortSignal;read:(file:PackageFile)=>Promise<Response>;revalidate:()=>Promise<void>;onProgress?:(bytes:number,total:number)=>void}){
  const central:Uint8Array[]=[];let offset=0,processed=0;
  const write=async(bytes:Uint8Array)=>{options.signal.throwIfAborted();await sink.write(bytes);offset+=bytes.length;};
  // Bit 3 permits streaming CRC/size in a data descriptor; bit 11 identifies UTF-8 paths.
  const entry=async(path:string,size:number,body:ReadableStream<Uint8Array>,expectedHash?:string)=>{
    const name=encoder.encode(path),start=offset,header=record(30+name.length);
    header.view.setUint32(0,0x04034b50,true);header.view.setUint16(4,20,true);header.view.setUint16(6,0x808,true);header.view.setUint16(12,33,true);header.view.setUint16(26,name.length,true);header.bytes.set(name,30);try{await write(header.bytes);}catch(error){await body.cancel().catch(()=>{});throw error;}
    const reader=body.getReader(),hash=sha256.create();let crc=0xffffffff,count=0;
    const cancel=()=>{void reader.cancel().catch(()=>{});};options.signal.addEventListener('abort',cancel,{once:true});
    try{
      for(;;){const {done,value}=await reader.read();options.signal.throwIfAborted();if(done)break;count+=value.length;if(count>size)throw new Error("An original exceeded its recorded size.");hash.update(value);crc=updateCrc(crc,value);await write(value);if(expectedHash){processed+=value.length;options.onProgress?.(processed,total);}}
      if(count!==size||(expectedHash&&bytesToHex(hash.digest())!==expectedHash))throw new Error("An original failed verification. No complete package was saved; retry the package.");
    }finally{options.signal.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});reader.releaseLock();}
    crc=(crc^0xffffffff)>>>0;
    const descriptor=record(16);descriptor.view.setUint32(0,0x08074b50,true);descriptor.view.setUint32(4,crc,true);descriptor.view.setUint32(8,size,true);descriptor.view.setUint32(12,size,true);await write(descriptor.bytes);
    const index=record(46+name.length);index.view.setUint32(0,0x02014b50,true);index.view.setUint16(4,20,true);index.view.setUint16(6,20,true);index.view.setUint16(8,0x808,true);index.view.setUint16(14,33,true);index.view.setUint32(16,crc,true);index.view.setUint32(20,size,true);index.view.setUint32(24,size,true);index.view.setUint16(28,name.length,true);index.view.setUint32(42,start,true);index.bytes.set(name,46);central.push(index.bytes);
  };
  let total=0;
  try{
    total=validatePackageManifest(manifest);
    const metadata=encoder.encode(JSON.stringify({...manifest,includesOriginalBytes:true,checksumProvenance:"Every original in a completed package was independently SHA-256 verified during creation."},null,2));
    if(metadata.length>4*1024**2)throw new Error("The package manifest is too large.");
    await entry('manifest.json',metadata.length,new Blob([metadata]).stream());
    for(const file of manifest.files){options.signal.throwIfAborted();const response=await options.read(file);if(!response.ok||!response.body)throw new Error("An original is unavailable. Retry after checking your access.");await entry(file.suggestedPath,file.size,response.body,file.sha256);}
    await options.revalidate();options.signal.throwIfAborted();
    const directoryStart=offset;for(const bytes of central)await write(bytes);
    const end=record(22);end.view.setUint32(0,0x06054b50,true);end.view.setUint16(8,central.length,true);end.view.setUint16(10,central.length,true);end.view.setUint32(12,offset-directoryStart,true);end.view.setUint32(16,directoryStart,true);await write(end.bytes);
    options.signal.throwIfAborted();await sink.close();
  }catch(error){await sink.abort().catch(()=>{});throw error;}
}
