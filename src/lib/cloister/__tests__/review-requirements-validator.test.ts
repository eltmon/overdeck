import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateRequirementsTrace } from '../review-requirements-validator';

function fixture(name: string): string {
  return readFileSync(resolve(process.cwd(), 'tests/fixtures/review-requirements', name), 'utf8');
}

describe('validateRequirementsTrace', () => {
  it('passes when all in_pr_scope Implemented ACs have valid traces', () => {
    const result = validateRequirementsTrace(fixture('happy-path.md'));
    expect(result.ok).toBe(true);
    expect(result.missingTraces).toEqual([]);
    expect(result.reason).toBe('');
  });

  it('passes when only whole_feature_scope ACs are present and sentinel is used', () => {
    const result = validateRequirementsTrace(fixture('whole-feature-only.md'));
    expect(result.ok).toBe(true);
    expect(result.missingTraces).toEqual([]);
    expect(result.reason).toBe('');
  });

  it('fails when the Live Code Path Traces section is missing', () => {
    const result = validateRequirementsTrace(fixture('missing-section.md'));
    expect(result.ok).toBe(false);
    expect(result.missingTraces).toContain('AC-1: Foo does the thing');
    expect(result.missingTraces).toContain('AC-2: Bar handles edge');
    expect(result.reason).toContain('requirements review missing live code path trace for ACs:');
  });

  it('fails when one required AC trace is missing', () => {
    const result = validateRequirementsTrace(fixture('missing-one-ac.md'));
    expect(result.ok).toBe(false);
    expect(result.missingTraces).toEqual(['AC-2: Bar handles edge']);
    expect(result.reason).toContain('AC-2: Bar handles edge');
  });

  it('fails when File values are prose or bare paths without extension/line', () => {
    const result = validateRequirementsTrace(fixture('bad-file-format.md'));
    expect(result.ok).toBe(false);
    expect(result.missingTraces).toContain('AC-1: Foo does the thing');
    expect(result.missingTraces).toContain('AC-2: Bar handles edge');
  });

  it('passes with zero qualifying ACs when sentinel body is present', () => {
    const result = validateRequirementsTrace(fixture('sentinel-when-not-needed.md'));
    expect(result.ok).toBe(true);
    expect(result.missingTraces).toEqual([]);
    expect(result.reason).toBe('');
  });

  it('fails when one qualifying AC exists but sentinel body is used', () => {
    const result = validateRequirementsTrace(fixture('sentinel-when-needed.md'));
    expect(result.ok).toBe(false);
    expect(result.missingTraces).toEqual(['AC-1: Foo does the thing']);
    expect(result.reason).toContain('AC-1: Foo does the thing');
  });

  it('rejects Windows-style backslash paths', () => {
    const result = validateRequirementsTrace(fixture('windows-path.md'));
    expect(result.ok).toBe(false);
    expect(result.missingTraces).toEqual(['AC-1: Foo does the thing']);
  });

  it('passes when the first backticked path in a block is valid', () => {
    const result = validateRequirementsTrace(fixture('multiple-paths-one-block.md'));
    expect(result.ok).toBe(true);
    expect(result.missingTraces).toEqual([]);
    expect(result.reason).toBe('');
  });

  it('fails when the section header has wrong case', () => {
    const result = validateRequirementsTrace(fixture('case-variation.md'));
    expect(result.ok).toBe(false);
    expect(result.missingTraces).toEqual(['AC-1: Foo does the thing']);
  });

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
    expect(failResult.reason).toMatch(/\.\.\.$/);
  });
});
