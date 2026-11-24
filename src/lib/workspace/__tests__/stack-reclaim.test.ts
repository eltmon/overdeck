import type { BackendPane } from '@overdeck/contracts';
import { describe, expect, it } from 'vitest';

import type { QualityGateQueueSnapshot } from '../../cloister/quality-gate-admission.js';
import type { ComposeContainer } from '../stack-reclaim-docker.js';
import {
  isInsidePath,
  issueInGateQueue,
  issuePanes,
  panesAllowReclaim,
  panesNeedStack,
  rankCandidates,
  reclaimableContainers,
  type TurnState,
} from '../stack-reclaim.js';

const WS = '/repos/myn/workspaces/feature-min-1144';

function pane(overrides: Partial<BackendPane>): BackendPane {
  return { id: 'p1', role: 'work', harness: 'claude-code', model: 'claude-opus-5-5', state: 'idle', ...overrides };
}

function compose(name: string, service: string, overrides: Partial<ComposeContainer> = {}): ComposeContainer {
  return { id: `id-${name}`, name, state: 'running', composeProject: 'myn-feature-min-1144', composeService: service, ...overrides };
}

const at = (state: TurnState) => () => state;

describe('isInsidePath (PAN-5623)', () => {
  it('matches the path itself and paths below it, never a sibling prefix', () => {
    expect(isInsidePath(WS, WS)).toBe(true);
    expect(isInsidePath(`${WS}/api`, WS)).toBe(true);
    expect(isInsidePath(`${WS}/api`, `${WS}/`)).toBe(true);
    expect(isInsidePath(`${WS}-2`, WS)).toBe(false);
  });
});

describe('issuePanes (PAN-5623)', () => {
  it('matches by issue token case-insensitively, by agent-id token and by cwd inside the workspace', () => {
    const panes = [
      pane({ id: 'issue', issue: 'min-1144' }),
      pane({ id: 'agent', agentId: 'agent-min-1144-review' }),
      pane({ id: 'cwd', workspace: `${WS}/frontend` }),
      pane({ id: 'other', issue: 'MIN-1146', agentId: 'agent-min-1146', workspace: '/repos/myn/workspaces/feature-min-1146' }),
    ];
    expect(issuePanes(panes, 'MIN-1144', WS).map((p) => p.id)).toEqual(['issue', 'agent', 'cwd']);
  });

  it('does not match an agent id that only shares a prefix', () => {
    expect(issuePanes([pane({ agentId: 'agent-pan-12' })], 'PAN-1234', '/ws/feature-pan-1234')).toEqual([]);
  });
});

describe('panesAllowReclaim (PAN-5623)', () => {
  it('accepts zero panes', () => {
    expect(panesAllowReclaim([], at('in-turn'))).toEqual({ ok: true });
  });

  it('accepts a work pane at a boundary next to an idle review pane', () => {
    const panes = [pane({ agentId: 'agent-min-1144' }), pane({ id: 'r', role: 'review', agentId: 'agent-min-1144-review' })];
    const turns = (agentId: string): TurnState => (agentId.endsWith('review') ? 'unknown' : 'boundary');
    expect(panesAllowReclaim(panes, turns)).toEqual({ ok: true });
  });

  it('rejects a test pane, a pane without an agent id, a working pane, a mid-turn pane and an unknown turn', () => {
    expect(panesAllowReclaim([pane({ role: 'test', agentId: 'a' })], at('boundary'))).toEqual({ ok: false, reason: 'pane-not-work' });
    expect(panesAllowReclaim([pane({})], at('boundary'))).toEqual({ ok: false, reason: 'pane-no-agent-id' });
    expect(panesAllowReclaim([pane({ agentId: 'a', state: 'working' })], at('boundary'))).toEqual({ ok: false, reason: 'pane-working' });
    expect(panesAllowReclaim([pane({ agentId: 'a' })], at('in-turn'))).toEqual({ ok: false, reason: 'pane-in-turn' });
    expect(panesAllowReclaim([pane({ agentId: 'a' })], at('unknown'))).toEqual({ ok: false, reason: 'pane-unknown' });
  });

  it('rejects a work pane whose state is unknown (PAN-5648 pane-known-idle.ac1)', () => {
    expect(panesAllowReclaim([pane({ agentId: 'a', state: 'unknown' })], at('boundary')))
      .toEqual({ ok: false, reason: 'pane-not-idle' });
  });

  it('rejects a work pane whose state is blocked (PAN-5648 pane-known-idle.ac2)', () => {
    expect(panesAllowReclaim([pane({ agentId: 'a', state: 'blocked' })], at('boundary')))
      .toEqual({ ok: false, reason: 'pane-not-idle' });
  });

  it('accepts a done or idle work pane at a turn boundary (PAN-5648 pane-known-idle.ac3)', () => {
    expect(panesAllowReclaim([pane({ agentId: 'a', state: 'done' })], at('boundary'))).toEqual({ ok: true });
    expect(panesAllowReclaim([pane({ agentId: 'a', state: 'idle' })], at('boundary'))).toEqual({ ok: true });
  });
});

describe('panesNeedStack (PAN-5623)', () => {
  it('ignores a mid-turn review pane and fires for a mid-turn or working work pane', () => {
    expect(panesNeedStack([pane({ role: 'review', agentId: 'r', state: 'working' })], at('in-turn'))).toBe(false);
    expect(panesNeedStack([pane({ agentId: 'a' })], at('in-turn'))).toBe(true);
    expect(panesNeedStack([pane({ agentId: 'a', state: 'working' })], at('boundary'))).toBe(true);
    expect(panesNeedStack([pane({ agentId: 'a' })], at('boundary'))).toBe(false);
  });
});

describe('issueInGateQueue (PAN-5623)', () => {
  const empty: QualityGateQueueSnapshot = { slots: 2, owners: [], waiters: [] };

  it('matches an owner by issue id and a waiter without an issue id by workspace path', () => {
    expect(issueInGateQueue({ ...empty, owners: [{ issueId: 'min-1144', workspacePath: '/elsewhere', gateName: 'vitest', createdAt: 0 }] }, 'MIN-1144', WS)).toBe(true);
    expect(issueInGateQueue({ ...empty, waiters: [{ workspacePath: `${WS}/frontend`, gateName: 'tsc', createdAt: 0 }] }, 'MIN-1144', WS)).toBe(true);
    expect(issueInGateQueue({ ...empty, waiters: [{ issueId: 'MIN-1146', workspacePath: '/repos/myn/workspaces/feature-min-1146', gateName: 'tsc', createdAt: 0 }] }, 'MIN-1144', WS)).toBe(false);
  });
});

describe('reclaimableContainers (PAN-5623)', () => {
  it('keeps running reclaimable services of the project only', () => {
    const containers = [
      compose('myn-feature-min-1144-api-1', 'api'),
      compose('myn-feature-min-1144-fe-1', 'fe'),
      compose('myn-feature-min-1144-dev-1', 'dev'),
      compose('myn-feature-min-1144-postgres-1', 'postgres'),
      compose('myn-feature-min-1144-redis-1', 'redis'),
      compose('myn-feature-min-1144-server-1', 'server', { state: 'exited' }),
      compose('myn-feature-min-1146-api-1', 'api', { composeProject: 'myn-feature-min-1146' }),
    ];
    expect(reclaimableContainers(containers, 'myn-feature-min-1144').map((c) => c.name))
      .toEqual(['myn-feature-min-1144-api-1', 'myn-feature-min-1144-fe-1']);
  });
});

describe('rankCandidates (PAN-5623)', () => {
  it('orders by summed memory, ties by issue id', () => {
    const GiB = 1024 ** 3;
    const candidate = (issueId: string, names: string[]) => ({
      issueId, workspacePath: `/ws/${issueId}`, composeProject: issueId, containers: names.map((name) => compose(name, 'api')),
    });
    const memory = new Map([['b-api', 1 * GiB], ['b-fe', 1 * GiB], ['a-api', 1 * GiB], ['c-api', 2 * GiB]]);
    const ranked = rankCandidates([candidate('MIN-3', ['a-api']), candidate('MIN-2', ['b-api', 'b-fe']), candidate('MIN-1', ['c-api'])], memory);
    expect(ranked.map((c) => [c.issueId, c.memoryBytes])).toEqual([
      ['MIN-1', 2 * GiB],
      ['MIN-2', 2 * GiB],
      ['MIN-3', 1 * GiB],
    ]);
  });
});
