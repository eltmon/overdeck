import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateRequirementsTrace } from '../review-requirements-validator';

const FIXTURE_DIR = resolve(process.cwd(), 'tests/fixtures/review-requirements');

interface FixtureMeta {
  ok: boolean;
  missingTraces: string[];
  reasonIncludes?: string;
}

function fixtureNames(): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter(name => name.endsWith('.md'))
    .map(name => name.replace(/\.md$/, ''))
    .sort();
}

function fixtureMarkdown(name: string): string {
  return readFileSync(resolve(FIXTURE_DIR, `${name}.md`), 'utf8');
}

function fixtureMeta(name: string): FixtureMeta {
  const raw = readFileSync(resolve(FIXTURE_DIR, `${name}.json`), 'utf8');
  return JSON.parse(raw) as FixtureMeta;
}

describe('validateRequirementsTrace fixture suite', () => {
  for (const name of fixtureNames()) {
    it(`matches expected result for ${name}.md`, () => {
      const meta = fixtureMeta(name);
      const result = validateRequirementsTrace(fixtureMarkdown(name));

      expect(result.ok).toBe(meta.ok);
      expect(result.missingTraces).toEqual(meta.missingTraces);

      if (meta.reasonIncludes) {
        expect(result.reason).toContain(meta.reasonIncludes);
      }
    });
  }
});

describe('validateRequirementsTrace invariants', () => {
  it('truncates the reason to 240 characters when many ACs are missing', () => {
    const rows: string[] = [];
    const traces: string[] = [];
    for (let i = 0; i < 20; i++) {
      const title = `AC-${i}: Very long requirement title that consumes characters ${i}`;
      rows.push(`| ${title} | vBRIEF | in_pr_scope | Implemented | \`src/foo.ts:${i}\` |`);
      traces.push(`### AC: ${title}\n**Scope:** in_pr_scope\n**File:** \`src/foo.ts:${i}\``);
    }
    const markdown = [
      '## Coverage Matrix',
      '| Requirement | Source | Scope | Status | Evidence |',
      '| --- | --- | --- | --- | --- |',
      ...rows,
      '',
      '## Live Code Path Traces',
      ...traces,
    ].join('\n');

    const result = validateRequirementsTrace(markdown);
    expect(result.ok).toBe(true);

    // Now remove half the traces to force a failure reason long enough to truncate.
    const truncatedMarkdown = [
      '## Coverage Matrix',
      '| Requirement | Source | Scope | Status | Evidence |',
      '| --- | --- | --- | --- | --- |',
      ...rows,
      '',
      '## Live Code Path Traces',
      ...traces.slice(10),
    ].join('\n');

    const failResult = validateRequirementsTrace(truncatedMarkdown);
    expect(failResult.ok).toBe(false);
    expect(failResult.reason.length).toBeLessThanOrEqual(240);
    expect(failResult.reason).toMatch(/\.{3}$/);
  });
});
