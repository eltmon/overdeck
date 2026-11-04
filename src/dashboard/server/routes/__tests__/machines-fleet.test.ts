/**
 * PAN-4654 WI-7: the fleet table and the Update all fan-out. Links, link
 * status, peers and this machine's job service are injected; no channels.
 */
import { HttpServerResponse } from 'effect/unstable/http';
import { describe, expect, it, vi } from 'vitest';
import type { FleetUpdateJob, LinkState, MachineVersionsReport } from '@overdeck/contracts';

import type { MachineLink } from '../../../../lib/anywhere/link-store.js';
import type { LinkStatusSource, UnsupportedInstall } from '../../services/machine-link-service.js';
import { buildFleetVersions, type FleetDeps, parseFleetUpdateBody, refuseFleetRequest, runFleetUpdate } from '../machines-fleet.js';

function link(id: string, label: string): MachineLink {
  return {
    id, environmentId: `env-${label}`, label, machineKey: 'ab'.repeat(32), token: 'odk_x', access: 'operator',
    routes: [], createdAt: '2026-11-01T00:00:00.000Z',
  } as unknown as MachineLink;
}

function report(label: string, version = '0.73.0'): MachineVersionsReport {
  return {
    environmentId: `env-${label}`, label,
    overdeck: { version, installMode: 'npm-global', linkProtocol: 1 },
    harnesses: [{ binary: 'claude', label: 'Claude Code', harnesses: ['claude-code'], version: '2.1.293', updatable: true, command: 'claude update', reason: null }],
    job: null,
  };
}

function job(id: string): FleetUpdateJob {
  return {
    id, mode: 'when-idle', phase: 'waiting', requestedBy: 'operator', startedAt: '2026-11-01T12:00:00.000Z',
    waitingTurns: 0, waitingSince: '2026-11-01T12:00:00.000Z', finishedAt: null, components: [],
  };
}

interface Peer { state: LinkState; stateDetail?: string | null; peerVersion?: string | null; unsupported?: UnsupportedInstall | null; answer?: (path: string, method: string) => { status: number; json: unknown } | Error }

function deps(peers: Record<string, Peer>, overrides: Partial<FleetDeps> = {}) {
  const links = Object.keys(peers).map((label, index) => link(`link-${index}`, label));
  const calls: Array<{ label: string; path: string; method: string; body: unknown; actor: string }> = [];
  const order: string[] = [];
  const start = vi.fn<FleetDeps['service']['start']>(async () => {
    order.push('self');
    return { outcome: 'started', job: job('self-job') };
  });
  const cancel = vi.fn<FleetDeps['service']['cancel']>(async () => null);
  const value: FleetDeps = {
    links: async () => links,
    status: (linkId): ReturnType<LinkStatusSource['status']> => {
      const label = links.find((entry) => entry.id === linkId)!.label;
      const peer = peers[label]!;
      return {
        state: peer.state, stateDetail: peer.stateDetail ?? null, currentRoute: null, lastHeartbeatAt: null, incident: null,
        peerVersion: peer.peerVersion ?? '0.73.0', unsupported: peer.unsupported ?? null, routeStatus: () => 'untried',
      };
    },
    fetchPeer: async (environmentId, path, init) => {
      const label = environmentId.replace(/^env-/, '');
      const method = init.method ?? 'GET';
      calls.push({ label, path, method, body: init.body, actor: init.actor });
      order.push(label);
      const answer = peers[label]!.answer?.(path, method) ?? { status: 200, json: path === '/api/versions/self' ? report(label) : { job: job(`${label}-job`) } };
      if (answer instanceof Error) throw answer;
      return answer;
    },
    selfReport: async () => report('desk'),
    self: async () => ({ environmentId: 'env-desk', label: 'desk' }),
    localVersion: async () => '0.73.0',
    service: { start, cancel },
    primary: () => true,
    ...overrides,
  };
  return { deps: value, calls, order, start, cancel };
}

describe('GET /api/machines/versions (PAN-4654 WI-7)', () => {
  it('rows: self first, then one row per link in link-store order', async () => {
    const { deps: d } = deps({ lab: { state: 'online' }, attic: { state: 'offline', stateDetail: 'no route answered', peerVersion: '0.72.0' }, shed: { state: 'online' } });
    const { rows } = await buildFleetVersions(d);
    expect(rows.map((row) => [row.label, row.state])).toEqual([['desk', 'self'], ['lab', 'online'], ['attic', 'offline'], ['shed', 'online']]);
    expect(rows[0]).toMatchObject({ self: true, updateSupported: true, report: { label: 'desk' } });
    expect(rows[1]).toMatchObject({ self: false, updateSupported: true, report: { label: 'lab' }, error: null });
    expect(rows[2]).toMatchObject({ report: null, updateSupported: false, stateDetail: 'no route answered', peerVersion: '0.72.0' });
  });

  it('an unsupported link row carries the install version, place and npm command', async () => {
    const { deps: d, calls } = deps({ lab: { state: 'unsupported', stateDetail: 'Install Overdeck 0.73.0 on lab: npm install -g @overdeck/core@0.73.0', unsupported: { version: '0.73.0', on: 'peer' } } });
    const { rows } = await buildFleetVersions(d);
    expect(rows[1]).toMatchObject({ state: 'unsupported', updateSupported: false, install: { version: '0.73.0', on: 'peer', command: 'npm install -g @overdeck/core@0.73.0' } });
    expect(calls).toEqual([]);
  });

  it('a 404 from an online peer gives updateSupported false and the D-11 text', async () => {
    const { deps: d } = deps({ lab: { state: 'online', peerVersion: '0.71.0', answer: () => ({ status: 404, json: { error: 'not found' } }) } });
    const { rows } = await buildFleetVersions(d);
    expect(rows[1]).toMatchObject({
      updateSupported: false,
      install: { version: '0.73.0', on: 'peer', command: 'npm install -g @overdeck/core@0.73.0' },
      error: 'Overdeck 0.71.0 on lab predates fleet updates. Install 0.73.0: npm install -g @overdeck/core@0.73.0',
    });
  });

  it('an older peer whose gate refuses with insufficient_scope (admin) is also treated as predating fleet updates', async () => {
    const { deps: d } = deps({ lab: { state: 'online', peerVersion: '0.73.0', answer: () => ({ status: 403, json: { error: 'insufficient_scope', missingScope: 'admin' } }) } });
    const { rows } = await buildFleetVersions(d);
    expect(rows[1]).toMatchObject({ updateSupported: false, install: { version: '0.73.0', on: 'peer' } });
    expect(rows[1]!.error).toContain('predates fleet updates');
  });

  it('a peer that cannot answer gets its error and no report', async () => {
    const { deps: d } = deps({ lab: { state: 'online', answer: () => new Error('did not answer within 2.5 s') }, shed: { state: 'online', answer: () => ({ status: 200, json: { nope: true } }) } });
    const { rows } = await buildFleetVersions(d);
    expect(rows[1]).toMatchObject({ report: null, updateSupported: false, error: 'did not answer within 2.5 s' });
    expect(rows[2]).toMatchObject({ report: null, error: 'shed sent a version report this machine cannot read' });
  });

  it('reads each online peer with an operator actor', async () => {
    const { deps: d, calls } = deps({ lab: { state: 'online' } });
    await buildFleetVersions(d);
    expect(calls).toEqual([{ label: 'lab', path: '/api/versions/self', method: 'GET', body: undefined, actor: 'operator' }]);
  });
});

describe('POST /api/machines/update (PAN-4654 WI-7)', () => {
  const body = (text = '{}') => {
    const parsed = parseFleetUpdateBody(text);
    if (typeof parsed === 'string') throw new Error(parsed);
    return parsed;
  };

  it('Update all calls each online peer with an operator actor and mode, then starts this machine last', async () => {
    const { deps: d, calls, order, start } = deps({ lab: { state: 'online' }, shed: { state: 'online' } });
    const result = await runFleetUpdate(body('{"mode":"now"}'), d);
    expect(calls.map(({ label, path, method, body: sent, actor }) => [label, path, method, sent, actor])).toEqual([
      ['lab', '/api/versions/self/update', 'POST', { mode: 'now' }, 'operator'],
      ['shed', '/api/versions/self/update', 'POST', { mode: 'now' }, 'operator'],
    ]);
    expect(order.at(-1)).toBe('self');
    expect(start).toHaveBeenCalledWith('now', 'operator');
    expect('started' in result && result.started.map((entry) => [entry.label, entry.job.id])).toEqual([['lab', 'lab-job'], ['shed', 'shed-job'], ['desk', 'self-job']]);
  });

  it('an offline link is skipped by Update all with "<label> is offline" and is not called', async () => {
    const { deps: d, calls } = deps({ attic: { state: 'offline' } });
    const result = await runFleetUpdate(body(), d);
    expect(calls).toEqual([]);
    expect('skipped' in result && result.skipped).toEqual([{ environmentId: 'env-attic', label: 'attic', reason: 'attic is offline' }]);
  });

  it('an unsupported link is skipped with its install detail', async () => {
    const { deps: d } = deps({ lab: { state: 'unsupported', stateDetail: 'Install Overdeck 0.73.0 on lab: npm install -g @overdeck/core@0.73.0' } });
    const result = await runFleetUpdate(body(), d);
    expect('skipped' in result && result.skipped[0]?.reason).toBe('lab is unsupported: Install Overdeck 0.73.0 on lab: npm install -g @overdeck/core@0.73.0');
  });

  it('a peer answering 403 (agent-fenced link) is skipped with a reason naming agent-fenced', async () => {
    const { deps: d } = deps({ lab: { state: 'online', answer: () => ({ status: 403, json: { error: 'fleet-update-forbidden' } }) } });
    const result = await runFleetUpdate(body(), d);
    expect('skipped' in result && result.skipped[0]?.reason).toBe('lab: this link is agent-fenced; Update all needs an operator-level link');
  });

  it('a 404 or gate-refused peer predates fleet updates; a 409 peer reports its error code; a thrown peer reports the message', async () => {
    const { deps: d } = deps({
      old: { state: 'online', answer: () => ({ status: 404, json: null }) },
      older: { state: 'online', answer: () => ({ status: 403, json: { error: 'insufficient_scope', missingScope: 'admin' } }) },
      odd: { state: 'online', answer: () => ({ status: 403, json: { error: 'insufficient_scope', missingScope: 'operate' } }) },
      busy: { state: 'online', answer: () => ({ status: 409, json: { error: 'update-in-progress' } }) },
      gone: { state: 'online', answer: () => new Error('link went away') },
    });
    const result = await runFleetUpdate(body(), d);
    expect('skipped' in result && result.skipped.map((entry) => entry.reason)).toEqual([
      'old predates fleet updates',
      'older predates fleet updates',
      'odd answered 403: insufficient_scope',
      'busy: update-in-progress',
      'gone: link went away',
    ]);
  });

  it('environmentIds limits the targets and an unknown id is refused', async () => {
    const { deps: d, calls, start } = deps({ lab: { state: 'online' }, shed: { state: 'online' } });
    const result = await runFleetUpdate(body('{"environmentIds":["env-shed"]}'), d);
    expect(calls.map((call) => call.label)).toEqual(['shed']);
    expect(start).not.toHaveBeenCalled();
    expect('started' in result && result.started.map((entry) => entry.label)).toEqual(['shed']);
    expect(await runFleetUpdate(body('{"environmentIds":["env-nope"]}'), d)).toEqual({ error: 'no machine matches env-nope' });
  });

  it('cancel sends DELETE to peers and cancels this machine; a non-waiting self is skipped', async () => {
    const { deps: d, calls, cancel } = deps({ lab: { state: 'online' } });
    const result = await runFleetUpdate(body('{"cancel":true}'), d);
    expect(calls).toEqual([{ label: 'lab', path: '/api/versions/self/update', method: 'DELETE', body: undefined, actor: 'operator' }]);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect('skipped' in result && result.skipped).toEqual([{ environmentId: 'env-desk', label: 'desk', reason: 'not-waiting' }]);
  });

  it('this machine in progress is skipped with update-in-progress', async () => {
    const { deps: d, start } = deps({});
    start.mockResolvedValueOnce({ outcome: 'in-progress', job: job('self-job') });
    const result = await runFleetUpdate(body(), d);
    expect('skipped' in result && result.skipped).toEqual([{ environmentId: 'env-desk', label: 'desk', reason: 'update-in-progress' }]);
  });

  it('parses the body strictly', () => {
    expect(parseFleetUpdateBody('')).toEqual({ mode: 'when-idle', environmentIds: null, cancel: false });
    expect(parseFleetUpdateBody('{"mode":"later"}')).toBe('mode must be when-idle or now');
    expect(parseFleetUpdateBody('{"environmentIds":"env-a"}')).toBe('environmentIds must be an array of environment ids');
    expect(parseFleetUpdateBody('{"cancel":"yes"}')).toBe('cancel must be true or false');
    expect(parseFleetUpdateBody('[')).toBe('body is not JSON');
  });

  it('a request through a channel gets 403 on both routes', () => {
    const auth = vi.fn(() => null);
    const refused = refuseFleetRequest(true, auth);
    expect(refused).not.toBeNull();
    expect(HttpServerResponse.toWeb(refused!).status).toBe(403);
    expect(auth).not.toHaveBeenCalled();
    expect(refuseFleetRequest(false, auth)).toBeNull();
  });
});
