/**
 * PAN-1990 review fix (security): pinned docs must never resolve outside the
 * project root. An unguarded pin could persistently place an arbitrary local
 * file (e.g. ~/.ssh/id_rsa) into prompt-time context sent to the configured
 * model provider. Both pin creation (cli/commands/memory.ts) and injection
 * read (lib/memory/injection.ts) call this shared guard.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveContainedPinPath } from '../../../../src/lib/memory/pin-path.js';

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
