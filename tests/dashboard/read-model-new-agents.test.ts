/**
 * Tests for discoverNewAgentIds() extracted from src/dashboard/server/read-model.ts (PAN-446)
 *
 * This is the production function that async-reads the agents directory to find
 * agents created after the last cache save. It was previously inline in the
 * Effect generator using a mix of sync and async FS calls.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { discoverNewAgentIds } from '../../src/dashboard/server/read-model.js';

let agentsDir: string;

beforeEach(() => {
  agentsDir = mkdtempSync(join(tmpdir(), 'read-model-agents-test-'));
});

afterEach(() => {
  rmSync(agentsDir, { recursive: true, force: true });
});

describe('discoverNewAgentIds()', () => {
  it('returns empty array when agents dir does not exist', async () => {
    const missing = join(agentsDir, 'nonexistent');
    expect(await discoverNewAgentIds(missing, new Set())).toEqual([]);
  });

  it('returns empty array when all agent IDs are already cached', async () => {
    const agentDir = join(agentsDir, 'agent-123');
    mkdirSync(agentDir);
    writeFileSync(join(agentDir, 'state.json'), JSON.stringify({ id: 'agent-123' }));

    expect(await discoverNewAgentIds(agentsDir, new Set(['agent-123']))).toEqual([]);
  });

  it('returns agents not in cachedIds that have a state.json', async () => {
    const agentDir = join(agentsDir, 'agent-new');
    mkdirSync(agentDir);
    writeFileSync(join(agentDir, 'state.json'), JSON.stringify({ id: 'agent-new' }));

    const found = await discoverNewAgentIds(agentsDir, new Set());
    expect(found).toContain('agent-new');
  });

  it('skips entries that do not have state.json', async () => {
    mkdirSync(join(agentsDir, 'agent-no-state'));
    // No state.json written

    expect(await discoverNewAgentIds(agentsDir, new Set())).toEqual([]);
  });

  it('returns only uncached agents, not already-cached ones', async () => {
    mkdirSync(join(agentsDir, 'agent-cached'));
    writeFileSync(join(agentsDir, 'agent-cached', 'state.json'), '{}');

    mkdirSync(join(agentsDir, 'agent-new'));
    writeFileSync(join(agentsDir, 'agent-new', 'state.json'), '{}');

    const found = await discoverNewAgentIds(agentsDir, new Set(['agent-cached']));
    expect(found).toEqual(['agent-new']);
  });
});
