export type AccountSessionMode = "temporary" | "trusted";
export const ACCOUNT_SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const TEMPORARY_SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;

// Unknown values must never silently select the longer-lived credential.
export function accountSessionLifetime(mode: AccountSessionMode) {
  if (mode === "temporary") return TEMPORARY_SESSION_LIFETIME_MS;
  if (mode === "trusted") return ACCOUNT_SESSION_LIFETIME_MS;
  throw new Error("Invalid browser session choice.");
}
