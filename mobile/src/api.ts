import Native from '../modules/relay-transfer/src/RelayTransferModule';
export const ORIGIN = 'https://relay-media-exchange.kiwanukaphil.workers.dev';
export type Media = { id: string; name: string; mime: string; size: number; sha256: string; category: 'original' | 'final'; deviceName: string };
export type Transfer = { id: string; name: string; state: string; progress: number; message?: string };
export async function api<T>(path: string, method = 'GET', body?: object): Promise<T> {
  return JSON.parse(await Native.request(method, path, body ? JSON.stringify(body) : null)) as T;
}
// Validate the invitation origin before consuming a token; a QR cannot redirect credentials elsewhere.
export async function pairDevice(link: string, name: string) {
  const url = new URL(link.trim());
  if (url.origin !== ORIGIN && !(url.protocol === 'relay:' && url.hostname === 'join')) throw new Error('Use an invitation from your Relay workspace.');
  const token = new URLSearchParams(url.hash.slice(1)).get('join') || url.searchParams.get('token');
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Error('This invitation is incomplete. Generate a new one on your desktop.');
  const response = await fetch(`${ORIGIN}/api/native/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, invitation: token }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Pairing failed.');
  await Native.configure(result.token);
}
