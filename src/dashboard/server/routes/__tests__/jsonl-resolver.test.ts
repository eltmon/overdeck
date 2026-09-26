import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  readLauncherPinnedSessionId,
  listAgentTranscriptCandidates,
  listAgentTranscriptWatchRoots,
  resolveCodexRolloutPath,
  resolveAcpTranscriptPath,
  resolveJsonlPath,
  resolveKimiWirePath,
  resolvePiSessionPath,
} from '../jsonl-resolver.js';
import { encodeClaudeProjectDir } from '../../../../lib/runtimes/storage/claude-code.js';
import { kimiSessionsRoot } from '../../../../lib/runtimes/storage/kimi-code.js';

const AGENT_ID = 'agent-pan-830';
const WORKSPACE_PATH = '/home/testuser/Projects/overdeck/workspaces/feature-pan-830';
const STRIKE_AGENT_ID = 'strike-pan-2857';
const STRIKE_WORKSPACE_PATH = '/home/testuser/Projects/overdeck/workspaces/feature-pan-2857-strike';
const CLAUDE_SESSION_ID = '9d08794c-3973-4f83-92cf-234ae618258a';

let testDir: string;
let agentsDir: string;
let claudeProjectsDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `pan-jsonl-resolver-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  agentsDir = join(testDir, 'overdeck', 'agents');
  claudeProjectsDir = join(testDir, 'claude', 'projects');
  await mkdir(join(agentsDir, AGENT_ID), { recursive: true });
  await mkdir(claudeProjectsDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe('resolveJsonlPath (PAN-830)', () => {
  it('logs a durable diagnostic when no session identity source exists', async () => {
    const diagnostics: string[] = [];

    const path = await resolveJsonlPath(AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
      getRuntimeStateAsync: async () => null,
      logDiagnostic: (_agentId, message) => diagnostics.push(message),
    });

    expect(path).toBeNull();
    expect(diagnostics).toEqual([
      expect.stringContaining('failed checked='),
    ]);
  });

  it('logs the workspace and expected JSONL path when the pinned file is missing', async () => {
    const diagnostics: string[] = [];
    await writeFile(join(agentsDir, AGENT_ID, 'session.id'), `${CLAUDE_SESSION_ID}\n`);

    const path = await resolveJsonlPath(AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
      getRuntimeStateAsync: async () => null,
      logDiagnostic: (_agentId, message) => diagnostics.push(message),
    });

    expect(path).toBeNull();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain(
      join(claudeProjectsDir, encodeClaudeProjectDir(WORKSPACE_PATH), `${CLAUDE_SESSION_ID}.jsonl`),
    );
  });

  it('returns the JSONL path when claudeSessionId resolves AND file exists', async () => {
    const encoded = encodeClaudeProjectDir(WORKSPACE_PATH);
    const projectDir = join(claudeProjectsDir, encoded);
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, `${CLAUDE_SESSION_ID}.jsonl`), '{"type":"event"}\n');
    await writeFile(join(agentsDir, AGENT_ID, 'session.id'), CLAUDE_SESSION_ID);

    const path = await resolveJsonlPath(AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
    });

    expect(path).toBe(join(projectDir, `${CLAUDE_SESSION_ID}.jsonl`));
  });

  it('prefers a stopped strike agent recorded workspace over the caller convention path', async () => {
    const diagnostics: string[] = [];
    const strikeAgentDir = join(agentsDir, STRIKE_AGENT_ID);
    const projectDir = join(claudeProjectsDir, encodeClaudeProjectDir(STRIKE_WORKSPACE_PATH));
    const jsonlPath = join(projectDir, `${CLAUDE_SESSION_ID}.jsonl`);
    await mkdir(strikeAgentDir, { recursive: true });
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(strikeAgentDir, 'state.json'), JSON.stringify({
      harness: 'claude-code',
      status: 'stopped',
      workspace: STRIKE_WORKSPACE_PATH,
    }));
    await writeFile(join(strikeAgentDir, 'session.id'), CLAUDE_SESSION_ID);
    await writeFile(jsonlPath, '{"type":"event"}\n');

    const path = await resolveJsonlPath(STRIKE_AGENT_ID, '/home/testuser/Projects/overdeck/workspaces/feature-pan-2857', {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
      logDiagnostic: (_agentId, message) => diagnostics.push(message),
    });

    expect(path).toBe(jsonlPath);
    expect(diagnostics).toEqual([expect.stringContaining('resolved kind=claude')]);
  });

  it('returns null when claudeSessionId resolves but file does not exist', async () => {
    await writeFile(join(agentsDir, AGENT_ID, 'session.id'), CLAUDE_SESSION_ID);

    const path = await resolveJsonlPath(AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
    });

    expect(path).toBeNull();
  });

  it('returns null when claudeSessionId cannot be resolved', async () => {
    const path = await resolveJsonlPath(AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
      getRuntimeStateAsync: async () => null,
    });

    expect(path).toBeNull();
  });

  it('does not adopt an unrelated freshest project JSONL without session identity', async () => {
    const encoded = encodeClaudeProjectDir(WORKSPACE_PATH);
    const projectDir = join(claudeProjectsDir, encoded);
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, `${AGENT_ID}.jsonl`), '{"old":"bug"}\n');
    // No sessions.json or runtime state — so claudeSessionId is null
    const path = await resolveJsonlPath(AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
      getRuntimeStateAsync: async () => null,
    });

    expect(path).toBeNull();
    await expect(listAgentTranscriptCandidates(AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
      getRuntimeStateAsync: async () => null,
    })).resolves.toEqual([]);
  });

  it('honors the reset marker before launcher, state, and directory fallbacks', async () => {
    const encoded = encodeClaudeProjectDir(WORKSPACE_PATH);
    const projectDir = join(claudeProjectsDir, encoded);
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, `${CLAUDE_SESSION_ID}.jsonl`), '{}\n');
    await writeFile(join(agentsDir, AGENT_ID, 'launcher.sh'), `claude --resume '${CLAUDE_SESSION_ID}'\n`);
    await writeFile(join(agentsDir, AGENT_ID, 'session-reset'), '');

    await expect(listAgentTranscriptCandidates(AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
    })).resolves.toEqual([]);
  });

  it('uses the encoded workspace path under claudeProjects root', async () => {
    const encoded = encodeClaudeProjectDir(WORKSPACE_PATH);
    expect(encoded).toBe(
      '-home-testuser-Projects-overdeck-workspaces-feature-pan-830',
    );
    const projectDir = join(claudeProjectsDir, encoded);
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, `${CLAUDE_SESSION_ID}.jsonl`), '{}');
    await writeFile(join(agentsDir, AGENT_ID, 'session.id'), CLAUDE_SESSION_ID);

    const path = await resolveJsonlPath(AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
    });

    expect(path).toContain(encoded);
    expect(path).toContain(`${CLAUDE_SESSION_ID}.jsonl`);
  });
});

describe('listAgentTranscriptCandidates — recorded transcript path fast path (PAN-3959)', () => {
  it('resolves a path-carrying entry to the recorded file with no formula-derived candidate for the same entry', async () => {
    const encoded = encodeClaudeProjectDir(WORKSPACE_PATH);
    const projectDir = join(claudeProjectsDir, encoded);
    await mkdir(projectDir, { recursive: true });
    // Formula-derived location for this session id — must NOT be the resolved candidate.
    await writeFile(join(projectDir, `${CLAUDE_SESSION_ID}.jsonl`), '{"formula":"wrong"}\n');
    const recordedDir = join(testDir, 'recorded');
    await mkdir(recordedDir, { recursive: true });
    const recordedPath = join(recordedDir, `${CLAUDE_SESSION_ID}.jsonl`);
    await writeFile(recordedPath, '{"recorded":"right"}\n');
    await writeFile(join(agentsDir, AGENT_ID, 'sessions.json'), `${JSON.stringify({
      sessionId: CLAUDE_SESSION_ID,
      at: new Date().toISOString(),
      source: 'session-start-hook',
      harness: 'claude-code',
      path: recordedPath,
    })}\n`);

    const candidates = await listAgentTranscriptCandidates(AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
      getRuntimeStateAsync: async () => null,
    });

    expect(candidates).toEqual([{ kind: 'claude', path: recordedPath }]);
  });

  it('falls through to an older entry when the recorded path is missing on disk', async () => {
    const OLDER_SESSION_ID = '11111111-2222-4333-8444-555555555555';
    const encoded = encodeClaudeProjectDir(WORKSPACE_PATH);
    const projectDir = join(claudeProjectsDir, encoded);
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, `${OLDER_SESSION_ID}.jsonl`), '{"older":"formula"}\n');
    const missingRecordedPath = join(testDir, 'missing', `${CLAUDE_SESSION_ID}.jsonl`);
    const lines = [
      JSON.stringify({ sessionId: OLDER_SESSION_ID, at: '2026-09-19T00:00:00.000Z', source: 'launcher', harness: 'claude-code' }),
      JSON.stringify({
        sessionId: CLAUDE_SESSION_ID,
        at: '2026-09-20T00:00:00.000Z',
        source: 'session-start-hook',
        harness: 'claude-code',
        path: missingRecordedPath,
      }),
    ];
    await writeFile(join(agentsDir, AGENT_ID, 'sessions.json'), `${lines.join('\n')}\n`);

    const path = await resolveJsonlPath(AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
      getRuntimeStateAsync: async () => null,
    });

    expect(path).toBe(join(projectDir, `${OLDER_SESSION_ID}.jsonl`));
  });

  it('still resolves a pathless entry via its per-harness formula', async () => {
    const encoded = encodeClaudeProjectDir(WORKSPACE_PATH);
    const projectDir = join(claudeProjectsDir, encoded);
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, `${CLAUDE_SESSION_ID}.jsonl`), '{}\n');
    await writeFile(join(agentsDir, AGENT_ID, 'sessions.json'), `${JSON.stringify({
      sessionId: CLAUDE_SESSION_ID,
      at: new Date().toISOString(),
      source: 'session-start-hook',
      harness: 'claude-code',
    })}\n`);

    const path = await resolveJsonlPath(AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
      getRuntimeStateAsync: async () => null,
    });

    expect(path).toBe(join(projectDir, `${CLAUDE_SESSION_ID}.jsonl`));
  });
});

describe('resolveJsonlPath — codex agents (PAN-1805)', () => {
  const CODEX_AGENT_ID = 'agent-pan-1803';
  // Each test gets a distinct thread-id: findRolloutPath caches by
  // (codexHome, threadId) at module level, and a per-test suffix keeps the
  // tmp-dir keys unique even across reruns.
  let threadCounter = 0;

  async function setupCodexAgent(opts: { threadId?: boolean; rollouts?: number } = {}): Promise<string[]> {
    threadCounter += 1;
    const agentDir = join(agentsDir, CODEX_AGENT_ID);
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, 'state.json'), JSON.stringify({
      id: CODEX_AGENT_ID,
      harness: 'codex',
    }));
    const sessionsDay = join(agentDir, 'codex-home', 'sessions', '2026', '06', '12');
    await mkdir(sessionsDay, { recursive: true });

    const rolloutPaths: string[] = [];
    const count = opts.rollouts ?? 0;
    for (let i = 0; i < count; i++) {
      const threadId = `019ebc6b-1fcb-7711-a3b2-${String(threadCounter).padStart(6, '0')}${String(i).padStart(6, '0')}`;
      const p = join(sessionsDay, `rollout-2026-06-12T11-0${i}-00-${threadId}.jsonl`);
      await writeFile(p, '{"type":"session_meta"}\n');
      // Stagger mtimes so "latest" is deterministic (filesystem mtime
      // granularity can otherwise make sequential writes tie).
      const t = new Date(Date.now() - (count - i) * 60_000);
      await utimes(p, t, t);
      rolloutPaths.push(p);
    }
    if (opts.threadId && rolloutPaths.length > 0) {
      // Persist the thread-id of the FIRST (oldest) rollout so the fast path
      // is distinguishable from the latest-rollout fallback.
      const first = rolloutPaths[0]!;
      const threadId = /-([0-9a-f-]{36})\.jsonl$/.exec(first)![1]!;
      await writeFile(join(agentDir, 'codex-thread-id'), threadId);
    }
    return rolloutPaths;
  }

  it('resolves the rollout via the persisted thread-id fast path', async () => {
    const rollouts = await setupCodexAgent({ threadId: true, rollouts: 2 });

    const path = await resolveJsonlPath(CODEX_AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
    });

    expect(path).toBe(rollouts[0]);
  });

  it('falls back to the latest rollout when no thread-id is persisted', async () => {
    const rollouts = await setupCodexAgent({ rollouts: 3 });

    const path = await resolveJsonlPath(CODEX_AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
    });

    expect(path).toBe(rollouts[2]);
  });

  it('returns null when the codex agent has no rollout yet', async () => {
    await setupCodexAgent({ rollouts: 0 });

    const path = await resolveJsonlPath(CODEX_AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
    });

    expect(path).toBeNull();
  });

  it('does not revive a pre-reset rollout after the launch marker clears', async () => {
    await setupCodexAgent({ rollouts: 1 });
    await writeFile(join(agentsDir, CODEX_AGENT_ID, 'sessions.json'), `${JSON.stringify({
      reset: true,
      at: new Date().toISOString(),
      source: 'operator-reset',
    })}\n`);

    await expect(listAgentTranscriptCandidates(CODEX_AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
    })).resolves.toEqual([]);
  });

  it('codex harness wins over a stale claude session.id', async () => {
    const rollouts = await setupCodexAgent({ rollouts: 1 });
    // Simulate a stale claude session from an earlier run of the same agent id.
    const encoded = encodeClaudeProjectDir(WORKSPACE_PATH);
    const projectDir = join(claudeProjectsDir, encoded);
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, `${CLAUDE_SESSION_ID}.jsonl`), '{"stale":"claude"}\n');
    await writeFile(join(agentsDir, CODEX_AGENT_ID, 'session.id'), CLAUDE_SESSION_ID);

    const path = await resolveJsonlPath(CODEX_AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
    });

    expect(path).toBe(rollouts[0]);
  });

  it('resolveCodexRolloutPath returns null for agents without a codex-home', async () => {
    const path = await resolveCodexRolloutPath(AGENT_ID, { agentsDirOverride: agentsDir });

    expect(path).toBeNull();
  });

  it('claude agents without a harness field keep the claude lookup (regression)', async () => {
    const encoded = encodeClaudeProjectDir(WORKSPACE_PATH);
    const projectDir = join(claudeProjectsDir, encoded);
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, `${CLAUDE_SESSION_ID}.jsonl`), '{}');
    await writeFile(join(agentsDir, AGENT_ID, 'session.id'), CLAUDE_SESSION_ID);
    // state.json without harness — pre-harness agents
    await writeFile(join(agentsDir, AGENT_ID, 'state.json'), JSON.stringify({ id: AGENT_ID }));

    const path = await resolveJsonlPath(AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
    });

    expect(path).toBe(join(projectDir, `${CLAUDE_SESSION_ID}.jsonl`));
  });
});

describe('resolveJsonlPath — ACP agents', () => {
  const ACP_AGENT_ID = 'agent-pan-2858';

  async function setupAcpAgent(harness: string = 'acp'): Promise<string> {
    const agentDir = join(agentsDir, ACP_AGENT_ID);
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, 'state.json'), JSON.stringify({
      id: ACP_AGENT_ID,
      harness,
      workspace: WORKSPACE_PATH,
    }));
    const transcriptPath = join(agentDir, 'acp-session.jsonl');
    await writeFile(transcriptPath, '{"role":"assistant","content":"ready"}\n');
    return transcriptPath;
  }

  it('resolves the normalized ACP host transcript', async () => {
    const transcriptPath = await setupAcpAgent();

    expect(await resolveAcpTranscriptPath(ACP_AGENT_ID, {
      agentsDirOverride: agentsDir,
    })).toBe(transcriptPath);
    expect(await resolveJsonlPath(ACP_AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
    })).toBe(transcriptPath);
  });

  it('ACP harness wins over stale Claude session artifacts', async () => {
    const transcriptPath = await setupAcpAgent();
    const projectDir = join(claudeProjectsDir, encodeClaudeProjectDir(WORKSPACE_PATH));
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(agentsDir, ACP_AGENT_ID, 'session.id'), CLAUDE_SESSION_ID);
    await writeFile(join(projectDir, `${CLAUDE_SESSION_ID}.jsonl`), '{"stale":"claude"}\n');

    const path = await resolveJsonlPath(ACP_AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
    });

    expect(path).toBe(transcriptPath);
  });

  it('does not infer ACP from retained artifacts when Claude is recorded', async () => {
    await setupAcpAgent('claude-code');

    expect(await resolveJsonlPath(ACP_AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
    })).toBeNull();
  });

  it('does not misclassify acp-session.jsonl as a Pi transcript', async () => {
    await setupAcpAgent();

    expect(await resolvePiSessionPath(ACP_AGENT_ID, {
      agentsDirOverride: agentsDir,
    })).toBeNull();
  });
});

describe('resolveJsonlPath — kimi-code agents (PAN-1837 wi8a)', () => {
  const KIMI_AGENT_ID = 'agent-pan-1837';
  let kimiHomeDir: string;

  beforeEach(async () => {
    kimiHomeDir = join(testDir, 'kimi-code');
  });

  async function setupKimiAgent(options: {
    harness?: string;
    sessionId?: string | null;
    capturedSessionId?: string;
  } = {}): Promise<string> {
    const { harness = 'kimi-code', sessionId = 'session_fresh', capturedSessionId = sessionId ?? undefined } = options;
    const agentDir = join(agentsDir, KIMI_AGENT_ID);
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, 'state.json'), JSON.stringify({
      id: KIMI_AGENT_ID,
      harness,
      workspace: WORKSPACE_PATH,
    }));
    if (capturedSessionId) {
      await writeFile(join(agentDir, 'kimi-session-id'), capturedSessionId);
    }
    const wireDir = join(kimiSessionsRoot(kimiHomeDir, WORKSPACE_PATH), sessionId ?? 'session_untracked', 'agents', 'main');
    await mkdir(wireDir, { recursive: true });
    const wirePath = join(wireDir, 'wire.jsonl');
    await writeFile(wirePath, '{"type":"turn.prompt"}\n');
    return wirePath;
  }

  it('ac1: resolveJsonlPath returns the native wire.jsonl path for a captured session id', async () => {
    const wirePath = await setupKimiAgent();

    expect(await resolveKimiWirePath(KIMI_AGENT_ID, {
      agentsDirOverride: agentsDir,
      kimiHomeOverride: kimiHomeDir,
    })).toBe(wirePath);
    expect(await resolveJsonlPath(KIMI_AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
      kimiHomeOverride: kimiHomeDir,
    })).toBe(wirePath);
  });

  it('ac2: falls back to the newest session dir under the workDirKey bucket when no id is captured', async () => {
    const wirePath = await setupKimiAgent({ sessionId: 'session_only', capturedSessionId: undefined });

    const path = await resolveKimiWirePath(KIMI_AGENT_ID, {
      agentsDirOverride: agentsDir,
      kimiHomeOverride: kimiHomeDir,
    });

    expect(path).toBe(wirePath);
  });

  it('ac3: does not infer kimi-code from retained artifacts when Claude is recorded', async () => {
    await setupKimiAgent({ harness: 'claude-code' });

    expect(await resolveJsonlPath(KIMI_AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
      kimiHomeOverride: kimiHomeDir,
    })).toBeNull();
  });

  it('returns null when no session bucket exists for the workspace', async () => {
    const agentDir = join(agentsDir, KIMI_AGENT_ID);
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, 'state.json'), JSON.stringify({
      id: KIMI_AGENT_ID,
      harness: 'kimi-code',
      workspace: WORKSPACE_PATH,
    }));

    expect(await resolveKimiWirePath(KIMI_AGENT_ID, {
      agentsDirOverride: agentsDir,
      kimiHomeOverride: kimiHomeDir,
    })).toBeNull();
  });

  it('exposes the workspace bucket as a watch root before any Kimi candidate exists', async () => {
    const agentDir = join(agentsDir, KIMI_AGENT_ID);
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, 'state.json'), JSON.stringify({
      id: KIMI_AGENT_ID,
      harness: 'kimi-code',
      workspace: WORKSPACE_PATH,
    }));

    await expect(listAgentTranscriptCandidates(KIMI_AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      kimiHomeOverride: kimiHomeDir,
    })).resolves.toEqual([]);
    await expect(listAgentTranscriptWatchRoots(KIMI_AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      kimiHomeOverride: kimiHomeDir,
    })).resolves.toEqual([kimiSessionsRoot(kimiHomeDir, WORKSPACE_PATH)]);
  });
});

describe('resolveJsonlPath — recorded harness is authoritative', () => {
  const STALE_AGENT = 'agent-pan-1832';

  async function writeState(agentId: string, harness: string | null): Promise<void> {
    const dir = join(agentsDir, agentId);
    await mkdir(dir, { recursive: true });
    const state: Record<string, unknown> = { id: agentId, workspace: WORKSPACE_PATH };
    if (harness) state.harness = harness;
    await writeFile(join(dir, 'state.json'), JSON.stringify(state));
  }

  async function writeCodexRollout(agentId: string): Promise<void> {
    const day = join(agentsDir, agentId, 'codex-home', 'sessions', '2026', '06', '24');
    await mkdir(day, { recursive: true });
    await writeFile(
      join(day, 'rollout-2026-06-24T11-00-00-019efa97-b5d4-7a12-aee6-0f518469972c.jsonl'),
      '{"type":"session_meta"}\n',
    );
  }

  it('resolveJsonlPath does not return a Codex rollout for a Claude agent', async () => {
    await writeState(STALE_AGENT, 'claude-code');
    await writeCodexRollout(STALE_AGENT);

    const path = await resolveJsonlPath(STALE_AGENT, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
    });

    expect(path).toBeNull();
  });
});

describe('readLauncherPinnedSessionId — Conversation tab matches Terminal tab', () => {
  const TMUX = 'conv-20260620-3784';
  const PINNED = 'fcd61bd6-56b3-489b-bb34-d7d4f13be95e';
  const RESUMED = '09125ebe-6b26-474b-b32d-da89a93b8baf';
  let overdeckHome: string;

  beforeEach(() => {
    overdeckHome = join(testDir, 'overdeck');
  });

  async function writeConversationLauncher(body: string): Promise<void> {
    const dir = join(overdeckHome, 'conversations', TMUX);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'launcher.sh'), body);
  }

  it('returns the --session-id pinned in the conversation launcher', async () => {
    await writeConversationLauncher(
      `node '/x/pty-supervisor.js' claude --permission-mode auto --model 'claude-opus-4-8' --session-id '${PINNED}'\n`,
    );

    const id = await readLauncherPinnedSessionId(TMUX, { overdeckHomeOverride: overdeckHome });

    expect(id).toBe(PINNED);
  });

  it('falls back to --resume when no --session-id is present', async () => {
    await writeConversationLauncher(`node '/x/pty-supervisor.js' claude --resume '${RESUMED}'\n`);

    const id = await readLauncherPinnedSessionId(TMUX, { overdeckHomeOverride: overdeckHome });

    expect(id).toBe(RESUMED);
  });

  it('prefers --session-id over --resume', async () => {
    await writeConversationLauncher(
      `node '/x/pty-supervisor.js' claude --resume '${RESUMED}' --session-id '${PINNED}'\n`,
    );

    const id = await readLauncherPinnedSessionId(TMUX, { overdeckHomeOverride: overdeckHome });

    expect(id).toBe(PINNED);
  });

  it('handles an unquoted session id', async () => {
    await writeConversationLauncher(`node /x/pty-supervisor.js claude --session-id ${PINNED}\n`);

    const id = await readLauncherPinnedSessionId(TMUX, { overdeckHomeOverride: overdeckHome });

    expect(id).toBe(PINNED);
  });

  it('checks the conversation launcher before the agent launcher', async () => {
    await writeConversationLauncher(`claude --session-id '${PINNED}'\n`);
    const agentDir = join(overdeckHome, 'agents', TMUX);
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, 'launcher.sh'), `claude --session-id '${RESUMED}'\n`);

    const id = await readLauncherPinnedSessionId(TMUX, { overdeckHomeOverride: overdeckHome });

    expect(id).toBe(PINNED);
  });

  it('falls back to the agent launcher when no conversation launcher exists', async () => {
    const agentDir = join(overdeckHome, 'agents', TMUX);
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, 'launcher.sh'), `claude --session-id '${PINNED}'\n`);

    const id = await readLauncherPinnedSessionId(TMUX, { overdeckHomeOverride: overdeckHome });

    expect(id).toBe(PINNED);
  });

  it('returns null when no launcher exists', async () => {
    const id = await readLauncherPinnedSessionId(TMUX, { overdeckHomeOverride: overdeckHome });

    expect(id).toBeNull();
  });

  it('returns null when the launcher pins no session id', async () => {
    await writeConversationLauncher(`node /x/pty-supervisor.js claude --permission-mode auto\n`);

    const id = await readLauncherPinnedSessionId(TMUX, { overdeckHomeOverride: overdeckHome });

    expect(id).toBeNull();
  });
});

describe('resolveJsonlPath / resolvePiSessionPath — pi agents (PAN-1908)', () => {
  const PI_AGENT_ID = 'agent-pan-1908';
  const PI_STRIKE_ID = 'strike-pan-1827';
  const PI_FLYWHEEL_ID = 'flywheel-orchestrator';
  const TRANSCRIPT_OLD = '2026-06-15T06-43-53-944Z_019eca05-bbd8-7330-82e8-f54e6020a7e2.jsonl';
  const TRANSCRIPT_NEW = '2026-06-15T07-10-00-000Z_019eca05-cccc-7330-82e8-ffffffffffff.jsonl';

  async function setupPiAgent(agentId = PI_AGENT_ID, harness: 'pi' | 'ohmypi' = 'pi'): Promise<string> {
    const agentDir = join(agentsDir, agentId);
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, 'state.json'), JSON.stringify({ id: agentId, harness }));
    return agentDir;
  }

  it('work agents: resolves the transcript written at the agent-dir ROOT', async () => {
    // The bug: pi work agents write `<ts>_<id>.jsonl` to the agent-dir root
    // (not the sessions/ subdir), so the messages endpoint returned 404 →
    // "No conversation data available" / "How can I help you?".
    const agentDir = await setupPiAgent();
    await writeFile(join(agentDir, TRANSCRIPT_OLD), '{"type":"session"}\n');

    const path = await resolveJsonlPath(PI_AGENT_ID, WORKSPACE_PATH, { agentsDirOverride: agentsDir });

    expect(path).toBe(join(agentDir, TRANSCRIPT_OLD));
  });

  it('does NOT return cost-events.jsonl / activity.jsonl as the transcript', async () => {
    const agentDir = await setupPiAgent();
    await writeFile(join(agentDir, 'cost-events.jsonl'), '{"cost":1}\n');
    await writeFile(join(agentDir, 'activity.jsonl'), '{"act":1}\n');
    await writeFile(join(agentDir, TRANSCRIPT_OLD), '{"type":"session"}\n');

    const path = await resolvePiSessionPath(PI_AGENT_ID, { agentsDirOverride: agentsDir });

    expect(path).toBe(join(agentDir, TRANSCRIPT_OLD));
  });

  it('conversations: resolves the transcript written in the sessions/ subdir', async () => {
    const agentDir = await setupPiAgent();
    const sessionsDir = join(agentDir, 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(join(sessionsDir, TRANSCRIPT_OLD), '{"type":"session"}\n');

    const path = await resolvePiSessionPath(PI_AGENT_ID, { agentsDirOverride: agentsDir });

    expect(path).toBe(join(sessionsDir, TRANSCRIPT_OLD));
  });

  it('picks the freshest transcript by mtime across root and sessions/', async () => {
    const agentDir = await setupPiAgent();
    const sessionsDir = join(agentDir, 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    const older = join(sessionsDir, TRANSCRIPT_OLD);
    const newer = join(agentDir, TRANSCRIPT_NEW);
    await writeFile(older, '{"type":"session"}\n');
    await writeFile(newer, '{"type":"session"}\n');
    const tOld = new Date(Date.now() - 60_000);
    const tNew = new Date();
    await utimes(older, tOld, tOld);
    await utimes(newer, tNew, tNew);

    const path = await resolvePiSessionPath(PI_AGENT_ID, { agentsDirOverride: agentsDir });

    expect(path).toBe(newer);
  });

  it('breaks equal-mtime Pi transcript ties deterministically by path', async () => {
    const agentDir = await setupPiAgent();
    const sessionsDir = join(agentDir, 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    // Split across directories so walk order (sessions/ first, root second)
    // differs from path order — otherwise a stable sort over tied mtimes
    // would happen to return the right answer even without the tie-break.
    const zulu = join(sessionsDir, 'z.jsonl');
    const alpha = join(agentDir, 'a.jsonl');
    await writeFile(zulu, '{"type":"session"}\n');
    await writeFile(alpha, '{"type":"session"}\n');
    const tied = new Date('2026-09-20T00:00:00.000Z');
    await utimes(alpha, tied, tied);
    await utimes(zulu, tied, tied);

    await expect(resolvePiSessionPath(PI_AGENT_ID, { agentsDirOverride: agentsDir })).resolves.toBe(alpha);
  });

  it('returns null when pi has not written a transcript yet', async () => {
    await setupPiAgent();

    const path = await resolvePiSessionPath(PI_AGENT_ID, { agentsDirOverride: agentsDir });

    expect(path).toBeNull();
  });

  it('pi harness wins over a stale claude session.id', async () => {
    const agentDir = await setupPiAgent();
    await writeFile(join(agentDir, TRANSCRIPT_OLD), '{"type":"session"}\n');
    const encoded = encodeClaudeProjectDir(WORKSPACE_PATH);
    const projectDir = join(claudeProjectsDir, encoded);
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, `${CLAUDE_SESSION_ID}.jsonl`), '{"stale":"claude"}\n');
    await writeFile(join(agentDir, 'session.id'), CLAUDE_SESSION_ID);

    const path = await resolveJsonlPath(PI_AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
    });

    expect(path).toBe(join(agentDir, TRANSCRIPT_OLD));
  });

  it('strike agents resolve pi transcripts from the strike session dir', async () => {
    const agentDir = await setupPiAgent(PI_STRIKE_ID);
    await writeFile(join(agentDir, TRANSCRIPT_OLD), '{"type":"session"}\n');

    const path = await resolveJsonlPath(PI_STRIKE_ID, WORKSPACE_PATH, { agentsDirOverride: agentsDir });

    expect(path).toBe(join(agentDir, TRANSCRIPT_OLD));
  });

  it('flywheel orchestrator resolves pi transcripts from its agent dir', async () => {
    const agentDir = await setupPiAgent(PI_FLYWHEEL_ID, 'ohmypi');
    await writeFile(join(agentDir, TRANSCRIPT_OLD), '{"type":"session"}\n');

    const path = await resolveJsonlPath(PI_FLYWHEEL_ID, WORKSPACE_PATH, { agentsDirOverride: agentsDir });

    expect(path).toBe(join(agentDir, TRANSCRIPT_OLD));
  });
});

describe('Prime Agent transcripts (PAN-3668 WI-18)', () => {
  async function primeAgent(): Promise<{ agentDir: string; sessionFile: string }> {
    const agentDir = join(agentsDir, AGENT_ID);
    await writeFile(join(agentDir, 'state.json'), JSON.stringify({ id: AGENT_ID, harness: 'prime-agent', workspace: WORKSPACE_PATH, model: 'gpt-5.5' }));
    const sessionFile = join(agentDir, 'prime-sessions', '01a0.jsonl');
    await mkdir(join(agentDir, 'prime-sessions'), { recursive: true });
    await writeFile(sessionFile, '{"type":"session","version":3}\n');
    return { agentDir, sessionFile };
  }

  it('watches the agent prime-sessions directory', async () => {
    await primeAgent();
    await expect(listAgentTranscriptWatchRoots(AGENT_ID, WORKSPACE_PATH, { agentsDirOverride: agentsDir }))
      .resolves.toEqual([join(agentsDir, AGENT_ID, 'prime-sessions')]);
  });

  it('falls back to the prime-agent-session-file pointer when sessions.json has no path', async () => {
    const { agentDir, sessionFile } = await primeAgent();
    await writeFile(join(agentDir, 'prime-agent-session-file'), `${sessionFile}\n`);

    const candidates = await listAgentTranscriptCandidates(AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
      getRuntimeStateAsync: async () => null,
    });

    expect(candidates).toEqual([{ kind: 'prime-agent', path: sessionFile, model: 'gpt-5.5' }]);
  });

  it('prefers the path the host recorded in sessions.json', async () => {
    const { agentDir, sessionFile } = await primeAgent();
    await writeFile(join(agentDir, 'sessions.json'), `${JSON.stringify({
      sessionId: 'prime-session-1',
      at: new Date().toISOString(),
      source: 'prime-agent-host',
      harness: 'prime-agent',
      path: sessionFile,
    })}\n`);

    const candidates = await listAgentTranscriptCandidates(AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
      getRuntimeStateAsync: async () => null,
    });

    expect(candidates[0]).toMatchObject({ kind: 'prime-agent', path: sessionFile });
  });
});
