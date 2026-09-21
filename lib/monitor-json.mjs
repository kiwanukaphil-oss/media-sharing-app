export class MonitorResponseLimitError extends Error {}

// Decode incrementally within the fixed monitoring bound using native Web APIs in both Node and Workers.
// Fatal decoding rejects malformed UTF-8, including split characters, without logging response content.
export async function readBoundedMonitorJson(response) {
  const decoder = new TextDecoder('utf-8', {fatal:true});
  let bytes = 0, text = '';
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > 128 * 1024) throw new MonitorResponseLimitError('Monitoring response exceeded its safe bound.');
    text += decoder.decode(chunk,{stream:true});
  }
  text += decoder.decode();
  return JSON.parse(text);
}
