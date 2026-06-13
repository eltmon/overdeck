import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  resolveClaudeSessionId,
  resolveCodexRolloutPath,
  resolveJsonlPath,
  resolvePiSessionPath,
} from '../jsonl-resolver.js';
import { encodeClaudeProjectDir } from '../../../../lib/paths.js';

const AGENT_ID = 'agent-pan-830';
const WORKSPACE_PATH = '/home/testuser/Projects/panopticon-cli/workspaces/feature-pan-830';
const CLAUDE_SESSION_ID = '9d08794c-3973-4f83-92cf-234ae618258a';

let testDir: string;
let agentsDir: string;
let claudeProjectsDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `pan-jsonl-resolver-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  agentsDir = join(testDir, 'panopticon', 'agents');
  claudeProjectsDir = join(testDir, 'claude', 'projects');
  await mkdir(join(agentsDir, AGENT_ID), { recursive: true });
  await mkdir(claudeProjectsDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe('resolveClaudeSessionId (PAN-830)', () => {
  it('reads session.id when present', async () => {
    await writeFile(join(agentsDir, AGENT_ID, 'session.id'), `${CLAUDE_SESSION_ID}\n`);

    const id = await resolveClaudeSessionId(AGENT_ID, { agentsDirOverride: agentsDir });

    expect(id).toBe(CLAUDE_SESSION_ID);
  });

  it('falls back to last entry of sessions.json when session.id missing', async () => {
    const arr = ['oldest-uuid', 'older-uuid', CLAUDE_SESSION_ID];
    await writeFile(join(agentsDir, AGENT_ID, 'sessions.json'), JSON.stringify(arr));

    const id = await resolveClaudeSessionId(AGENT_ID, { agentsDirOverride: agentsDir });

    expect(id).toBe(CLAUDE_SESSION_ID);
  });

  it('falls back to runtime state when session.id and sessions.json missing', async () => {
    const id = await resolveClaudeSessionId(AGENT_ID, {
      agentsDirOverride: agentsDir,
      getRuntimeStateAsync: async () => ({ claudeSessionId: CLAUDE_SESSION_ID }),
    });

    expect(id).toBe(CLAUDE_SESSION_ID);
  });

  it('prefers session.id over sessions.json', async () => {
    await writeFile(join(agentsDir, AGENT_ID, 'session.id'), 'session-id-wins\n');
    await writeFile(join(agentsDir, AGENT_ID, 'sessions.json'), JSON.stringify(['sessions-json-loses']));

    const id = await resolveClaudeSessionId(AGENT_ID, { agentsDirOverride: agentsDir });

    expect(id).toBe('session-id-wins');
  });

  it('prefers sessions.json over runtime state', async () => {
    await writeFile(join(agentsDir, AGENT_ID, 'sessions.json'), JSON.stringify(['sessions-json-wins']));

    const id = await resolveClaudeSessionId(AGENT_ID, {
      agentsDirOverride: agentsDir,
      getRuntimeStateAsync: async () => ({ claudeSessionId: 'runtime-loses' }),
    });

    expect(id).toBe('sessions-json-wins');
  });

  it('returns null when nothing is available', async () => {
    const id = await resolveClaudeSessionId(AGENT_ID, {
      agentsDirOverride: agentsDir,
      getRuntimeStateAsync: async () => null,
    });

    expect(id).toBeNull();
  });

  it('returns null on malformed sessions.json (non-array)', async () => {
    await writeFile(join(agentsDir, AGENT_ID, 'sessions.json'), '{"not":"array"}');

    const id = await resolveClaudeSessionId(AGENT_ID, {
      agentsDirOverride: agentsDir,
      getRuntimeStateAsync: async () => null,
    });

    expect(id).toBeNull();
  });

  it('returns null on malformed sessions.json (invalid JSON)', async () => {
    await writeFile(join(agentsDir, AGENT_ID, 'sessions.json'), 'not-json{');

    const id = await resolveClaudeSessionId(AGENT_ID, {
      agentsDirOverride: agentsDir,
      getRuntimeStateAsync: async () => null,
    });

    expect(id).toBeNull();
  });

  it('returns null on empty sessions.json array', async () => {
    await writeFile(join(agentsDir, AGENT_ID, 'sessions.json'), '[]');

    const id = await resolveClaudeSessionId(AGENT_ID, {
      agentsDirOverride: agentsDir,
      getRuntimeStateAsync: async () => null,
    });

    expect(id).toBeNull();
  });

  it('returns null when agent dir does not exist', async () => {
    const id = await resolveClaudeSessionId('nonexistent-agent', {
      agentsDirOverride: agentsDir,
      getRuntimeStateAsync: async () => null,
    });

    expect(id).toBeNull();
  });
});

describe('resolveJsonlPath (PAN-830)', () => {
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

  it('does NOT return an agent-id-named JSONL (the bug PAN-830 fixes)', async () => {
    // Pre-PAN-830 behavior would have built ~/.claude/projects/<encoded>/<agentId>.jsonl
    // and returned it if present. Verify the new resolver does NOT do that.
    const encoded = encodeClaudeProjectDir(WORKSPACE_PATH);
    const projectDir = join(claudeProjectsDir, encoded);
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, `${AGENT_ID}.jsonl`), '{"old":"bug"}\n');
    // No session.id, no sessions.json, no runtime state — so claudeSessionId is null
    const path = await resolveJsonlPath(AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
      getRuntimeStateAsync: async () => null,
    });

    expect(path).toBeNull();
  });

  it('uses the encoded workspace path under claudeProjects root', async () => {
    const encoded = encodeClaudeProjectDir(WORKSPACE_PATH);
    expect(encoded).toBe(
      '-home-testuser-Projects-panopticon-cli-workspaces-feature-pan-830',
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
      codexMode: 'work-tui',
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

describe('resolvePiSessionPath (PAN-1827)', () => {
  const PI_AGENT_ID = 'agent-pan-1827';

  async function setupPiAgent(sessions: Array<{ relPath: string; offsetMin?: number }>): Promise<string[]> {
    const agentDir = join(agentsDir, PI_AGENT_ID);
    const sessionsDir = join(agentDir, 'sessions');
    const paths: string[] = [];
    for (let i = 0; i < sessions.length; i++) {
      const { relPath, offsetMin = sessions.length - i } = sessions[i]!;
      const p = join(sessionsDir, relPath);
      await mkdir(join(p, '..'), { recursive: true });
      await writeFile(p, '{"type":"event"}\n');
      const t = new Date(Date.now() - offsetMin * 60_000);
      await utimes(p, t, t);
      paths.push(p);
    }
    return paths;
  }

  it('returns the freshest .jsonl found under sessions/ at any nesting depth', async () => {
    const paths = await setupPiAgent([
      { relPath: join('encoded-cwd', '2026-06-13T11-00-00_old.jsonl'), offsetMin: 10 },
      { relPath: join('encoded-cwd', '2026-06-13T11-05-00_new.jsonl'), offsetMin: 2 },
      { relPath: join('other-cwd', '2026-06-13T11-03-00_other.jsonl'), offsetMin: 5 },
    ]);

    const path = await resolvePiSessionPath(PI_AGENT_ID, { agentsDirOverride: agentsDir });

    expect(path).toBe(paths[1]);
  });

  it('returns null when the agent has no sessions/ directory', async () => {
    const path = await resolvePiSessionPath(PI_AGENT_ID, { agentsDirOverride: agentsDir });

    expect(path).toBeNull();
  });

  it('returns null when sessions/ contains no .jsonl file', async () => {
    const sessionsDir = join(agentsDir, PI_AGENT_ID, 'sessions');
    await mkdir(join(sessionsDir, 'empty-dir'), { recursive: true });
    await writeFile(join(sessionsDir, 'not-a-session.txt'), 'text');

    const path = await resolvePiSessionPath(PI_AGENT_ID, { agentsDirOverride: agentsDir });

    expect(path).toBeNull();
  });
});

describe('resolveJsonlPath — pi agents (PAN-1827)', () => {
  const PI_AGENT_ID = 'agent-pan-1827';

  async function setupPiAgentWithState(opts: { sessions?: number } = {}): Promise<string[]> {
    const agentDir = join(agentsDir, PI_AGENT_ID);
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, 'state.json'), JSON.stringify({
      id: PI_AGENT_ID,
      harness: 'pi',
    }));
    const sessionsDir = join(agentDir, 'sessions');
    const paths: string[] = [];
    const count = opts.sessions ?? 0;
    for (let i = 0; i < count; i++) {
      const p = join(sessionsDir, `2026-06-13T11-0${i}-00_session-${i}.jsonl`);
      await mkdir(join(p, '..'), { recursive: true });
      await writeFile(p, '{"type":"event"}\n');
      const t = new Date(Date.now() - (count - i) * 60_000);
      await utimes(p, t, t);
      paths.push(p);
    }
    return paths;
  }

  it('resolves the pi session JSONL via the pi branch', async () => {
    const paths = await setupPiAgentWithState({ sessions: 2 });

    const path = await resolveJsonlPath(PI_AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
    });

    expect(path).toBe(paths[1]);
  });

  it('returns null when the pi agent has no session files yet', async () => {
    await setupPiAgentWithState({ sessions: 0 });

    const path = await resolveJsonlPath(PI_AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
    });

    expect(path).toBeNull();
  });

  it('pi harness wins over a stale claude session.id', async () => {
    const paths = await setupPiAgentWithState({ sessions: 1 });
    const encoded = encodeClaudeProjectDir(WORKSPACE_PATH);
    const projectDir = join(claudeProjectsDir, encoded);
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, `${CLAUDE_SESSION_ID}.jsonl`), '{"stale":"claude"}\n');
    await writeFile(join(agentsDir, PI_AGENT_ID, 'session.id'), CLAUDE_SESSION_ID);

    const path = await resolveJsonlPath(PI_AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
    });

    expect(path).toBe(paths[0]);
  });

  it('resolveJsonlPath still returns the claude JSONL for claude-code agents (regression)', async () => {
    const encoded = encodeClaudeProjectDir(WORKSPACE_PATH);
    const projectDir = join(claudeProjectsDir, encoded);
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, `${CLAUDE_SESSION_ID}.jsonl`), '{}');
    await writeFile(join(agentsDir, AGENT_ID, 'session.id'), CLAUDE_SESSION_ID);
    await writeFile(join(agentsDir, AGENT_ID, 'state.json'), JSON.stringify({
      id: AGENT_ID,
      harness: 'claude-code',
    }));

    const path = await resolveJsonlPath(AGENT_ID, WORKSPACE_PATH, {
      agentsDirOverride: agentsDir,
      claudeProjectsDirOverride: claudeProjectsDir,
    });

    expect(path).toBe(join(projectDir, `${CLAUDE_SESSION_ID}.jsonl`));
  });
});
