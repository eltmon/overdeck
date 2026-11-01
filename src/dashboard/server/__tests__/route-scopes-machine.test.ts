/**
 * PAN-4645 WI-5: a machine credential inside its channel passes every new
 * operate row through the remote request gate and gets 403 on the admin-only
 * surfaces it must never reach (pairing, devices, tokens, settings, trusted
 * origins, and the machine-link management routes themselves).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Option } from 'effect';
import { HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  _resetAccessTokensForTests,
  _settleAccessTokenWritesForTests,
  createAccessToken,
  MACHINE_TOKEN_SCOPES,
} from '../../../lib/access-tokens.js';
import { _resetInternalTokenCacheForTests } from '../../../lib/internal-token.js';
import { closeOverdeckDatabase } from '../../../lib/overdeck/infra.js';
import { invalidateRemoteAccessConfig } from '../../../lib/remote-access/config.js';
import type { ChannelMarker } from '../channel-peer.js';
import { remoteGateRejection } from '../remote-request-gate.js';
import { requiredScopeFor } from '../route-scopes.js';
import { _resetDashboardSessionTokenForTests } from '../routes/dashboard-auth.js';

const KEY = 'c3'.repeat(32);
const LINK: ChannelMarker = { mode: 'link', remoteKeyHex: KEY, pairingId: null };
const originalHome = process.env.OVERDECK_HOME;

const OPERATE_ROWS: ReadonlyArray<[string, string]> = [
  ['POST', '/api/conversations'],
  ['POST', '/api/conversations/conv-1/stop'],
  ['POST', '/api/conversations/conv-1/abort'],
  ['POST', '/api/lanes'],
];

// PAN-4649 moved the approval routes to their own `approve` grant; an
// operator-level link holds it, an agent-fenced link does not.
const APPROVE_ROWS: ReadonlyArray<[string, string]> = [
  ['POST', '/api/conversations/conv-1/permission'],
  ['POST', '/api/conversations/conv-1/codex-approval'],
  ['POST', '/api/conversations/conv-1/pane-choice'],
  ['POST', '/api/conversations/conv-1/pi-ask-answer'],
  ['POST', '/api/agents/pan-1/answer-question'],
  ['POST', '/api/agents/pan-1/permissions/req-9/respond'],
];

const ADMIN_ONLY: ReadonlyArray<[string, string]> = [
  ['GET', '/api/access-tokens'],
  ['POST', '/api/access-tokens'],
  ['POST', '/api/pairing/credentials'],
  ['GET', '/api/devices'],
  ['PUT', '/api/settings'],
  ['POST', '/api/anywhere/trusted-origins'],
  ['POST', '/api/machines/link'],
  ['DELETE', '/api/machines/link-1'],
];

let home: string;
let operatorToken: string;
let fencedToken: string;

// A link always stamps its actor; `agent-fenced` links downgrade `operator` to an agent.
function request(method: string, path: string, token: string) {
  return HttpServerRequest.fromWeb(new Request(`http://dashboard.test${path}`, {
    method, headers: { authorization: `Bearer ${token}`, 'x-overdeck-link-actor': 'operator' },
  })).modify({ remoteAddress: Option.some(`link:${KEY.slice(0, 16)}`) });
}

// PAN-4650 D-4650-7: an agent actor (the fenced link's operator included) never changes conversations
// it did not start; PAN-4651 D-4651-2: nor starts lanes outside the work doors.
const AGENT_FENCED = { status: 403, code: 'agent-fenced' } as const;
const fencedOr = <T>(path: string, otherwise: T) => (path.startsWith('/api/conversations') || path === '/api/lanes' ? AGENT_FENCED : otherwise);

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4645-route-scopes-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = 'route-scopes-internal-token';
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetAccessTokensForTests();
  invalidateRemoteAccessConfig();
  operatorToken = (await createAccessToken({
    name: 'machine:desk', kind: 'machine', scopes: MACHINE_TOKEN_SCOPES('operator'),
    machineKey: KEY, environmentId: 'env-desk', access: 'operator',
  })).token;
  fencedToken = (await createAccessToken({
    name: 'machine:lab', kind: 'machine', scopes: MACHINE_TOKEN_SCOPES('agent-fenced'),
    machineKey: KEY, environmentId: 'env-lab', access: 'agent-fenced',
  })).token;
});

afterEach(async () => {
  closeOverdeckDatabase();
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('route-scope rows for machine credentials (PAN-4645 WI-5)', () => {
  it('maps every new operate surface to operate and the approval routes to approve in the table', () => {
    for (const [method, path] of OPERATE_ROWS) {
      expect(requiredScopeFor(method, path), `${method} ${path}`).toBe('operate');
    }
    for (const [method, path] of APPROVE_ROWS) {
      expect(requiredScopeFor(method, path), `${method} ${path}`).toBe('approve');
    }
    expect(requiredScopeFor('GET', '/api/conversations/conv-1/stop')).toBe('admin');
    expect(requiredScopeFor('POST', '/api/conversations/conv-1/stop/extra')).toBe('admin');
  });

  it.each(OPERATE_ROWS)('lets a machine credential over its channel through %s %s', (method, path) => {
    expect(remoteGateRejection(request(method, path, operatorToken), LINK)).toBeNull();
    expect(remoteGateRejection(request(method, path, fencedToken), LINK)).toEqual(fencedOr(path, null));
  });

  it.each(APPROVE_ROWS)('lets only an operator-level machine credential answer prompts on %s %s', (method, path) => {
    expect(remoteGateRejection(request(method, path, operatorToken), LINK)).toBeNull();
    expect(remoteGateRejection(request(method, path, fencedToken), LINK)).toEqual(fencedOr(path, { status: 403, missingScope: 'approve' }));
  });

  it.each(ADMIN_ONLY)('answers 403 insufficient_scope admin for a machine credential on %s %s', (method, path) => {
    expect(remoteGateRejection(request(method, path, operatorToken), LINK)).toEqual({ status: 403, missingScope: 'admin' });
    expect(remoteGateRejection(request(method, path, fencedToken), LINK)).toEqual({ status: 403, missingScope: 'admin' });
  });

  it('keeps the existing token kind in step: operate on a token now covers the same rows', async () => {
    const { token } = await createAccessToken({ name: 'ops', kind: 'token', scopes: ['operate'] });
    const plain = (method: string, path: string) => HttpServerRequest
      .fromWeb(new Request(`http://dashboard.test${path}`, { method, headers: { authorization: `Bearer ${token}` } }))
      .modify({ remoteAddress: Option.some('198.51.100.9') });
    for (const [method, path] of OPERATE_ROWS) {
      expect(remoteGateRejection(plain(method, path), null), `${method} ${path}`).toBeNull();
    }
    expect(remoteGateRejection(plain('PUT', '/api/settings'), null)).toEqual({ status: 403, missingScope: 'admin' });
    expect(remoteGateRejection(plain('POST', '/api/conversations/conv-1/permission'), null)).toEqual({ status: 403, missingScope: 'approve' });

    const tellOnly = (await createAccessToken({ name: 'tell', kind: 'token', scopes: ['tell'] })).token;
    const tellRequest = HttpServerRequest
      .fromWeb(new Request('http://dashboard.test/api/conversations/conv-1/abort', { method: 'POST', headers: { authorization: `Bearer ${tellOnly}` } }))
      .modify({ remoteAddress: Option.some('198.51.100.9') });
    expect(remoteGateRejection(tellRequest, null)).toEqual({ status: 403, missingScope: 'operate' });
  });
});
