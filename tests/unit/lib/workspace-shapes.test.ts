import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isSlotWorkspaceDirectoryName,
  resolveIssueWorkspaceDirs,
} from '../../../src/lib/workspaces/shapes.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pan-3887-shapes-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('resolveIssueWorkspaceDirs (PAN-3887)', () => {
  it('resolves base, strike, and slot shapes in removal order', () => {
    const dir = join(root, 'workspaces');
    for (const name of ['feature-pan-2796', 'feature-pan-2796-strike', 'feature-pan-2796-slot-1', 'feature-pan-2796-slot-2']) {
      mkdirSync(join(dir, name), { recursive: true });
    }

    const resolved = resolveIssueWorkspaceDirs(dir, 'pan-2796');
    expect(resolved.map((r) => r.name)).toEqual([
      'feature-pan-2796-slot-1',
      'feature-pan-2796-slot-2',
      'feature-pan-2796-strike',
      'feature-pan-2796',
    ]);
    expect(resolved.map((r) => r.shape)).toEqual(['slot', 'slot', 'strike', 'base']);
    expect(resolved.map((r) => r.branch)).toEqual([
      'feature/pan-2796-slot-1',
      'feature/pan-2796-slot-2',
      'strike/pan-2796',
      'feature/pan-2796',
    ]);
  });

  it('resolves a lone strike workspace (the reported bug: destroy refused it)', () => {
    const dir = join(root, 'workspaces');
    mkdirSync(join(dir, 'feature-pan-2796-strike'), { recursive: true });

    const resolved = resolveIssueWorkspaceDirs(dir, 'pan-2796');
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({ name: 'feature-pan-2796-strike', shape: 'strike' });
  });

  it('ignores operator-preserved slot archives and other issues', () => {
    const dir = join(root, 'workspaces');
    for (const name of [
      'feature-pan-2796-slot-1',
      'feature-pan-2796-slot-1-reset-backup-20260814',
      'feature-pan-2796-slot-2-failed-20260814',
      'feature-pan-2800-strike',
    ]) {
      mkdirSync(join(dir, name), { recursive: true });
    }

    const resolved = resolveIssueWorkspaceDirs(dir, 'pan-2796');
    expect(resolved.map((r) => r.name)).toEqual(['feature-pan-2796-slot-1']);
  });

  it('returns empty when the workspaces dir is missing', () => {
    expect(resolveIssueWorkspaceDirs(join(root, 'nope'), 'pan-2796')).toEqual([]);
  });
});

describe('isSlotWorkspaceDirectoryName', () => {
  it('accepts only exact <base>-slot-<integer> names', () => {
    expect(isSlotWorkspaceDirectoryName('feature-pan-1', 'feature-pan-1-slot-3')).toBe(true);
    expect(isSlotWorkspaceDirectoryName('feature-pan-1', 'feature-pan-1-slot-3-reset-backup-20260814')).toBe(false);
    expect(isSlotWorkspaceDirectoryName('feature-pan-1', 'feature-pan-1-strike')).toBe(false);
    expect(isSlotWorkspaceDirectoryName('feature-pan-1', 'feature-pan-1')).toBe(false);
  });
});
