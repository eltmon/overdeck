/**
 * Tests for coderabbit-ingestion.ts (PAN-2374)
 */
import { exec } from 'node:child_process';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  fetchCodeRabbitFindings,
  fetchPullRequestSettlementFacts,
  type CodeRabbitFinding,
  type GhRunner,
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


describe('fetchPullRequestSettlementFacts (PAN-5218)', () => {
  const SINCE = '2026-11-13T21:00:00Z';
  const commitList = [
    { sha: 'later', date: '2026-11-13T21:05:00Z', parents: 1 },
    { sha: 'merge', date: '2026-11-13T21:06:00Z', parents: 2 },
    { sha: 'earlier', date: '2026-11-13T20:55:00Z', parents: 1 },
    { sha: 'later2', date: '2026-11-13T21:07:00Z', parents: 1 },
  ].map((row) => JSON.stringify(row)).join('\n');
  const replies = [
    { in_reply_to_id: 11, login: 'eltmon' },
    { in_reply_to_id: 12, login: 'coderabbitai[bot]' },
    { in_reply_to_id: 11, login: 'overdeck-agent[bot]' },
  ].map((row) => JSON.stringify(row)).join('\n');

  function fakeGh(overrides: Record<string, () => Promise<string>> = {}): GhRunner & ReturnType<typeof vi.fn> {
    return vi.fn(async (args: string[]) => {
      const path = args.find((arg) => arg.startsWith('repos/')) ?? '';
      for (const [key, respond] of Object.entries(overrides)) if (path.includes(key)) return respond();
      if (path.includes('/pulls/42/commits')) return commitList;
      if (path.includes('/pulls/42/comments')) return replies;
      if (path.endsWith('/commits/later')) return JSON.stringify(['src/a.ts']);
      if (path.endsWith('/commits/later2')) return JSON.stringify(['src/b.ts', 'src/c.ts']);
      throw new Error(`unexpected gh call: ${args.join(' ')}`);
    }) as GhRunner & ReturnType<typeof vi.fn>;
  }

  it('keeps only later single-parent commits, with files from their commit reads', async () => {
    const gh = fakeGh();
    const facts = await fetchPullRequestSettlementFacts('eltmon/overdeck', 42, SINCE, gh);
    expect(facts.commits).toEqual([
      { sha: 'later', committedAt: '2026-11-13T21:05:00Z', files: ['src/a.ts'] },
      { sha: 'later2', committedAt: '2026-11-13T21:07:00Z', files: ['src/b.ts', 'src/c.ts'] },
    ]);
    const reads = gh.mock.calls.map(([args]) => (args as string[]).find((arg) => arg.startsWith('repos/')));
    expect(reads).not.toContain('repos/eltmon/overdeck/commits/merge');
    expect(reads).not.toContain('repos/eltmon/overdeck/commits/earlier');
  });

  it('gives files: null for a commit whose read failed, and keeps the others', async () => {
    const facts = await fetchPullRequestSettlementFacts('eltmon/overdeck', 42, SINCE, fakeGh({
      '/commits/later2': async () => { throw new Error('gh: 502'); },
    }));
    expect(facts.commits).toEqual([
      { sha: 'later', committedAt: '2026-11-13T21:05:00Z', files: ['src/a.ts'] },
      { sha: 'later2', committedAt: '2026-11-13T21:07:00Z', files: null },
    ]);
  });

  it('leaves out CodeRabbit self-replies', async () => {
    const facts = await fetchPullRequestSettlementFacts('eltmon/overdeck', 42, SINCE, fakeGh());
    expect(facts.repliedThreadIds).toEqual([11]);
  });

  it('gives repliedThreadIds: null when the comments read fails, while commits still return', async () => {
    const facts = await fetchPullRequestSettlementFacts('eltmon/overdeck', 42, SINCE, fakeGh({
      '/pulls/42/comments': async () => { throw new Error('gh: 502'); },
    }));
    expect(facts.repliedThreadIds).toBeNull();
    expect(facts.commits).toHaveLength(2);
  });

  it('gives commits: null when the commit list read fails', async () => {
    const facts = await fetchPullRequestSettlementFacts('eltmon/overdeck', 42, SINCE, fakeGh({
      '/pulls/42/commits': async () => { throw new Error('gh: 502'); },
    }));
    expect(facts.commits).toBeNull();
    expect(facts.repliedThreadIds).toEqual([11]);
  });
});
