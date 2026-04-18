/**
 * Tests for async readdir + readFile logic in src/dashboard/server/read-model.ts (PAN-446)
 *
 * The bootstrap path discovers agents created after the last cache save by async-reading
 * the agents directory and loading state.json for IDs not already in the cache.
 * These tests verify that logic in isolation using the same fs/promises calls.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

let agentsDir: string;

beforeEach(() => {
  agentsDir = mkdtempSync(join(tmpdir(), 'read-model-agents-test-'));
});

afterEach(() => {
  rmSync(agentsDir, { recursive: true, force: true });
});

/**
 * Mirrors the read-model bootstrap logic that discovers uncached agent IDs:
 *   const entries = await readdir(agentsDir)
 *   for (const entry of entries) {
 *     if (!cachedIds.has(entry) && existsSync(join(agentsDir, entry, 'state.json'))) { ... }
 *   }
 */
async function discoverNewAgents(agentsDirPath: string, cachedIds: Set<string>): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(agentsDirPath);
  } catch {
    return [];
  }
  const newIds: string[] = [];
  for (const entry of entries) {
    if (!cachedIds.has(entry) && existsSync(join(agentsDirPath, entry, 'state.json'))) {
      newIds.push(entry);
    }
  }
  return newIds;
}

async function loadAgentState(agentsDirPath: string, agentId: string): Promise<unknown> {
  const raw = await readFile(join(agentsDirPath, agentId, 'state.json'), 'utf-8');
  return JSON.parse(raw);
}

describe('read-model new-agent discovery (async readdir)', () => {
  it('returns empty array when agents dir does not exist', async () => {
    const missing = join(agentsDir, 'nonexistent');
    expect(await discoverNewAgents(missing, new Set())).toEqual([]);
  });

  it('returns empty array when all agents are already in cachedIds', async () => {
    const agentDir = join(agentsDir, 'agent-123');
    mkdirSync(agentDir);
    writeFileSync(join(agentDir, 'state.json'), JSON.stringify({ id: 'agent-123' }));

    const cached = new Set(['agent-123']);
    expect(await discoverNewAgents(agentsDir, cached)).toEqual([]);
  });

  it('returns agents not in cachedIds that have a state.json', async () => {
    const agentDir = join(agentsDir, 'agent-new');
    mkdirSync(agentDir);
    writeFileSync(join(agentDir, 'state.json'), JSON.stringify({ id: 'agent-new' }));

    const cached = new Set<string>();
    const found = await discoverNewAgents(agentsDir, cached);
    expect(found).toContain('agent-new');
  });

  it('skips entries that do not have state.json', async () => {
    const agentDir = join(agentsDir, 'agent-no-state');
    mkdirSync(agentDir);
    // No state.json written

    expect(await discoverNewAgents(agentsDir, new Set())).toEqual([]);
  });

  it('only returns new agents (not already cached)', async () => {
    const cachedDir = join(agentsDir, 'agent-cached');
    mkdirSync(cachedDir);
    writeFileSync(join(cachedDir, 'state.json'), JSON.stringify({ id: 'agent-cached' }));

    const newDir = join(agentsDir, 'agent-new');
    mkdirSync(newDir);
    writeFileSync(join(newDir, 'state.json'), JSON.stringify({ id: 'agent-new' }));

    const cached = new Set(['agent-cached']);
    const found = await discoverNewAgents(agentsDir, cached);
    expect(found).toEqual(['agent-new']);
  });
});

describe('read-model state.json loading (async readFile)', () => {
  it('parses state.json into an object', async () => {
    const agentId = 'agent-abc';
    const agentDir = join(agentsDir, agentId);
    mkdirSync(agentDir);
    const state = { id: agentId, status: 'running' };
    writeFileSync(join(agentDir, 'state.json'), JSON.stringify(state));

    const loaded = await loadAgentState(agentsDir, agentId);
    expect(loaded).toEqual(state);
  });

  it('rejects when state.json is missing', async () => {
    const agentDir = join(agentsDir, 'agent-missing');
    mkdirSync(agentDir);

    await expect(loadAgentState(agentsDir, 'agent-missing')).rejects.toThrow();
  });

  it('rejects when state.json contains invalid JSON', async () => {
    const agentId = 'agent-bad-json';
    const agentDir = join(agentsDir, agentId);
    mkdirSync(agentDir);
    writeFileSync(join(agentDir, 'state.json'), 'not valid json {{{');

    await expect(loadAgentState(agentsDir, agentId)).rejects.toThrow();
  });
});
