import { validateRehearsalAccess } from './erasure-rehearsal-scope.mjs';

// The generated-test role is validated before its token may be used; never accept a production bucket
// or forward a credential/token to a redirect or a non-provider endpoint.
export async function authorizeRehearsalCredential(credential) {
  if (typeof credential.applicationKeyId !== 'string' || typeof credential.applicationKey !== 'string') {
    throw new Error('Rehearsal credential is incomplete.');
  }
  const response = await fetch('https://api.backblazeb2.com/b2api/v4/b2_authorize_account', {
    headers:{Authorization:`Basic ${Buffer.from(`${credential.applicationKeyId}:${credential.applicationKey}`).toString('base64')}`},
    redirect:'error',signal:AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error('Rehearsal credential could not be verified.');
  const authorization = await response.json();
  const storage = authorization.apiInfo?.storageApi;
  validateRehearsalAccess(storage?.allowed);
  for (const value of [storage.apiUrl,storage.downloadUrl]) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !/\.backblazeb2\.com$/.test(url.hostname)) throw new Error('Unexpected rehearsal storage endpoint.');
  }
  return {...storage,token:authorization.authorizationToken};
}
