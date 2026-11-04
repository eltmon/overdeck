/**
 * The OAuth 2.1 authorization server behind `/mcp` (PAN-4945 D-4..D-9).
 *
 * Every operation the OAuth routes call lives here: client registration,
 * the authorize request and its approval (D-6), and the code exchange (D-7).
 * The routes stay thin; this module imports nothing from `src/dashboard/`.
 *
 * Approvals and authorization codes live only in memory, so a dashboard
 * restart cancels every sign-in in progress; the client starts again. Clients
 * and sign-ins (families) live in `mcp-oauth.json` (`./oauth-store.js`), and
 * each family's access token is an ordinary `kind: 'token'` record carrying
 * `oauthClientId`, `oauthFamilyId` and `expiresAt`.
 *
 * `createMcpOAuthService(deps)` takes the clock and the random source so tests
 * can move time; `mcpOAuthService` is the default instance. A store or
 * registry failure becomes a 500 `server_error` and one `console.error` line
 * that names the file, never a token.
 */
import { createHash, randomBytes as cryptoRandomBytes } from 'node:crypto';

import { createAccessToken, revokeAccessToken, revokeAccessTokensMatching } from '../access-tokens.js';
import {
  ACCESS_TOKEN_TTL_MS,
  APPROVAL_TTL_MS,
  CLIENT_ID_PREFIX,
  CODE_TTL_MS,
  formatApprovalCode,
  isOAuthLevel,
  LEVEL_SCOPES,
  oauthErrorBody,
  pkceS256Matches,
  redirectUriMatches,
  redirectWith,
  REFRESH_TOKEN_PREFIX,
  REFRESH_TOKEN_TTL_MS,
  validateAuthorizeParams,
  validateRegistration,
  type OAuthLevel,
} from './oauth-flow.js';
import { mutateMcpOAuthData, readMcpOAuthData, type OAuthClientRecord } from './oauth-store.js';

export interface McpOAuthServiceDeps {
  now(): number;
  randomBytes(size: number): Buffer;
}

type ErrorBody = { error: string; error_description?: string };

export type TokenResult =
  | { ok: true; body: { access_token: string; token_type: 'Bearer'; expires_in: number; refresh_token: string; scope: OAuthLevel } }
  | { ok: false; status: 400 | 401 | 500; body: ErrorBody };
export type RegisterResult = { ok: true; body: Record<string, unknown> } | { ok: false; status: 400 | 500; body: ErrorBody };
export type AuthorizeOutcome =
  | { kind: 'page'; requestId: string; approvalCode: string; clientName: string; redirectHost: string }
  | { kind: 'error-page'; message: string }
  | { kind: 'redirect'; location: string };
export type ApprovalStatus = { status: 'pending' } | { status: 'approved' | 'denied'; redirect: string } | { status: 'expired' };
export interface PendingApprovalView {
  id: string;
  clientId: string;
  clientName: string;
  redirectHost: string;
  requestedLevel: OAuthLevel;
  approvalCode: string;
  createdAt: string;
  expiresAt: string;
}
export type DecideResult = { ok: true; status: 'approved' | 'denied' } | { ok: false; status: 400 | 404 | 409; error: string };

export interface McpOAuthService {
  registerClient(body: unknown): Promise<RegisterResult>;
  authorize(params: URLSearchParams): Promise<AuthorizeOutcome>;
  approvalStatus(requestId: string): ApprovalStatus;
  listApprovals(): PendingApprovalView[];
  decideApproval(id: string, decision: unknown, level: unknown): DecideResult;
  exchangeCode(form: URLSearchParams): Promise<TokenResult>;
}

const MAX_CLIENTS = 50;
const MAX_PENDING_APPROVALS = 20;
const APPROVAL_GRACE_MS = 60_000;
const CODE_REUSE_WINDOW_MS = 10 * 60_000;
const MAX_TOKEN_NAME = 200;
const INVALID_LINK = 'This sign-in link is not valid. Start the sign-in again from your app.';
const UNAVAILABLE = 'Overdeck could not read its sign-in records. Try again later.';

interface Approval {
  id: string;
  approvalCode: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  requestedLevel: OAuthLevel;
  createdAt: number;
  expiresAt: number;
  status: 'pending' | 'approved' | 'denied';
  code?: string;
}

interface AuthorizationCode {
  value: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  level: OAuthLevel;
  expiresAt: number;
  used: boolean;
  /** The family the first exchange produced, once it exists. */
  familyId?: string;
  /** Set when the code was presented again while its first exchange was still minting. */
  reused?: boolean;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function failure(status: 400 | 401 | 500, error: string, description?: string): { ok: false; status: 400 | 401 | 500; body: ErrorBody } {
  return { ok: false, status, body: oauthErrorBody(error, description) };
}

function logFailure(error: unknown): void {
  console.error(`[mcp-oauth] ${(error as Error).message}`);
}

export function createMcpOAuthService(deps: Partial<McpOAuthServiceDeps> = {}): McpOAuthService {
  const now = deps.now ?? Date.now;
  const randomBytes = deps.randomBytes ?? cryptoRandomBytes;
  const approvals = new Map<string, Approval>();
  const codes = new Map<string, AuthorizationCode>();

  function cleanup(at: number): void {
    for (const [id, approval] of approvals) if (at > approval.expiresAt + APPROVAL_GRACE_MS) approvals.delete(id);
    for (const [value, code] of codes) if (at > code.expiresAt + CODE_REUSE_WINDOW_MS) codes.delete(value);
  }

  /** End a family: mark it revoked and revoke every access token it holds (D-9). */
  async function endFamily(familyId: string): Promise<boolean> {
    const at = now();
    const ended = await mutateMcpOAuthData(at, (data) => {
      const index = data.families.findIndex((family) => family.familyId === familyId && family.revokedAt === undefined);
      if (index === -1) return { data, result: false, write: false };
      const families = data.families.slice();
      families[index] = { ...families[index]!, revokedAt: iso(at) };
      return { data: { ...data, families }, result: true };
    });
    await revokeAccessTokensMatching((record) => record.oauthFamilyId === familyId);
    return ended;
  }

  /** Mint a family's access token (D-7.5). */
  async function mintAccessToken(client: OAuthClientRecord, familyId: string, level: OAuthLevel, at: number): Promise<{ token: string; id: string }> {
    const { token, record } = await createAccessToken({
      name: `${client.name} (OAuth)`.slice(0, MAX_TOKEN_NAME),
      kind: 'token',
      scopes: [...LEVEL_SCOPES[level]],
      oauthClientId: client.clientId,
      oauthFamilyId: familyId,
      expiresAt: iso(at + ACCESS_TOKEN_TTL_MS),
    });
    return { token, id: record.id };
  }

  function newRefreshToken(): { token: string; hash: string } {
    const token = `${REFRESH_TOKEN_PREFIX}${randomBytes(32).toString('hex')}`;
    return { token, hash: sha256Hex(token) };
  }

  /** Mint a new family for `client` at `level`: access token, refresh token and the family record (D-7.5). */
  async function mintFamily(client: OAuthClientRecord, level: OAuthLevel, at: number): Promise<TokenResult & { familyId?: string }> {
    const familyId = randomBytes(16).toString('hex');
    let access: { token: string; id: string };
    try {
      access = await mintAccessToken(client, familyId, level, at);
    } catch (error) {
      logFailure(error);
      return failure(500, 'server_error');
    }
    const refresh = newRefreshToken();
    try {
      await mutateMcpOAuthData(at, (data) => ({
        data: {
          clients: data.clients.map((c) => (c.clientId === client.clientId ? { ...c, lastUsedAt: iso(at) } : c)),
          families: [
            ...data.families,
            {
              familyId,
              clientId: client.clientId,
              level,
              scopes: [...LEVEL_SCOPES[level]],
              refreshHash: refresh.hash,
              priorRefreshHashes: [],
              refreshExpiresAt: iso(at + REFRESH_TOKEN_TTL_MS),
              accessTokenId: access.id,
              createdAt: iso(at),
            },
          ],
        },
        result: undefined,
      }));
    } catch (error) {
      logFailure(error);
      await revokeAccessToken(access.id).catch(logFailure);
      return failure(500, 'server_error');
    }
    return {
      ok: true,
      familyId,
      body: { access_token: access.token, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_MS / 1000, refresh_token: refresh.token, scope: level },
    };
  }

  async function registerClient(body: unknown): Promise<RegisterResult> {
    const checked = validateRegistration(body);
    if (!checked.ok) return { ok: false, status: 400, body: oauthErrorBody(checked.error, checked.description) };
    const at = now();
    const client: OAuthClientRecord = {
      clientId: `${CLIENT_ID_PREFIX}${randomBytes(16).toString('hex')}`,
      name: checked.name,
      redirectUris: checked.redirectUris,
      createdAt: iso(at),
      lastUsedAt: null,
    };
    let added: boolean;
    try {
      added = await mutateMcpOAuthData(at, (data) => {
        let clients = data.clients;
        if (clients.length >= MAX_CLIENTS) {
          const withFamily = new Set(data.families.map((family) => family.clientId));
          const evict = clients
            .filter((c) => !withFamily.has(c.clientId))
            .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
          if (!evict) return { data, result: false, write: false };
          clients = clients.filter((c) => c.clientId !== evict.clientId);
        }
        return { data: { ...data, clients: [...clients, client] }, result: true };
      });
    } catch (error) {
      logFailure(error);
      return { ok: false, status: 500, body: oauthErrorBody('server_error') };
    }
    if (!added) {
      return { ok: false, status: 400, body: oauthErrorBody('invalid_client_metadata', 'too many registered clients; revoke unused sign-ins') };
    }
    return {
      ok: true,
      body: {
        client_id: client.clientId,
        client_id_issued_at: Math.floor(at / 1000),
        client_name: client.name,
        redirect_uris: client.redirectUris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      },
    };
  }

  async function authorize(params: URLSearchParams): Promise<AuthorizeOutcome> {
    const at = now();
    cleanup(at);
    const clientId = params.get('client_id');
    const redirectUri = params.get('redirect_uri');
    let client: OAuthClientRecord | undefined;
    try {
      client = (await readMcpOAuthData(at)).clients.find((c) => c.clientId === clientId && !c.headless);
    } catch (error) {
      logFailure(error);
      return { kind: 'error-page', message: UNAVAILABLE };
    }
    // D-5 step 1: never redirect to a URI that was not registered for this client.
    if (!client || redirectUri === null || !redirectUriMatches(client.redirectUris, redirectUri)) {
      return { kind: 'error-page', message: INVALID_LINK };
    }
    const checked = validateAuthorizeParams(params);
    if (!checked.ok) {
      const state = params.get('state');
      const echo = state !== null && state.length <= 500 ? state : undefined;
      return { kind: 'redirect', location: redirectWith(redirectUri, { error: checked.error, error_description: checked.description, state: echo }) };
    }
    const pending = [...approvals.values()].filter((approval) => approval.status === 'pending');
    if (pending.length >= MAX_PENDING_APPROVALS) approvals.delete(pending[0]!.id);
    const approval: Approval = {
      id: randomBytes(16).toString('hex'),
      approvalCode: formatApprovalCode(randomBytes(8)),
      clientId: client.clientId,
      clientName: client.name,
      redirectUri,
      codeChallenge: checked.codeChallenge,
      ...(checked.state !== undefined ? { state: checked.state } : {}),
      requestedLevel: checked.requestedLevel,
      createdAt: at,
      expiresAt: at + APPROVAL_TTL_MS,
      status: 'pending',
    };
    approvals.set(approval.id, approval);
    return { kind: 'page', requestId: approval.id, approvalCode: approval.approvalCode, clientName: client.name, redirectHost: new URL(redirectUri).host };
  }

  function approvalStatus(requestId: string): ApprovalStatus {
    const at = now();
    cleanup(at);
    const approval = approvals.get(requestId);
    if (!approval) return { status: 'expired' };
    if (approval.status === 'pending') return at < approval.expiresAt ? { status: 'pending' } : { status: 'expired' };
    if (approval.status === 'denied') {
      return { status: 'denied', redirect: redirectWith(approval.redirectUri, { error: 'access_denied', state: approval.state }) };
    }
    const code = approval.code !== undefined ? codes.get(approval.code) : undefined;
    if (!code || code.used || at >= code.expiresAt) return { status: 'expired' };
    return { status: 'approved', redirect: redirectWith(approval.redirectUri, { code: code.value, state: approval.state }) };
  }

  function listApprovals(): PendingApprovalView[] {
    const at = now();
    cleanup(at);
    return [...approvals.values()]
      .filter((approval) => approval.status === 'pending' && at < approval.expiresAt)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((approval) => ({
        id: approval.id,
        clientId: approval.clientId,
        clientName: approval.clientName,
        redirectHost: new URL(approval.redirectUri).host,
        requestedLevel: approval.requestedLevel,
        approvalCode: approval.approvalCode,
        createdAt: iso(approval.createdAt),
        expiresAt: iso(approval.expiresAt),
      }));
  }

  function decideApproval(id: string, decision: unknown, level: unknown): DecideResult {
    const at = now();
    cleanup(at);
    const approval = approvals.get(id);
    if (!approval || (approval.status === 'pending' && at >= approval.expiresAt)) return { ok: false, status: 404, error: 'unknown or expired sign-in request' };
    if (approval.status !== 'pending') return { ok: false, status: 409, error: `this sign-in request was already ${approval.status}` };
    if (decision === 'deny') {
      approval.status = 'denied';
      return { ok: true, status: 'denied' };
    }
    if (decision !== 'approve') return { ok: false, status: 400, error: 'decision must be approve or deny' };
    if (!isOAuthLevel(level)) return { ok: false, status: 400, error: 'approve needs a level: read, message, operate or approve' };
    const value = randomBytes(32).toString('base64url');
    codes.set(value, {
      value,
      clientId: approval.clientId,
      redirectUri: approval.redirectUri,
      codeChallenge: approval.codeChallenge,
      level,
      expiresAt: at + CODE_TTL_MS,
      used: false,
    });
    approval.status = 'approved';
    approval.code = value;
    return { ok: true, status: 'approved' };
  }

  async function exchangeCode(form: URLSearchParams): Promise<TokenResult> {
    const value = form.get('code');
    const clientId = form.get('client_id');
    const redirectUri = form.get('redirect_uri');
    const verifier = form.get('code_verifier');
    if (!value || !clientId || !redirectUri || !verifier) {
      return failure(400, 'invalid_request', 'code, client_id, redirect_uri and code_verifier are required');
    }
    const at = now();
    cleanup(at);
    const code = codes.get(value);
    if (!code) return failure(400, 'invalid_grant');
    // D-7.2: a code presented twice ends the sign-in it produced. Checked before
    // expiry, because used codes are kept past expiry only to catch this.
    if (code.used) {
      if (code.familyId !== undefined) await endFamily(code.familyId).catch(logFailure);
      else code.reused = true;
      return failure(400, 'invalid_grant');
    }
    if (at >= code.expiresAt) return failure(400, 'invalid_grant');
    // D-7.3: consume the code before the remaining checks, so a failed attempt also uses it up.
    code.used = true;
    if (clientId !== code.clientId || redirectUri !== code.redirectUri || !pkceS256Matches(verifier, code.codeChallenge)) {
      return failure(400, 'invalid_grant');
    }
    let client: OAuthClientRecord | undefined;
    try {
      client = (await readMcpOAuthData(at)).clients.find((c) => c.clientId === code.clientId);
    } catch (error) {
      logFailure(error);
      return failure(500, 'server_error');
    }
    if (!client) return failure(400, 'invalid_grant');
    const minted = await mintFamily(client, code.level, at);
    if (!minted.ok) return minted;
    code.familyId = minted.familyId;
    if (code.reused) {
      // The code was presented again while this exchange was minting: treat it as a reuse.
      await endFamily(minted.familyId!).catch(logFailure);
      return failure(400, 'invalid_grant');
    }
    return { ok: true, body: minted.body };
  }

  return { registerClient, authorize, approvalStatus, listApprovals, decideApproval, exchangeCode };
}

export const mcpOAuthService: McpOAuthService = createMcpOAuthService();
