/** Shared types and helpers for the Access Tokens section and its create dialog (PAN-4435). */

export interface AccessTokenRecord {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt?: string;
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
