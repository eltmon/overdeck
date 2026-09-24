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

// No scan-root argument: the default `src` scan plus the Markdown pass over
// src/lib/cloister/prompts/ and sync-sources/ (the fixture root is the cwd).
function runGuardWithMarkdownPass(root: string, script: string): { ok: boolean; output: string } {
  try {
    const output = execFileSync('bash', [script], { cwd: root, encoding: 'utf-8' });
    return { ok: true, output };
  } catch (error: any) {
    return {
      ok: false,
      output: [error.stdout ?? '', error.stderr ?? ''].join('\n'),
    };
  }
}

function writeFixtureFile(root: string, relPath: string, content: string): void {
  const path = join(root, relPath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
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

  // PAN-3929: agent-shipped Markdown is held to the code pass's full pattern
  // set, deleted status fields included.
  describe('Markdown pass', () => {
    it('fails on a deleted status field in a synced skill', () => {
      const fixture = makeFixture();
      writeFixtureFile(fixture.root, 'sync-sources/skills/x/SKILL.md', 'Check readyForMerge=true first.\n');

      const result = runGuardWithMarkdownPass(fixture.root, fixture.script);

      expect(result.ok).toBe(false);
      expect(result.output).toContain('sync-sources/skills/x/SKILL.md:1: readyForMerge');
    });

    it('fails on a deleted status field in a runtime prompt', () => {
      const fixture = makeFixture();
      writeFixtureFile(fixture.root, 'src/lib/cloister/prompts/p.md', 'Wait until mergeStatus is merged.\n');

      const result = runGuardWithMarkdownPass(fixture.root, fixture.script);

      expect(result.ok).toBe(false);
      expect(result.output).toContain('src/lib/cloister/prompts/p.md:1:');
    });

    // PAN-3934: roles/*.md is appended to role sessions as the system prompt.
    it('fails on a deleted status field in a role prompt', () => {
      const fixture = makeFixture();
      writeFixtureFile(fixture.root, 'roles/test.md', 'Record testStatus and uatStatus separately.\n');

      const result = runGuardWithMarkdownPass(fixture.root, fixture.script);

      expect(result.ok).toBe(false);
      expect(result.output).toContain('roles/test.md:1:');
    });

    it('passes the two by-name exempt files', () => {
      const fixture = makeFixture();
      const content = 'The overdeck-state branch held readyForMerge.\n';
      writeFixtureFile(fixture.root, 'sync-sources/rules/protect-overdeck-state-branch.md', content);
      writeFixtureFile(fixture.root, 'sync-sources/skills/pan-admin-migrate-plan-home/SKILL.md', content);

      const result = runGuardWithMarkdownPass(fixture.root, fixture.script);

      expect(result.ok).toBe(true);
      expect(result.output).toContain('guard-no-state-layer passed');
    });

    it('passes a skill that describes the derived model', () => {
      const fixture = makeFixture();
      writeFixtureFile(
        fixture.root,
        'sync-sources/skills/y/SKILL.md',
        'Read the derived state, then `pr.reviewState` and `pr.checks` from `pan show --json`.\n',
      );

      const result = runGuardWithMarkdownPass(fixture.root, fixture.script);

      expect(result.ok).toBe(true);
      expect(result.output).toContain('guard-no-state-layer passed');
    });
  });
});
