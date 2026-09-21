// Install as a Post Login Action for Relay Web. The claim is signed inside the ID token.
exports.onExecutePostLogin = async (event, api) => {
  if (event.client.client_id !== event.secrets.RELAY_CLIENT_ID) return;
  const value = event.user.last_password_reset;
  const changedAt = value === undefined ? 0 : Date.parse(value);
  if (!Number.isSafeInteger(changedAt) || changedAt < 0 || changedAt > Date.now()) {
    api.access.deny('Account recovery verification is unavailable.');
    return;
  }
  api.idToken.setCustomClaim('https://relayalbums.com/credentials_changed_at', changedAt);
};
