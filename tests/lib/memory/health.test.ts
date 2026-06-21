import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readMemoryHealthSnapshot,
  updateMemoryHealth,
  type MemoryHealthChangedPayload,
} from '../../../src/lib/memory/health.js';

let tempDir: string | null = null;
let originalHome: string | undefined;

const identity = {
  projectId: 'overdeck',
  workspaceId: 'feature-pan-1052',
  issueId: 'PAN-1052',
  runId: 'run-1',
  sessionId: 'session-1',
  agentRole: 'work',
  agentHarness: 'claude-code',
} as const;

beforeEach(async () => {
  originalHome = process.env.OVERDECK_HOME;
  tempDir = await mkdtemp(join(tmpdir(), 'pan-memory-health-'));
  process.env.OVERDECK_HOME = tempDir;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('updateMemoryHealth detail handling', () => {
  it('persists the failure detail and emits it on the healthy→failing transition', async () => {
    const emit = vi.fn<(p: MemoryHealthChangedPayload, ts: string) => void>();

    const next = await updateMemoryHealth(
      identity,
      { status: 'failing', reason: 'extraction-failed', detail: 'cliproxy/gpt-4.1-nano: unknown provider', success: false },
      { emitHealthChanged: emit },
    );

    expect(next.last_failure_detail).toBe('cliproxy/gpt-4.1-nano: unknown provider');
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![0]).toMatchObject({
      status: 'failing',
      reason: 'extraction-failed',
      detail: 'cliproxy/gpt-4.1-nano: unknown provider',
    });
  });

  it('preserves a prior detail when a later detail-less failure write arrives', async () => {
    const emit = vi.fn();
    await updateMemoryHealth(
      identity,
      { status: 'failing', reason: 'extraction-failed', detail: 'real provider error', success: false },
      { emitHealthChanged: emit },
    );

    // Second write (e.g. the pipeline re-recording the same reason) carries no detail.
    const next = await updateMemoryHealth(
      identity,
      { status: 'failing', reason: 'extraction-failed', success: false },
      { emitHealthChanged: emit },
    );

    expect(next.last_failure_detail).toBe('real provider error');
    // No new emit: status unchanged and detail unchanged.
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('re-emits when the failure detail changes while already failing', async () => {
    const emit = vi.fn();
    await updateMemoryHealth(
      identity,
      { status: 'failing', reason: 'extraction-failed', detail: 'first cause', success: false },
      { emitHealthChanged: emit },
    );

    await updateMemoryHealth(
      identity,
      { status: 'failing', reason: 'extraction-failed', detail: 'second cause', success: false },
      { emitHealthChanged: emit },
    );

    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[1]![0]).toMatchObject({ detail: 'second cause' });
  });

  it('clears the detail and emits healthy on recovery', async () => {
    const emit = vi.fn();
    await updateMemoryHealth(
      identity,
      { status: 'failing', reason: 'extraction-failed', detail: 'some cause', success: false },
      { emitHealthChanged: emit },
    );

    const next = await updateMemoryHealth(identity, { status: 'healthy', success: true }, { emitHealthChanged: emit });

    expect(next.last_failure_detail).toBeNull();
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[1]![0]).toMatchObject({ status: 'healthy' });
    expect(emit.mock.calls[1]![0].detail).toBeUndefined();

    const persisted = await readMemoryHealthSnapshot(identity);
    expect(persisted.last_failure_detail).toBeNull();
  });
});
