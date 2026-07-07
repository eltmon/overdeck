/**
 * Tests for coderabbit-ingestion.ts (PAN-2374)
 */
import { exec } from 'node:child_process';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  fetchCodeRabbitFindings,
  postCodeRabbitReply,
  CODERABBIT_REPLY_ADDRESSED,
  CODERABBIT_REPLY_REJECTED,
  type CodeRabbitFinding,
} from '../../../../src/lib/cloister/coderabbit-ingestion.js';
import { lookupPullRequestNumberForBranch } from '../../../../src/lib/github-pr-lookup.js';
import { postPrComment } from '../../../../src/lib/cloister/review-verdict-feedback.js';

const { mockExec } = vi.hoisted(() => ({
  mockExec: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  mockExec[Symbol.for('nodejs.util.promisify.custom')] = mockExec;
  return {
    ...actual,
    exec: mockExec,
  };
});

vi.mock('../../../../src/lib/github-pr-lookup.js', () => ({
  lookupPullRequestNumberForBranch: vi.fn(),
}));

vi.mock('../../../../src/lib/cloister/review-verdict-feedback.js', () => ({
  postPrComment: vi.fn(),
}));

const mockLookupPullRequestNumberForBranch = vi.mocked(lookupPullRequestNumberForBranch);
const mockPostPrComment = vi.mocked(postPrComment);

function givenRepoView() {
  mockExec.mockImplementation((cmd: string) => {
    if (cmd.includes('gh repo view')) {
      return Promise.resolve({ stdout: JSON.stringify({ owner: { login: 'eltmon' }, name: 'overdeck' }), stderr: '' });
    }
    return Promise.resolve({ stdout: '[]', stderr: '' });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLookupPullRequestNumberForBranch.mockResolvedValue(42);
  mockPostPrComment.mockResolvedValue(true);
});

describe('fetchCodeRabbitFindings', () => {
  it('returns empty array when no CodeRabbit entries exist', async () => {
    givenRepoView();

    const result = await fetchCodeRabbitFindings({ workspace: '/tmp/ws', branch: 'feature/pan-2374' });

    expect(result).toEqual([]);
  });

  it('returns empty array and never throws when PR cannot be resolved', async () => {
    mockLookupPullRequestNumberForBranch.mockResolvedValue(null);
    givenRepoView();

    const result = await fetchCodeRabbitFindings({ workspace: '/tmp/ws', branch: 'feature/pan-2374' });

    expect(result).toEqual([]);
  });

  it('returns empty array and never throws when gh api rejects', async () => {
    mockExec.mockImplementation((cmd: string) => {
      if (cmd.includes('gh repo view')) {
        return Promise.resolve({ stdout: JSON.stringify({ owner: { login: 'eltmon' }, name: 'overdeck' }), stderr: '' });
      }
      return Promise.reject(new Error('network error'));
    });

    const result = await fetchCodeRabbitFindings({ workspace: '/tmp/ws', branch: 'feature/pan-2374' });

    expect(result).toEqual([]);
  });

  it('returns findings from coderabbitai[bot] reviews and inline comments', async () => {
    mockExec.mockImplementation((cmd: string) => {
      if (cmd.includes('gh repo view')) {
        return Promise.resolve({ stdout: JSON.stringify({ owner: { login: 'eltmon' }, name: 'overdeck' }), stderr: '' });
      }
      if (cmd.includes('/pulls/42/reviews')) {
        return Promise.resolve({
          stdout: JSON.stringify([
            { id: 1, user: { login: 'coderabbitai[bot]' }, body: 'Consider extracting this.', state: 'COMMENTED', html_url: 'https://github.com/eltmon/overdeck/pull/42#discussion_r1' },
            { id: 2, user: { login: 'coderabbitai[bot]' }, body: 'Dismissed finding', state: 'DISMISSED', html_url: 'https://github.com/eltmon/overdeck/pull/42#discussion_r2' },
          ]),
          stderr: '',
        });
      }
      if (cmd.includes('/pulls/42/comments')) {
        return Promise.resolve({
          stdout: JSON.stringify([
            { id: 10, user: { login: 'coderabbitai[bot]' }, body: 'Unused import.', path: 'src/lib/foo.ts', line: 7, html_url: 'https://github.com/eltmon/overdeck/pull/42#discussion_r10' },
          ]),
          stderr: '',
        });
      }
      return Promise.resolve({ stdout: '[]', stderr: '' });
    });

    const result = await fetchCodeRabbitFindings({ workspace: '/tmp/ws', branch: 'feature/pan-2374' });

    expect(result).toHaveLength(2);
    expect(result).toContainEqual<CodeRabbitFinding>({
      body: 'Consider extracting this.',
      url: 'https://github.com/eltmon/overdeck/pull/42#discussion_r1',
    });
    expect(result).toContainEqual<CodeRabbitFinding>({
      path: 'src/lib/foo.ts',
      line: 7,
      body: 'Unused import.',
      url: 'https://github.com/eltmon/overdeck/pull/42#discussion_r10',
    });
  });

  it('contains no execSync usage in the source file', async () => {
    // This assertion is structural: execSync would block the event loop and
    // violates the dashboard server async-only rule.
    const { readFile } = await import('node:fs/promises');
    const source = await readFile('src/lib/cloister/coderabbit-ingestion.ts', 'utf-8');
    expect(source).not.toMatch(/execSync/);
  });
});

describe('postCodeRabbitReply', () => {
  it('calls postPrComment with the addressed template', async () => {
    const prUrl = 'https://github.com/eltmon/overdeck/pull/42';
    const finding = 'Consider extracting this.';

    const result = await postCodeRabbitReply(prUrl, 'addressed', finding);

    expect(result).toBe(true);
    expect(mockPostPrComment).toHaveBeenCalledWith(prUrl, CODERABBIT_REPLY_ADDRESSED(finding));
    expect(mockPostPrComment).toHaveBeenCalledWith(prUrl, expect.stringContaining('addressed: Consider extracting this.'));
  });

  it('calls postPrComment with the rejected template including rationale', async () => {
    const prUrl = 'https://github.com/eltmon/overdeck/pull/42';
    const finding = 'Unused import.';
    const rationale = 'This import is used by the test harness.';

    const result = await postCodeRabbitReply(prUrl, 'rejected', finding, rationale);

    expect(result).toBe(true);
    expect(mockPostPrComment).toHaveBeenCalledWith(prUrl, CODERABBIT_REPLY_REJECTED(finding, rationale));
    expect(mockPostPrComment).toHaveBeenCalledWith(
      prUrl,
      expect.stringContaining("we're not applying this: Unused import.. Rationale: This import is used by the test harness."),
    );
  });

  it('returns false without throwing when postPrComment rejects', async () => {
    mockPostPrComment.mockRejectedValue(new Error('gh api failed'));

    const result = await postCodeRabbitReply(
      'https://github.com/eltmon/overdeck/pull/42',
      'addressed',
      'finding',
    );

    expect(result).toBe(false);
  });
});
