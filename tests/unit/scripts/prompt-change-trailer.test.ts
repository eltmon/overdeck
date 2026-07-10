import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const SCRIPT_SOURCE = new URL('../../../scripts/check-prompt-change-trailer.sh', import.meta.url);

interface Fixture {
  root: string;
  scriptPath: string;
  baseSha: string;
}

function makeTempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'prompt-change-trailer-'));
  execFileAsync('git', ['init', '--quiet'], { cwd: root }).then(
    () => undefined,
    () => undefined,
  );
  // Use the sync helper for setup steps so the test ordering is deterministic
  // — execFileAsync here would race the git config calls below.
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  return root;
}

function installScript(root: string): string {
  const scriptDest = join(root, 'scripts', 'check-prompt-change-trailer.sh');
  const src = readFileSync(SCRIPT_SOURCE, 'utf-8');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(scriptDest, src, { mode: 0o755 });
  return scriptDest;
}

function commitAll(root: string, message: string): string {
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-m', message, '--quiet'], { cwd: root });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8' }).trim();
}

function commitAllowEmpty(root: string, message: string): string {
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
  execFileSync('git', ['commit', '--allow-empty', '-m', message, '--quiet'], { cwd: root });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8' }).trim();
}

function seedBaseRepo(root: string): string {
  writeFileSync(join(root, 'README.md'), 'base\n');
  return commitAll(root, 'base');
}

function setupFixture(): Fixture {
  const root = makeTempRepo();
  const scriptPath = installScript(root);
  const baseSha = seedBaseRepo(root);
  return { root, scriptPath, baseSha };
}

async function runScript(
  fixture: Fixture,
  headSha: string,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      'bash',
      [fixture.scriptPath, fixture.baseSha, headSha],
      { cwd: fixture.root },
    );
    return { ok: true, stdout, stderr };
  } catch (err) {
    const e = err as { stdout?: string | Buffer; stderr?: string | Buffer; code?: number };
    return {
      ok: false,
      stdout: typeof e.stdout === 'string' ? e.stdout : e.stdout?.toString() ?? '',
      stderr: typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString() ?? '',
    };
  }
}

describe('scripts/check-prompt-change-trailer.sh', () => {
  it('exits 1 with the gated files and trailer syntax in the failure output when roles/flywheel.md is changed without a Prompt-Change: trailer', async () => {
    const fixture = setupFixture();
    mkdirSync(join(fixture.root, 'roles'), { recursive: true });
    writeFileSync(join(fixture.root, 'roles/flywheel.md'), '# flywheel\n');
    const headSha = commitAll(fixture.root, 'reword a sentence in flywheel');

    const result = await runScript(fixture, headSha);

    expect(result.ok, `expected non-zero exit, got stdout=${result.stdout} stderr=${result.stderr}`).toBe(false);
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined, 'failure output names the changed gated file').toMatch(/roles\/flywheel\.md/);
    expect(combined, 'failure output shows the trailer syntax').toMatch(/Prompt-Change:/);
    expect(combined, 'failure output cites PAN-2229').toMatch(/PAN-2229/);
    expect(combined, 'failure output names the gate paths').toMatch(/docs\/flywheel-brief\.md/);
    expect(combined, 'failure output does not suggest amending or force-pushing as a fix').toMatch(/do not amend|do NOT amend|not.*amend|never.*amend/i);
    expect(combined, 'failure output does not suggest force-pushing as a fix').toMatch(/do not force-push|do NOT force-push|not.*force-push|never.*force-push/i);
  });

  it('exits 0 when roles/flywheel.md is changed and a follow-up commit carries a Prompt-Change: trailer', async () => {
    const fixture = setupFixture();
    mkdirSync(join(fixture.root, 'roles'), { recursive: true });
    writeFileSync(join(fixture.root, 'roles/flywheel.md'), '# flywheel\n');
    commitAll(fixture.root, 'reword a sentence in flywheel');
    const headSha = commitAllowEmpty(
      fixture.root,
      [
        'chore: document the prompt change',
        '',
        'Prompt-Change: reworded pickup gate; eval run green',
      ].join('\n'),
    );

    const result = await runScript(fixture, headSha);

    expect(result.ok, `expected zero exit, got stdout=${result.stdout} stderr=${result.stderr}`).toBe(true);
    expect(result.stdout).toMatch(/Prompt-Change: trailer present/);
    expect(result.stdout).toMatch(/roles\/flywheel\.md/);
  });

  it('exits 0 when only src/ files are changed (no gated paths)', async () => {
    const fixture = setupFixture();
    mkdirSync(join(fixture.root, 'src'), { recursive: true });
    writeFileSync(join(fixture.root, 'src/foo.ts'), 'export const x = 1;\n');
    const headSha = commitAll(fixture.root, 'add a foo');

    const result = await runScript(fixture, headSha);

    expect(result.ok, `expected zero exit, got stdout=${result.stdout} stderr=${result.stderr}`).toBe(true);
    expect(result.stdout).toMatch(/no gated prompt files changed/);
  });

  it('exits 0 when only docs/flywheel-briefs/run-x.md is changed (per-run order book is not gated)', async () => {
    const fixture = setupFixture();
    mkdirSync(join(fixture.root, 'docs/flywheel-briefs'), { recursive: true });
    writeFileSync(join(fixture.root, 'docs/flywheel-briefs/run-57-order-book.md'), '# run 57\n');
    const headSha = commitAll(fixture.root, 'record run 57 orders');

    const result = await runScript(fixture, headSha);

    expect(result.ok, `expected zero exit, got stdout=${result.stdout} stderr=${result.stderr}`).toBe(true);
    expect(result.stdout).toMatch(/no gated prompt files changed/);
  });

  it('exits 1 when docs/flywheel-brief.md is changed without a trailer', async () => {
    const fixture = setupFixture();
    mkdirSync(join(fixture.root, 'docs'), { recursive: true });
    writeFileSync(join(fixture.root, 'docs/flywheel-brief.md'), '# flywheel brief\n');
    const headSha = commitAll(fixture.root, 'tweak the brief');

    const result = await runScript(fixture, headSha);

    expect(result.ok, `expected non-zero exit, got stdout=${result.stdout} stderr=${result.stderr}`).toBe(false);
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined).toMatch(/docs\/flywheel-brief\.md/);
  });
});