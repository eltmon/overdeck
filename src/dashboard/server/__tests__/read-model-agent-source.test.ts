import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentSnapshot } from '@panctl/contracts';
import { getClosedIssueIdsForReadSource, pruneAgentsForReadSource } from '../read-model.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeAgentsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pan-read-source-agents-'));
  tempDirs.push(dir);
  return dir;
}

function writeStateFile(agentsDir: string, agentId: string): void {
  const agentDir = join(agentsDir, agentId);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, 'state.json'), '{}', 'utf8');
}

function agent(id: string, issueId: string): AgentSnapshot {
  return {
    id,
    issueId,
    status: 'stopped',
    startedAt: '2026-05-23T00:00:00.000Z',
  };
}

describe('read model agent source pruning', () => {
  it('detects closed issue ids from tracker-shaped issue rows', () => {
    expect(getClosedIssueIdsForReadSource([
      { identifier: 'PAN-1132', state: 'CLOSED' },
      { identifier: 'PAN-1331', canonicalStatus: 'done' },
      { identifier: 'PAN-1419', canonicalStatus: 'in_progress' },
    ])).toEqual(new Set(['PAN-1132', 'PAN-1331']));
  });

  it('drops cached agents whose state directory no longer has state.json', () => {
    const agentsDir = makeAgentsDir();
    writeStateFile(agentsDir, 'agent-pan-1419-live');

    const pruned = pruneAgentsForReadSource({
      'agent-pan-1419-live': agent('agent-pan-1419-live', 'PAN-1419'),
      'agent-pan-1132-stale': agent('agent-pan-1132-stale', 'PAN-1132'),
    }, [], agentsDir);

    expect(Object.keys(pruned.agentsById)).toEqual(['agent-pan-1419-live']);
    expect(pruned.prunedCount).toBe(1);
  });

  it('drops agents for closed issues even when their state file still exists', () => {
    const agentsDir = makeAgentsDir();
    writeStateFile(agentsDir, 'agent-pan-1331-closed');
    writeStateFile(agentsDir, 'agent-pan-1419-active');

    const pruned = pruneAgentsForReadSource({
      'agent-pan-1331-closed': agent('agent-pan-1331-closed', 'PAN-1331'),
      'agent-pan-1419-active': agent('agent-pan-1419-active', 'PAN-1419'),
    }, [
      { identifier: 'PAN-1331', status: 'done' },
      { identifier: 'PAN-1419', status: 'in_progress' },
    ], agentsDir);

    expect(Object.keys(pruned.agentsById)).toEqual(['agent-pan-1419-active']);
    expect(pruned.prunedCount).toBe(1);
  });
});
