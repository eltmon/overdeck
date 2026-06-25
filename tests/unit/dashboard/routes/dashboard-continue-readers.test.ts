/**
 * PAN-1919: dashboard route continue read/write rerouted to per-issue record.
 *
 * AC: routes/agents.ts reads and writes session state through the record
 *     (no inline readWorkspaceContinueState / writeWorkspaceContinueState touching continue.json)
 * AC: routes/workspaces.ts returns continue context from the record
 * AC: routes/agents.ts is removed from CONTINUE_EXCLUDES in lint-state-writes.sh
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = join(import.meta.dirname, '../../../../');

describe('PAN-1919: dashboard route continue readers/writers → record', () => {
  it('AC1: readWorkspaceContinueState absent from routes/agents.ts', () => {
    const result = execSync(
      `git grep -n "readWorkspaceContinueState\\|writeWorkspaceContinueState" -- src/dashboard/server/routes/agents.ts || true`,
      { cwd: ROOT, encoding: 'utf-8' },
    );
    expect(result.trim()).toBe('');
  });

  it('AC1: appendSessionEntry is used in routes/agents.ts', () => {
    const result = execSync(
      `git grep -n "appendSessionEntry" -- src/dashboard/server/routes/agents.ts || true`,
      { cwd: ROOT, encoding: 'utf-8' },
    );
    expect(result.trim()).not.toBe('');
  });

  it('AC2: readWorkspaceContinueFile in routes/workspaces.ts uses readRecordContinueViewSync', () => {
    const result = execSync(
      `git grep -n "readRecordContinueViewSync" -- src/dashboard/server/routes/workspaces.ts || true`,
      { cwd: ROOT, encoding: 'utf-8' },
    );
    expect(result.trim()).not.toBe('');
  });

  it('AC2: readWorkspaceContinueFile no longer reads PAN_CONTINUE_FILENAME directly for continue data', () => {
    // The function still compiles, but must not use PAN_CONTINUE_FILENAME + writeFile pattern
    const content = readFileSync(join(ROOT, 'src/dashboard/server/routes/workspaces.ts'), 'utf-8');
    // The old pattern used to read PAN_DIRNAME/PAN_CONTINUE_FILENAME via readFile inside the function
    expect(content).not.toContain('const continuePath = join(workspacePath, PAN_DIRNAME, PAN_CONTINUE_FILENAME)');
  });

  it('AC3: routes/agents.ts absent from CONTINUE_EXCLUDES in lint-state-writes.sh', () => {
    const script = readFileSync(join(ROOT, 'scripts/lint-state-writes.sh'), 'utf-8');
    expect(script).not.toContain("':!src/dashboard/server/routes/agents.ts'");
  });

  it('AC3: lint-state-writes.sh exits 0 after removal', () => {
    const result = execSync(
      'bash scripts/lint-state-writes.sh 2>&1 || echo EXIT_NONZERO',
      { cwd: ROOT, encoding: 'utf-8' },
    );
    expect(result).toContain('✓ state-write lint passed');
    expect(result).not.toContain('EXIT_NONZERO');
  });
});
