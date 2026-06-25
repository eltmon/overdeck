/**
 * PAN-1919: cloister + scope continue readers rerouted to readRecordContinueViewSync.
 *
 * AC: work-agent prompt contains decisions/hazards/sessionHistory from record
 * AC: no readWorkspaceContinue or readContinueStateSync call remains in
 *     work-agent-prompt.ts, handoff-context.ts, or scope.ts
 * AC: readFeedback (markdown delivery dir) call survives in work-agent-prompt.ts
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../../../');
const TARGET_FILES = [
  'src/lib/cloister/work-agent-prompt.ts',
  'src/lib/cloister/handoff-context.ts',
  'src/cli/commands/scope.ts',
];

describe('PAN-1919: cloister continue readers → record (no continue calls)', () => {
  it('AC3: readWorkspaceContinue absent from target files', () => {
    for (const file of TARGET_FILES) {
      const result = execSync(
        `git grep -n "readWorkspaceContinue" -- "${file}" || true`,
        { cwd: ROOT, encoding: 'utf-8' },
      );
      expect(result.trim(), `${file} still calls readWorkspaceContinue`).toBe('');
    }
  });

  it('AC3: readContinueStateSync absent from target files', () => {
    for (const file of TARGET_FILES) {
      const result = execSync(
        `git grep -n "readContinueStateSync" -- "${file}" || true`,
        { cwd: ROOT, encoding: 'utf-8' },
      );
      expect(result.trim(), `${file} still calls readContinueStateSync`).toBe('');
    }
  });

  it('AC3: readFeedback (markdown delivery dir) still present in work-agent-prompt.ts', () => {
    const result = execSync(
      `git grep -n "readFeedback" -- src/lib/cloister/work-agent-prompt.ts || true`,
      { cwd: ROOT, encoding: 'utf-8' },
    );
    expect(result.trim()).not.toBe('');
  });

  it('AC3: readRecordContinueViewSync is imported in all three target files', () => {
    for (const file of TARGET_FILES) {
      const result = execSync(
        `git grep -n "readRecordContinueViewSync" -- "${file}" || true`,
        { cwd: ROOT, encoding: 'utf-8' },
      );
      expect(result.trim(), `${file} missing readRecordContinueViewSync import`).not.toBe('');
    }
  });
});
