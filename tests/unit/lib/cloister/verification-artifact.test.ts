import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readVerificationArtifact,
  verificationArtifactPath,
  writeVerificationArtifact,
} from '../../../../src/lib/cloister/verification-artifact.js';
import type { QualityGateResult } from '../../../../src/lib/cloister/validation.js';

const gate = (overrides: Partial<QualityGateResult>): QualityGateResult => ({
  name: 'lint',
  passed: true,
  required: true,
  output: '',
  durationMs: 1000,
  ...overrides,
});

describe('verification artifact', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'verif-artifact-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('round-trips a passing run and drops passing-gate output', () => {
    writeVerificationArtifact(workspace, 'PAN-1', [
      gate({ name: 'typecheck', output: 'lots of build noise' }),
      gate({ name: 'lint', output: 'more noise' }),
    ]);

    const read = readVerificationArtifact(workspace);
    expect(read).toMatchObject({ issueId: 'PAN-1', outcome: 'passed' });
    expect(read?.failedCheck).toBeUndefined();
    expect(read?.gates).toHaveLength(2);
    expect(read?.gates.every((g) => g.output === undefined)).toBe(true);
  });

  it('records the failed check and keeps its output', () => {
    writeVerificationArtifact(workspace, 'PAN-2', [
      gate({ name: 'typecheck' }),
      gate({ name: 'lint', passed: false, output: 'prompt lint failed:\n  item-loop-order', error: 'exit 1' }),
    ]);

    const read = readVerificationArtifact(workspace);
    expect(read).toMatchObject({ outcome: 'failed', failedCheck: 'lint' });
    const lint = read?.gates.find((g) => g.name === 'lint');
    expect(lint?.output).toContain('item-loop-order');
    expect(lint?.error).toBe('exit 1');
  });

  it('ignores optional-gate failures for the overall outcome', () => {
    writeVerificationArtifact(workspace, 'PAN-3', [
      gate({ name: 'lint' }),
      gate({ name: 'coverage', passed: false, required: false }),
    ]);

    expect(readVerificationArtifact(workspace)?.outcome).toBe('passed');
  });

  it('marks an in-progress run as running with the current gate (PAN-2665 live view)', () => {
    writeVerificationArtifact(workspace, 'PAN-5', [gate({ name: 'typecheck' })], { currentGate: 'lint' });

    const read = readVerificationArtifact(workspace);
    expect(read).toMatchObject({ outcome: 'running', currentGate: 'lint' });
    expect(read?.failedCheck).toBeUndefined();
    expect(read?.gates.map((g) => g.name)).toEqual(['typecheck']);
  });

  it('returns null for a missing or corrupt artifact', () => {
    expect(readVerificationArtifact(workspace)).toBeNull();

    mkdirSync(join(workspace, '.overdeck'), { recursive: true });
    writeFileSync(verificationArtifactPath(workspace), 'not json');
    expect(readVerificationArtifact(workspace)).toBeNull();
  });
});
