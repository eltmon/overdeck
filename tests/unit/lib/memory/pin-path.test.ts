/**
 * PAN-1990 review fix (security): pinned docs must never resolve outside the
 * project root. An unguarded pin could persistently place an arbitrary local
 * file (e.g. ~/.ssh/id_rsa) into prompt-time context sent to the configured
 * model provider. Both pin creation (cli/commands/memory.ts) and injection
 * read (lib/memory/injection.ts) call this shared guard.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveContainedPinPath, verifyPinPathContainment } from '../../../../src/lib/memory/pin-path.js';

const PROJECT_ROOT = '/repo/overdeck';

describe('resolveContainedPinPath', () => {
  it('accepts a plain relative path unchanged', () => {
    expect(resolveContainedPinPath(PROJECT_ROOT, 'docs/ARCHITECTURE.md')).toBe(join('docs', 'ARCHITECTURE.md'));
  });

  it('normalizes an absolute path inside the project root to project-relative', () => {
    expect(resolveContainedPinPath(PROJECT_ROOT, join(PROJECT_ROOT, 'docs', 'NOTES.md'))).toBe(join('docs', 'NOTES.md'));
  });

  it('rejects an absolute path outside the project root', () => {
    expect(resolveContainedPinPath(PROJECT_ROOT, '/home/user/.ssh/id_rsa')).toBeNull();
  });

  it('rejects a relative path that traverses outside the project root', () => {
    expect(resolveContainedPinPath(PROJECT_ROOT, '../../../../etc/passwd')).toBeNull();
  });

  it('rejects a relative path that traverses out and back in (still escapes textually first)', () => {
    expect(resolveContainedPinPath(PROJECT_ROOT, '../overdeck-secondary/docs/NOTES.md')).toBeNull();
  });

  it('rejects the project root itself (empty relative path is not a file)', () => {
    expect(resolveContainedPinPath(PROJECT_ROOT, PROJECT_ROOT)).toBeNull();
  });
});

describe('verifyPinPathContainment (symlink-safe, review fix cycle 2)', () => {
  let projectRoot: string;
  let outsideDir: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'pan-1990-pin-containment-'));
    outsideDir = mkdtempSync(join(tmpdir(), 'pan-1990-pin-outside-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  });

  it('accepts a real regular file inside the project root', async () => {
    mkdirSync(join(projectRoot, 'docs'), { recursive: true });
    writeFileSync(join(projectRoot, 'docs', 'NOTES.md'), 'hello\n', 'utf8');

    expect(await verifyPinPathContainment(projectRoot, 'docs/NOTES.md')).toBe(join('docs', 'NOTES.md'));
  });

  it('rejects an in-project symlink whose real target is outside the project root', async () => {
    const outsideFile = join(outsideDir, 'id_rsa');
    writeFileSync(outsideFile, 'not a real key\n', 'utf8');
    mkdirSync(join(projectRoot, 'docs'), { recursive: true });
    symlinkSync(outsideFile, join(projectRoot, 'docs', 'private'));

    expect(await verifyPinPathContainment(projectRoot, 'docs/private')).toBeNull();
  });

  it('accepts an in-project symlink whose real target is also inside the project root', async () => {
    mkdirSync(join(projectRoot, 'docs'), { recursive: true });
    writeFileSync(join(projectRoot, 'docs', 'real.md'), 'hello\n', 'utf8');
    symlinkSync(join(projectRoot, 'docs', 'real.md'), join(projectRoot, 'docs', 'alias.md'));

    expect(await verifyPinPathContainment(projectRoot, 'docs/alias.md')).toBe(join('docs', 'alias.md'));
  });

  it('rejects a path that does not exist', async () => {
    expect(await verifyPinPathContainment(projectRoot, 'docs/missing.md')).toBeNull();
  });

  it('rejects a directory (not a regular file)', async () => {
    mkdirSync(join(projectRoot, 'docs'), { recursive: true });

    expect(await verifyPinPathContainment(projectRoot, 'docs')).toBeNull();
  });

  it('rejects a lexically-escaping path before ever touching the filesystem', async () => {
    expect(await verifyPinPathContainment(projectRoot, '../../../../etc/passwd')).toBeNull();
  });
});
