import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

import { PanRpcError } from '@overdeck/contracts';

const projectPath = vi.hoisted(() => ({ value: '' }));

vi.mock('../../../../lib/projects.js', () => ({
  resolveProjectFromIssue: () => Effect.succeed({ projectPath: projectPath.value, projectKey: 'panopticon-cli' }),
}));

async function expectPanRpcError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
  await expect(promise).rejects.toBeInstanceOf(PanRpcError);
}

describe('readWorkspaceFile', () => {
  let tempRoot: string;
  let workspacePath: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'pan-read-workspace-file-'));
    projectPath.value = join(tempRoot, 'project');
    workspacePath = join(projectPath.value, 'workspaces', 'feature-pan-1370');
    await mkdir(workspacePath, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('reads a workspace file with context lines and language metadata', async () => {
    const { readWorkspaceFile } = await import('../read-workspace-file.js');
    await writeFile(join(workspacePath, 'src.ts'), ['one', 'two', 'three', 'four', 'five'].join('\n'));

    const result = await readWorkspaceFile({
      issueId: 'PAN-1370',
      relativePath: 'src.ts',
      line: 3,
      contextLines: 1,
    });

    expect(result).toEqual({
      text: ['two', 'three', 'four'].join('\n'),
      lang: 'typescript',
      truncated: false,
      totalLines: 5,
    });
  });

  it('rejects lexical traversal outside the workspace', async () => {
    const { readWorkspaceFile } = await import('../read-workspace-file.js');
    await writeFile(join(projectPath.value, 'outside.txt'), 'outside');

    await expectPanRpcError(
      readWorkspaceFile({ issueId: 'PAN-1370', relativePath: '../outside.txt' }),
      'PATH_OUTSIDE_WORKSPACE',
    );
  });

  it('rejects absolute paths outside the workspace', async () => {
    const { readWorkspaceFile } = await import('../read-workspace-file.js');
    const outside = resolve(tempRoot, 'outside.txt');
    await writeFile(outside, 'outside');

    await expectPanRpcError(
      readWorkspaceFile({ issueId: 'PAN-1370', relativePath: outside }),
      'PATH_OUTSIDE_WORKSPACE',
    );
  });

  it('rejects symlinks that escape the workspace', async () => {
    const { readWorkspaceFile } = await import('../read-workspace-file.js');
    const outside = resolve(tempRoot, 'outside.md');
    await writeFile(outside, 'outside');
    await symlink(outside, join(workspacePath, 'escape.md'));

    await expectPanRpcError(
      readWorkspaceFile({ issueId: 'PAN-1370', relativePath: 'escape.md' }),
      'PATH_OUTSIDE_WORKSPACE',
    );
  });

  it('returns a bounded top-of-file excerpt when contextLines is provided without a line', async () => {
    const { readWorkspaceFile } = await import('../read-workspace-file.js');
    await writeFile(join(workspacePath, 'src.ts'), ['one', 'two', 'three', 'four', 'five'].join('\n'));

    const result = await readWorkspaceFile({
      issueId: 'PAN-1370',
      relativePath: 'src.ts',
      contextLines: 2,
    });

    expect(result).toEqual({
      text: ['one', 'two'].join('\n'),
      lang: 'typescript',
      truncated: false,
      totalLines: 5,
    });
  });

  it('caps reads at 256 KiB and reports truncation', async () => {
    const { readWorkspaceFile } = await import('../read-workspace-file.js');
    const body = `${'a'.repeat(256 * 1024)}overflow`;
    await writeFile(join(workspacePath, 'large.txt'), body);

    const result = await readWorkspaceFile({ issueId: 'PAN-1370', relativePath: 'large.txt' });

    expect(result.text).toHaveLength(256 * 1024);
    expect(result.truncated).toBe(true);
    expect(result.lang).toBe('plaintext');
  });

  it('maps common extensions and falls back to plaintext', async () => {
    const { languageForPath } = await import('../read-workspace-file.js');

    expect(languageForPath('/workspace/Component.tsx')).toBe('tsx');
    expect(languageForPath('/workspace/config.yml')).toBe('yaml');
    expect(languageForPath('/workspace/unknown.extension')).toBe('plaintext');
  });
});
