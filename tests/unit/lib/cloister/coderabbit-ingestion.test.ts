/**
 * Tests for coderabbit-ingestion.ts (PAN-2374)
 */
import { exec } from 'node:child_process';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchCodeRabbitFindings, type CodeRabbitFinding } from '../../../../src/lib/cloister/coderabbit-ingestion.js';
import { lookupPullRequestNumberForBranch } from '../../../../src/lib/github-pr-lookup.js';

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

const mockLookupPullRequestNumberForBranch = vi.mocked(lookupPullRequestNumberForBranch);

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
