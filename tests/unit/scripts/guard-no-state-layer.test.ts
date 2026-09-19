import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// PAN-3917 (W3): guard-no-state-layer.sh fails a build that still references
// the deleted record plane, status mirrors, IssueRecord, or the state branch.
const SCRIPT_SOURCE = new URL('../../../scripts/guard-no-state-layer.sh', import.meta.url);
const tempRoots: string[] = [];

function makeFixture(): { root: string; scanRoot: string; script: string } {
  const root = mkdtempSync(join(tmpdir(), 'guard-no-state-layer-'));
  tempRoots.push(root);
  const scanRoot = join(root, 'src');
  const script = join(root, 'scripts', 'guard-no-state-layer.sh');
  mkdirSync(scanRoot, { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(script, readFileSync(SCRIPT_SOURCE, 'utf-8'), { mode: 0o755 });
  return { root, scanRoot, script };
}

function runGuard(root: string, scanRoot: string, script: string): { ok: boolean; output: string } {
  try {
    const output = execFileSync('bash', [script, scanRoot], { cwd: root, encoding: 'utf-8' });
    return { ok: true, output };
  } catch (error: any) {
    return {
      ok: false,
      output: [error.stdout ?? '', error.stderr ?? ''].join('\n'),
    };
  }
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('guard-no-state-layer.sh', () => {
  it('passes a clean fixture with no state-layer references', () => {
    const fixture = makeFixture();
    mkdirSync(join(fixture.scanRoot, 'lib'), { recursive: true });
    writeFileSync(
      join(fixture.scanRoot, 'lib', 'clean.ts'),
      [
        "export function ratio(a: number, b: number): number {",
        '  return a / b;',
        "}",
        "export const myrecords = 'not a path segment hit';",
        'export const totalRecordsCount = 5;',
        '',
      ].join('\n'),
    );

    const result = runGuard(fixture.root, fixture.scanRoot, fixture.script);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('guard-no-state-layer passed');
  });

  it('fails with file:line:pattern for a records/ path-segment reference', () => {
    const fixture = makeFixture();
    mkdirSync(join(fixture.scanRoot, 'lib'), { recursive: true });
    const sourcePath = join(fixture.scanRoot, 'lib', 'orphan.ts');
    writeFileSync(sourcePath, "const p = join(dir, 'records/', issueId);\n");

    const result = runGuard(fixture.root, fixture.scanRoot, fixture.script);

    expect(result.ok).toBe(false);
    expect(result.output).toContain('src/lib/orphan.ts:1: records/');
  });

  it.each([
    ['statusOverrides', 'export const x = { statusOverrides: {} };\n'],
    ['recoveryTrips', 'export const x = record.recoveryTrips;\n'],
    ['readyForMerge', 'export const x = status.readyForMerge;\n'],
    ['overdeck-state', "const branch = 'overdeck-state';\n"],
    ['task-door', "import { applyTaskStatusChange } from './task-door.js';\n"],
    ['auto-commit', "import { queueAutoCommit } from './auto-commit.js';\n"],
    ['IssueRecord', 'export interface Holder { record: IssueRecord }\n'],
  ] as const)('fails on a %s reference', (label, content) => {
    const fixture = makeFixture();
    mkdirSync(join(fixture.scanRoot, 'lib'), { recursive: true });
    const sourcePath = join(fixture.scanRoot, 'lib', `${label}.ts`);
    writeFileSync(sourcePath, content);

    const result = runGuard(fixture.root, fixture.scanRoot, fixture.script);

    expect(result.ok).toBe(false);
    expect(result.output).toContain(`src/lib/${label}.ts:1: `);
    expect(result.output).toContain(label);
  });

  it.each(['reviewStatus', 'testStatus', 'verificationStatus', 'inspectStatus', 'mergeStatus', 'releaseStatus'] as const)(
    'fails on the six-status-field name %s',
    (field) => {
      const fixture = makeFixture();
      mkdirSync(join(fixture.scanRoot, 'lib'), { recursive: true });
      const sourcePath = join(fixture.scanRoot, 'lib', `${field}.ts`);
      writeFileSync(sourcePath, `export const x = { ${field}: 'pending' };\n`);

      const result = runGuard(fixture.root, fixture.scanRoot, fixture.script);

      expect(result.ok).toBe(false);
      expect(result.output).toContain(`src/lib/${field}.ts:1:`);
    },
  );

  it('excludes __fixtures__ directories from the scan', () => {
    const fixture = makeFixture();
    const fixturesDir = join(fixture.scanRoot, 'lib', '__fixtures__');
    mkdirSync(fixturesDir, { recursive: true });
    writeFileSync(
      join(fixturesDir, 'legacy-record.ts'),
      'export interface IssueRecord { statusOverrides: unknown }\n',
    );

    const result = runGuard(fixture.root, fixture.scanRoot, fixture.script);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('guard-no-state-layer passed');
  });

  it('does not flag division or unrelated identifiers containing "records"', () => {
    const fixture = makeFixture();
    mkdirSync(join(fixture.scanRoot, 'lib'), { recursive: true });
    writeFileSync(
      join(fixture.scanRoot, 'lib', 'division.ts'),
      [
        'const average = total / count;',
        "const label = 'my-records-widget';",
        '',
      ].join('\n'),
    );

    const result = runGuard(fixture.root, fixture.scanRoot, fixture.script);

    expect(result.ok).toBe(true);
  });
});
