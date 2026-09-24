/**
 * PAN-3920 review: the Agents Directory scans agent states asynchronously,
 * skips conversation dirs before reading, and tolerates a state.json that
 * vanished between readdir and read (agent GC) instead of failing the build.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listAgentStatesAsync } from '../../../../src/lib/agents/agent-state-read.js';

let home: string;
let previousHome: string | undefined;

function writeState(id: string, state: Record<string, unknown> | null): void {
  mkdirSync(join(home, 'agents', id), { recursive: true });
  if (state) writeFileSync(join(home, 'agents', id, 'state.json'), JSON.stringify(state));
}

beforeEach(() => {
  previousHome = process.env.OVERDECK_HOME;
  home = mkdtempSync(join(tmpdir(), 'agent-state-async-'));
  process.env.OVERDECK_HOME = home;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

describe('listAgentStatesAsync', () => {
  it('reads every agent state, skipping names before reading and dirs with no state.json', async () => {
    writeState('agent-pan-1', { id: 'agent-pan-1', issueId: 'PAN-1', role: 'work', model: 'm', status: 'running', startedAt: 'x', workspace: '/w' });
    writeState('conv-flywheel', { id: 'conv-flywheel', role: 'work', model: 'm', status: 'running', startedAt: 'x', workspace: '/w' });
    writeState('agent-pan-2', null); // removed mid-scan
    writeState('agent-pan-3', { id: 'agent-pan-3', model: 'm' }); // roleless: invisible

    const states = await listAgentStatesAsync({ skip: (name) => name.startsWith('conv-') });
    expect(states.map((state) => state.id)).toEqual(['agent-pan-1']);
  });

  it('answers [] when the agents directory does not exist', async () => {
    expect(await listAgentStatesAsync()).toEqual([]);
  });
});
