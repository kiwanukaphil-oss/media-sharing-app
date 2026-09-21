import assert from 'node:assert/strict';
import { MonitorResponseLimitError, readBoundedMonitorJson } from '../lib/monitor-json.mjs';

const encoded = new TextEncoder().encode(JSON.stringify({name:'café 📷'}));
const split = new Response(new ReadableStream({start(controller) {
  for (const byte of encoded) controller.enqueue(new Uint8Array([byte]));
  controller.close();
}}));
assert.deepEqual(await readBoundedMonitorJson(split),{name:'café 📷'});
await assert.rejects(readBoundedMonitorJson(new Response(new Uint8Array([0x22,0xff,0x22]))),TypeError);
await assert.rejects(readBoundedMonitorJson(new Response('x'.repeat(128*1024+1))),MonitorResponseLimitError);
assert.equal((await readBoundedMonitorJson(new Response('"'+'x'.repeat(128*1024-2)+'"'))).length,128*1024-2);
await assert.rejects(readBoundedMonitorJson(new Response('not-json')),SyntaxError);
console.log('PASS: bounded native JSON decoding, split UTF-8, malformed encoding and exact size boundary.');
