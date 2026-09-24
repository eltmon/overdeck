/**
 * Golden transcript resolution per harness (PAN-4013, CH-7).
 *
 * CH-7 moves every harness's storage-path knowledge into
 * `src/lib/runtimes/storage/<harness>.ts`. This file was committed against the
 * code as it stood before that move and must pass unchanged after it: for each
 * harness it pins the path the resolvers return
 *
 *   (a) for a sessions.json entry that records its absolute transcript path
 *       (PAN-3959) — the recorded path wins, even with a formula-location file
 *       present for the same session;
 *   (b) for a pre-PAN-3959 entry with no path — the per-harness formula path;
 *
 * plus the conversation resolver (`resolveSessionFile`) and the watch roots.
 * It imports only the resolvers, never the storage helpers, and builds the
 * expected paths by hand (Claude's project-dir encoding, Kimi's work-dir key)
 * so a moved helper cannot make the expectation drift with the code.
 *
 * Default roots are exercised through HOME / OVERDECK_HOME, not overrides.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  listAgentTranscriptWatchRoots,
  resolveJsonlPath,
} from '../../../../src/lib/agents/transcript-resolver.js';
import { resolveSessionFile } from '../../../../src/lib/overdeck/conversation-reads.js';
import type { Conversation } from '../../../../src/lib/overdeck/conversations.js';

let root: string;
let overdeckHome: string;
let agentsRoot: string;
const saved: Record<string, string | undefined> = {};

function touch(path: string, body = '{"type":"user"}\n'): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  return path;
}

function writeAgent(agentId: string, harness: string, workspace: string, index: object[]): string {
  const agentDir = join(agentsRoot, agentId);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, 'state.json'), JSON.stringify({
    id: agentId,
    issueId: 'PAN-4013',
    role: 'work',
    harness,
    workspace,
    status: 'running',
  }));
  writeFileSync(join(agentDir, 'sessions.json'), index.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
  return agentDir;
}

/** Claude Code's project-dir encoding, restated (every non [a-zA-Z0-9-] char becomes '-'). */
function claudeProjectDirFor(cwd: string): string {
  return join(root, '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9-]/g, '-'));
}

/** Kimi's per-work-dir session bucket, restated. */
function kimiBucketFor(workDir: string): string {
  const hash = createHash('sha256').update(workDir).digest('hex').slice(0, 12);
  return join(root, '.kimi-code', 'sessions', `wd_${basename(workDir)}_${hash}`);
}

function conversation(overrides: Partial<Conversation>): Conversation {
  return { status: 'active', ...overrides } as Conversation;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'transcript-golden-'));
  overdeckHome = join(root, '.overdeck');
  agentsRoot = join(overdeckHome, 'agents');
  for (const key of ['HOME', 'OVERDECK_HOME', 'CODEX_HOME']) saved[key] = process.env[key];
  process.env.HOME = root;
  process.env.OVERDECK_HOME = overdeckHome;
  delete process.env.CODEX_HOME;
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

describe('golden transcript resolution (PAN-4013)', () => {
  describe('claude-code', () => {
    const workspace = '/work/space/feature-pan-4013';

    it('prefers the recorded absolute path over the project-dir formula', async () => {
      const recorded = touch(join(root, 'elsewhere', 'claude-recorded.jsonl'));
      touch(join(claudeProjectDirFor(workspace), 'sess-claude.jsonl'));
      writeAgent('agent-pan-4013', 'claude-code', workspace, [
        { sessionId: 'sess-claude', at: '2026-09-23T00:00:00.000Z', source: 'session-start', harness: 'claude-code', path: recorded },
      ]);
      expect(await resolveJsonlPath('agent-pan-4013', workspace)).toBe(recorded);
    });

    it('resolves a pre-PAN-3959 entry to ~/.claude/projects/<encoded cwd>/<id>.jsonl', async () => {
      const formula = touch(join(claudeProjectDirFor(workspace), 'sess-claude.jsonl'));
      writeAgent('agent-pan-4013', 'claude-code', workspace, [
        { sessionId: 'sess-claude', at: '2026-09-23T00:00:00.000Z', source: 'rotation' },
      ]);
      expect(await resolveJsonlPath('agent-pan-4013', workspace)).toBe(formula);
      expect(await listAgentTranscriptWatchRoots('agent-pan-4013', workspace)).toEqual([claudeProjectDirFor(workspace)]);
    });

    it('resolves a conversation from its cwd and Claude session id', async () => {
      const cwd = '/work/conversations/one';
      const formula = touch(join(claudeProjectDirFor(cwd), 'conv-session.jsonl'));
      const conv = conversation({ harness: 'claude-code', tmuxSession: 'conv-pan-4013', cwd, claudeSessionId: 'conv-session' });
      expect(await resolveSessionFile(conv)).toBe(formula);
    });
  });

  describe('codex', () => {
    const workspace = '/work/space/codex';
    const threadId = '0199aaaa-bbbb-7ccc-8ddd-eeeeffff0000';

    function rollout(agentDir: string): string {
      return touch(join(agentDir, 'codex-home', 'sessions', '2026', '09', '23', `rollout-2026-09-23T00-00-00-${threadId}.jsonl`));
    }

    it('prefers the recorded absolute path over the rollout walk', async () => {
      const recorded = touch(join(root, 'elsewhere', 'codex-recorded.jsonl'));
      const agentDir = writeAgent('agent-pan-4013', 'codex', workspace, [
        { sessionId: threadId, at: '2026-09-23T00:00:00.000Z', source: 'session-start', harness: 'codex', path: recorded },
      ]);
      rollout(agentDir);
      expect(await resolveJsonlPath('agent-pan-4013', workspace)).toBe(recorded);
    });

    it('resolves a pre-PAN-3959 entry to the rollout under the agent CODEX_HOME', async () => {
      const agentDir = writeAgent('agent-pan-4013', 'codex', workspace, [
        { sessionId: threadId, at: '2026-09-23T00:00:00.000Z', source: 'rotation' },
      ]);
      const path = rollout(agentDir);
      writeFileSync(join(agentDir, 'codex-thread-id'), `${threadId}\n`);
      expect(await resolveJsonlPath('agent-pan-4013', workspace)).toBe(path);
      expect(await listAgentTranscriptWatchRoots('agent-pan-4013', workspace)).toEqual([join(agentDir, 'codex-home', 'sessions')]);
    });

    it('resolves a conversation through its per-conversation CODEX_HOME', async () => {
      const convDir = join(agentsRoot, 'conv-pan-4013');
      const path = rollout(convDir);
      writeFileSync(join(convDir, 'codex-thread-id'), `${threadId}\n`);
      const conv = conversation({ harness: 'codex', tmuxSession: 'conv-pan-4013', cwd: workspace });
      expect(await resolveSessionFile(conv)).toBe(path);
    });
  });

  describe('kimi-code', () => {
    const workspace = '/work/space/kimi';

    it('prefers the recorded absolute path over the wire.jsonl formula', async () => {
      const recorded = touch(join(root, 'elsewhere', 'kimi-recorded.jsonl'));
      touch(join(kimiBucketFor(workspace), 'kimi-sess', 'agents', 'main', 'wire.jsonl'));
      writeAgent('agent-pan-4013', 'kimi-code', workspace, [
        { sessionId: 'kimi-sess', at: '2026-09-23T00:00:00.000Z', source: 'session-start', harness: 'kimi-code', path: recorded },
      ]);
      expect(await resolveJsonlPath('agent-pan-4013', workspace)).toBe(recorded);
    });

    it('resolves a pre-PAN-3959 entry to ~/.kimi-code/sessions/<work-dir key>/<id>/agents/main/wire.jsonl', async () => {
      const wire = touch(join(kimiBucketFor(workspace), 'kimi-sess', 'agents', 'main', 'wire.jsonl'));
      const agentDir = writeAgent('agent-pan-4013', 'kimi-code', workspace, [
        { sessionId: 'kimi-sess', at: '2026-09-23T00:00:00.000Z', source: 'rotation' },
      ]);
      writeFileSync(join(agentDir, 'kimi-session-id'), 'kimi-sess\n');
      expect(await resolveJsonlPath('agent-pan-4013', workspace)).toBe(wire);
      expect(await listAgentTranscriptWatchRoots('agent-pan-4013', workspace)).toEqual([kimiBucketFor(workspace)]);
    });

    it('resolves a conversation from its cwd bucket', async () => {
      const cwd = '/work/conversations/kimi';
      const wire = touch(join(kimiBucketFor(cwd), 'conv-kimi', 'agents', 'main', 'wire.jsonl'));
      const convDir = join(agentsRoot, 'conv-pan-4013');
      mkdirSync(convDir, { recursive: true });
      writeFileSync(join(convDir, 'kimi-session-id'), 'conv-kimi\n');
      const conv = conversation({ harness: 'kimi-code', tmuxSession: 'conv-pan-4013', cwd });
      expect(await resolveSessionFile(conv)).toBe(wire);
    });
  });

  describe('pi', () => {
    const workspace = '/work/space/pi';

    it('prefers the recorded absolute path over the sessions/ walk', async () => {
      const recorded = touch(join(root, 'elsewhere', 'pi-recorded.jsonl'));
      const agentDir = writeAgent('agent-pan-4013', 'pi', workspace, [
        { sessionId: 'pi-sess', at: '2026-09-23T00:00:00.000Z', source: 'session-start', harness: 'pi', path: recorded },
      ]);
      touch(join(agentDir, 'sessions', '2026-09-23T00-00-00_pi-sess.jsonl'));
      expect(await resolveJsonlPath('agent-pan-4013', workspace)).toBe(recorded);
    });

    it('resolves a pre-PAN-3959 entry to <agentDir>/sessions/*_<id>.jsonl', async () => {
      const agentDir = writeAgent('agent-pan-4013', 'pi', workspace, [
        { sessionId: 'pi-sess', at: '2026-09-23T00:00:00.000Z', source: 'rotation' },
      ]);
      const path = touch(join(agentDir, 'sessions', '2026-09-23T00-00-00_pi-sess.jsonl'));
      expect(await resolveJsonlPath('agent-pan-4013', workspace)).toBe(path);
      expect(await listAgentTranscriptWatchRoots('agent-pan-4013', workspace)).toEqual([join(agentDir, 'sessions')]);
    });

    it('resolves a conversation from its agent-dir sessions/', async () => {
      const path = touch(join(agentsRoot, 'conv-pan-4013', 'sessions', '2026-09-23T00-00-00_conv-pi.jsonl'));
      const conv = conversation({ harness: 'pi', tmuxSession: 'conv-pan-4013', cwd: workspace });
      expect(await resolveSessionFile(conv)).toBe(path);
    });
  });

  describe('acp (opencode)', () => {
    const workspace = '/work/space/opencode';

    it('prefers the recorded absolute path over acp-session.jsonl', async () => {
      const recorded = touch(join(root, 'elsewhere', 'acp-recorded.jsonl'));
      const agentDir = writeAgent('agent-pan-4013', 'opencode', workspace, [
        { sessionId: 'acp-sess', at: '2026-09-23T00:00:00.000Z', source: 'session-start', harness: 'opencode', path: recorded },
      ]);
      touch(join(agentDir, 'acp-session.jsonl'));
      expect(await resolveJsonlPath('agent-pan-4013', workspace)).toBe(recorded);
    });

    it('resolves a pre-PAN-3959 entry to <agentDir>/acp-session.jsonl', async () => {
      const agentDir = writeAgent('agent-pan-4013', 'opencode', workspace, [
        { sessionId: 'acp-sess', at: '2026-09-23T00:00:00.000Z', source: 'rotation' },
      ]);
      const path = touch(join(agentDir, 'acp-session.jsonl'));
      expect(await resolveJsonlPath('agent-pan-4013', workspace)).toBe(path);
      expect(await listAgentTranscriptWatchRoots('agent-pan-4013', workspace)).toEqual([agentDir]);
    });

    it('resolves a conversation to its acp-session.jsonl', async () => {
      const path = touch(join(agentsRoot, 'conv-pan-4013', 'acp-session.jsonl'));
      const conv = conversation({ harness: 'opencode', tmuxSession: 'conv-pan-4013', cwd: workspace });
      expect(await resolveSessionFile(conv)).toBe(path);
    });
  });

  describe('muse', () => {
    const workspace = '/work/space/muse';
    const museId = '0199aaaa-bbbb-7ccc-8ddd-eeeeffff1111';

    function museLog(agentId: string): string {
      return touch(join(agentsRoot, agentId, 'muse-data', 'muse', 'sessions', '2026', '09', '23', museId, 'session.jsonl'));
    }

    it('prefers the recorded absolute path over the muse-data walk', async () => {
      const recorded = touch(join(root, 'elsewhere', 'muse-recorded.jsonl'));
      writeAgent('agent-pan-4013', 'muse', workspace, [
        { sessionId: museId, at: '2026-09-23T00:00:00.000Z', source: 'session-start', harness: 'muse', path: recorded },
      ]);
      museLog('agent-pan-4013');
      expect(await resolveJsonlPath('agent-pan-4013', workspace)).toBe(recorded);
    });

    it('resolves a pre-PAN-3959 entry to muse-data/muse/sessions/YYYY/MM/DD/<id>/session.jsonl', async () => {
      writeAgent('agent-pan-4013', 'muse', workspace, [
        { sessionId: museId, at: '2026-09-23T00:00:00.000Z', source: 'rotation' },
      ]);
      const path = museLog('agent-pan-4013');
      expect(await resolveJsonlPath('agent-pan-4013', workspace)).toBe(path);
      expect(await listAgentTranscriptWatchRoots('agent-pan-4013', workspace)).toEqual([
        join(agentsRoot, 'agent-pan-4013', 'muse-data', 'muse', 'sessions'),
      ]);
    });

    it('resolves a conversation to its newest muse session log', async () => {
      const path = museLog('conv-pan-4013');
      const conv = conversation({ harness: 'muse', tmuxSession: 'conv-pan-4013', cwd: workspace });
      expect(await resolveSessionFile(conv)).toBe(path);
    });
  });
});
