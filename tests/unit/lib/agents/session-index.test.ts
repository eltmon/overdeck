import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getAgentJsonlPath } from '../../../../src/lib/agent-enrichment.js';
import { getLatestSessionIdSync, saveSessionId } from '../../../../src/lib/agents/activity.js';
import { restartAgent } from '../../../../src/lib/agents/recovery.js';
import type { AgentState } from '../../../../src/lib/agents/agent-state.js';
import { markAgentRunning } from '../../../../src/lib/agents/agent-state.js';
import { encodeClaudeProjectDir } from '../../../../src/lib/paths.js';
import { kimiSessionsRoot } from '../../../../src/lib/runtimes/kimi-code.js';
import {
  appendSessionIdToHistory,
  clearSessionResetMarker,
  isSessionResetMarker,
  latestSessionResetTime,
  orderedTranscriptCandidates,
  readSessionIndexSync,
  readSessionIndexWithLegacySync,
  resetSessionIndex,
  SESSION_RESET_MARKER,
  transcriptCandidateKey,
} from '../../../../src/lib/session-history.js';
import { listAgentTranscriptCandidates } from '../../../../src/lib/agents/transcript-resolver.js';

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
  it('appends JSON lines and resolves duplicate session ids from the last occurrence', () => {
    saveSessionId('agent-pan-3950', 'session-a');
    appendSessionIdToHistory('agent-pan-3950', 'session-b', 'session-start');
    saveSessionId('agent-pan-3950', 'session-a');

    expect(readSessionIndexSync('agent-pan-3950')).toEqual([
      expect.objectContaining({ sessionId: 'session-b', source: 'session-start' }),
      expect.objectContaining({ sessionId: 'session-a', source: 'rotation' }),
    ]);
    expect(readSessionIndexSync('agent-pan-3950').every((entry) => entry.harness && entry.model)).toBe(true);
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
    expect(readSessionIndexWithLegacySync('agent-pan-3950')).toEqual([
      { sessionId: 'legacy-session', at: '', source: 'legacy-pointer' },
    ]);
    expect(readFileSync(legacyPath, 'utf8')).toBe('legacy-session\n');
    expect(existsSync(join(agentDir, 'sessions.json'))).toBe(false);
  });

  it('restartAgent aborts before launch when durable prelaunch indexing fails', async () => {
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
    const result = await restartAgent(state.id, { graceful: false }, {
      getAgentStateSync: () => state,
      detectPendingOperatorDecision: async () => null,
      assertWorkspaceStackHealthyForSpawn: async () => undefined,
      resolveHarness: async () => 'claude-code',
      prepareHarnessLaunch: async () => ({ binaryPath: '/bin/claude', pathExport: '' }),
      sessionExists: async () => false,
      stopAgent: async () => { order.push('stopped'); },
      logAgentLifecycleSync: () => undefined,
      allocateSessionIdentity: () => {
        order.push('index-attempt');
        throw new Error('index write failed');
      },
    });

    expect(result).toEqual({
      success: false,
      error: 'Failed to restart agent: session index write failed: index write failed',
    });
    expect(order).toEqual(['stopped', 'index-attempt']);
  });

  it('skips malformed lines without preventing later appends', () => {
    const agentDir = join(process.env.OVERDECK_HOME!, 'agents', 'agent-pan-3950');
    mkdirSync(agentDir, { recursive: true });
    const indexPath = join(agentDir, 'sessions.json');
    writeFileSync(indexPath, '{malformed\n');

    appendSessionIdToHistory('agent-pan-3950', 'session-new', 'launcher');
    expect(readSessionIndexSync('agent-pan-3950')).toEqual([
      expect.objectContaining({ sessionId: 'session-new', source: 'launcher' }),
    ]);
  });

  it('reads the legacy JSON array format', () => {
    const agentDir = join(process.env.OVERDECK_HOME!, 'agents', 'agent-pan-3950');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'sessions.json'), JSON.stringify([
      'legacy-string',
      { sessionId: 'legacy-object', at: '2026-09-20T00:00:00.000Z', source: 'launcher' },
    ]));

    expect(readSessionIndexSync('agent-pan-3950').map((entry) => entry.sessionId)).toEqual([
      'legacy-string',
      'legacy-object',
    ]);

    appendSessionIdToHistory('agent-pan-3950', 'jsonl-after-legacy', 'session-start');
    expect(readSessionIndexSync('agent-pan-3950').map((entry) => entry.sessionId)).toEqual([
      'legacy-string',
      'legacy-object',
      'jsonl-after-legacy',
    ]);
  });

  it('records reset as an append-only boundary without erasing a concurrent later observation', async () => {
    appendSessionIdToHistory('agent-pan-3950', 'before-reset', 'launcher');

    await resetSessionIndex('agent-pan-3950');
    appendSessionIdToHistory('agent-pan-3950', 'after-reset', 'session-start');

    expect(isSessionResetMarker('agent-pan-3950')).toBe(true);
    expect(readSessionIndexSync('agent-pan-3950').map((entry) => entry.sessionId)).toEqual(['after-reset']);
    clearSessionResetMarker('agent-pan-3950');
    expect(readSessionIndexSync('agent-pan-3950').map((entry) => entry.sessionId)).toEqual(['after-reset']);
  });

  it('writes a reset on its own line after a legacy array without a trailing newline', async () => {
    const agentDir = join(process.env.OVERDECK_HOME!, 'agents', 'agent-pan-3950');
    mkdirSync(agentDir, { recursive: true });
    const indexPath = join(agentDir, 'sessions.json');
    writeFileSync(indexPath, JSON.stringify(['legacy-session']));

    await resetSessionIndex('agent-pan-3950');

    const raw = readFileSync(indexPath, 'utf8');
    expect(raw).toMatch(/^\["legacy-session"\]\n\{"reset":true,/);
    expect(latestSessionResetTime(raw)).not.toBeNull();
    expect(readSessionIndexSync('agent-pan-3950')).toEqual([]);
  });

  it('throws without changing status when a directory occupies the reset marker path', () => {
    const state = {
      id: 'agent-pan-3950',
      issueId: 'PAN-3950',
      workspace: root,
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: '2026-09-20T00:00:00.000Z',
      startedBy: 'test',
    } as AgentState;
    const agentDir = join(process.env.OVERDECK_HOME!, 'agents', state.id);
    mkdirSync(join(agentDir, SESSION_RESET_MARKER), { recursive: true });

    expect(() => markAgentRunning(state)).toThrow();
    expect(state.status).toBe('stopped');
  });

  it('runs normally when no reset marker exists', () => {
    const state = {
      id: 'agent-pan-3950',
      issueId: 'PAN-3950',
      workspace: root,
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: '2026-09-20T00:00:00.000Z',
      startedBy: 'test',
    } as AgentState;

    markAgentRunning(state);

    expect(state.status).toBe('running');
  });

  it('resets after an unterminated final JSONL record so the raw file stays parseable', async () => {
    const agentDir = join(process.env.OVERDECK_HOME!, 'agents', 'agent-pan-3950');
    mkdirSync(agentDir, { recursive: true });
    const indexPath = join(agentDir, 'sessions.json');
    // No trailing newline — simulates a crash mid-write of the final record.
    writeFileSync(indexPath, JSON.stringify({ sessionId: 'unterminated', at: '2026-09-20T00:00:00.000Z', source: 'launcher' }));

    await resetSessionIndex('agent-pan-3950');

    const raw = readFileSync(indexPath, 'utf8');
    expect(raw).toMatch(/\}\n\{"reset":true,/);
    expect(readSessionIndexSync('agent-pan-3950')).toEqual([]);
    expect(latestSessionResetTime(raw)).not.toBeNull();
  });

  it('clears the reset marker at the shared successful-launch transition', async () => {
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
    await resetSessionIndex(state.id);

    markAgentRunning(state);

    expect(state.status).toBe('running');
    expect(isSessionResetMarker(state.id)).toBe(false);
  });

  it('uses the single resolver for untagged legacy entries', async () => {
    const agentId = 'agent-pan-3950';
    const workspace = join(root, 'workspace');
    const agentDir = join(process.env.OVERDECK_HOME!, 'agents', agentId);
    const projectDir = join(root, '.claude', 'projects', encodeClaudeProjectDir(workspace));
    const codexDir = join(agentDir, 'codex-home-v2', 'sessions', '2026', '09', '20');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(join(agentDir, 'state.json'), JSON.stringify({
      id: agentId,
      issueId: 'PAN-3950',
      workspace,
      harness: 'codex',
      role: 'work',
      model: 'gpt-5.4',
      status: 'stopped',
      startedAt: '2026-09-20T00:00:00.000Z',
      startedBy: 'test',
    }));
    writeFileSync(join(agentDir, 'sessions.json'), JSON.stringify(['legacy-session']));
    const claudePath = join(projectDir, 'legacy-session.jsonl');
    const codexPath = join(codexDir, 'rollout-2026-09-20-legacy-session.jsonl');
    writeFileSync(claudePath, '{}\n');
    writeFileSync(codexPath, '{}\n');

    const candidates = await listAgentTranscriptCandidates(agentId, workspace, {
      agentsDirOverride: join(process.env.OVERDECK_HOME!, 'agents'),
      claudeProjectsDirOverride: join(root, '.claude', 'projects'),
    });

    expect(candidates).toEqual([
      { kind: 'codex', path: codexPath },
      { kind: 'claude', path: claudePath },
    ]);
    expect(candidates.every(({ path }) => !path.includes('*'))).toBe(true);
  });

  it('makes a reset marker authoritative in both candidate adapters', async () => {
    const agentId = 'agent-pan-3950';
    const workspace = join(root, 'workspace');
    const agentDir = join(process.env.OVERDECK_HOME!, 'agents', agentId);
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'state.json'), JSON.stringify({ id: agentId, workspace, harness: 'claude-code' }));
    appendSessionIdToHistory(agentId, 'old-session', 'launcher');
    await resetSessionIndex(agentId);

    await expect(listAgentTranscriptCandidates(agentId, workspace, {
      agentsDirOverride: join(process.env.OVERDECK_HOME!, 'agents'),
      claudeProjectsDirOverride: join(root, '.claude', 'projects'),
    })).resolves.toEqual([]);

    clearSessionResetMarker(agentId);
    await expect(listAgentTranscriptCandidates(agentId, workspace, {
      agentsDirOverride: join(process.env.OVERDECK_HOME!, 'agents'),
      claudeProjectsDirOverride: join(root, '.claude', 'projects'),
    })).resolves.toEqual([]);
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

  it('enrichment uses the current Kimi transcript ahead of an untagged legacy Claude entry', async () => {
    const agentId = 'agent-pan-3950';
    const workspace = join(root, 'workspace');
    const agentDir = join(process.env.OVERDECK_HOME!, 'agents', agentId);
    const projectDir = join(root, '.claude', 'projects', encodeClaudeProjectDir(workspace));
    const sessionId = 'kimi-current';
    const wirePath = join(
      kimiSessionsRoot(join(root, '.kimi-code'), workspace),
      sessionId,
      'agents',
      'main',
      'wire.jsonl',
    );
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(join(wirePath, '..'), { recursive: true });
    writeFileSync(join(agentDir, 'state.json'), JSON.stringify({
      id: agentId,
      issueId: 'PAN-3950',
      workspace,
      harness: 'kimi-code',
      model: 'kimi-for-coding',
      role: 'work',
      status: 'stopped',
      startedAt: '2026-09-20T00:00:00.000Z',
      startedBy: 'test',
    }));
    writeFileSync(join(agentDir, 'sessions.json'), JSON.stringify(['legacy-claude']));
    writeFileSync(join(agentDir, 'kimi-session-id'), sessionId);
    writeFileSync(join(projectDir, 'legacy-claude.jsonl'), '{}\n');
    writeFileSync(wirePath, '{}\n');

    await expect(Effect.runPromise(getAgentJsonlPath(agentId))).resolves.toBe(wirePath);
  });

  it('orders mixed-harness entries before launcher and state fallbacks', () => {
    const paths = new Map([
      [transcriptCandidateKey('claude', 'claude-old'), '/claude/old.jsonl'],
      [transcriptCandidateKey('codex', 'codex-new'), '/codex/new.jsonl'],
    ]);
    expect(orderedTranscriptCandidates({
      entries: [
        { sessionId: 'claude-old', at: '', source: 'legacy', harness: 'claude-code' },
        { sessionId: 'codex-new', at: '', source: 'hook', harness: 'codex' },
      ],
      currentHarness: 'claude-code',
      indexedPaths: paths,
      launcherPinned: { kind: 'claude', path: '/claude/launcher.jsonl' },
      stateDerived: [{ kind: 'claude', path: '/claude/state.jsonl' }],
    })).toEqual([
      { kind: 'codex', path: '/codex/new.jsonl' },
      { kind: 'claude', path: '/claude/old.jsonl' },
      { kind: 'claude', path: '/claude/launcher.jsonl' },
      { kind: 'claude', path: '/claude/state.jsonl' },
    ]);
  });

  it('preserves indexed models on transcript candidates', () => {
    const paths = new Map([
      [transcriptCandidateKey('claude', 'session-a'), '/claude/session-a.jsonl'],
    ]);
    expect(orderedTranscriptCandidates({
      entries: [{ sessionId: 'session-a', at: '', source: 'hook', harness: 'claude-code', model: 'claude-sonnet-4-6' }],
      currentHarness: 'claude-code',
      indexedPaths: paths,
    })).toEqual([
      { kind: 'claude', path: '/claude/session-a.jsonl', model: 'claude-sonnet-4-6' },
    ]);
  });
});
