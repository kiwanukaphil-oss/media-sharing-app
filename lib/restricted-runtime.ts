import { env } from "cloudflare:workers";

// Enabling creation/navigation is separate from read enforcement, which always protects stored scopes.
// No deployment configuration enables this flag until the full disclosure inventory is verified.
export function restrictedScopesEnabled() {
  return (env as Cloudflare.Env & { RELAY_RESTRICTED_SCOPES_ENABLED?: string }).RELAY_RESTRICTED_SCOPES_ENABLED === "true";
}
