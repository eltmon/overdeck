/**
 * PAN-2356 WI-14: two in-process machines (approver A, requester R) joined by an in-memory
 * directory and an in-memory approval channel (a duplex pair running the real approval-mode
 * handshake, with R's HTTP side answering the exchange). Real token and link stores in a temp
 * OVERDECK_HOME; both machines share it, so links and tokens are told apart by environment id.
 * The 10-minute expiry runs on an injected clock.
 */
import { createRequire } from 'node:module';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { duplexPair } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APPROVAL_TTL_MS, type DirectoryToMachineFrame, type MachineToDirectoryFrame } from '@overdeck/contracts';

vi.mock('../../../../lib/activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));

const { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, listActiveRecordsOfKind, revokeAccessToken } = await import('../../../../lib/access-tokens.js');
const { _resetLinkStoreForTests, _settleLinkStoreWritesForTests, listLinks, upsertLink } = await import('../../../../lib/anywhere/link-store.js');
const { acceptChannel } = await import('../../../../lib/anywhere/channel/accept.js');
const { openChannelOverTransport } = await import('../../../../lib/anywhere/channel/open.js');
const { channelOfIncoming } = await import('../../channel-peer.js');
const { grantMachineLink } = await import('../machine-link-grant.js');
const { channelRequest } = await import('../machine-link-service.js');
const { DirectoryApprovalService } = await import('../directory-approval.js');
type Service = InstanceType<typeof DirectoryApprovalService>;
type MachineKeyPair = import('../../../../lib/anywhere/machine-key.js').MachineKeyPair;
type AnywhereAnalytics = import('../../../../lib/telemetry/anywhere.js').AnywhereAnalytics;

const _require = createRequire(import.meta.url);
const dh = _require('noise-handshake/dh') as { generateKeyPair(): MachineKeyPair };

const A_ENV = '00000000-0000-4000-8000-00000000000a';
const R_ENV = '00000000-0000-4000-8000-00000000000b';
const keyA = dh.generateKeyPair();
const keyR = dh.generateKeyPair();
const hex = (key: MachineKeyPair) => key.publicKey.toString('hex');
const originalHome = process.env.OVERDECK_HOME;

type Handler = (frame: DirectoryToMachineFrame) => void;

interface World {
  a: Service;
  r: Service;
  clock: { now: number };
  servers: http.Server[];
}

/** PAN-5016: per-machine analytics fakes, and a requester whose directory socket is down. */
interface WorldTelemetry {
  a?: AnywhereAnalytics;
  r?: AnywhereAnalytics;
  rOffline?: boolean;
}

/**
 * `advertisedKey` is the key the directory claims for R; a different value models a directory
 * that lies about R's key.
 */
function world(advertisedKey = hex(keyR), telemetry: WorldTelemetry = {}): World {
  const clock = { now: Date.UTC(2026, 10, 1, 12, 0, 0) };
  const handlers = new Map<string, Map<string, Set<Handler>>>();
  const deliver = (to: string, frame: DirectoryToMachineFrame) => {
    for (const handler of handlers.get(to)?.get(frame.type) ?? []) handler(frame);
  };
  const port = (self: string) => {
    const mine = new Map<string, Set<Handler>>();
    handlers.set(self, mine);
    return {
      send(frame: MachineToDirectoryFrame) {
        const other = self === A_ENV ? R_ENV : A_ENV;
        if (frame.type === 'approval-request') {
          deliver(other, {
            type: 'approval-request',
            requestId: frame.requestId,
            from: self,
            label: self === R_ENV ? 'requester' : 'approver',
            fingerprint: 'from-directory',
            publicKeyHex: self === R_ENV ? advertisedKey : hex(keyA),
            expiresAt: clock.now + APPROVAL_TTL_MS,
          });
        } else if (frame.type === 'approval-cancel') {
          deliver(other, { type: 'approval-cancel', requestId: frame.requestId });
        }
        return true;
      },
      on<T extends DirectoryToMachineFrame['type']>(type: T, handler: (frame: Extract<DirectoryToMachineFrame, { type: T }>) => void) {
        let set = mine.get(type);
        if (!set) mine.set(type, (set = new Set()));
        set.add(handler as Handler);
        return () => set.delete(handler as Handler);
      },
    };
  };

  const servers: http.Server[] = [];
  const common = {
    request: channelRequest,
    grant: grantMachineLink,
    revokeToken: revokeAccessToken,
    upsertLink,
    notifyLinksChanged: () => undefined,
    now: () => clock.now,
    sleep: async (ms: number) => {
      clock.now += ms;
    },
  };

  let r!: Service;
  // R's HTTP side: the approval exchange and its descriptor, reached only through the channel.
  const rHttp = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      void (async () => {
        if (req.method === 'POST' && req.url === '/api/machines/approval-exchange') {
          const answer = await r.handleExchange(body, channelOfIncoming(req));
          res.writeHead(answer.status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(answer.json));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ endpoints: [{ kind: 'lan', url: 'tcp://192.168.1.9:3011' }] }));
      })();
    });
  });
  servers.push(rHttp);

  const a = new DirectoryApprovalService({
    ...common,
    analytics: telemetry.a,
    directory: port(A_ENV),
    identity: async () => ({ environmentId: A_ENV, label: 'approver' }),
    endpoints: () => [{ kind: 'lan', url: 'tcp://192.168.1.8:3011' }],
    async openApprovalChannel(_peer, requestId) {
      const [mine, theirs] = duplexPair();
      void acceptChannel(theirs, {
        localKey: keyR,
        isPinnedPeer: () => false,
        takePairing: () => 'unknown',
        onPairingFailure: () => undefined,
        takeApproval: (id) => r.takeApproval(id),
      }).then((channel) => {
        r.onIncomingChannel(channel);
        rHttp.emit('connection', channel);
      }, () => undefined);
      return openChannelOverTransport(mine, { mode: 'approval', localKey: keyA, requestId });
    },
  });
  const rPort = port(R_ENV);
  r = new DirectoryApprovalService({
    ...common,
    analytics: telemetry.r,
    directory: telemetry.rOffline ? { ...rPort, send: () => false } : rPort,
    identity: async () => ({ environmentId: R_ENV, label: 'requester' }),
    endpoints: () => [],
    openApprovalChannel: () => Promise.reject(new Error('the requester never dials')),
  });
  return { a, r, clock, servers };
}

let home = '';
let current: World | null = null;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-2356-approval-'));
  process.env.OVERDECK_HOME = home;
  _resetAccessTokensForTests();
  _resetLinkStoreForTests();
});

afterEach(async () => {
  current?.a.stop();
  current?.r.stop();
  for (const server of current?.servers ?? []) server.close();
  current = null;
  await _settleAccessTokenWritesForTests();
  await _settleLinkStoreWritesForTests();
  _resetAccessTokensForTests();
  _resetLinkStoreForTests();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('directory approval (PAN-2356 WI-14)', () => {
  it('approve plus accept creates exactly one operator link each way and two machine tokens', async () => {
    const w = (current = world());
    const requestId = w.r.join(null);
    expect(w.a.views().approvals).toMatchObject([{ requestId, from: R_ENV, label: 'requester', state: 'pending', sas: null }]);

    const opened = await w.a.open(requestId);
    expect(opened.sas).toMatch(/^\d{3} \d{3}$/);
    await vi.waitFor(() => expect(w.r.views().joins[0]).toMatchObject({ requestId, state: 'open', sas: opened.sas }));
    // Each side shows the other's handshake fingerprint, never the directory's.
    expect(w.a.views().approvals[0]?.fingerprint).toBe(opened.fingerprint);
    expect(w.r.views().joins[0]?.fingerprint).not.toBe('from-directory');

    const done = w.a.approve(requestId);
    w.r.accept(requestId);
    await done;

    const links = await listLinks();
    expect(links.map((l) => [l.environmentId, l.label, l.access]).sort()).toEqual([
      [A_ENV, 'approver', 'operator'],
      [R_ENV, 'requester', 'operator'],
    ]);
    const aToR = links.find((l) => l.environmentId === R_ENV)!;
    const rToA = links.find((l) => l.environmentId === A_ENV)!;
    expect(aToR.machineKey).toBe(hex(keyR));
    expect(rToA.machineKey).toBe(hex(keyA));
    expect(aToR.routes.map((route) => route.url)).toEqual(['tcp://192.168.1.9:3011']);
    expect(rToA.routes.map((route) => route.url)).toEqual(['tcp://192.168.1.8:3011']);
    const tokens = listActiveRecordsOfKind('machine');
    expect(tokens.map((t) => [t.environmentId, t.machineKey]).sort()).toEqual([
      [A_ENV, hex(keyA)],
      [R_ENV, hex(keyR)],
    ]);
    expect(w.a.views().approvals).toEqual([]);
  });

  it('creates nothing on either side when the requester never accepts within 10 minutes, and revokes the approver token', async () => {
    const w = (current = world());
    const requestId = w.r.join(null);
    await w.a.open(requestId);
    await vi.waitFor(() => expect(w.r.views().joins[0]?.state).toBe('open'));
    expect(w.r.views().joins[0]?.state).toBe('open');

    await w.a.approve(requestId);
    expect(w.clock.now).toBeGreaterThanOrEqual(Date.UTC(2026, 10, 1, 12, 0, 0) + APPROVAL_TTL_MS);
    expect(await listLinks()).toEqual([]);
    expect(listActiveRecordsOfKind('machine')).toEqual([]);
    expect(w.a.views().approvals).toEqual([]);
  });

  it('refuses to open when the approval channel key differs from the key the request named', async () => {
    const w = (current = world('c3'.repeat(32)));
    const requestId = w.r.join(null);
    await expect(w.a.open(requestId)).rejects.toMatchObject({ code: 'fingerprint-mismatch' });
    expect(w.a.views().approvals[0]?.state).toBe('pending');
    expect(await listLinks()).toEqual([]);
    expect(listActiveRecordsOfKind('machine')).toEqual([]);
  });

  it('accepts one approval channel per request id and only for a live request', () => {
    const w = (current = world());
    const requestId = w.r.join(null);
    expect(w.r.takeApproval('f'.repeat(32))).toBe(false);
    expect(w.r.takeApproval(requestId)).toBe(true);
    expect(w.r.takeApproval(requestId)).toBe(false);
  });

  it('refuses the exchange outside an approval channel, and a reject cancels the request on both sides', async () => {
    const w = (current = world());
    expect(await w.r.handleExchange('{}', null)).toMatchObject({ status: 403 });
    const requestId = w.r.join(null);
    await w.a.open(requestId);
    await vi.waitFor(() => expect(w.r.views().joins[0]?.state).toBe('open'));
    w.r.rejectJoin(requestId);
    // The requester's reject cancels the request on the approver: nothing is left to approve.
    expect(w.r.views().joins[0]?.state).toBe('rejected');
    expect(w.a.views().approvals).toEqual([]);
    expect(() => w.a.approve(requestId)).toThrow(/No live approval request/);
    expect(listActiveRecordsOfKind('machine')).toEqual([]);
  });
});

describe('directory approval telemetry (PAN-5016 WI-5)', () => {
  function spies() {
    const a = vi.fn();
    const r = vi.fn();
    return { a, r, telemetry: { a: { capture: a }, r: { capture: r } } };
  }

  it('join records started on the requester; an offline directory records the offline failure and throws', () => {
    const { r, telemetry } = spies();
    const w = (current = world(hex(keyR), telemetry));
    w.r.join(null);
    expect(r.mock.calls).toEqual([['machine_link_started', { method: 'directory_approval' }]]);

    const offline = spies();
    const down = world(hex(keyR), { ...offline.telemetry, rOffline: true });
    try {
      expect(() => down.r.join(null)).toThrow(expect.objectContaining({ code: 'offline' }));
    } finally {
      down.a.stop();
      down.r.stop();
      for (const server of down.servers) server.close();
    }
    expect(offline.r.mock.calls).toEqual([['machine_link_failed', { method: 'directory_approval', side: 'requester', reason: 'offline' }]]);
  });

  it('a full approve run records approved on both sides, and a repeated exchange records the requester once', async () => {
    const { a, r, telemetry } = spies();
    const w = (current = world(hex(keyR), telemetry));
    const requestId = w.r.join(null);
    await w.a.open(requestId);
    await vi.waitFor(() => expect(w.r.views().joins[0]?.state).toBe('open'));
    const done = w.a.approve(requestId);
    w.r.accept(requestId);
    await done;

    expect(a.mock.calls).toEqual([['machine_link_approved', { method: 'directory_approval', side: 'approver' }]]);
    const marker = { mode: 'approval' as const, remoteKeyHex: hex(keyA), pairingId: null, requestId, approvalSas: '000 000' };
    expect(await w.r.handleExchange('{}', marker)).toMatchObject({ status: 200 });
    expect(r.mock.calls).toEqual([
      ['machine_link_started', { method: 'directory_approval' }],
      ['machine_link_approved', { method: 'directory_approval', side: 'requester' }],
    ]);
  });

  it('a requester reject records approval_refused there and approval_failed on the approver', async () => {
    const { a, r, telemetry } = spies();
    const w = (current = world(hex(keyR), telemetry));
    const requestId = w.r.join(null);
    await w.a.open(requestId);
    await vi.waitFor(() => expect(w.r.views().joins[0]?.state).toBe('open'));
    const done = w.a.approve(requestId);
    w.r.rejectJoin(requestId);
    await done;

    expect(r).toHaveBeenLastCalledWith('machine_link_failed', { method: 'directory_approval', side: 'requester', reason: 'approval_refused' });
    expect(a.mock.calls).toEqual([['machine_link_failed', { method: 'directory_approval', side: 'approver', reason: 'approval_failed' }]]);
    expect(await listLinks()).toEqual([]);
  });
});
