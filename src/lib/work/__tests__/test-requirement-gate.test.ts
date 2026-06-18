import { exec } from 'child_process';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import {
  countTestDeltaInDiff,
  detectTestRequirements,
  fetchIssueBodyForGate,
  runTestRequirementCheck,
  TEST_FILE_PATTERN,
  TEST_REQUIREMENT_KEYWORDS,
  TrackerFetchError,
  type TestRequirement,
} from '../test-requirement-gate.js';
import { getLinearApiKey } from '../../shadow-utils.js';
import { LinearClient } from '@linear/sdk';
import { resolveGitHubIssueSync } from '../../tracker-utils.js';

beforeEach(() => {
  vi.resetAllMocks();
});

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('@linear/sdk', () => ({
  LinearClient: vi.fn(),
}));

vi.mock('../../tracker-utils.js', () => ({
  resolveGitHubIssueSync: vi.fn(),
}));

vi.mock('../../shadow-utils.js', () => ({
  getLinearApiKey: vi.fn(() => Promise.resolve('test-api-key')),
}));

describe('detectTestRequirements', () => {
  it('returns an empty array for empty, null, or undefined input (AC4)', () => {
    expect(detectTestRequirements('')).toEqual([]);
    expect(detectTestRequirements(null)).toEqual([]);
    expect(detectTestRequirements(undefined)).toEqual([]);
  });

  it('exports the exact keyword set the orchestrator and tests share (AC1/AC2)', () => {
    const keywords = TEST_REQUIREMENT_KEYWORDS.map((k) => k.keyword);
    expect(keywords).toEqual([
      'test',
      'regression test',
      'unit test',
      'Test:',
      '## Test plan',
      'vitest',
      'playwright',
    ]);
  });

  it('matches the bare word "test" case-insensitively (AC2)', () => {
    const results = detectTestRequirements('We need a test for this.');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject<TestRequirement>({
      keyword: 'test',
      line: 1,
      context: 'We need a test for this.',
    });
  });

  it('matches "regression test" (AC2)', () => {
    const results = detectTestRequirements('- [ ] Regression test for the retry bug');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.keyword === 'regression test')).toBe(true);
  });

  it('matches "unit test" (AC2)', () => {
    const results = detectTestRequirements('Add a unit test for the helper.');
    expect(results.some((r) => r.keyword === 'unit test')).toBe(true);
  });

  it('matches "Test:" (AC2)', () => {
    const results = detectTestRequirements('Test: ensure the guard blocks pan done.');
    expect(results.some((r) => r.keyword === 'Test:')).toBe(true);
  });

  it('matches "## Test plan" (AC2)', () => {
    const results = detectTestRequirements('## Test plan\n\n1. Run the unit tests.');
    expect(results.some((r) => r.keyword === '## Test plan')).toBe(true);
  });

  it('matches "vitest" (AC2)', () => {
    const results = detectTestRequirements('Add a vitest spec for the parser.');
    expect(results.some((r) => r.keyword === 'vitest')).toBe(true);
  });

  it('matches "playwright" (AC2)', () => {
    const results = detectTestRequirements('Add a Playwright flow for the login page.');
    expect(results.some((r) => r.keyword === 'playwright')).toBe(true);
  });

  it('reports multiple matches on the same line (AC2)', () => {
    const results = detectTestRequirements('Add a unit test and a playwright regression test.');
    const keywords = results.map((r) => r.keyword);
    expect(keywords).toContain('unit test');
    expect(keywords).toContain('playwright');
    expect(keywords).toContain('regression test');
  });

  it('reports accurate 1-indexed line numbers (AC5)', () => {
    const text = 'first line\nsecond line asks for a test\nthird line';
    const results = detectTestRequirements(text);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ keyword: 'test', line: 2, context: 'second line asks for a test' });
  });

  it('does not match "test" inside unrelated words (AC3)', () => {
    expect(detectTestRequirements('This is the latest version.')).toEqual([]);
    expect(detectTestRequirements('The issue is contested.')).toEqual([]);
    expect(detectTestRequirements('It has already been tested.')).toEqual([]);
  });
});

describe('TEST_FILE_PATTERN', () => {
  it('matches the four supported test-file suffixes', () => {
    expect(TEST_FILE_PATTERN.test('src/lib/foo.test.ts')).toBe(true);
    expect(TEST_FILE_PATTERN.test('src/lib/foo.spec.ts')).toBe(true);
    expect(TEST_FILE_PATTERN.test('src/lib/foo.test.tsx')).toBe(true);
    expect(TEST_FILE_PATTERN.test('src/lib/foo.spec.tsx')).toBe(true);
  });

  it('does not match non-test source files', () => {
    expect(TEST_FILE_PATTERN.test('src/lib/foo.ts')).toBe(false);
    expect(TEST_FILE_PATTERN.test('src/lib/foo.tsx')).toBe(false);
    expect(TEST_FILE_PATTERN.test('src/lib/foo.test.js')).toBe(false);
    expect(TEST_FILE_PATTERN.test('src/lib/foo.spec.js')).toBe(false);
  });
});

describe('countTestDeltaInDiff', () => {
  it('returns 0 for empty, null, or undefined input (AC5)', () => {
    expect(countTestDeltaInDiff('')).toBe(0);
    expect(countTestDeltaInDiff(null as unknown as string)).toBe(0);
    expect(countTestDeltaInDiff(undefined as unknown as string)).toBe(0);
  });

  it('sums additions for a single test file (AC2)', () => {
    const numstat = '42\t3\tsrc/lib/foo.test.ts';
    expect(countTestDeltaInDiff(numstat)).toBe(42);
  });

  it('sums additions across multiple test files (AC2)', () => {
    const numstat = [
      '10\t2\tsrc/lib/a.test.ts',
      '20\t4\tsrc/lib/b.spec.ts',
      '30\t6\tsrc/lib/c.test.tsx',
      '40\t8\tsrc/lib/d.spec.tsx',
    ].join('\n');
    expect(countTestDeltaInDiff(numstat)).toBe(100);
  });

  it('ignores non-test files (AC3)', () => {
    const numstat = [
      '10\t2\tsrc/lib/foo.ts',
      '20\t4\tsrc/lib/bar.tsx',
      '30\t6\tsrc/lib/baz.js',
    ].join('\n');
    expect(countTestDeltaInDiff(numstat)).toBe(0);
  });

  it('skips binary entries (AC4)', () => {
    const numstat = [
      '-\t-\timages/screenshot.png',
      '25\t1\tsrc/lib/foo.test.ts',
    ].join('\n');
    expect(countTestDeltaInDiff(numstat)).toBe(25);
  });

  it('tolerates malformed lines without throwing (AC5)', () => {
    const numstat = [
      '25\t1\tsrc/lib/foo.test.ts',
      'not-a-number',
      '',
      '5\t0\t',
      '10\t2\tsrc/lib/bar.test.ts',
    ].join('\n');
    expect(countTestDeltaInDiff(numstat)).toBe(35);
  });
});

describe('fetchIssueBodyForGate', () => {
  it('returns the GitHub issue body via gh issue view (AC1)', async () => {
    vi.mocked(resolveGitHubIssueSync).mockReturnValue({
      isGitHub: true,
      owner: 'eltmon',
      repo: 'overdeck',
      number: 1501,
    } as ReturnType<typeof resolveGitHubIssueSync>);

    vi.mocked(exec).mockImplementation(((cmd: string, optionsOrCallback: unknown, maybeCallback?: unknown) => {
      const callback = (typeof optionsOrCallback === 'function'
        ? optionsOrCallback
        : maybeCallback) as (err: Error | null, stdout: { stdout: string }, stderr: string) => void;
      callback(null, { stdout: 'GitHub body\n' }, '');
      return undefined as unknown as ReturnType<typeof exec>;
    }) as typeof exec);

    const body = await Effect.runPromise(fetchIssueBodyForGate('PAN-1501'));
    expect(body).toBe('GitHub body');
  });

  it('returns null when gh issue view fails (AC3)', async () => {
    vi.mocked(resolveGitHubIssueSync).mockReturnValue({
      isGitHub: true,
      owner: 'eltmon',
      repo: 'overdeck',
      number: 1501,
    } as ReturnType<typeof resolveGitHubIssueSync>);

    vi.mocked(exec).mockImplementation(((cmd: string, optionsOrCallback: unknown, maybeCallback?: unknown) => {
      const callback = (typeof optionsOrCallback === 'function'
        ? optionsOrCallback
        : maybeCallback) as (err: Error | null, stdout: { stdout: string }, stderr: string) => void;
      callback(new Error('gh not authenticated'), { stdout: '' }, '');
      return undefined as unknown as ReturnType<typeof exec>;
    }) as typeof exec);

    const body = await Effect.runPromise(fetchIssueBodyForGate('PAN-1501'));
    expect(body).toBeNull();
  });

  it('returns the Linear issue description (AC2)', async () => {
    vi.mocked(resolveGitHubIssueSync).mockReturnValue({ isGitHub: false } as ReturnType<typeof resolveGitHubIssueSync>);
    vi.mocked(getLinearApiKey).mockReturnValue(Effect.succeed('test-key'));

    const mockDescription = Promise.resolve('Linear description');
    const mockIssue = { description: mockDescription };
    vi.mocked(LinearClient).mockImplementation(
      function () {
        return {
          issues: vi.fn().mockResolvedValue({ nodes: [mockIssue] }),
        } as unknown as ReturnType<typeof LinearClient>;
      } as unknown as typeof LinearClient,
    );

    const body = await Effect.runPromise(fetchIssueBodyForGate('MIN-123'));
    expect(body).toBe('Linear description');
  });

  it('returns null when Linear API key is missing (AC3)', async () => {
    vi.mocked(resolveGitHubIssueSync).mockReturnValue({ isGitHub: false } as ReturnType<typeof resolveGitHubIssueSync>);
    vi.mocked(getLinearApiKey).mockReturnValue(Effect.succeed(null));

    const body = await Effect.runPromise(fetchIssueBodyForGate('MIN-123'));
    expect(body).toBeNull();
  });

  it('returns null when Linear issue is missing (AC3)', async () => {
    vi.mocked(resolveGitHubIssueSync).mockReturnValue({ isGitHub: false } as ReturnType<typeof resolveGitHubIssueSync>);
    vi.mocked(getLinearApiKey).mockReturnValue(Effect.succeed('test-key'));
    vi.mocked(LinearClient).mockImplementation(
      function () {
        return {
          issues: vi.fn().mockResolvedValue({ nodes: [] }),
        } as unknown as ReturnType<typeof LinearClient>;
      } as unknown as typeof LinearClient,
    );

    const body = await Effect.runPromise(fetchIssueBodyForGate('MIN-123'));
    expect(body).toBeNull();
  });

  it('fails with TrackerFetchError for an unparseable issue ID', async () => {
    vi.mocked(resolveGitHubIssueSync).mockReturnValue({ isGitHub: false } as ReturnType<typeof resolveGitHubIssueSync>);

    await expect(Effect.runPromise(fetchIssueBodyForGate('not-an-issue'))).rejects.toBeInstanceOf(
      TrackerFetchError,
    );
  });
});

function mockLinearIssue(description: string) {
  vi.mocked(resolveGitHubIssueSync).mockReturnValue({ isGitHub: false } as ReturnType<typeof resolveGitHubIssueSync>);
  vi.mocked(getLinearApiKey).mockReturnValue(Effect.succeed('test-key'));
  vi.mocked(LinearClient).mockImplementation(
    function () {
      return {
        issues: vi.fn().mockResolvedValue({
          nodes: [{ description: Promise.resolve(description) }],
        }),
      } as unknown as ReturnType<typeof LinearClient>;
    } as unknown as typeof LinearClient,
  );
}

describe('runTestRequirementCheck', () => {
  const workspacePath = '/tmp/pan-1501-workspace';

  it('returns [] immediately when a waiver reason is provided (AC1)', async () => {
    const result = await Effect.runPromise(
      runTestRequirementCheck(workspacePath, 'PAN-1501', 'covered by existing test at abc123'),
    );
    expect(result).toEqual([]);
  });

  it('returns [] when the issue body has no test-keyword matches (AC2)', async () => {
    mockLinearIssue('This is a feature with no qa mentions.');

    vi.mocked(exec).mockImplementation(((cmd: string, optionsOrCallback: unknown, maybeCallback?: unknown) => {
      const callback = (typeof optionsOrCallback === 'function'
        ? optionsOrCallback
        : maybeCallback) as (err: Error | null, stdout: { stdout: string }, stderr: string) => void;
      if (cmd.startsWith('git merge-base')) {
        callback(null, { stdout: 'abc123\n' }, '');
      } else if (cmd.startsWith('git diff --numstat')) {
        callback(null, { stdout: '10\t2\tsrc/lib/foo.ts\n' }, '');
      } else {
        callback(null, { stdout: '' }, '');
      }
      return undefined as unknown as ReturnType<typeof exec>;
    }) as typeof exec);

    const result = await Effect.runPromise(runTestRequirementCheck(workspacePath, 'MIN-123'));
    expect(result).toEqual([]);
  });

  it('returns failure lines when requirements match and no test lines were added (AC3)', async () => {
    mockLinearIssue('Add a unit test for the new helper.');

    vi.mocked(exec).mockImplementation(((cmd: string, optionsOrCallback: unknown, maybeCallback?: unknown) => {
      const callback = (typeof optionsOrCallback === 'function'
        ? optionsOrCallback
        : maybeCallback) as (err: Error | null, stdout: { stdout: string }, stderr: string) => void;
      if (cmd.startsWith('git merge-base')) {
        callback(null, { stdout: 'abc123\n' }, '');
      } else if (cmd.startsWith('git diff --numstat')) {
        callback(null, { stdout: '10\t2\tsrc/lib/foo.ts\n' }, '');
      } else {
        callback(null, { stdout: '' }, '');
      }
      return undefined as unknown as ReturnType<typeof exec>;
    }) as typeof exec);

    const result = await Effect.runPromise(runTestRequirementCheck(workspacePath, 'MIN-123'));
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((line) => line.includes('unit test'))).toBe(true);
    expect(result.some((line) => line.includes('--test-waived'))).toBe(true);
    expect(result.some((line) => line.includes('Add tests'))).toBe(true);
  });

  it('returns [] when requirements match but test lines were added (AC3)', async () => {
    mockLinearIssue('Add a unit test for the new helper.');

    vi.mocked(exec).mockImplementation(((cmd: string, optionsOrCallback: unknown, maybeCallback?: unknown) => {
      const callback = (typeof optionsOrCallback === 'function'
        ? optionsOrCallback
        : maybeCallback) as (err: Error | null, stdout: { stdout: string }, stderr: string) => void;
      if (cmd.startsWith('git merge-base')) {
        callback(null, { stdout: 'abc123\n' }, '');
      } else if (cmd.startsWith('git diff --numstat')) {
        callback(null, { stdout: '10\t2\tsrc/lib/foo.test.ts\n' }, '');
      } else {
        callback(null, { stdout: '' }, '');
      }
      return undefined as unknown as ReturnType<typeof exec>;
    }) as typeof exec);

    const result = await Effect.runPromise(runTestRequirementCheck(workspacePath, 'MIN-123'));
    expect(result).toEqual([]);
  });

  it('soft-fails with [] when the tracker is unreachable or unauthenticated (AC4)', async () => {
    vi.mocked(resolveGitHubIssueSync).mockReturnValue({ isGitHub: false } as ReturnType<typeof resolveGitHubIssueSync>);
    vi.mocked(getLinearApiKey).mockReturnValue(Effect.succeed(null));

    const result = await Effect.runPromise(runTestRequirementCheck(workspacePath, 'MIN-123'));
    expect(result).toEqual([]);
  });

  it('soft-fails with [] when git merge-base and fallback both fail (AC5)', async () => {
    mockLinearIssue('Add a unit test for the new helper.');

    vi.mocked(exec).mockImplementation(((cmd: string, optionsOrCallback: unknown, maybeCallback?: unknown) => {
      const callback = (typeof optionsOrCallback === 'function'
        ? optionsOrCallback
        : maybeCallback) as (err: Error | null, stdout: { stdout: string }, stderr: string) => void;
      callback(new Error('git failed'), { stdout: '' }, '');
      return undefined as unknown as ReturnType<typeof exec>;
    }) as typeof exec);

    const result = await Effect.runPromise(runTestRequirementCheck(workspacePath, 'MIN-123'));
    expect(result).toEqual([]);
  });
});
