import { describe, expect, it } from 'vitest';

import { extractTestFailureExcerpt, withoutAggregateChecks } from '../ci-check-run-failures.js';

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
