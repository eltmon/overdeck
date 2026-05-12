/**
 * Tests for review-context.ts (PAN-1059)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'path';

// ── fs/promises mocks ──────────────────────────────────────────────────────
const mockMkdir = vi.fn(async () => {});
const mockWriteFile = vi.fn(async () => {});
const mockReadFile = vi.fn(async () => '');

vi.mock('fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

// ── fs (sync) mocks ────────────────────────────────────────────────────────
const mockExistsSync = vi.fn(() => false);
vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

// ── child_process mock ─────────────────────────────────────────────────────
const mockExecAsync = vi.fn();
vi.mock('child_process', () => ({
  exec: vi.fn((cmd: string, opts: unknown, cb: unknown) => {
    // promisify calls exec(cmd, opts, callback)
    const callback = typeof opts === 'function' ? opts : cb;
    mockExecAsync(cmd).then(
      (result: { stdout: string; stderr: string }) => (callback as Function)(null, result),
      (err: Error) => (callback as Function)(err),
    );
    return { on: vi.fn() };
  }),
}));

// ── vbrief / config mocks ──────────────────────────────────────────────────
vi.mock('../../vbrief/io.js', () => ({
  findPlan: vi.fn(() => null),
  readPlanAsync: vi.fn(async () => {
    throw new Error('no plan');
  }),
}));
vi.mock('../../vbrief/lifecycle-io.js', () => ({
  findVBriefByIssue: vi.fn(() => null),
}));
vi.mock('../../config.js', () => ({
  getDevrootPath: vi.fn(() => null),
}));

// ── import after mocks ─────────────────────────────────────────────────────
import { buildReviewContext } from '../review-context.js';

// ── helpers ────────────────────────────────────────────────────────────────
function mockGitOutput(map: Record<string, { stdout: string; stderr?: string }>) {
  mockExecAsync.mockImplementation(async (cmd: string) => {
    for (const [key, val] of Object.entries(map)) {
      if (cmd.includes(key)) return { stdout: val.stdout, stderr: val.stderr ?? '' };
    }
    throw new Error(`Unexpected exec: ${cmd}`);
  });
}

describe('buildReviewContext', () => {
  const workspace = '/tmp/fake-workspace';
  const runId = 'agent-pan-1059-review-abc12345';
  const issueId = 'PAN-1059';

  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockImplementation((p: string) => p === workspace);
  });

  it('throws when workspace does not exist', async () => {
    mockExistsSync.mockReturnValue(false);

    await expect(buildReviewContext({ runId, issueId, workspace })).rejects.toThrow(
      'Workspace directory does not exist',
    );
  });

  it('runs git commands and writes manifest to correct path', async () => {
    mockGitOutput({
      'rev-parse HEAD': { stdout: 'abc12345def67890\n' },
      'branch --show-current': { stdout: 'feature-pan-1059\n' },
      'merge-base origin/main HEAD': { stdout: 'deadbeef\n' },
      '--name-status': { stdout: 'M\tsrc/lib/foo.ts\nA\tsrc/lib/bar.ts\n' },
      '--numstat': { stdout: '10\t2\tsrc/lib/foo.ts\n5\t0\tsrc/lib/bar.ts\n' },
      'diff --stat': { stdout: '2 files changed, 15 insertions(+), 2 deletions(-)\n' },
      'diff "deadbeef"...HEAD\n': { stdout: '+some diff content\n' },
      'git diff "deadbeef"...HEAD': { stdout: '+some diff content\n' },
    });

    const manifest = await buildReviewContext({ runId, issueId, workspace });

    expect(mockMkdir).toHaveBeenCalledWith(
      join(workspace, '.pan', 'review', runId),
      { recursive: true },
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      join(workspace, '.pan', 'review', runId, 'context.json'),
      expect.any(String),
      'utf-8',
    );
    expect(manifest.runId).toBe(runId);
    expect(manifest.issueId).toBe(issueId);
    expect(manifest.headSha).toBe('abc12345def67890');
    expect(manifest.changedFiles).toHaveLength(2);
    expect(manifest.manifestPath).toBe(join(workspace, '.pan', 'review', runId, 'context.json'));
  });

  it('sorts changed files by risk score descending', async () => {
    mockGitOutput({
      'rev-parse HEAD': { stdout: 'abc12345\n' },
      'branch --show-current': { stdout: 'main\n' },
      'merge-base origin/main HEAD': { stdout: 'base\n' },
      '--name-status': {
        stdout: [
          'M\tsrc/auth/token.ts',   // HIGH risk
          'A\tsrc/README.md',       // LOW risk
          'M\tsrc/api/routes.ts',   // MED risk
        ].join('\n') + '\n',
      },
      '--numstat': { stdout: '' },
      'diff --stat': { stdout: '' },
      'git diff "base"...HEAD': { stdout: '' },
    });

    const manifest = await buildReviewContext({ runId, issueId, workspace });

    expect(manifest.changedFiles[0].path).toBe('src/auth/token.ts');   // HIGH=5
    expect(manifest.changedFiles[1].path).toBe('src/api/routes.ts');   // MED=3
    expect(manifest.changedFiles[2].path).toBe('src/README.md');       // LOW=1
  });

  it('truncates diff at 128 KB', async () => {
    const bigDiff = 'x'.repeat(200 * 1024);
    mockGitOutput({
      'rev-parse HEAD': { stdout: 'abc\n' },
      'branch --show-current': { stdout: 'main\n' },
      'merge-base origin/main HEAD': { stdout: 'base\n' },
      '--name-status': { stdout: '' },
      '--numstat': { stdout: '' },
      'diff --stat': { stdout: '' },
      'git diff "base"...HEAD': { stdout: bigDiff },
    });

    const manifest = await buildReviewContext({ runId, issueId, workspace });

    expect(manifest.diff.truncated).toBe(true);
    expect(manifest.diff.raw).toContain('[diff truncated');
  });

  it('gracefully handles git failures', async () => {
    mockExecAsync.mockRejectedValue(new Error('not a git repo'));
    mockExistsSync.mockImplementation((p: string) => p === workspace);

    const manifest = await buildReviewContext({ runId, issueId, workspace });

    expect(manifest.changedFiles).toEqual([]);
    expect(manifest.headSha).toBe('unknown');
    expect(manifest.diff.raw).toContain('Unable');
  });
});

describe('riskScore (via buildReviewContext file ranking)', () => {
  const workspace = '/tmp/fake-workspace';
  const runId = 'test-run';

  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockImplementation((p: string) => p === workspace);
    mockExecAsync.mockRejectedValue(new Error('no git'));
  });

  const highRiskPaths = [
    'src/auth/login.ts',
    'src/utils/password-hash.ts',
    'lib/token-validator.ts',
    'src/admin/permissions.ts',
    'utils/crypto.ts',
    'src/stripe/billing.ts',
    'db/query-builder.ts',
    'src/exec-runner.ts',
    'api/eval-service.ts',
  ];

  const lowRiskPaths = [
    'src/auth/auth.test.ts',
    'README.md',
    'docs/setup.txt',
    'fixtures/mock-data.json',
    'src/lib/__mocks__/stub.ts',
  ];

  for (const p of highRiskPaths) {
    it(`scores ${p} as HIGH risk`, async () => {
      mockExistsSync.mockImplementation((path: string) => path === workspace);

      // Override git to return just this file
      mockExecAsync.mockImplementation(async (cmd: string) => {
        if (cmd.includes('merge-base')) return { stdout: 'base\n', stderr: '' };
        if (cmd.includes('name-status')) return { stdout: `M\t${p}\n`, stderr: '' };
        return { stdout: '', stderr: '' };
      });

      const manifest = await buildReviewContext({ runId: 'r', issueId: 'X-1', workspace });
      expect(manifest.changedFiles[0]?.riskScore).toBe(5);
    });
  }

  for (const p of lowRiskPaths) {
    it(`scores ${p} as LOW risk`, async () => {
      mockExistsSync.mockImplementation((path: string) => path === workspace);

      mockExecAsync.mockImplementation(async (cmd: string) => {
        if (cmd.includes('merge-base')) return { stdout: 'base\n', stderr: '' };
        if (cmd.includes('name-status')) return { stdout: `M\t${p}\n`, stderr: '' };
        return { stdout: '', stderr: '' };
      });

      const manifest = await buildReviewContext({ runId: 'r', issueId: 'X-1', workspace });
      expect(manifest.changedFiles[0]?.riskScore).toBe(1);
    });
  }
});
