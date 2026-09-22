export type AssetScope = { spaceId: string; scopeId: string | null; personalOwnerId?: string };
export type ScopeReader = { kind: "account" | "legacy"; spaceId: string; personId?: string; membershipId?: string;
  role: string; active: boolean; grantedScopes: readonly string[] };

// Design-level reference policy for P4. Runtime SQL enforcement is a separate release gate; an owner
// is deliberately not a bypass, and personal-space authority never comes from shared administration.
export function canReadAssetScope(reader: ScopeReader, asset: AssetScope) {
  if (!reader.active || reader.spaceId !== asset.spaceId || !["owner", "editor", "contributor", "viewer", "member"].includes(reader.role)) return false;
  if (reader.kind === "legacy") return !asset.personalOwnerId && asset.scopeId === null && ["owner", "member"].includes(reader.role);
  if (reader.kind !== "account" || !reader.personId || !reader.membershipId) return false;
  if (asset.personalOwnerId) return reader.personId === asset.personalOwnerId && reader.role === "owner" && asset.scopeId === null;
  return asset.scopeId === null || reader.grantedScopes.includes(asset.scopeId);
}

export function albumAcceptsAsset(album: AssetScope, asset: AssetScope) {
  return album.spaceId === asset.spaceId && album.scopeId === asset.scopeId && album.personalOwnerId === asset.personalOwnerId;
}

export function canRequestAdministratorGrant(reader: ScopeReader, scope: AssetScope) {
  return reader.kind === "account" && Boolean(reader.personId && reader.membershipId) && reader.active && reader.role === "owner" &&
    reader.spaceId === scope.spaceId && !scope.personalOwnerId && scope.scopeId !== null;
}

export function canReadScopeEvent(reader: ScopeReader, resources: readonly AssetScope[]) {
  return resources.length > 0 && resources.every(resource => canReadAssetScope(reader, resource));
}
