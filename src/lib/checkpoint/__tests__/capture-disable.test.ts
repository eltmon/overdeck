import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { captureCheckpoint, isCheckpointTargetDisabled } from '../checkpoint-manager.js';

describe('checkpoint capture on a non-git workspace (PAN-3725)', () => {
  let workspace: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // A fresh temp directory that is deliberately NOT a git repository —
    // the shape of a polyrepo wrapper workspace.
    workspace = await mkdtemp(join(tmpdir(), 'pan-3725-'));
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    await rm(workspace, { recursive: true, force: true });
  });

  it('disables the target after the first failure and never spawns git again', async () => {
    await expect(
      Effect.runPromise(captureCheckpoint(workspace, 'agent-min-889-slot-1', 'turn-1')),
    ).rejects.toThrow(/not a git repository/i);

    expect(isCheckpointTargetDisabled(workspace)).toBe(true);

    // Remove the directory: any further git spawn would now fail with ENOENT on
    // the cwd. A clean resolve proves the guard short-circuited before spawning.
    await rm(workspace, { recursive: true, force: true });

    await expect(
      Effect.runPromise(captureCheckpoint(workspace, 'agent-min-889-slot-1', 'turn-2')),
    ).resolves.toBeUndefined();
  });

  it('logs exactly one warning naming the workspace path', async () => {
    await Effect.runPromise(captureCheckpoint(workspace, 'agent-min-889-slot-2', 'turn-1')).catch(() => {});
    await Effect.runPromise(captureCheckpoint(workspace, 'agent-min-889-slot-2', 'turn-2')).catch(() => {});

    const disableWarnings = warnSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes(workspace),
    );
    expect(disableWarnings).toHaveLength(1);
    expect(disableWarnings[0]?.[0]).toContain('not a git repository');
  });

  it('leaves other workspaces untouched', async () => {
    await Effect.runPromise(captureCheckpoint(workspace, 'agent-min-889-slot-3', 'turn-1')).catch(() => {});

    expect(isCheckpointTargetDisabled(workspace)).toBe(true);
    expect(isCheckpointTargetDisabled(`${workspace}-other`)).toBe(false);
  });
});
