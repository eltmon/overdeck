import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readWorkspaceIdentity,
  resolveWorkspaceIdentityPath,
  writeWorkspaceIdentity,
  type WorkspaceIdentitySource,
} from '../../../src/lib/memory/identity-record.js';

let tempDir: string | null = null;
let originalHome: string | undefined;

beforeEach(async () => {
  originalHome = process.env.OVERDECK_HOME;
  tempDir = await mkdtemp(join(tmpdir(), 'pan-identity-record-'));
  process.env.OVERDECK_HOME = tempDir;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function row(overrides: Partial<WorkspaceIdentitySource> = {}): WorkspaceIdentitySource {
  return {
    id: 'workspace-1',
    projectId: 'overdeck',
    kind: 'issue',
    name: 'feature-pan-1990',
    path: '/repo/workspaces/feature-pan-1990',
    branchName: 'feature/pan-1990',
    parentBranch: 'main',
    issueId: 'PAN-1990',
    createdAt: 1700000000000,
    ...overrides,
  };
}

describe('writeWorkspaceIdentity / readWorkspaceIdentity (PAN-1990 ac2)', () => {
  it('writes the full identity to metadata.json at the workspace memory root', async () => {
    const path = await writeWorkspaceIdentity(row());

    expect(path).toBe(resolveWorkspaceIdentityPath('overdeck', 'workspace-1'));
    const record = await readWorkspaceIdentity(path);
    expect(record).toMatchObject(row());
  });

  it('merges the identity over existing counters rather than overwriting the whole file', async () => {
    const path = resolveWorkspaceIdentityPath('overdeck', 'workspace-1');
    await writeWorkspaceIdentity(row());

    // Simulate an unrelated field (e.g. a future counter) already present in the file.
    const existing = JSON.parse(await readFile(path, 'utf8'));
    const withCounter = { ...existing, extractionCount: 42 };
    const { writeFile } = await import('fs/promises');
    await writeFile(path, `${JSON.stringify(withCounter, null, 2)}\n`, 'utf8');

    await writeWorkspaceIdentity(row({ name: 'renamed-workspace' }));

    const record = await readWorkspaceIdentity(path);
    expect(record).toMatchObject({ ...row({ name: 'renamed-workspace' }), extractionCount: 42 });
  });

  it('readWorkspaceIdentity returns null for a missing or unreadable file', async () => {
    const path = resolveWorkspaceIdentityPath('overdeck', 'never-written');
    expect(await readWorkspaceIdentity(path)).toBeNull();
  });
});
