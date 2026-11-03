/**
 * Access-token record shape and validator (PAN-4927 W-TOK1 extraction).
 * Leaf module: imports nothing from access-tokens.ts.
 */

export const ACCESS_TOKEN_SCOPES = [
  'read:events',
  'read:state',
  'read:conversations',
  'read:costs',
  'read:settings',
  'tell',
  'operate',
  'approve',
  'forward',
  'admin',
] as const;
export type AccessTokenScope = (typeof ACCESS_TOKEN_SCOPES)[number];
export type AccessTokenKind = 'device' | 'token' | 'machine' | 'phone';
/** Access level of a machine link (PAN-4645 FR-4). */
export type MachineAccess = 'operator' | 'agent-fenced';
export const MACHINE_ACCESS_LEVELS: readonly MachineAccess[] = ['operator', 'agent-fenced'];

export const MACHINE_KEY_HEX = /^[0-9a-f]{64}$/;
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** An agent token's `agentId`: an agent id or a conversation name (PAN-4927 D-6). */
export const AGENT_ID = /^[A-Za-z0-9._:/-]{1,200}$/;
/** An agent token's `role`: a role name, or 'conversation'. */
export const AGENT_ROLE = /^[a-z][a-z0-9-]{0,63}$/;

export interface AccessTokenRecord {
  id: string;
  name: string;
  scopes: AccessTokenScope[];
  /** SHA-256 hex digest of the plaintext token. */
  tokenHash: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt?: string;
  kind?: AccessTokenKind;
  /** `machine` only: the peer's machine public key, 64 lowercase hex. */
  machineKey?: string;
  /** `machine` only: the peer's environment id. */
  environmentId?: string;
  /** `machine` only: the link's access level. */
  access?: MachineAccess;
  /** `phone` only: the phone's link public key, 64 lowercase hex (PAN-4835). */
  phoneKey?: string;
  /** `phone` only: the phone app's directory client id, a UUID v4. */
  clientId?: string;
  /** `phone` only: the phone's push public key, 64 lowercase hex; absent until the app sends one. */
  pushKey?: string;
  /** `token` only (PAN-4927 D-6): the managed agent this token belongs to — an agent id or a conversation name. */
  agentId?: string;
  /** `token` only: what `agentId` names. */
  agentKind?: 'agent' | 'conversation';
  /** `token` only: the agent's role, or 'conversation'. */
  role?: string;
}

export function isMachineAccess(value: unknown): value is MachineAccess {
  return (MACHINE_ACCESS_LEVELS as readonly unknown[]).includes(value);
}

/** True when `agentId`, `agentKind` and `role` are all present and well-formed. */
export function agentFieldsValid(r: { agentId?: unknown; agentKind?: unknown; role?: unknown }): boolean {
  return (
    typeof r.agentId === 'string' &&
    AGENT_ID.test(r.agentId) &&
    (r.agentKind === 'agent' || r.agentKind === 'conversation') &&
    typeof r.role === 'string' &&
    AGENT_ROLE.test(r.role)
  );
}

export function isRecord(value: unknown): value is AccessTokenRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  const base =
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    Array.isArray(r.scopes) &&
    r.scopes.every((scope) => typeof scope === 'string') &&
    typeof r.tokenHash === 'string' &&
    /^[0-9a-f]{64}$/.test(r.tokenHash) &&
    typeof r.createdAt === 'string' &&
    (r.lastUsedAt === null || typeof r.lastUsedAt === 'string') &&
    (r.revokedAt === undefined || typeof r.revokedAt === 'string') &&
    (r.kind === undefined || r.kind === 'device' || r.kind === 'token' || r.kind === 'machine' || r.kind === 'phone');
  if (!base) return false;
  const machineKeyOk = typeof r.machineKey === 'string' && MACHINE_KEY_HEX.test(r.machineKey);
  const environmentOk = typeof r.environmentId === 'string' && r.environmentId !== '';
  const accessOk = isMachineAccess(r.access);
  const phoneKeyOk = typeof r.phoneKey === 'string' && MACHINE_KEY_HEX.test(r.phoneKey);
  const clientIdOk = typeof r.clientId === 'string' && UUID_V4.test(r.clientId);
  const pushKeyOk = r.pushKey === undefined || (typeof r.pushKey === 'string' && MACHINE_KEY_HEX.test(r.pushKey));
  const agentFieldsAbsent = r.agentId === undefined && r.agentKind === undefined && r.role === undefined;
  // A machine record needs all three binding fields; a phone record needs its
  // own two plus an optional push key; other kinds may carry none of either
  // set, and any field present must still be well-formed. Only a `token`
  // record may carry the agent fields, and then all three (PAN-4927).
  if (r.kind === 'machine') return machineKeyOk && environmentOk && accessOk && r.phoneKey === undefined && r.clientId === undefined && r.pushKey === undefined && agentFieldsAbsent;
  if (r.kind === 'phone') return phoneKeyOk && clientIdOk && pushKeyOk && r.machineKey === undefined && r.environmentId === undefined && r.access === undefined && agentFieldsAbsent;
  return (
    (r.machineKey === undefined || machineKeyOk) &&
    (r.environmentId === undefined || environmentOk) &&
    (r.access === undefined || accessOk) &&
    r.phoneKey === undefined &&
    r.clientId === undefined &&
    r.pushKey === undefined &&
    (agentFieldsAbsent || (r.kind === 'token' && agentFieldsValid(r)))
  );
}
