import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getAgentJsonlPath } from '../../../../src/lib/agent-enrichment.js';
import { getLatestSessionIdSync, saveSessionId } from '../../../../src/lib/agents/activity.js';
import { prepareRestartSessionIdentity } from '../../../../src/lib/agents/recovery.js';
import type { AgentState } from '../../../../src/lib/agents/agent-state.js';
import { encodeClaudeProjectDir } from '../../../../src/lib/paths.js';
import {
  appendSessionIdToHistory,
  createFreshSessionIdentity,
  readSessionIndexSync,
} from '../../../../src/lib/session-history.js';

let root: string;
let previousHome: string | undefined;
let previousOverdeckHome: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'session-index-'));
  previousHome = process.env.HOME;
  previousOverdeckHome = process.env.OVERDECK_HOME;
  process.env.HOME = root;
  process.env.OVERDECK_HOME = join(root, '.overdeck');
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = previousOverdeckHome;
  rmSync(root, { recursive: true, force: true });
});

describe('sessions.json index', () => {
  it('appends structured entries and deduplicates by session id', () => {
    saveSessionId('agent-pan-3950', 'session-a');
    saveSessionId('agent-pan-3950', 'session-a');
    appendSessionIdToHistory('agent-pan-3950', 'session-b', 'session-start');

    expect(readSessionIndexSync('agent-pan-3950')).toEqual([
      expect.objectContaining({ sessionId: 'session-a', source: 'rotation' }),
      expect.objectContaining({ sessionId: 'session-b', source: 'session-start' }),
    ]);
  });

  it('uses the newest indexed entry as the current session', () => {
    appendSessionIdToHistory('agent-pan-3950', 'session-old', 'launcher');
    appendSessionIdToHistory('agent-pan-3950', 'session-new', 'session-start');

    expect(getLatestSessionIdSync('agent-pan-3950')).toBe('session-new');
  });

  it('reads a legacy pointer only when sessions.json is absent and never rewrites it', () => {
    const agentDir = join(process.env.OVERDECK_HOME!, 'agents', 'agent-pan-3950');
    mkdirSync(agentDir, { recursive: true });
    const legacyPath = join(agentDir, 'session.id');
    writeFileSync(legacyPath, 'legacy-session\n');

    expect(getLatestSessionIdSync('agent-pan-3950')).toBe('legacy-session');
    expect(readFileSync(legacyPath, 'utf8')).toBe('legacy-session\n');
    expect(existsSync(join(agentDir, 'sessions.json'))).toBe(false);
  });

  it('records a fresh restart identity before launch', () => {
    const order: string[] = [];
    const state = {
      id: 'agent-pan-3950',
      issueId: 'PAN-3950',
      workspace: root,
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'starting',
      startedAt: '2026-09-20T00:00:00.000Z',
      startedBy: 'test',
    } as AgentState;
    const allocate = (agentId: string, harness: 'claude-code') => {
      const sessionId = createFreshSessionIdentity(agentId, harness);
      expect(readSessionIndexSync(agentId).at(-1)?.sessionId).toBe(sessionId);
      order.push('indexed');
      return sessionId;
    };

    const sessionId = prepareRestartSessionIdentity(state.id, 'claude-code', state, allocate);
    order.push('launched');

    expect(order).toEqual(['indexed', 'launched']);
    expect(state.sessionId).toBe(sessionId);
  });

  it('falls back to an older indexed transcript when the newest JSONL is absent', async () => {
    const agentId = 'agent-pan-3950';
    const workspace = join(root, 'workspace');
    const agentDir = join(process.env.OVERDECK_HOME!, 'agents', agentId);
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'state.json'), JSON.stringify({
      id: agentId,
      issueId: 'PAN-3950',
      workspace,
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: '2026-09-20T00:00:00.000Z',
      startedBy: 'test',
    }));
    appendSessionIdToHistory(agentId, 'session-with-transcript', 'launcher');
    appendSessionIdToHistory(agentId, 'session-without-transcript', 'session-start');
    const projectDir = join(root, '.claude', 'projects', encodeClaudeProjectDir(workspace));
    mkdirSync(projectDir, { recursive: true });
    const olderTranscript = join(projectDir, 'session-with-transcript.jsonl');
    writeFileSync(olderTranscript, '{}\n');

    await expect(Effect.runPromise(getAgentJsonlPath(agentId))).resolves.toBe(olderTranscript);
  });
});
