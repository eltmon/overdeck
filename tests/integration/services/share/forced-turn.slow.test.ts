/**
 * Shared Sessions work through symmetric NATs via Cloudflare Realtime TURN (PRD PAN-4482 WI-6;
 * PAN-658 NFR-7 and AC-15).
 *
 * OPERATOR CHECKPOINT. This test calls Cloudflare with the share Worker's Realtime TURN key, so only the
 * operator runs it; agents never do (NFR-4). It is a `*.slow.test.ts` file, so the default run skips it:
 *
 *   TURN_KEY_ID=<key id> TURN_KEY_API_TOKEN=<api token> VITEST_INCLUDE_SLOW=1 \
 *     npx vitest run tests/integration/services/share/forced-turn.slow.test.ts
 *
 * The bundled share Worker runs on workerd with the TURN secrets bound and no outbound stub, so it mints
 * real credentials. Both peers force `iceTransportPolicy: 'relay'`: the host through the PeerHub's
 * `createPeerConnection` seam, the viewer through `LoopbackViewer`'s configuration built from
 * `JoinManager.iceServers` (the path the browser viewer uses). Two relay-only peers model two symmetric
 * NATs. The test passes when the conversation history arrives over the DataChannel and every candidate
 * either side signaled is `typ relay` (D-7). Without both env vars it fails with a named precondition
 * error; it never skips. No assertion prints an ICE URL, username or credential (NFR-3).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RTCPeerConnection } from 'werift';
import type { ConversationPayload, IceServer, JoinEvent, JoinState, RoomSnapshot, SignalData } from '@overdeck/contracts';

import type { AccountRecord } from '../../../../src/lib/account/store.js';
import { putShareRecord, readShareRecords, removeShareRecord } from '../../../../src/lib/sharing/share-record.js';
import { defaultOpenSocket, ShareManager } from '../../../../src/dashboard/server/services/share-host.js';
import { JoinManager } from '../../../../src/dashboard/server/services/share-join.js';
import { parseEntireConversation } from '../../../../src/dashboard/server/services/conversation/parser.js';
import { ConversationBridge } from '../../../../src/dashboard/server/sharing/conversation-bridge.js';
import { PeerHub, type HubPeerConnection, type PeerHubDeps } from '../../../../src/dashboard/server/sharing/peer-hub.js';
import { LoopbackViewer } from '../../../../src/dashboard/server/sharing/__tests__/loopback-viewer.js';
import { signaledCandidates } from '../../../helpers/share/ice-candidates.js';
import { startShareWorker, tokenFor, type ShareTestUser, type ShareWorker } from '../../../helpers/share/share-worker.js';
import { findLeaks, SignalingCapture } from '../../../helpers/share/signaling-capture.js';

const OWNER: ShareTestUser = { id: 1, login: 'owner' };
const VIEWER_A: ShareTestUser = { id: 100, login: 'alice' };
const CONVERSATION_ID = 'conv-forced-turn-1';
const FIXTURE_TEXT = 'forced-relay fixture message';
const WAIT = { timeout: 30_000, interval: 25 };

type HostIceConfig = Parameters<PeerHubDeps['createPeerConnection']>[0];

function account(user: ShareTestUser): AccountRecord {
  return {
    v: 1,
    baseUrl: 'https://overdeck.ai',
    accessToken: tokenFor(user.id),
    deviceId: `d${user.id}`,
    label: user.login,
    githubLogin: user.login,
    githubId: user.id,
    signedInAt: '2026-11-02T00:00:00.000Z',
  };
}

function userLine(text: string, uuid: string, timestamp: string): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: text }, timestamp, uuid });
}

/** True when some server offers a `turn:` or `turns:` URL with both a username and a credential. */
function hasAuthenticatedTurn(servers: ReadonlyArray<{ readonly urls: readonly string[]; readonly username?: string; readonly credential?: string }>): boolean {
  return servers.some((s) => Boolean(s.username) && Boolean(s.credential) && s.urls.some((u) => u.startsWith('turn:') || u.startsWith('turns:')));
}

/**
 * The viewer browser stand-in. Signals the host sends before the viewer exists (it needs ICE servers,
 * which only an admitted join can fetch) are buffered, then replayed in order on `attach`.
 */
class RelaySubscriber {
  readonly events: JoinEvent[] = [];
  viewer: LoopbackViewer | null = null;
  private readonly buffered: SignalData[] = [];

  constructor(
    private readonly joins: JoinManager,
    private readonly shortCode: string,
  ) {
    const unsubscribe = joins.subscribe(shortCode, (event) => {
      this.events.push(event);
      if (event.type !== 'signal') return;
      if (this.viewer) void this.viewer.onSignal(event.data);
      else this.buffered.push(event.data);
    });
    if (!unsubscribe) throw new Error('no join');
  }

  async attach(viewer: LoopbackViewer): Promise<void> {
    this.viewer = viewer;
    viewer.onOutgoingSignal((data) => this.joins.signal(this.shortCode, data));
    for (const data of this.buffered.splice(0)) await viewer.onSignal(data);
  }

  async waitState(state: JoinState): Promise<void> {
    await vi.waitFor(() => {
      if (!this.events.some((event) => event.type === 'state' && event.view.state === state)) throw new Error(`waiting for ${state}`);
    }, WAIT);
  }
}

let worker: ShareWorker;
let home = '';
const originalHome = process.env.OVERDECK_HOME;

beforeAll(async () => {
  const keyId = process.env.TURN_KEY_ID ?? '';
  const apiToken = process.env.TURN_KEY_API_TOKEN ?? '';
  if (!keyId || !apiToken) {
    throw new Error(
      'forced-TURN checkpoint needs TURN_KEY_ID and TURN_KEY_API_TOKEN (the share Worker\'s Realtime TURN key); see docs/SHARED-SESSIONS.md "Forced-relay checkpoint"',
    );
  }
  home = await mkdtemp(join(tmpdir(), 'overdeck-share-turn-home-'));
  process.env.OVERDECK_HOME = home;
  worker = await startShareWorker({ users: [OWNER, VIEWER_A], turn: { keyId, apiToken } });
}, 180_000);

afterAll(async () => {
  await worker?.dispose();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  if (home) await rm(home, { recursive: true, force: true });
}, 60_000);

describe('forced relay through Cloudflare Realtime TURN (PAN-4482, NFR-7, AC-15)', () => {
  it('relay-only peers on both ends connect and stream the conversation history', async () => {
    const file = join(home, `${CONVERSATION_ID}.jsonl`);
    await writeFile(file, `${userLine(FIXTURE_TEXT, 'u-1', '2026-11-03T00:00:00.000Z')}\n`);
    const capture = new SignalingCapture();
    const hostConfigs: HostIceConfig[] = [];

    const manager = new ShareManager({
      readAccount: async () => account(OWNER),
      readShareUrl: async () => ({ url: worker.url }),
      createRoom: capture.createRoom,
      deleteRoom: capture.deleteRoom,
      records: { read: readShareRecords, put: putShareRecord, remove: removeShareRecord },
      openSocket: capture.openSocket('host', OWNER.login, defaultOpenSocket),
      now: () => new Date(),
      createHub: (ctx) =>
        new PeerHub(ctx, {
          createPeerConnection: (config) => {
            hostConfigs.push(config);
            return new RTCPeerConnection({ ...config, iceTransportPolicy: 'relay' }) as unknown as HubPeerConnection;
          },
          bridge: new ConversationBridge(ctx.scope.conversationId, {
            resolveSessionFile: async () => file,
            parseInitial: (sessionFile) => parseEntireConversation(sessionFile, { flushPendingToolUse: false }),
            watch: () => ({ stop: () => undefined }),
          }),
          queue: {
            deliver: async () => ({ status: 200, body: {} }),
            activity: async () => ({ working: false, lastMessageId: null }),
            now: () => Date.now(),
          },
          terminal: { attach: async () => () => undefined, close: () => undefined },
          streamLabel: async () => 'Forced relay',
          now: () => Date.now(),
        }),
    });
    const joins = new JoinManager({
      readAccount: async () => account(VIEWER_A),
      readShareUrl: async () => ({ url: worker.url }),
      openSocket: capture.openSocket('viewer', VIEWER_A.login, defaultOpenSocket),
      now: () => Date.now(),
    });
    let shortCode: string | null = null;
    let subscriber: RelaySubscriber | null = null;

    const snapshotWhere = (code: string, match: (s: RoomSnapshot) => boolean) =>
      vi.waitFor(async () => {
        const view = (await manager.list()).find((v) => v.shortCode === code);
        if (view?.connection !== 'connected' || !view.snapshot || !match(view.snapshot)) throw new Error('waiting for snapshot');
      }, WAIT);

    try {
      const created = await manager.create({ kind: 'conversation', conversationId: CONVERSATION_ID });
      expect(created.kind).toBe('created');
      if (created.kind !== 'created') return;
      shortCode = created.view.shortCode;
      await snapshotWhere(shortCode, (s) => s.hostConnected);

      expect((await joins.join(shortCode)).kind).toBe('created');
      subscriber = new RelaySubscriber(joins, shortCode);
      await subscriber.waitState('lobby');
      expect((await manager.command(shortCode, { type: 'admit', githubId: VIEWER_A.id })).status).toBe(202);
      await subscriber.waitState('admitted');

      const ice = await joins.iceServers(shortCode);
      expect(ice.ok, 'the viewer server fetched ICE servers').toBe(true);
      if (!ice.ok) return;
      const viewerIce: IceServer[] = ice.iceServers;
      const viewer = new LoopbackViewer({
        iceServers: viewerIce.map((s) => ({ urls: [...s.urls], username: s.username, credential: s.credential })),
        iceTransportPolicy: 'relay',
      });
      await subscriber.attach(viewer);

      await vi.waitFor(
        () => {
          const arrived = (viewer.envelopes.get('conversation') ?? []).some((envelope) => {
            const payload = envelope.payload as ConversationPayload;
            return payload.kind === 'history' && payload.messages.some((m) => m.text === FIXTURE_TEXT);
          });
          if (!arrived) throw new Error('waiting for the history over the relayed DataChannel');
        },
        { timeout: 90_000, interval: 50 },
      );

      // Both sides were handed authenticated TURN servers.
      expect(hostConfigs.length, 'host peer connections created').toBeGreaterThan(0);
      expect(hasAuthenticatedTurn(hostConfigs[0]?.iceServers ?? []), 'host ICE list has an authenticated TURN server').toBe(true);
      expect(hasAuthenticatedTurn(viewerIce), 'viewer ICE list has an authenticated TURN server').toBe(true);

      // Every candidate either side signaled is a relay candidate, at least one per side.
      const hostSignals = capture.entries.flatMap((entry) => {
        if (entry.kind !== 'ws-text' || entry.role !== 'host' || entry.direction !== 'to-service') return [];
        const frame = JSON.parse(entry.text) as { type?: string; data?: SignalData };
        return frame.type === 'signal' && frame.data ? [frame.data] : [];
      });
      const hostTypes = signaledCandidates(hostSignals).map((c) => c.type);
      const viewerTypes = signaledCandidates(viewer.signals).map((c) => c.type);
      expect(hostTypes.length, 'host candidates signaled').toBeGreaterThan(0);
      expect(viewerTypes.length, 'viewer candidates signaled').toBeGreaterThan(0);
      expect(hostTypes.filter((t) => t !== 'relay'), 'host non-relay candidate types').toEqual([]);
      expect(viewerTypes.filter((t) => t !== 'relay'), 'viewer non-relay candidate types').toEqual([]);

      // The content stayed off the share service.
      expect(findLeaks(capture.entries, [FIXTURE_TEXT])).toEqual([]);
    } finally {
      if (shortCode) await manager.end(shortCode).catch(() => undefined);
      manager.stop();
      joins.stop();
      await subscriber?.viewer?.close();
    }
  }, 180_000);
});
