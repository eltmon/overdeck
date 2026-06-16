import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT_SOURCE = new URL('../../../scripts/lint-state-writes.sh', import.meta.url);

function makeTempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'lint-state-writes-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  return root;
}

function installScript(root: string): string {
  const scriptDest = join(root, 'scripts', 'lint-state-writes.sh');
  const src = readFileSync(SCRIPT_SOURCE, 'utf-8');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(scriptDest, src, { mode: 0o755 });
  return scriptDest;
}

function runLint(root: string): { ok: boolean; output: string } {
  const script = join(root, 'scripts', 'lint-state-writes.sh');
  try {
    const output = execFileSync('bash', [script], { cwd: root, encoding: 'utf-8' });
    return { ok: true, output };
  } catch (err: any) {
    return {
      ok: false,
      output: [err.stdout ?? '', err.stderr ?? ''].join('\n'),
    };
  }
}

function commitAll(root: string): void {
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'fixture', '--quiet'], { cwd: root });
}

describe('lint-state-writes.sh', () => {
  it('passes against a clean fixture with only approved writers', () => {
    const root = makeTempRepo();
    installScript(root);

    mkdirSync(join(root, 'src', 'lib', 'pan-dir'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'lib', 'pan-dir', 'record.ts'),
      `import { writeFileSync } from 'node:fs';\nexport function writeIssueRecordSync(path: string, record: unknown) {\n  writeFileSync(path, JSON.stringify(record));\n}\n`,
    );
    writeFileSync(
      join(root, 'src', 'lib', 'pan-dir', 'specs.ts'),
      `import { writeFileString } from 'effect/FileSystem';\nexport function writeSpec() {\n  return writeFileString('x', 'y');\n}\n`,
    );

    mkdirSync(join(root, 'src', 'lib'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'lib', 'agents.ts'),
      `import { writeFileSync } from 'node:fs';\nimport { join } from 'node:path';\nexport function writeAgentStateJsonSync(state: unknown) {\n  writeFileSync(\n    join('dir', 'state.json'),\n    JSON.stringify(state)\n  );\n}\nexport function writeOutput(agentDir: string, output: string) {\n  writeFileSync(join(agentDir, 'output.log'), output);\n}\n`,
    );

    commitAll(root);
    const { ok, output } = runLint(root);
    expect(ok).toBe(true);
    expect(output).toContain('✓ state-write lint passed');
  });

  it('fails on a new pan-dir file with an ad-hoc write primitive', () => {
    const root = makeTempRepo();
    installScript(root);

    mkdirSync(join(root, 'src', 'lib', 'pan-dir'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'lib', 'pan-dir', 'evil.ts'),
      `import { FileSystem } from 'effect';\nexport function badWrite(path: string, content: string) {\n  const fs = FileSystem.FileSystem;\n  return fs.writeFileString(path, content);\n}\n`,
    );

    commitAll(root);
    const { ok, output } = runLint(root);
    expect(ok).toBe(false);
    expect(output).toContain('ad-hoc state write under src/lib/pan-dir/');
    expect(output).toContain('evil.ts');
  });

  it('fails on a multiline state.json write outside writeAgentStateJsonSync', () => {
    const root = makeTempRepo();
    installScript(root);

    mkdirSync(join(root, 'src', 'lib'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'lib', 'agents.ts'),
      `import { writeFileSync } from 'node:fs';\nimport { join } from 'node:path';\nexport function writeAgentStateJsonSync(state: unknown) {\n  writeFileSync(join('dir', 'state.json'), JSON.stringify(state));\n}\nexport function badStateWriter(dir: string) {\n  writeFileSync(\n    join(dir, 'state.json'),\n    '{}'\n  );\n}\n`,
    );

    commitAll(root);
    const { ok, output } = runLint(root);
    expect(ok).toBe(false);
    expect(output).toContain('state.json written outside writeAgentStateJsonSync');
  });

  it('fails on a continue.json write from a new file outside the allowlist', () => {
    const root = makeTempRepo();
    installScript(root);

    mkdirSync(join(root, 'src', 'lib'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'lib', 'evil.ts'),
      `import { writeFileSync } from 'node:fs';\nexport function badContinueWriter(continuePath: string) {\n  writeFileSync(continuePath, '{}');\n}\n`,
    );

    commitAll(root);
    const { ok, output } = runLint(root);
    expect(ok).toBe(false);
    expect(output).toContain('ad-hoc write to the workspace/project continue file');
  });

  it('does not false-positive on a legitimate output.log write in agents.ts', () => {
    const root = makeTempRepo();
    installScript(root);

    mkdirSync(join(root, 'src', 'lib'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'lib', 'agents.ts'),
      `import { writeFileSync } from 'node:fs';\nimport { join } from 'node:path';\nexport function writeAgentStateJsonSync(state: unknown) {\n  writeFileSync(join('dir', 'state.json'), JSON.stringify(state));\n}\nexport function writeOutput(agentDir: string, output: string) {\n  writeFileSync(join(agentDir, 'output.log'), output);\n}\n`,
    );

    commitAll(root);
    const { ok, output } = runLint(root);
    expect(ok).toBe(true);
    expect(output).toContain('✓ state-write lint passed');
  });
});
