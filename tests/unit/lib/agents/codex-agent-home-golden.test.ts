/**
 * Golden paths for the per-agent Codex home (PAN-4013, CH-7 review).
 *
 * `<agentDir>/codex-home` (and its `sessions/` rollout tree) was built by hand
 * at six sites before CH-7 gave it a helper in `storage/codex.ts`. This file was
 * run against those hand-built joins first and must pass unchanged after them.
 * Like `transcript-resolution-golden.test.ts`, it imports only the callers,
 * never the storage helpers, and restates the expected paths by hand.
 *
 * Default roots come from HOME / OVERDECK_HOME, not overrides.
 */
import { lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveLatestSessionId } from '../../../../src/lib/agents/activity.js';
import { discoverJsonlFiles } from '../../../../src/lib/conversations/harness-discovery.js';
import { collectCodexCostEvents } from '../../../../src/lib/costs/codex-collector.js';
import { CodexTranscriptSource } from '../../../../src/lib/memory/transcript-source.js';
import { CodexRuntimeSync, initCodexHome } from '../../../../src/lib/runtimes/codex.js';

let root: string;
let agentsRoot: string;
const saved: Record<string, string | undefined> = {};

function touch(path: string, body = '{"type":"session_meta","payload":{}}\n'): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  return path;
}

/** `<agentsRoot>/<agentId>/codex-home/sessions/YYYY/MM/DD/rollout-…-<threadId>.jsonl`, restated. */
function rolloutFor(agentId: string, threadId: string): string {
  return join(agentsRoot, agentId, 'codex-home', 'sessions', '2026', '09', '23', `rollout-2026-09-23T00-00-00-${threadId}.jsonl`);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'codex-home-golden-'));
  agentsRoot = join(root, '.overdeck', 'agents');
  for (const key of ['HOME', 'OVERDECK_HOME', 'CODEX_HOME']) saved[key] = process.env[key];
  process.env.HOME = root;
  process.env.OVERDECK_HOME = join(root, '.overdeck');
  delete process.env.CODEX_HOME;
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

describe('golden per-agent codex home (PAN-4013)', () => {
  it('CodexRuntimeSync.getSessionPath finds the rollout under <agentDir>/codex-home/sessions', () => {
    const threadId = '019eaaec-4dfa-7ab1-90ba-9104d1650001';
    const rollout = touch(rolloutFor('agent-golden-a', threadId));
    writeFileSync(join(agentsRoot, 'agent-golden-a', 'codex-thread-id'), `${threadId}\n`);
    expect(new CodexRuntimeSync().getSessionPath('agent-golden-a')).toBe(rollout);
  });

  it('CodexTranscriptSource resolves the rollout under <agentDir>/codex-home/sessions', async () => {
    const threadId = '019eaaec-4dfa-7ab1-90ba-9104d1650002';
    const rollout = touch(rolloutFor('agent-golden-b', threadId));
    const source = new CodexTranscriptSource({
      listAgents: async () => [{
        id: 'agent-golden-b', issueId: 'PAN-4013', workspace: '/work/space/codex', harness: 'codex', role: 'work',
        status: 'running', tmuxActive: true,
      } as never],
      readThreadId: async () => threadId,
    });
    const entries = await source.getActiveTranscripts();
    expect(entries.map((entry) => entry.transcriptPath)).toEqual([rollout]);
  });

  it('resolveLatestSessionId reads the thread id from the newest rollout in <agentDir>/codex-home', () => {
    const threadId = '019eaaec-4dfa-7ab1-90ba-9104d1650003';
    touch(rolloutFor('agent-golden-c', threadId),
      `${JSON.stringify({ type: 'session_meta', payload: { id: threadId } })}\n`);
    const result = resolveLatestSessionId('agent-golden-c', {
      isSessionReset: () => false,
      getAgentState: () => ({ id: 'agent-golden-c', harness: 'codex' }) as never,
    });
    expect(result.sessionId).toBe(threadId);
  });

  it('discoverJsonlFiles lists <agentDir>/codex-home/sessions rollouts as codex', async () => {
    const rollout = touch(rolloutFor('agent-golden-d', '019eaaec-4dfa-7ab1-90ba-9104d1650004'));
    const found = (await discoverJsonlFiles()).filter((file) => file.harness === 'codex');
    expect(found.map((file) => file.jsonlPath)).toEqual([rollout]);
    expect(found[0]?.projectDir).toBe(join(agentsRoot, 'agent-golden-d', 'codex-home', 'sessions'));
  });

  it('collectCodexCostEvents scans <agentDir>/codex-home/sessions for each agent', async () => {
    const rollout = touch(rolloutFor('agent-golden-e', '019eaaec-4dfa-7ab1-90ba-9104d1650005'));
    const result = await collectCodexCostEvents();
    expect(result.stats.scanned).toBe(1);
    expect([...result.skipped.map((entry) => entry.file), ...result.verdicts.map((entry) => entry.path)]).toContain(rollout);
  });

  it('initCodexHome links codex-home-v2/sessions to <agentDir>/codex-home/sessions', () => {
    const agentDir = join(agentsRoot, 'agent-golden-f');
    const v2 = join(agentDir, 'codex-home-v2');
    initCodexHome(v2);
    const link = join(v2, 'sessions');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(join(agentDir, 'codex-home', 'sessions'));
  });
});
