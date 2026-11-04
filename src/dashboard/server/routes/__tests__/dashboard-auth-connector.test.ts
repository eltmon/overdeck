/**
 * PAN-4949 W-2: a `connector` credential resolves only inside a link-mode
 * channel bound to its `connectorKey`, carries only the connector scope
 * choices even from a hand-edited record, skips the CSRF/Origin checks like a
 * phone's bearer, and is revocable: revoking its record reaches its channels
 * through `registerRevocationClosers`.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Option } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../channel-listener.js', () => ({ closeChannelsForPeer: vi.fn(() => 0) }));

import {
  _resetAccessTokensForTests,
  _settleAccessTokenWritesForTests,
  createAccessToken,
  refreshAccessTokens,
  revokeAccessToken,
} from '../../../../lib/access-tokens.js';
import { _resetInternalTokenCacheForTests } from '../../../../lib/internal-token.js';
import { closeChannelsForPeer } from '../../channel-listener.js';
import type { ChannelMarker } from '../../channel-peer.js';
import { revocableCredentialId } from '../../device-connections.js';
import { registerRevocationClosers } from '../../ws-rpc-auth.js';
import {
  _resetDashboardSessionTokenForTests,
  rejectUnsafeDashboardMutationRequest,
  resolveDashboardCredential,
} from '../dashboard-auth.js';

const CONNECTOR_KEY_A = 'c1'.repeat(32);
const CONNECTOR_KEY_B = 'c2'.repeat(32);
const CLIENT_ID = '22222222-2222-4222-8222-222222222222';
const LINK: ChannelMarker = { mode: 'link', remoteKeyHex: CONNECTOR_KEY_A, pairingId: null };
const OTHER_LINK: ChannelMarker = { mode: 'link', remoteKeyHex: CONNECTOR_KEY_B, pairingId: null };
const PAIRING: ChannelMarker = { mode: 'pairing', remoteKeyHex: CONNECTOR_KEY_A, pairingId: 'cd'.repeat(16) };
const APPROVAL: ChannelMarker = { mode: 'approval', remoteKeyHex: CONNECTOR_KEY_A, pairingId: null, requestId: 'ef'.repeat(16) };
const originalHome = process.env.OVERDECK_HOME;

/** A `ChannelSocket` stand-in: just the symbol `isChannelSocket` checks for, and the marker. */
function channelSocket(marker: ChannelMarker) {
  return { [Symbol.for('overdeck.anywhere.channelSocket')]: true, channel: marker };
}

function fakeChannelRequest(headers: Record<string, string>, marker: ChannelMarker, route: { method: string; url: string }) {
  return {
    ...route,
    headers,
    remoteAddress: Option.none(),
    source: { socket: channelSocket(marker) },
  } as unknown as Parameters<typeof rejectUnsafeDashboardMutationRequest>[0];
}

let home: string;
let connectorToken: string;
let connectorId: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4949-connector-cred-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = 'connector-cred-internal-token';
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetAccessTokensForTests();
  vi.mocked(closeChannelsForPeer).mockClear();
  const created = await createAccessToken({
    name: 'bot:desk', kind: 'connector', scopes: ['read:state', 'tell'],
    connectorKey: CONNECTOR_KEY_A, clientId: CLIENT_ID,
  });
  connectorToken = created.token;
  connectorId = created.record.id;
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

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

describe('connector credential resolution (PAN-4927 D-17)', () => {
  it('resolves a connector credential with exactly its record scopes inside a link channel bound to its key', () => {
    expect(resolveDashboardCredential(bearer(connectorToken), LINK)).toEqual({
      kind: 'connector', tokenId: connectorId, clientId: CLIENT_ID, connectorKey: CONNECTOR_KEY_A, scopes: ['read:state', 'tell'],
    });
  });

  it('resolves nothing on a plain socket, in a pairing or approval channel, or in a link channel from another key', () => {
    expect(resolveDashboardCredential(bearer(connectorToken))).toBeNull();
    expect(resolveDashboardCredential(bearer(connectorToken), PAIRING)).toBeNull();
    expect(resolveDashboardCredential(bearer(connectorToken), APPROVAL)).toBeNull();
    expect(resolveDashboardCredential(bearer(connectorToken), OTHER_LINK)).toBeNull();
  });

  it('keeps only the connector scope choices from a hand-edited record (PAN-4927 D-5)', async () => {
    const token = `odk_${'7'.repeat(64)}`;
    const record = {
      id: 'hand-edited', name: 'bot:edited', kind: 'connector', scopes: ['read:state', 'admin', 'forward'],
      tokenHash: createHash('sha256').update(token).digest('hex'), createdAt: '2026-11-01T00:00:00.000Z', lastUsedAt: null,
      connectorKey: CONNECTOR_KEY_B, clientId: CLIENT_ID,
    };
    await _settleAccessTokenWritesForTests();
    await writeFile(join(home, 'access-tokens.json'), JSON.stringify({ v: 1, tokens: [record] }), { mode: 0o600 });
    await refreshAccessTokens();
    expect(resolveDashboardCredential(bearer(token), OTHER_LINK)).toMatchObject({ kind: 'connector', tokenId: 'hand-edited', scopes: ['read:state'] });
  });
});

describe('connector credential at the mutation and revocation seams (PAN-4949 W-2)', () => {
  it('skips the Origin/CSRF checks for a connector bearer over its channel', () => {
    const request = fakeChannelRequest(
      { 'content-type': 'application/json', ...bearer(connectorToken) },
      LINK,
      { method: 'POST', url: '/api/conversations/c1/message' },
    );
    expect(rejectUnsafeDashboardMutationRequest(request)).toBeNull();
  });

  it('names the connector record as the revocable credential id', () => {
    expect(revocableCredentialId(resolveDashboardCredential(bearer(connectorToken), LINK))).toBe(connectorId);
  });

  it('closes the connector key channels once when its record is revoked', async () => {
    const unsubscribe = registerRevocationClosers();
    try {
      await revokeAccessToken(connectorId);
      expect(vi.mocked(closeChannelsForPeer)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(closeChannelsForPeer)).toHaveBeenCalledWith(CONNECTOR_KEY_A);
    } finally {
      unsubscribe();
    }
  });
});
