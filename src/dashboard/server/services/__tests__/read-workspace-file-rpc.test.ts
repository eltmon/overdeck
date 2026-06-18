import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { PanRpcError } from '@overdeck/contracts';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const projectPath = vi.hoisted(() => ({ value: '' }));

vi.mock('../../../../lib/projects.js', () => ({
  resolveProjectFromIssue: () => Effect.succeed({ projectPath: projectPath.value, projectKey: 'panopticon-cli' }),
}));

import { readWorkspaceFileEffect } from '../read-workspace-file.js';

const MAX_WORKSPACE_FILE_BYTES = 256 * 1024;

async function runReadWorkspaceFile(input: {
  issueId: string;
  relativePath: string;
  line?: number;
  contextLines?: number;
}) {
  return Effect.runPromise(readWorkspaceFileEffect(input));
}

async function expectPanRpcError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(PanRpcError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe('readWorkspaceFileEffect RPC payload handling', () => {
  let tempRoot: string;
  let workspacePath: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'pan-read-workspace-file-rpc-'));
    projectPath.value = join(tempRoot, 'project');
    workspacePath = join(projectPath.value, 'workspaces', 'feature-pan-1370');
    await mkdir(workspacePath, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('reads a small workspace file through the RPC effect', async () => {
    await writeFile(join(workspacePath, 'notes.md'), ['alpha', 'beta', 'gamma'].join('\n'));

    const result = await runReadWorkspaceFile({
      issueId: 'PAN-1370',
      relativePath: 'notes.md',
    });

    expect(result).toEqual({
      text: ['alpha', 'beta', 'gamma'].join('\n'),
      lang: 'markdown',
      truncated: false,
      totalLines: 3,
    });
  });

  it('rejects parent traversal through the RPC effect', async () => {
    await writeFile(join(projectPath.value, 'outside.txt'), 'outside');

    await expectPanRpcError(
      runReadWorkspaceFile({ issueId: 'PAN-1370', relativePath: '../outside.txt' }),
      'PATH_OUTSIDE_WORKSPACE',
    );
  });

  it('rejects absolute paths outside the workspace through the RPC effect', async () => {
    const outside = resolve(tempRoot, 'outside.txt');
    await writeFile(outside, 'outside');

    await expectPanRpcError(
      runReadWorkspaceFile({ issueId: 'PAN-1370', relativePath: outside }),
      'PATH_OUTSIDE_WORKSPACE',
    );
  });

  it('rejects symlinks to /etc/passwd through the RPC effect', async () => {
    await symlink('/etc/passwd', join(workspacePath, 'passwd-link'));

    await expectPanRpcError(
      runReadWorkspaceFile({ issueId: 'PAN-1370', relativePath: 'passwd-link' }),
      'PATH_OUTSIDE_WORKSPACE',
    );
  });

  it('returns the first 256 KiB for a truncated 1 MiB file through the RPC effect', async () => {
    const prefix = 'a'.repeat(MAX_WORKSPACE_FILE_BYTES);
    await writeFile(join(workspacePath, 'large.txt'), `${prefix}${'b'.repeat(768 * 1024)}`);

    const result = await runReadWorkspaceFile({ issueId: 'PAN-1370', relativePath: 'large.txt' });

    expect(result.text).toBe(prefix);
    expect(result.text).toHaveLength(MAX_WORKSPACE_FILE_BYTES);
    expect(result.truncated).toBe(true);
    expect(result.lang).toBe('plaintext');
  });

  it('maps TypeScript, Markdown, and unknown extensions through the RPC effect', async () => {
    await writeFile(join(workspacePath, 'source.ts'), 'export const value = 1;\n');
    await writeFile(join(workspacePath, 'README.md'), '# Title\n');
    await writeFile(join(workspacePath, 'archive.xyz'), 'unknown\n');

    await expect(runReadWorkspaceFile({ issueId: 'PAN-1370', relativePath: 'source.ts' }))
      .resolves.toMatchObject({ lang: 'typescript' });
    await expect(runReadWorkspaceFile({ issueId: 'PAN-1370', relativePath: 'README.md' }))
      .resolves.toMatchObject({ lang: 'markdown' });
    await expect(runReadWorkspaceFile({ issueId: 'PAN-1370', relativePath: 'archive.xyz' }))
      .resolves.toMatchObject({ lang: 'plaintext' });
  });
});
