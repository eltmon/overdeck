import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testHome = vi.hoisted(() => {
  const { mkdtempSync: makeTemp } = require('node:fs') as typeof import('node:fs');
  const { tmpdir: tempRoot } = require('node:os') as typeof import('node:os');
  const { join: joinPath } = require('node:path') as typeof import('node:path');
  const home = makeTemp(joinPath(tempRoot(), 'teardown-agent-state-'));
  process.env.OVERDECK_HOME = home;
  return home;
});

import { getAgentState, saveAgentStateSync } from '../../../../src/lib/agents/agent-state.js';
import { persistIssueAgentsStopped } from '../../../../src/lib/lifecycle/teardown-workspace.js';

describe('close-out agent state persistence', () => {
  beforeEach(() => {
    rmSync(join(testHome, 'agents'), { recursive: true, force: true });
    mkdirSync(join(testHome, 'agents'), { recursive: true });
  });

  afterEach(() => rmSync(join(testHome, 'agents'), { recursive: true, force: true }));

  it('persists stopped before durable state pruning', () => {
    saveAgentStateSync({
      id: 'agent-pan-3950',
      issueId: 'PAN-3950',
      role: 'work',
      status: 'running',
      workspace: '/repo/workspaces/feature-pan-3950',
      harness: 'claude-code',
      model: 'claude',
      startedAt: '2026-09-20T00:00:00.000Z',
    });

    expect(persistIssueAgentsStopped('pan-3950')).toBe(1);
    expect(getAgentState('agent-pan-3950')).toMatchObject({
      status: 'stopped',
      stoppedAt: expect.any(String),
    });
  });
});
