/**
 * PAN-5288 WI-8: project spend includes the project's conversations, and
 * "today" starts at the server's local midnight.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { localDayStartIso, usageWindowStarts, windowsOf } from '../../../../../src/lib/costs/request-digest.js';
import {
  conversationSessionsForProject,
  inProjectSpend,
  projectKeysForPrefix,
} from '../../../../../src/dashboard/server/services/project-spend.js';

describe('projectKeysForPrefix', () => {
  it('matches issue_prefix and issue_prefixes case-insensitively', () => {
    const keys = projectKeysForPrefix('WFX', [
      { key: 'one', config: { issue_prefix: 'wfx' } },
      { key: 'two', config: { issue_prefixes: ['ABC', 'WFX'] } },
      { key: 'three', config: { issue_prefix: 'PAN' } },
    ]);
    expect([...keys]).toEqual(['one', 'two']);
  });
});

describe('conversationSessionsForProject', () => {
  const projects = [
    { key: 'wfx', config: { path: '/repos/wfx' } },
    { key: 'nested', config: { path: '/repos/wfx/packages/nested' } },
  ];

  it('takes explicit-projectKey members and null-projectKey members by cwd, with a nested project winning', () => {
    const sessions = conversationSessionsForProject(new Set(['wfx']), projects, [
      { tmuxSession: 'conv-explicit', projectKey: 'wfx', cwd: '/elsewhere' },
      { tmuxSession: 'conv-cwd', projectKey: null, cwd: '/repos/wfx/src' },
      { tmuxSession: 'conv-root', projectKey: null, cwd: '/repos/wfx' },
      { tmuxSession: 'conv-nested', projectKey: null, cwd: '/repos/wfx/packages/nested/lib' },
      { tmuxSession: 'conv-other-key', projectKey: 'nested', cwd: '/repos/wfx' },
      { tmuxSession: 'conv-sibling', projectKey: null, cwd: '/repos/wfx-other' },
    ]);
    expect([...sessions]).toEqual(['conv-explicit', 'conv-cwd', 'conv-root']);
  });
});

describe('inProjectSpend', () => {
  const sessions = new Set(['conv-a']);

  it('counts prefixed issue events and member conversation events, and not another project session', () => {
    expect(inProjectSpend({ issueId: 'WFX-1', agentId: 'agent-wfx-1' }, 'WFX', sessions)).toBe(true);
    expect(inProjectSpend({ issueId: 'UNKNOWN', agentId: 'conv-a' }, 'WFX', sessions)).toBe(true);
    expect(inProjectSpend({ issueId: 'UNKNOWN', agentId: 'conv-b' }, 'WFX', sessions)).toBe(false);
  });

  it('counts an event that matches both rules once', () => {
    const events = [
      { issueId: 'WFX-2', agentId: 'conv-a', cost: 1.5 },
      { issueId: 'UNKNOWN', agentId: 'conv-a', cost: 0.5 },
      { issueId: 'PAN-9', agentId: 'agent-pan-9', cost: 4 },
    ];
    const counted = events.filter((e) => inProjectSpend(e, 'WFX', sessions));
    expect(counted.reduce((sum, e) => sum + e.cost, 0)).toBe(2);
  });
});

describe('local-day "today"', () => {
  const originalTz = process.env.TZ;
  beforeEach(() => { process.env.TZ = 'America/Denver'; });
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("starts at the server's local midnight and the summary windows use it", () => {
    const now = Date.parse('2026-11-15T03:00:00Z');
    expect(localDayStartIso(now)).toBe('2026-11-14T07:00:00.000Z');
    expect(usageWindowStarts(now).today).toBe('2026-11-14T07:00:00.000Z');
    expect(windowsOf('2026-11-14T10:00:00Z', now)).toContain('today');
    expect(windowsOf('2026-11-14T06:59:00Z', now)).not.toContain('today');
  });
});
