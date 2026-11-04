/**
 * PAN-4645 WI-4: a `machine` credential resolves only inside a link-mode
 * channel bound to its key; root and device credentials resolve to nothing
 * over a channel; the actor stamp narrows scopes; the remote request gate
 * admits a pairing channel to exactly two surfaces and never trusts a channel
 * as local; the session mint refuses channels; upgrades honour the marker.
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
import { effectiveScopes, parseLinkActor } from '../../../lib/anywhere/link-actor.js';
import { _resetInternalTokenCacheForTests } from '../../../lib/internal-token.js';
import { invalidateRemoteAccessConfig } from '../../../lib/remote-access/config.js';
import { type ChannelMarker, channelOfIncoming, channelOfRequest } from '../channel-peer.js';
import { revocableCredentialId } from '../device-connections.js';
import { remoteGateRejection } from '../remote-request-gate.js';
import {
  _resetDashboardSessionTokenForTests,
  credentialScopes,
  dashboardSessionCookieHeader,
  hasDashboardAuthHeaders,
  rejectUnauthorizedDashboardRequest,
  rejectUnauthorizedDashboardSessionMintRequest,
  resolveDashboardCredential,
} from '../routes/dashboard-auth.js';
import { authorizeDashboardUpgrade } from '../ws-auth.js';

const INTERNAL = 'machine-credential-internal-token';
const KEY_A = 'a1'.repeat(32);
const KEY_B = 'b2'.repeat(32);
const LINK: ChannelMarker = { mode: 'link', remoteKeyHex: KEY_A, pairingId: null };
const OTHER_LINK: ChannelMarker = { mode: 'link', remoteKeyHex: KEY_B, pairingId: null };
const PAIRING: ChannelMarker = { mode: 'pairing', remoteKeyHex: KEY_A, pairingId: 'cd'.repeat(16) };
const APPROVAL: ChannelMarker = { mode: 'approval', remoteKeyHex: KEY_A, pairingId: null, requestId: 'ef'.repeat(16), approvalSas: '123 456' };
const originalHome = process.env.OVERDECK_HOME;

let home: string;
let machineToken: string;
let machineTokenId: string;
let fencedToken: string;
let deviceToken: string;

function request(method: string, path: string, headers: Record<string, string> = {}, peer = '198.51.100.7') {
  return HttpServerRequest.fromWeb(new Request(`http://dashboard.test${path}`, { method, headers }))
    .modify({ remoteAddress: Option.some(peer) });
}

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4645-machine-cred-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = INTERNAL;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetAccessTokensForTests();
  invalidateRemoteAccessConfig();
  const machine = await createAccessToken({
    name: 'machine:desk', kind: 'machine', scopes: MACHINE_TOKEN_SCOPES('operator'),
    machineKey: KEY_A, environmentId: 'env-desk', access: 'operator',
  });
  machineToken = machine.token;
  machineTokenId = machine.record.id;
  fencedToken = (await createAccessToken({
    name: 'machine:lab', kind: 'machine', scopes: MACHINE_TOKEN_SCOPES('agent-fenced'),
    machineKey: KEY_B, environmentId: 'env-lab', access: 'agent-fenced',
  })).token;
  deviceToken = (await createAccessToken({ name: 'phone', kind: 'device', scopes: ['admin'] })).token;
});

afterEach(async () => {
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('machine credential resolution (D-4645-9)', () => {
  it('resolves nothing for a machine bearer on a plain socket', () => {
    expect(resolveDashboardCredential(bearer(machineToken))).toBeNull();
    expect(resolveDashboardCredential(bearer(machineToken), null)).toBeNull();
    expect(hasDashboardAuthHeaders(bearer(machineToken))).toBe(false);
  });

  it('resolves a machine credential with the FR-7 scopes inside a channel bound to its key', () => {
    const credential = resolveDashboardCredential(bearer(machineToken), LINK);
    expect(credential).toEqual({
      kind: 'machine',
      tokenId: machineTokenId,
      environmentId: 'env-desk',
      scopes: MACHINE_TOKEN_SCOPES('operator'),
      actor: { agentId: 'unknown' },
      access: 'operator',
    });
    expect(credentialScopes(credential!)).toEqual(MACHINE_TOKEN_SCOPES('operator'));
    expect(credentialScopes(credential!)).not.toContain('admin');
    expect(revocableCredentialId(credential)).toBe(machineTokenId);
  });

  it('resolves nothing inside a channel bound to another key, or a pairing channel', () => {
    expect(resolveDashboardCredential(bearer(machineToken), OTHER_LINK)).toBeNull();
    expect(resolveDashboardCredential(bearer(machineToken), PAIRING)).toBeNull();
    expect(resolveDashboardCredential(bearer(fencedToken), LINK)).toBeNull();
  });

  it('resolves no root, device or token credential over a channel (NFR-2)', () => {
    const session = dashboardSessionCookieHeader().split(';')[0]!;
    expect(resolveDashboardCredential({ 'x-overdeck-internal-token': INTERNAL }, LINK)).toBeNull();
    expect(resolveDashboardCredential(bearer(INTERNAL), LINK)).toBeNull();
    expect(resolveDashboardCredential({ cookie: session }, LINK)).toBeNull();
    expect(resolveDashboardCredential({ cookie: `overdeck_device=${deviceToken}` }, LINK)).toBeNull();
    expect(resolveDashboardCredential(bearer(deviceToken), LINK)).toBeNull();
    // The same headers still resolve on a plain socket.
    expect(resolveDashboardCredential({ 'x-overdeck-internal-token': INTERNAL })?.kind).toBe('internal-token');
    expect(resolveDashboardCredential({ cookie: session })?.kind).toBe('root-session');
  });

  it('applies the actor stamp: a ceiling narrows and cannot add admin; a fenced link downgrades operator', () => {
    const narrowed = resolveDashboardCredential(
      { ...bearer(machineToken), 'x-overdeck-link-actor': 'operator', 'x-overdeck-link-ceiling': 'read:state,admin,bogus,tell' },
      LINK,
    );
    expect(narrowed).toMatchObject({ kind: 'machine', actor: 'operator', scopes: ['read:state', 'tell'] });

    const agent = resolveDashboardCredential({ ...bearer(machineToken), 'x-overdeck-link-actor': 'agent:pan-4645' }, LINK);
    expect(agent).toMatchObject({ actor: { agentId: 'pan-4645' } });

    const fenced = resolveDashboardCredential({ ...bearer(fencedToken), 'x-overdeck-link-actor': 'operator' }, OTHER_LINK);
    expect(fenced).toMatchObject({ kind: 'machine', access: 'agent-fenced', actor: { agentId: 'operator-fenced' } });
    expect(credentialScopes(fenced!)).not.toContain('forward');

    expect(parseLinkActor(undefined, undefined, 'operator')).toEqual({ actor: { agentId: 'unknown' }, ceiling: null });
    expect(parseLinkActor('agent:', '', 'operator')).toEqual({ actor: { agentId: 'unknown' }, ceiling: null });
    expect(effectiveScopes(['tell', 'operate'], ['admin', 'tell'])).toEqual(['tell']);
  });
});

describe('remote request gate with channels', () => {
  it('admits a pairing channel to exactly GET /api/environment and POST /api/machines/exchange', () => {
    expect(remoteGateRejection(request('GET', '/api/environment'), PAIRING)).toBeNull();
    expect(remoteGateRejection(request('POST', '/api/machines/exchange'), PAIRING)).toBeNull();
    expect(remoteGateRejection(request('GET', '/api/issues'), PAIRING)).toEqual({ status: 401 });
    expect(remoteGateRejection(request('GET', '/api/health'), PAIRING)).toEqual({ status: 401 });
    expect(remoteGateRejection(request('POST', '/api/pairing/exchange'), PAIRING)).toEqual({ status: 401 });
  });

  it('refuses POST /api/machines/exchange from every plain socket, loopback and root included', () => {
    expect(remoteGateRejection(request('POST', '/api/machines/exchange', {}, '127.0.0.1'), null)).toEqual({ status: 401 });
    expect(remoteGateRejection(request('POST', '/api/machines/exchange', { 'x-overdeck-internal-token': INTERNAL }, '127.0.0.1'), null))
      .toEqual({ status: 401 });
    expect(remoteGateRejection(request('POST', '/api/machines/exchange', bearer(machineToken)), LINK)).toEqual({ status: 401 });
  });

  it('admits an approval channel to exactly GET /api/environment and POST /api/machines/approval-exchange (PAN-2356)', () => {
    expect(remoteGateRejection(request('GET', '/api/environment'), APPROVAL)).toBeNull();
    expect(remoteGateRejection(request('POST', '/api/machines/approval-exchange'), APPROVAL)).toBeNull();
    expect(remoteGateRejection(request('GET', '/api/machines'), APPROVAL)).toEqual({ status: 401 });
    expect(remoteGateRejection(request('POST', '/api/machines/exchange'), APPROVAL)).toEqual({ status: 401 });
    // A machine token on an approval channel does not widen it.
    expect(remoteGateRejection(request('GET', '/api/issues', bearer(machineToken)), APPROVAL)).toEqual({ status: 401 });
  });

  it('refuses POST /api/machines/approval-exchange from every non-approval socket (PAN-2356)', () => {
    expect(remoteGateRejection(request('POST', '/api/machines/approval-exchange', {}, '127.0.0.1'), null)).toEqual({ status: 401 });
    expect(remoteGateRejection(request('POST', '/api/machines/approval-exchange', { 'x-overdeck-internal-token': INTERNAL }, '127.0.0.1'), null))
      .toEqual({ status: 401 });
    expect(remoteGateRejection(request('POST', '/api/machines/approval-exchange', bearer(machineToken)), LINK)).toEqual({ status: 401 });
    expect(remoteGateRejection(request('POST', '/api/machines/approval-exchange'), PAIRING)).toEqual({ status: 401 });
  });

  it('never treats a link channel as a trusted local caller, and judges it by its machine credential', () => {
    expect(remoteGateRejection(request('GET', '/api/issues', {}, '127.0.0.1'), LINK)).toEqual({ status: 401 });
    expect(remoteGateRejection(request('GET', '/api/issues', { 'x-overdeck-internal-token': INTERNAL }, '127.0.0.1'), LINK))
      .toEqual({ status: 401 });
    expect(remoteGateRejection(request('GET', '/api/issues', bearer(machineToken)), LINK)).toBeNull();
    expect(remoteGateRejection(request('GET', '/api/conversations', bearer(machineToken)), LINK)).toBeNull();
    expect(remoteGateRejection(request('POST', '/api/access-tokens', bearer(machineToken)), LINK)).toEqual({ status: 403, missingScope: 'admin' });
    expect(remoteGateRejection(request('GET', '/api/issues', bearer(machineToken)), OTHER_LINK)).toEqual({ status: 401 });
    // The same bearer on a plain LAN socket is nobody.
    expect(remoteGateRejection(request('GET', '/api/issues', bearer(machineToken)), null)).toEqual({ status: 401 });
  });

  it('defense-in-depth route check and the session mint follow the same rules', () => {
    expect(rejectUnauthorizedDashboardRequest(request('GET', '/api/issues', bearer(machineToken)), LINK)).toBeNull();
    expect(rejectUnauthorizedDashboardRequest(request('POST', '/api/access-tokens', bearer(machineToken)), LINK)?.status).toBe(403);
    expect(rejectUnauthorizedDashboardRequest(request('GET', '/api/issues', bearer(machineToken)), null)?.status).toBe(401);

    const mint = request('POST', '/api/dashboard/session', { 'x-overdeck-internal-token': INTERNAL }, '127.0.0.1');
    expect(rejectUnauthorizedDashboardSessionMintRequest(mint, null)).toBeNull();
    expect(rejectUnauthorizedDashboardSessionMintRequest(mint, LINK)?.status).toBe(401);
    expect(rejectUnauthorizedDashboardSessionMintRequest(mint, PAIRING)?.status).toBe(401);
  });
});

describe('upgrades and markers', () => {
  it('authorizes a /ws upgrade for a machine credential inside its channel, within its scopes only', () => {
    const headers = bearer(machineToken);
    expect(authorizeDashboardUpgrade(headers, 'GET', 'read:events', LINK)).toMatchObject({ ok: true, credential: { kind: 'machine' } });
    expect(authorizeDashboardUpgrade(headers, 'GET', 'operate', LINK)).toMatchObject({ ok: true });
    expect(authorizeDashboardUpgrade(headers, 'GET', 'admin', LINK)).toMatchObject({ ok: false, status: 403 });
    expect(authorizeDashboardUpgrade(headers, 'GET', 'read:events', null)).toMatchObject({ ok: false, status: 401 });
    expect(authorizeDashboardUpgrade(headers, 'GET', 'read:events', OTHER_LINK)).toMatchObject({ ok: false, status: 401 });
  });

  it('reads the marker from a ChannelSocket and nothing from a web-backed request', () => {
    const marked = { [Symbol.for('overdeck.anywhere.channelSocket')]: true, channel: LINK };
    expect(channelOfIncoming({ socket: marked as never })).toEqual(LINK);
    expect(channelOfIncoming({ socket: {} as never })).toBeNull();
    expect(channelOfRequest(request('GET', '/api/environment'))).toBeNull();
  });
});
