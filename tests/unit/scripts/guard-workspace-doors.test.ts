import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';

const SCRIPT_SOURCE = new URL('../../../scripts/guard-workspace-doors.sh', import.meta.url);

function makeTempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'guard-workspace-doors-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  return root;
}

function installScript(root: string): void {
  const scriptDest = join(root, 'scripts', 'guard-workspace-doors.sh');
  const src = readFileSync(fileURLToPath(SCRIPT_SOURCE), 'utf-8');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(scriptDest, src, { mode: 0o755 });
}

function runGuard(root: string): { ok: boolean; output: string } {
  const script = join(root, 'scripts', 'guard-workspace-doors.sh');
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

describe('guard-workspace-doors.sh', () => {
  it('exits 1 and prints the offending line when a fixture file outside the doors SELECTs the workspaces table', () => {
    const root = makeTempRepo();
    installScript(root);

    mkdirSync(join(root, 'src', 'lib', 'somewhere'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'lib', 'somewhere', 'bad-access.ts'),
      `import { getDatabase } from '../database/index.js';\nexport function badRead(id: string) {\n  return getDatabase().prepare(\`SELECT * FROM workspaces WHERE id = ?\`).get(id);\n}\n`,
    );
    commitAll(root);

    const { ok, output } = runGuard(root);
    expect(ok).toBe(false);
    expect(output).toContain('direct SQL against workspaces/projects/project_targets/pinned_docs');
    expect(output).toContain('bad-access.ts');
    expect(output).toContain('FROM workspaces');
  });

  it('exits 1 for direct SQL in a workspaces/ sibling file that is not resolver.ts or writer.ts', () => {
    const root = makeTempRepo();
    installScript(root);

    mkdirSync(join(root, 'src', 'lib', 'workspaces'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'lib', 'workspaces', 'rebuild.ts'),
      `import { getOverdeckDatabaseSync } from '../overdeck/infra.js';\nexport function badRebuildRead(id: string) {\n  return getOverdeckDatabaseSync().prepare(\`SELECT * FROM workspaces WHERE id = ?\`).get(id);\n}\n`,
    );
    commitAll(root);

    const { ok, output } = runGuard(root);
    expect(ok).toBe(false);
    expect(output).toContain('rebuild.ts');
  });

  it('exits 1 for a direct JOIN against a doors table outside the two doors', () => {
    const root = makeTempRepo();
    installScript(root);

    mkdirSync(join(root, 'src', 'lib', 'somewhere'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'lib', 'somewhere', 'bad-join.ts'),
      `import { getDatabase } from '../database/index.js';\nexport function badJoin() {\n  return getDatabase().prepare(\`SELECT * FROM conversations c JOIN workspaces w ON w.id = c.workspace_id\`).all();\n}\n`,
    );
    commitAll(root);

    const { ok, output } = runGuard(root);
    expect(ok).toBe(false);
    expect(output).toContain('bad-join.ts');
  });

  it('exits 0 on a clean tree with schema.ts and the door modules allowlisted', () => {
    const root = makeTempRepo();
    installScript(root);

    mkdirSync(join(root, 'src', 'lib', 'overdeck'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'lib', 'overdeck', 'infra.ts'),
      `export function ensureWorkspaceTablesSync(db: any) {\n  db.exec(\`CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY)\`);\n}\n`,
    );

    mkdirSync(join(root, 'src', 'lib', 'workspaces'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'lib', 'workspaces', 'resolver.ts'),
      `import { getOverdeckDatabaseSync } from '../overdeck/infra.js';\nexport function getWorkspaceById(id: string) {\n  return getOverdeckDatabaseSync().prepare(\`SELECT * FROM workspaces WHERE id = ?\`).get(id);\n}\n`,
    );
    writeFileSync(
      join(root, 'src', 'lib', 'workspaces', 'writer.ts'),
      `import { getOverdeckDatabaseSync } from '../overdeck/infra.js';\nexport function deleteWorkspace(id: string) {\n  getOverdeckDatabaseSync().prepare(\`DELETE FROM workspaces WHERE id = ?\`).run(id);\n}\n`,
    );

    // Prose mentioning "projects.yaml" (a file, not a table reference) must not trip the guard.
    mkdirSync(join(root, 'src', 'cli'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'cli', 'workspace.ts'),
      `// Explicit project key from projects.yaml (overrides registry)\nexport const noop = 1;\n`,
    );

    commitAll(root);

    const { ok, output } = runGuard(root);
    expect(ok).toBe(true);
    expect(output).toContain('✓ workspace-doors guard passed');
  });
});
