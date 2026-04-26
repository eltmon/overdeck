import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { archiveReviewerRound, type ReviewerRoundArtifact } from '../review-agent.js';
import { getReviewerSessionName } from '../specialists.js';

const ISSUE_ID = 'pan-830';
const PROJECT_KEY = 'panopticon';
const ROLES = ['correctness', 'security', 'performance', 'requirements'] as const;

let testAgentsDir: string;

beforeEach(async () => {
  testAgentsDir = join(tmpdir(), `pan-archive-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(testAgentsDir, { recursive: true });
  for (const role of [...ROLES, 'synthesis']) {
    const dir = join(testAgentsDir, getReviewerSessionName(role, PROJECT_KEY, ISSUE_ID));
    await mkdir(dir, { recursive: true });
  }
});

afterEach(async () => {
  await rm(testAgentsDir, { recursive: true, force: true });
});

describe('archiveReviewerRound (PAN-830)', () => {
  it('writes round-1.json to every reviewer + synthesis state dir on first call', async () => {
    await archiveReviewerRound({
      projectKey: PROJECT_KEY,
      issueId: ISSUE_ID,
      agents: ROLES.map(name => ({ name })),
      reviewId: 'review-pan-830-1714000000',
      outputDir: '/tmp/fake-output',
      reviewerResults: ROLES.map(role => ({
        role,
        status: 'completed' as const,
        outputFile: `/tmp/fake-output/${role}.md`,
      })),
      result: {
        success: true,
        reviewResult: 'APPROVED',
      },
      agentsDirOverride: testAgentsDir,
    });

    for (const role of [...ROLES, 'synthesis']) {
      const sessionDir = join(testAgentsDir, getReviewerSessionName(role, PROJECT_KEY, ISSUE_ID));
      const entries = await readdir(sessionDir);
      expect(entries).toContain('round-1.json');
      const raw = await readFile(join(sessionDir, 'round-1.json'), 'utf-8');
      const parsed = JSON.parse(raw) as ReviewerRoundArtifact;
      expect(parsed.round).toBe(1);
      expect(parsed.role).toBe(role);
      expect(parsed.issueId).toBe(ISSUE_ID);
      expect(parsed.projectKey).toBe(PROJECT_KEY);
      expect(parsed.reviewResult).toBe('APPROVED');
      expect(parsed.success).toBe(true);
    }
  });

  it('increments round number on subsequent calls', async () => {
    const callOnce = () =>
      archiveReviewerRound({
        projectKey: PROJECT_KEY,
        issueId: ISSUE_ID,
        agents: ROLES.map(name => ({ name })),
        reviewId: 'review-pan-830-x',
        outputDir: '/tmp/fake-output',
        reviewerResults: ROLES.map(role => ({
          role,
          status: 'completed' as const,
          outputFile: `/tmp/fake-output/${role}.md`,
        })),
        result: { success: false, reviewResult: 'CHANGES_REQUESTED' },
        agentsDirOverride: testAgentsDir,
      });

    await callOnce();
    await callOnce();
    await callOnce();

    for (const role of [...ROLES, 'synthesis']) {
      const sessionDir = join(testAgentsDir, getReviewerSessionName(role, PROJECT_KEY, ISSUE_ID));
      const entries = await readdir(sessionDir);
      const roundFiles = entries.filter(f => /^round-\d+\.json$/.test(f));
      expect(roundFiles.sort()).toEqual(['round-1.json', 'round-2.json', 'round-3.json']);
    }
  });

  it('does NOT delete the reviewer state dirs (PAN-830 guarantees lifetime)', async () => {
    const sessionDir = join(testAgentsDir, getReviewerSessionName('correctness', PROJECT_KEY, ISSUE_ID));
    await writeFile(join(sessionDir, 'state.json'), '{"claudeSessionId":"abc"}');

    await archiveReviewerRound({
      projectKey: PROJECT_KEY,
      issueId: ISSUE_ID,
      agents: [{ name: 'correctness' }],
      reviewId: 'review-pan-830-y',
      outputDir: '/tmp/fake-output',
      reviewerResults: [{ role: 'correctness', status: 'failed', outputFile: '/tmp/fake-output/correctness.md' }],
      result: { success: false, reviewResult: 'COMMENTED' },
      agentsDirOverride: testAgentsDir,
    });

    const entries = await readdir(sessionDir);
    expect(entries).toContain('state.json');
    expect(entries).toContain('round-1.json');
    const stateRaw = await readFile(join(sessionDir, 'state.json'), 'utf-8');
    expect(JSON.parse(stateRaw).claudeSessionId).toBe('abc');
  });

  it('skips state dirs that do not exist (no error thrown)', async () => {
    await rm(
      join(testAgentsDir, getReviewerSessionName('synthesis', PROJECT_KEY, ISSUE_ID)),
      { recursive: true, force: true },
    );

    await expect(
      archiveReviewerRound({
        projectKey: PROJECT_KEY,
        issueId: ISSUE_ID,
        agents: ROLES.map(name => ({ name })),
        reviewId: 'review-pan-830-z',
        outputDir: '/tmp/fake-output',
        reviewerResults: ROLES.map(role => ({
          role,
          status: 'completed' as const,
          outputFile: `/tmp/fake-output/${role}.md`,
        })),
        result: { success: true, reviewResult: 'APPROVED' },
        agentsDirOverride: testAgentsDir,
      }),
    ).resolves.not.toThrow();

    for (const role of ROLES) {
      const dir = join(testAgentsDir, getReviewerSessionName(role, PROJECT_KEY, ISSUE_ID));
      const entries = await readdir(dir);
      expect(entries).toContain('round-1.json');
    }
  });

  it('reports synthesis status from result.success when reviewerResults has none for synthesis', async () => {
    await archiveReviewerRound({
      projectKey: PROJECT_KEY,
      issueId: ISSUE_ID,
      agents: ROLES.map(name => ({ name })),
      reviewId: 'review-pan-830-w',
      outputDir: '/tmp/fake-output',
      reviewerResults: ROLES.map(role => ({
        role,
        status: 'completed' as const,
        outputFile: `/tmp/fake-output/${role}.md`,
      })),
      result: { success: false, reviewResult: 'CHANGES_REQUESTED' },
      agentsDirOverride: testAgentsDir,
    });

    const synthDir = join(testAgentsDir, getReviewerSessionName('synthesis', PROJECT_KEY, ISSUE_ID));
    const raw = await readFile(join(synthDir, 'round-1.json'), 'utf-8');
    const parsed = JSON.parse(raw) as ReviewerRoundArtifact;
    expect(parsed.status).toBe('failed');
    expect(parsed.role).toBe('synthesis');
  });
});
