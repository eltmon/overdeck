/**
 * Tests for review-context.ts (PAN-1059)
 */
import { Effect } from 'effect';
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
const mockReadPlan = vi.fn();
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
  findPlanSync: vi.fn(() => null),
  readPlan: (...args: unknown[]) => mockReadPlan(...args),
  readPlanProgram: (...args: unknown[]) => mockReadPlan(...args),
}));
vi.mock('../../vbrief/lifecycle-io.js', () => ({
  findVBriefByIssue: vi.fn(() => null),
  findVBriefByIssueSync: vi.fn(() => null),
}));
vi.mock('../../config.js', () => ({
  getDevrootPath: vi.fn(() => null),
  getDevrootPathSync: vi.fn(() => null),
}));

// ── stub-ui scanner mock ───────────────────────────────────────────────────
vi.mock('../lint-stub-ui.js', () => ({
  scanStubUi: vi.fn(),
}));

// ── import after mocks ─────────────────────────────────────────────────────
import { buildReviewContext, formatTier1Summary, REVIEW_LARGE_CHANGESET_FILES, REVIEW_LARGE_CHANGESET_LINES } from '../review-context.js';
import { findPlanSync } from '../../vbrief/io.js';
import { scanStubUi } from '../lint-stub-ui.js';

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
    mockReadPlan.mockReturnValue(Effect.fail(new Error('no plan')));
    mockExistsSync.mockImplementation((p: string) => p === workspace);
    vi.mocked(scanStubUi).mockResolvedValue([]);
  });

  it('throws when workspace does not exist', async () => {
    mockExistsSync.mockReturnValue(false);

    await expect(Effect.runPromise(buildReviewContext({ runId, issueId, workspace }))).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringContaining('Workspace directory does not exist') }),
    });
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

    const manifest = await Effect.runPromise(buildReviewContext({ runId, issueId, workspace }));

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
    expect(manifest.nonGoals).toEqual([]);
    expect(manifest.traces).toEqual([]);
    expect(manifest.manifestPath).toBe(join(workspace, '.pan', 'review', runId, 'context.json'));
  });

  it('includes plan NonGoals in the manifest', async () => {
    vi.mocked(findPlanSync).mockReturnValue(join(workspace, '.pan', 'spec.vbrief.json'));
    mockReadPlan.mockReturnValue(Effect.succeed({
      vBRIEFInfo: { version: '0.5', created: '2026-06-12T00:00:00Z' },
      plan: {
        id: issueId.toLowerCase(),
        title: 'Plan',
        status: 'proposed',
        narratives: {
          NonGoals: '- Do not add a new dashboard route\n- Do not change issue lifecycle statuses',
        },
        items: [],
        edges: [],
      },
    }));
    mockGitOutput({
      'rev-parse HEAD': { stdout: 'abc12345\n' },
      'branch --show-current': { stdout: 'feature-pan-1059\n' },
      'merge-base origin/main HEAD': { stdout: 'base\n' },
      '--name-status': { stdout: '' },
      '--numstat': { stdout: '' },
      'diff --stat': { stdout: '' },
    });

    const manifest = await Effect.runPromise(buildReviewContext({ runId, issueId, workspace }));

    expect(manifest.nonGoals).toEqual([
      'Do not add a new dashboard route',
      'Do not change issue lifecycle statuses',
    ]);
    const written = JSON.parse(String(mockWriteFile.mock.calls.at(-1)?.[1]));
    expect(written.nonGoals).toEqual(manifest.nonGoals);
  });

  it("includes plan item traces in the manifest", async () => {
    vi.mocked(findPlanSync).mockReturnValue(join(workspace, '.pan', 'spec.vbrief.json'));
    mockReadPlan.mockReturnValue(Effect.succeed({
      vBRIEFInfo: { version: '0.5', created: '2026-06-12T00:00:00Z' },
      plan: {
        id: issueId.toLowerCase(),
        title: 'Plan',
        status: 'proposed',
        items: [
          {
            id: 'wire-command',
            title: 'Wire command',
            status: 'pending',
            metadata: { traces: ['FR-1', 'NFR-2'] },
          },
        ],
        edges: [],
      },
    }));
    mockGitOutput({
      'rev-parse HEAD': { stdout: 'abc12345\n' },
      'branch --show-current': { stdout: 'feature-pan-1059\n' },
      'merge-base origin/main HEAD': { stdout: 'base\n' },
      '--name-status': { stdout: '' },
      '--numstat': { stdout: '' },
      'diff --stat': { stdout: '' },
    });

    const manifest = await Effect.runPromise(buildReviewContext({ runId, issueId, workspace }));

    expect(manifest.traces).toEqual([
      { itemId: 'wire-command', title: 'Wire command', traces: ['FR-1', 'NFR-2'] },
    ]);
    const written = JSON.parse(String(mockWriteFile.mock.calls.at(-1)?.[1]));
    expect(written.traces).toEqual(manifest.traces);
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

    const manifest = await Effect.runPromise(buildReviewContext({ runId, issueId, workspace }));

    expect(manifest.changedFiles[0].path).toBe('src/auth/token.ts');   // HIGH=5
    expect(manifest.changedFiles[1].path).toBe('src/api/routes.ts');   // MED=3
    expect(manifest.changedFiles[2].path).toBe('src/README.md');       // LOW=1
  });

  it('marks diff as truncated (raw diff no longer embedded)', async () => {
    mockGitOutput({
      'rev-parse HEAD': { stdout: 'abc\n' },
      'branch --show-current': { stdout: 'main\n' },
      'merge-base origin/main HEAD': { stdout: 'base\n' },
      '--name-status': { stdout: '' },
      '--numstat': { stdout: '' },
      'diff --stat': { stdout: '2 files changed, 200 insertions(+), 0 deletions(-)\n' },
    });

    const manifest = await Effect.runPromise(buildReviewContext({ runId, issueId, workspace }));

    expect(manifest.diff.truncated).toBe(true);
    expect(manifest.diff.stat).toContain('2 files changed');
  });

  it('gracefully handles git failures', async () => {
    mockExecAsync.mockRejectedValue(new Error('not a git repo'));
    mockExistsSync.mockImplementation((p: string) => p === workspace);

    const manifest = await Effect.runPromise(buildReviewContext({ runId, issueId, workspace }));

    expect(manifest.changedFiles).toEqual([]);
    expect(manifest.headSha).toBe('unknown');
    expect(manifest.diff.stat).toContain('Unable');
  });

  it('includes stubUiFindings on the manifest', async () => {
    vi.mocked(scanStubUi).mockResolvedValue([
      {
        patternId: 'empty-array-return',
        patternLabel: 'Hook/function returns an empty array',
        filePath: 'src/dashboard/frontend/src/components/Inspector/FilesTab.tsx',
        lineNumber: 42,
        addedLine: '  return [];',
        severity: 'block',
      },
    ]);
    mockGitOutput({
      'rev-parse HEAD': { stdout: 'abc12345\n' },
      'branch --show-current': { stdout: 'feature-pan-1500\n' },
      'merge-base origin/main HEAD': { stdout: 'base\n' },
      '--name-status': { stdout: '' },
      '--numstat': { stdout: '' },
      'diff --stat': { stdout: '' },
    });

    const manifest = await Effect.runPromise(buildReviewContext({ runId, issueId, workspace }));

    expect(manifest.stubUiFindings).toHaveLength(1);
    expect(manifest.stubUiFindings[0]?.patternId).toBe('empty-array-return');
    const written = JSON.parse(String(mockWriteFile.mock.calls.at(-1)?.[1]));
    expect(written.stubUiFindings).toEqual(manifest.stubUiFindings);
  });

  it('survives a throwing scanStubUi with stubUiFindings: []', async () => {
    vi.mocked(scanStubUi).mockRejectedValue(new Error('scanner boom'));
    mockGitOutput({
      'rev-parse HEAD': { stdout: 'abc12345\n' },
      'branch --show-current': { stdout: 'feature-pan-1500\n' },
      'merge-base origin/main HEAD': { stdout: 'base\n' },
      '--name-status': { stdout: '' },
      '--numstat': { stdout: '' },
      'diff --stat': { stdout: '' },
    });

    const manifest = await Effect.runPromise(buildReviewContext({ runId, issueId, workspace }));

    expect(manifest.stubUiFindings).toEqual([]);
    const written = JSON.parse(String(mockWriteFile.mock.calls.at(-1)?.[1]));
    expect(written.stubUiFindings).toEqual([]);
  });
});

describe('riskScore (via buildReviewContext file ranking)', () => {
  const workspace = '/tmp/fake-workspace';
  const runId = 'test-run';

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadPlan.mockReturnValue(Effect.fail(new Error('no plan')));
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

      const manifest = await Effect.runPromise(buildReviewContext({ runId: 'r', issueId: 'X-1', workspace }));
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

      const manifest = await Effect.runPromise(buildReviewContext({ runId: 'r', issueId: 'X-1', workspace }));
      expect(manifest.changedFiles[0]?.riskScore).toBe(1);
    });
  }
});

describe('large changeset guardrail', () => {
  const baseManifest = {
    issueId: 'PAN-1059',
    branch: 'feature-pan-1059',
    headSha: 'abc123',
    changedFiles: [],
    largeChangeset: { fileCount: 0, changedLines: 0, isLarge: false },
    acceptanceCriteria: [],
    nonGoals: [],
    traces: [],
    policyNotes: [],
    stubUiFindings: [],
    diff: { stat: '1 file changed, 1 insertion(+)', truncated: false },
  };

  it('flags a changeset with more than REVIEW_LARGE_CHANGESET_FILES files', () => {
    const files = Array.from({ length: REVIEW_LARGE_CHANGESET_FILES + 1 }, (_, i) => ({
      path: `src/lib/f${i}.ts`,
      status: 'M' as const,
      additions: 1,
      deletions: 0,
      riskScore: 2,
    }));
    const summary = formatTier1Summary({ ...baseManifest, changedFiles: files, largeChangeset: { fileCount: files.length, changedLines: files.length, isLarge: true } });
    expect(summary).toContain('LARGE CHANGESET');
    expect(summary).toContain('highest-risk files first');
    expect(summary).toContain('BLOCKING coverage gap');
  });

  it('flags a changeset with more than REVIEW_LARGE_CHANGESET_LINES changed lines', () => {
    const files = [{
      path: 'src/lib/big.ts',
      status: 'M' as const,
      additions: REVIEW_LARGE_CHANGESET_LINES + 1,
      deletions: 0,
      riskScore: 2,
    }];
    const summary = formatTier1Summary({ ...baseManifest, changedFiles: files, largeChangeset: { fileCount: 1, changedLines: REVIEW_LARGE_CHANGESET_LINES + 1, isLarge: true } });
    expect(summary).toContain('LARGE CHANGESET');
    expect(summary).toContain('changed regions');
  });

  it('omits the guardrail for small changesets', () => {
    const files = Array.from({ length: REVIEW_LARGE_CHANGESET_FILES }, (_, i) => ({
      path: `src/lib/f${i}.ts`,
      status: 'M' as const,
      additions: 1,
      deletions: 0,
      riskScore: 2,
    }));
    const changedLines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);
    const summary = formatTier1Summary({ ...baseManifest, changedFiles: files, largeChangeset: { fileCount: files.length, changedLines, isLarge: false } });
    expect(summary).not.toContain('LARGE CHANGESET');
    expect(summary).not.toContain('BLOCKING coverage gap');
  });
});
