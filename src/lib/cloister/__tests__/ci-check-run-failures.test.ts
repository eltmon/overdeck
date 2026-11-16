import { execFile } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';

import {
  collectCheckRunFailures,
  extractSemgrepFindingsExcerpt,
  extractTestFailureExcerpt,
  isSemgrepCheckName,
  withoutAggregateChecks,
} from '../ci-check-run-failures.js';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

describe('extractTestFailureExcerpt (PAN-4534)', () => {
  it('takes the Vitest failure section, not the head of the log', () => {
    const log = [
      '2026-10-04T05:03:40.0000000Z setup noise',
      '2026-10-04T05:03:41.0000000Z  FAIL  tests/unit/lib/agents/codex-agent-home-golden.test.ts > writes the golden home',
      '2026-10-04T05:03:41.1000000Z  ❯ src/lib/runtimes/codex.ts:294:11',
      '2026-10-04T05:03:41.2000000Z  Test Files  1 failed | 40 passed (41)',
      '2026-10-04T05:03:41.3000000Z teardown noise',
    ].join('\n');

    expect(extractTestFailureExcerpt(log)).toBe([
      ' FAIL  tests/unit/lib/agents/codex-agent-home-golden.test.ts > writes the golden home',
      ' ❯ src/lib/runtimes/codex.ts:294:11',
      ' Test Files  1 failed | 40 passed (41)',
    ].join('\n').trim());
  });

  it('keeps the Test Files summary when the section is cut to the size budget', () => {
    const frames = Array.from({ length: 200 }, (_, i) => ` ❯ tests/a.test.ts:${i}:1`);
    const log = [' FAIL  tests/a.test.ts > case', ...frames, ' Test Files  1 failed (1)'].join('\n');

    const excerpt = extractTestFailureExcerpt(log, 500);
    expect(excerpt.length).toBeLessThanOrEqual(500);
    expect(excerpt.startsWith('FAIL  tests/a.test.ts > case')).toBe(true);
    expect(excerpt.endsWith('Test Files  1 failed (1)')).toBe(true);
  });

  it('gives the tail of a log with no Vitest failure', () => {
    expect(extractTestFailureExcerpt('a\nb\nerror: build failed', 12)).toBe('build failed');
  });
});

describe('withoutAggregateChecks (PAN-4534)', () => {
  const names = (list: Array<{ name: string; log?: string }>) => withoutAggregateChecks(list).map((f) => f.name);
  const ECHO = '2026-10-04T04:16:20.1000000Z test-shard: failure\n2026-10-04T04:16:20.2000000Z test-e2e:   success';

  it('drops an aggregate whose log reports its failing shard, and keeps an aggregate that failed alone', () => {
    expect(names([{ name: 'test', log: ECHO }, { name: 'test-shard (4/4)' }])).toEqual(['test-shard (4/4)']);
    expect(names([{ name: 'test', log: ECHO }, { name: 'lint' }])).toEqual(['test', 'lint']);
    expect(names([{ name: 'test', log: 'test: failure' }, { name: 'test / unit' }])).toEqual(['test / unit']);
  });

  it('keeps an independent same-prefix pair, and an aggregate with no log', () => {
    // `test` failed on its own: its log reports no test-e2e result.
    expect(names([{ name: 'test', log: ' FAIL  tests/a.test.ts > a' }, { name: 'test-e2e' }])).toEqual(['test', 'test-e2e']);
    expect(names([{ name: 'test' }, { name: 'test-shard (4/4)' }])).toEqual(['test', 'test-shard (4/4)']);
  });
});

describe('isSemgrepCheckName (PAN-4592)', () => {
  it('accepts a check named semgrep, alone or followed by a non-alphanumeric character', () => {
    for (const name of ['semgrep', 'Semgrep OSS', 'semgrep / scan', 'semgrep (pr)', ' SEMGREP ']) {
      expect(isSemgrepCheckName(name), name).toBe(true);
    }
  });

  it('rejects other names', () => {
    for (const name of ['semgrepx', 'run-semgrep', 'test', '', null, undefined]) {
      expect(isSemgrepCheckName(name), String(name)).toBe(false);
    }
  });
});

/** The D5 report from `semgrep/semgrep:1.180.0`, as GitHub Actions logs it. */
const SEMGREP_REPORT = [
  '┌────────────────┐',
  '│ 1 Code Finding │',
  '└────────────────┘',
  '    new.py',
  '   ❯❯❱ no-eval',
  '          ❰❰ Blocking ❱❱',
  '          Do not use eval',
  '            1┆ eval("2")',
  '┌──────────────┐',
  '│ Scan Summary │',
  '└──────────────┘',
  '✅ Scan completed successfully.',
  ' • Findings: 1 (1 blocking)',
  'Ran 1 rule on 1 file: 1 finding.',
];
const actionsLog = (lines: string[]) => lines.map((line) => `2026-11-16T10:00:00.0000000Z ${line}`).join('\n');
const SEMGREP_LOG = actionsLog([
  'Run git config --global --add safe.directory "$GITHUB_WORKSPACE"',
  ...SEMGREP_REPORT,
  '##[error]Process completed with exit code 1.',
]);

describe('extractSemgrepFindingsExcerpt (PAN-4592)', () => {
  it('takes the findings block through the Ran line', () => {
    const excerpt = extractSemgrepFindingsExcerpt(SEMGREP_LOG);
    expect(excerpt.startsWith('│ 1 Code Finding │')).toBe(true);
    expect(excerpt.endsWith('Ran 1 rule on 1 file: 1 finding.')).toBe(true);
    expect(excerpt).toContain('❯❯❱ no-eval');
    expect(excerpt).not.toContain('2026-11-16T');
    expect(excerpt).not.toContain('exit code 1');
  });

  it('keeps the Ran line when a long findings block is cut to the size budget', () => {
    const findings = Array.from({ length: 200 }, (_, i) => `    src/file${i}.py\n   ❯❯❱ no-eval\n            ${i}┆ eval("${i}")`);
    const log = actionsLog(['│ 200 Code Findings │', ...findings, 'Ran 1 rule on 200 files: 200 findings.']);
    expect(log.length).toBeGreaterThan(5000);

    const excerpt = extractSemgrepFindingsExcerpt(log);
    expect(excerpt.length).toBeLessThanOrEqual(2000);
    expect(excerpt.startsWith('│ 200 Code Findings │')).toBe(true);
    expect(excerpt.endsWith('…\nRan 1 rule on 200 files: 200 findings.')).toBe(true);
  });

  it('gives the trimmed tail of a log with no Code Finding line', () => {
    const log = actionsLog(['setup', '[ERROR] invalid configuration file found (1 configs were invalid)   ']);
    expect(extractSemgrepFindingsExcerpt(log)).toBe('setup\n[ERROR] invalid configuration file found (1 configs were invalid)');
    expect(extractSemgrepFindingsExcerpt('a\nb\nerror: rule missing  ', 13)).toBe('rule missing');
  });
});

describe('collectCheckRunFailures with a Semgrep check (PAN-4592)', () => {
  it('excerpts a failing semgrep Actions job with the Semgrep extractor', async () => {
    const run = { id: 77, name: 'semgrep', conclusion: 'failure', details_url: 'https://github.com/o/r/actions/runs/1/job/77', html_url: null, app: { slug: 'github-actions' } };
    vi.mocked(execFile).mockImplementation(((_file: string, args: string[], _opts: unknown, callback: (error: Error | null, stdout: string) => void) => {
      const path = args[args[1] === '--paginate' ? 2 : 1]!;
      if (path.startsWith('repos/o/r/commits/abc123/check-runs')) callback(null, `${JSON.stringify(run)}\n`);
      else if (path === 'repos/o/r/actions/jobs/77/logs') callback(null, SEMGREP_LOG);
      else callback(new Error(`unexpected gh call: ${args.join(' ')}`), '');
    }) as unknown as typeof execFile);

    const failures = await collectCheckRunFailures('o', 'r', 'abc123');

    expect(failures).toEqual([{
      name: 'semgrep',
      jobId: 77,
      url: 'https://github.com/o/r/actions/runs/1/job/77',
      excerpt: extractSemgrepFindingsExcerpt(SEMGREP_LOG),
    }]);
  });
});
