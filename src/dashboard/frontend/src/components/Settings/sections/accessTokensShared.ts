/** Shared types and helpers for the Access Tokens section and its create dialog (PAN-4435). */

export interface AccessTokenRecord {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt?: string;
  /** PAN-4946 — set on a per-agent token; its presence is what makes a record an "agent" token. */
  agentId?: string;
  agentKind?: 'agent' | 'conversation';
  role?: string;
  /** PAN-4946 — an MCP OAuth sign-in's client and family, set only on a token minted by that flow. */
  oauthClientId?: string;
  oauthFamilyId?: string;
  expiresAt?: string | null;
}

/** PAN-4946 (PRD WI-4) — splits a token list into the operator's own tokens and per-agent tokens. */
export function partitionAgentTokens(records: AccessTokenRecord[]): { own: AccessTokenRecord[]; agent: AccessTokenRecord[] } {
  const own: AccessTokenRecord[] = [];
  const agent: AccessTokenRecord[] = [];
  for (const record of records) {
    (record.agentId ? agent : own).push(record);
  }
  return { own, agent };
}

/** A 403 from any access-token route (PAN-4435 D-8). */
export class AccessTokensForbiddenError extends Error {}

export const ACCESS_TOKENS_FORBIDDEN_EXPLANATION =
  'This browser is signed in as a paired device or with a scoped token. Only this machine\'s own dashboard session can create or revoke access tokens; use `pan token` on this machine instead.';

export async function throwForAccessTokensResponse(res: Response, fallback: string): Promise<never> {
  const body = await res.json().catch(() => null) as { error?: string } | null;
  const message = body?.error ?? fallback;
  if (res.status === 403) throw new AccessTokensForbiddenError(message);
  throw new Error(message);
}
