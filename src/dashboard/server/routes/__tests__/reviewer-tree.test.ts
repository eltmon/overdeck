import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  extractReviewerRole,
  readReviewerRounds,
  readSynthesisRounds,
  buildReviewerNodes,
} from '../reviewer-tree.js';
import { REVIEWER_ROLES, getReviewerSessionName } from '../../../../lib/cloister/specialists.js';
import { getAgentStateSync } from '../../../../lib/agents.js';

vi.mock('../../../../lib/agents.js', () => ({
  getAgentStateSync: vi.fn(() => null),
}));

// buildReviewerNodes is gated by isExtendedReviewEnabled() (PAN-1981): convoy lanes
// are only built when extended review is on. Default the mock to TRUE so the existing
// node-building tests exercise the (parked-but-preserved) convoy logic; the gate's
// false-path has its own dedicated test below.
const { isExtendedReviewEnabledMock } = vi.hoisted(() => ({
  isExtendedReviewEnabledMock: vi.fn(() => true),
}));
vi.mock('../../../../lib/cloister/review-agent.js', () => ({
  isExtendedReviewEnabled: isExtendedReviewEnabledMock,
}));

const PROJECT_KEY = 'overdeck';
const ISSUE_ID = 'pan-830';
const WORKSPACE_PATH = '/home/testuser/Projects/overdeck/workspaces/feature-pan-830';

let testDir: string;
let agentsDir: string;

beforeEach(async () => {
  isExtendedReviewEnabledMock.mockReturnValue(true);
  testDir = join(tmpdir(), `pan-reviewer-tree-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  agentsDir = join(testDir, 'overdeck', 'agents');
  await mkdir(agentsDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
  vi.mocked(getAgentStateSync).mockImplementation(() => null);
});

describe('extractReviewerRole (PAN-830)', () => {
  it('parses canonical PAN-830 session names', () => {
    const name = getReviewerSessionName('correctness', PROJECT_KEY, ISSUE_ID);
    expect(extractReviewerRole(name, ISSUE_ID)).toBe('correctness');
  });

  it('parses canonical names for all five roles', () => {
    for (const role of REVIEWER_ROLES) {
      const name = getReviewerSessionName(role, PROJECT_KEY, ISSUE_ID);
      expect(extractReviewerRole(name, ISSUE_ID)).toBe(role);
    }
  });

  it('parses legacy PAN-821 timestamp-based session names', () => {
    expect(extractReviewerRole('review-pan-830-1700000000000-correctness', ISSUE_ID)).toBe('correctness');
    expect(extractReviewerRole('review-pan-830-1700000000000-security', ISSUE_ID)).toBe('security');
    expect(extractReviewerRole('review-pan-830-1700000000000-synthesis', ISSUE_ID)).toBe('synthesis');
  });

  it('handles case-insensitive issue IDs in legacy pattern', () => {
    expect(extractReviewerRole('review-PAN-830-1700000000000-correctness', 'pan-830')).toBe('correctness');
    expect(extractReviewerRole('review-pan-830-1700000000000-correctness', 'PAN-830')).toBe('correctness');
  });

  it('returns null for non-matching session names', () => {
    expect(extractReviewerRole('agent-pan-830', ISSUE_ID)).toBeNull();
    expect(extractReviewerRole('specialist-test-agent', ISSUE_ID)).toBeNull();
    expect(extractReviewerRole('random-string', ISSUE_ID)).toBeNull();
  });

  it('returns null for canonical pattern with mismatched issueId', () => {
    const name = getReviewerSessionName('correctness', PROJECT_KEY, 'pan-999');
    expect(extractReviewerRole(name, ISSUE_ID)).toBeNull();
  });

  it('returns null for legacy pattern with mismatched issueId', () => {
    expect(extractReviewerRole('review-pan-999-1700000000000-correctness', ISSUE_ID)).toBeNull();
  });

  it('returns null when role segment is missing in legacy pattern', () => {
    expect(extractReviewerRole('review-pan-830-1700000000000', ISSUE_ID)).toBeNull();
    expect(extractReviewerRole('review-pan-830-', ISSUE_ID)).toBeNull();
  });
});

describe('readReviewerRounds (PAN-830)', () => {
  const SESSION_NAME = getReviewerSessionName('correctness', PROJECT_KEY, ISSUE_ID);

  async function writeRound(round: number, status: string, success?: boolean): Promise<void> {
    const dir = join(agentsDir, SESSION_NAME);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, `round-${round}.json`),
      JSON.stringify({
        round,
        status,
        success,
        archivedAt: new Date(2026, 0, 1, round).toISOString(),
      }),
    );
  }

  it('returns undefined when session directory missing', async () => {
    const meta = await readReviewerRounds('nonexistent-session', agentsDir);
    expect(meta).toBeUndefined();
  });

  it('returns undefined when no round-N.json files present', async () => {
    await mkdir(join(agentsDir, SESSION_NAME), { recursive: true });
    await writeFile(join(agentsDir, SESSION_NAME, 'unrelated.json'), '{}');

    const meta = await readReviewerRounds(SESSION_NAME, agentsDir);
    expect(meta).toBeUndefined();
  });

  it('returns metadata for a single round', async () => {
    await writeRound(1, 'completed', true);

    const meta = await readReviewerRounds(SESSION_NAME, agentsDir);
    expect(meta).toBeDefined();
    expect(meta!.roundCount).toBe(1);
    expect(meta!.latestRound).toBe(1);
    expect(meta!.latestStatus).toBe('completed');
    expect(meta!.history).toHaveLength(1);
    expect(meta!.history[0]).toMatchObject({ round: 1, status: 'completed', success: true });
  });

  it('returns rounds sorted ascending and reports latest correctly', async () => {
    await writeRound(3, 'failed', false);
    await writeRound(1, 'completed', true);
    await writeRound(2, 'completed', true);

    const meta = await readReviewerRounds(SESSION_NAME, agentsDir);
    expect(meta!.roundCount).toBe(3);
    expect(meta!.latestRound).toBe(3);
    expect(meta!.latestStatus).toBe('failed');
    expect(meta!.history.map(h => h.round)).toEqual([1, 2, 3]);
    expect(meta!.history.map(h => h.status)).toEqual(['completed', 'completed', 'failed']);
  });

  it('skips malformed round artifacts', async () => {
    await writeRound(1, 'completed', true);
    const dir = join(agentsDir, SESSION_NAME);
    await writeFile(join(dir, 'round-2.json'), 'not-json{');
    await writeRound(3, 'failed', false);

    const meta = await readReviewerRounds(SESSION_NAME, agentsDir);
    expect(meta!.roundCount).toBe(2);
    expect(meta!.latestRound).toBe(3);
    expect(meta!.history.map(h => h.round)).toEqual([1, 3]);
  });
});

describe('buildReviewerNodes (PAN-830)', () => {
  it('returns [] when extended (convoy) review is disabled — quick mode hides phantom lanes (PAN-1981)', async () => {
    isExtendedReviewEnabledMock.mockReturnValue(false);
    const nodes = await buildReviewerNodes({
      issueId: ISSUE_ID,
      projectKey: PROJECT_KEY,
      workspacePath: WORKSPACE_PATH,
      tmuxSessionNames: new Set(),
      startedAt: '2026-01-01T00:00:00Z',
      status: 'completed',
      agentsDirOverride: agentsDir,
    });
    expect(nodes).toEqual([]);
    expect(isExtendedReviewEnabledMock).toHaveBeenCalledWith(ISSUE_ID);
  });

  it('returns exactly four convoy nodes without a synthesis child', async () => {
    const nodes = await buildReviewerNodes({
      issueId: ISSUE_ID,
      projectKey: PROJECT_KEY,
      workspacePath: WORKSPACE_PATH,
      tmuxSessionNames: new Set(),
      startedAt: '2026-01-01T00:00:00Z',
      status: 'completed',
      agentsDirOverride: agentsDir,
    });

    expect(nodes).toHaveLength(4);
    expect(nodes.map(n => n.role)).toEqual(['correctness', 'security', 'performance', 'requirements']);
    expect(nodes.every(n => n.type === 'reviewer')).toBe(true);
    expect(nodes.every(n => n.model === 'specialist')).toBe(true);
  });

  it('uses canonical session IDs for each role', async () => {
    const nodes = await buildReviewerNodes({
      issueId: ISSUE_ID,
      projectKey: PROJECT_KEY,
      workspacePath: WORKSPACE_PATH,
      tmuxSessionNames: new Set(),
      startedAt: '2026-01-01T00:00:00Z',
      status: 'completed',
      agentsDirOverride: agentsDir,
    });

    for (const node of nodes) {
      expect(node.sessionId).toBe(getReviewerSessionName(node.role, PROJECT_KEY, ISSUE_ID));
    }
  });

  it('marks presence "active" when tmux live and parent status running', async () => {
    const liveSet = new Set<string>(REVIEWER_ROLES.map(r => getReviewerSessionName(r, PROJECT_KEY, ISSUE_ID)));

    const nodes = await buildReviewerNodes({
      issueId: ISSUE_ID,
      projectKey: PROJECT_KEY,
      workspacePath: WORKSPACE_PATH,
      tmuxSessionNames: liveSet,
      startedAt: '2026-01-01T00:00:00Z',
      status: 'running',
      agentsDirOverride: agentsDir,
    });

    expect(nodes.every(n => n.presence === 'active')).toBe(true);
  });

  it('marks presence "idle" when tmux live but parent status not running', async () => {
    const liveSet = new Set<string>(REVIEWER_ROLES.map(r => getReviewerSessionName(r, PROJECT_KEY, ISSUE_ID)));

    const nodes = await buildReviewerNodes({
      issueId: ISSUE_ID,
      projectKey: PROJECT_KEY,
      workspacePath: WORKSPACE_PATH,
      tmuxSessionNames: liveSet,
      startedAt: '2026-01-01T00:00:00Z',
      status: 'completed',
      agentsDirOverride: agentsDir,
    });

    expect(nodes.every(n => n.presence === 'idle')).toBe(true);
  });

  it('marks presence "ended" when no tmux session exists', async () => {
    const nodes = await buildReviewerNodes({
      issueId: ISSUE_ID,
      projectKey: PROJECT_KEY,
      workspacePath: WORKSPACE_PATH,
      tmuxSessionNames: new Set(),
      startedAt: '2026-01-01T00:00:00Z',
      status: 'completed',
      agentsDirOverride: agentsDir,
    });

    expect(nodes.every(n => n.presence === 'ended')).toBe(true);
  });

  it('uses round metadata latestStatus when available', async () => {
    const correctness = getReviewerSessionName('correctness', PROJECT_KEY, ISSUE_ID);
    await mkdir(join(agentsDir, correctness), { recursive: true });
    await writeFile(
      join(agentsDir, correctness, 'round-1.json'),
      JSON.stringify({ round: 1, status: 'failed', success: false }),
    );

    const nodes = await buildReviewerNodes({
      issueId: ISSUE_ID,
      projectKey: PROJECT_KEY,
      workspacePath: WORKSPACE_PATH,
      tmuxSessionNames: new Set(),
      startedAt: '2026-01-01T00:00:00Z',
      status: 'completed',
      agentsDirOverride: agentsDir,
    });

    const correctnessNode = nodes.find(n => n.role === 'correctness')!;
    expect(correctnessNode.status).toBe('error');
    expect(correctnessNode.roundMetadata).toBeDefined();
    expect(correctnessNode.roundMetadata!.latestRound).toBe(1);
    expect(correctnessNode.roundMetadata!.roundCount).toBe(1);

    // Other roles fall back to parent status
    const security = nodes.find(n => n.role === 'security')!;
    expect(security.status).toBe('stopped');
    expect(security.roundMetadata).toBeUndefined();
  });

  it('marks a finished sub-reviewer completed once its report lands, not the orchestrator status', async () => {
    // PAN-1048 sub-reviewers are subagents with no tmux. A finished one must
    // not inherit the orchestrator's "running" status (which left it showing
    // "working" with no terminal). The report .md is the authoritative signal.
    const workspacePath = join(testDir, 'workspaces', `feature-${ISSUE_ID}`);
    const reviewRunDir = join(workspacePath, '.pan', 'review', `review-${ISSUE_ID.toUpperCase()}-1700000099999`);
    await mkdir(reviewRunDir, { recursive: true });
    await writeFile(join(reviewRunDir, 'correctness.md'), '# correctness review');

    const nodes = await buildReviewerNodes({
      issueId: ISSUE_ID,
      projectKey: PROJECT_KEY,
      workspacePath,
      tmuxSessionNames: new Set(), // no tmux — subagent
      startedAt: '2026-01-01T00:00:00Z',
      status: 'running', // orchestrator still synthesizing
      agentsDirOverride: agentsDir,
    });

    // Report landed → done ('completed' normalizes to 'stopped'), terminal gone.
    const correctness = nodes.find(n => n.role === 'correctness')!;
    expect(correctness.status).toBe('stopped');
    expect(correctness.presence).toBe('ended');

    // A role whose report has NOT landed still reflects the orchestrator status.
    const security = nodes.find(n => n.role === 'security')!;
    expect(security.status).toBe('running');
  });

  it('reads synthesis round metadata separately for the parent review node', async () => {
    const synthesis = getReviewerSessionName('synthesis', PROJECT_KEY, ISSUE_ID);
    await mkdir(join(agentsDir, synthesis), { recursive: true });
    await writeFile(join(agentsDir, synthesis, 'round-2.json'),
      JSON.stringify({ round: 2, status: 'completed', success: true }));
    await writeFile(join(agentsDir, synthesis, 'round-1.json'),
      JSON.stringify({ round: 1, status: 'failed', success: false }));

    const metadata = await readSynthesisRounds(ISSUE_ID, PROJECT_KEY, agentsDir);

    expect(metadata!.roundCount).toBe(2);
    expect(metadata!.latestRound).toBe(2);
    expect(metadata!.history.map(h => h.round)).toEqual([1, 2]);
    expect(metadata!.history.map(h => h.status)).toEqual(['failed', 'completed']);
  });

  it('omits synthesis from child nodes', async () => {
    const synthesis = getReviewerSessionName('synthesis', PROJECT_KEY, ISSUE_ID);
    await mkdir(join(agentsDir, synthesis), { recursive: true });
    await writeFile(join(agentsDir, synthesis, 'round-1.json'),
      JSON.stringify({ round: 1, status: 'completed', success: true }));

    const nodes = await buildReviewerNodes({
      issueId: ISSUE_ID,
      projectKey: PROJECT_KEY,
      workspacePath: WORKSPACE_PATH,
      tmuxSessionNames: new Set(),
      startedAt: '2026-01-01T00:00:00Z',
      status: 'completed',
      agentsDirOverride: agentsDir,
    });

    expect(nodes.find(n => n.role === 'synthesis')).toBeUndefined();
  });

  it('computes duration from startedAt/endedAt', async () => {
    const nodes = await buildReviewerNodes({
      issueId: ISSUE_ID,
      projectKey: PROJECT_KEY,
      workspacePath: WORKSPACE_PATH,
      tmuxSessionNames: new Set(),
      startedAt: '2026-01-01T00:00:00Z',
      endedAt: '2026-01-01T00:01:00Z',
      status: 'completed',
      agentsDirOverride: agentsDir,
    });

    expect(nodes.every(n => n.duration === 60)).toBe(true);
    expect(nodes.every(n => n.endedAt === '2026-01-01T00:01:00Z')).toBe(true);
  });

  it('returns null duration when endedAt missing', async () => {
    const nodes = await buildReviewerNodes({
      issueId: ISSUE_ID,
      projectKey: PROJECT_KEY,
      workspacePath: WORKSPACE_PATH,
      tmuxSessionNames: new Set(),
      startedAt: '2026-01-01T00:00:00Z',
      status: 'running',
      agentsDirOverride: agentsDir,
    });

    expect(nodes.every(n => n.duration === null)).toBe(true);
    expect(nodes.every(n => n.endedAt === undefined)).toBe(true);
  });

  it('uses per-reviewer stoppedAt (via getAgentStateSync) instead of parent endedAt', async () => {
    // Sub-reviewer finished early, parent (synthesizer) still active.
    // Without per-node endedAt, the frontend renders "Starting…" over the JSONL.
    const correctness = getReviewerSessionName('correctness', PROJECT_KEY, ISSUE_ID);
    // PAN-1938: stoppedAt now read via getAgentStateSync (overdeck DB), not state.json directly.
    vi.mocked(getAgentStateSync).mockImplementation((id) =>
      id === correctness
        ? { id: correctness, issueId: ISSUE_ID, role: 'review', model: 'sonnet', status: 'stopped', startedAt: '2026-01-01T00:00:00Z', workspace: WORKSPACE_PATH, stoppedAt: '2026-01-01T00:05:00Z' } as any
        : null,
    );

    const nodes = await buildReviewerNodes({
      issueId: ISSUE_ID,
      projectKey: PROJECT_KEY,
      workspacePath: WORKSPACE_PATH,
      tmuxSessionNames: new Set(), // sub-reviewer's tmux is dead
      startedAt: '2026-01-01T00:00:00Z',
      // No endedAt — parent review section is still running.
      status: 'running',
      agentsDirOverride: agentsDir,
    });

    const correctnessNode = nodes.find(n => n.role === 'correctness')!;
    expect(correctnessNode.endedAt).toBe('2026-01-01T00:05:00Z');
    expect(correctnessNode.duration).toBe(300);

    // Other roles without their own state.json fall through to parent's
    // (undefined) endedAt — still acceptable because they'll be backfilled
    // on the next poll once they finish.
    const security = nodes.find(n => n.role === 'security')!;
    expect(security.endedAt).toBeUndefined();
  });

  it('falls back to latest round endedAt when state.json is missing', async () => {
    const correctness = getReviewerSessionName('correctness', PROJECT_KEY, ISSUE_ID);
    await mkdir(join(agentsDir, correctness), { recursive: true });
    await writeFile(
      join(agentsDir, correctness, 'round-1.json'),
      JSON.stringify({
        round: 1,
        status: 'completed',
        success: true,
        endedAt: '2026-01-01T00:07:00Z',
      }),
    );

    const nodes = await buildReviewerNodes({
      issueId: ISSUE_ID,
      projectKey: PROJECT_KEY,
      workspacePath: WORKSPACE_PATH,
      tmuxSessionNames: new Set(),
      startedAt: '2026-01-01T00:00:00Z',
      status: 'running',
      agentsDirOverride: agentsDir,
    });

    const correctnessNode = nodes.find(n => n.role === 'correctness')!;
    expect(correctnessNode.endedAt).toBe('2026-01-01T00:07:00Z');
  });

  it('keeps endedAt undefined for a genuinely live reviewer', async () => {
    // A live, non-zombie reviewer should never inherit a stoppedAt from a
    // stale state.json — sessionAlive drives the UI in that case.
    const correctness = getReviewerSessionName('correctness', PROJECT_KEY, ISSUE_ID);
    await mkdir(join(agentsDir, correctness), { recursive: true });
    await writeFile(
      join(agentsDir, correctness, 'state.json'),
      JSON.stringify({
        id: correctness,
        status: 'running',
        startedAt: '2026-01-01T00:00:00Z',
        stoppedAt: '2026-01-01T00:05:00Z', // stale — process is actually live
      }),
    );

    const nodes = await buildReviewerNodes({
      issueId: ISSUE_ID,
      projectKey: PROJECT_KEY,
      workspacePath: WORKSPACE_PATH,
      tmuxSessionNames: new Set([correctness]),
      startedAt: '2026-01-01T00:00:00Z',
      status: 'running',
      agentsDirOverride: agentsDir,
    });

    const correctnessNode = nodes.find(n => n.role === 'correctness')!;
    expect(correctnessNode.endedAt).toBeUndefined();
    expect(correctnessNode.presence).toBe('active');
  });

  it('hasJsonl is false when no JSONL transcript resolves', async () => {
    const nodes = await buildReviewerNodes({
      issueId: ISSUE_ID,
      projectKey: PROJECT_KEY,
      workspacePath: WORKSPACE_PATH,
      tmuxSessionNames: new Set(),
      startedAt: '2026-01-01T00:00:00Z',
      status: 'completed',
      agentsDirOverride: agentsDir,
    });

    expect(nodes.every(n => n.hasJsonl === false)).toBe(true);
  });

  // ─── PAN-915: in-progress round disambiguates from completed-zombie ─────
  describe('PAN-915 in-progress round detection', () => {
    it('reports running when session is alive, prior round archived as completed, AND a newer review-run dir exists with no output file yet', async () => {
      const correctness = getReviewerSessionName('correctness', PROJECT_KEY, ISSUE_ID);
      // Archive a prior round as completed (would normally trigger zombie)
      await mkdir(join(agentsDir, correctness), { recursive: true });
      await writeFile(
        join(agentsDir, correctness, 'round-1.json'),
        JSON.stringify({ round: 1, status: 'completed', success: true }),
      );

      // Spin up a workspace dir with a NEW round folder but no <role>.md yet
      const workspacePath = join(testDir, 'workspaces', `feature-${ISSUE_ID}`);
      const reviewRunDir = join(workspacePath, '.pan', 'review', `review-${ISSUE_ID.toUpperCase()}-1700000099999`);
      await mkdir(reviewRunDir, { recursive: true });

      const liveSet = new Set<string>([correctness]);

      const nodes = await buildReviewerNodes({
        issueId: ISSUE_ID,
        projectKey: PROJECT_KEY,
        workspacePath,
        tmuxSessionNames: liveSet,
        startedAt: '2026-01-01T00:00:00Z',
        status: 'completed',
        agentsDirOverride: agentsDir,
      });

      const node = nodes.find(n => n.role === 'correctness')!;
      expect(node.status).toBe('running');
      expect(node.presence).toBe('active');
      expect(node.tmuxSession).toBe(correctness);
    });

    it('reports zombie (idle) when session alive, prior round completed, AND output file already exists in latest run dir', async () => {
      const correctness = getReviewerSessionName('correctness', PROJECT_KEY, ISSUE_ID);
      await mkdir(join(agentsDir, correctness), { recursive: true });
      await writeFile(
        join(agentsDir, correctness, 'round-1.json'),
        JSON.stringify({ round: 1, status: 'completed', success: true }),
      );

      const workspacePath = join(testDir, 'workspaces', `feature-${ISSUE_ID}`);
      const reviewRunDir = join(workspacePath, '.pan', 'review', `review-${ISSUE_ID.toUpperCase()}-1700000099999`);
      await mkdir(reviewRunDir, { recursive: true });
      // Output file exists — round done, session is a zombie
      await writeFile(join(reviewRunDir, 'correctness.md'), '# done');

      const liveSet = new Set<string>([correctness]);

      const nodes = await buildReviewerNodes({
        issueId: ISSUE_ID,
        projectKey: PROJECT_KEY,
        workspacePath,
        tmuxSessionNames: liveSet,
        startedAt: '2026-01-01T00:00:00Z',
        status: 'completed',
        agentsDirOverride: agentsDir,
      });

      const node = nodes.find(n => n.role === 'correctness')!;
      // Falls back to archived round status (completed → 'stopped' via normalizeAgentStatus)
      expect(node.status).toBe('stopped');
      expect(node.presence).toBe('idle');
      expect(node.tmuxSession).toBeUndefined();
    });

    it('falls back to legacy zombie detection when no review-run dir exists in workspace', async () => {
      const correctness = getReviewerSessionName('correctness', PROJECT_KEY, ISSUE_ID);
      await mkdir(join(agentsDir, correctness), { recursive: true });
      await writeFile(
        join(agentsDir, correctness, 'round-1.json'),
        JSON.stringify({ round: 1, status: 'completed', success: true }),
      );

      const liveSet = new Set<string>([correctness]);

      // No .pan/review dir exists — workspacePath has no review history.
      // The role should still be treated as a zombie (matches pre-PAN-915 behavior).
      const nodes = await buildReviewerNodes({
        issueId: ISSUE_ID,
        projectKey: PROJECT_KEY,
        workspacePath: join(testDir, 'workspaces', 'no-review-history'),
        tmuxSessionNames: liveSet,
        startedAt: '2026-01-01T00:00:00Z',
        status: 'completed',
        agentsDirOverride: agentsDir,
      });

      const node = nodes.find(n => n.role === 'correctness')!;
      expect(node.status).toBe('stopped');
      expect(node.presence).toBe('idle');
      expect(node.tmuxSession).toBeUndefined();
    });
  });
});
