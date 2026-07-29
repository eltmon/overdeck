import { mkdtemp, mkdir, rm, symlink, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PanRpcError } from '@overdeck/contracts';

const state = vi.hoisted(() => ({ projectPath: '', overdeckHome: '' }));

vi.mock('../../../../lib/projects.js', () => ({
  listProjectsSync: () => [{ key: 'overdeck', config: { name: 'Overdeck', path: state.projectPath } }],
}));

vi.mock('../../../../lib/paths.js', () => ({
  get OVERDECK_HOME() {
    return state.overdeckHome;
  },
}));

async function expectPanRpcError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
  await expect(promise).rejects.toBeInstanceOf(PanRpcError);
}

describe('file-at-path', () => {
  let tempRoot: string;
  let projectDir: string;
  let homeDir: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'pan-file-at-path-'));
    projectDir = join(tempRoot, 'project');
    homeDir = join(tempRoot, 'overdeck-home');
    await mkdir(projectDir, { recursive: true });
    await mkdir(homeDir, { recursive: true });
    state.projectPath = projectDir;
    state.overdeckHome = homeDir;
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  describe('readFileAtPath', () => {
    it('reads a markdown file under a registered project root', async () => {
      const { readFileAtPath } = await import('../file-at-path.js');
      const target = join(projectDir, 'docs', 'brief.md');
      await mkdir(join(projectDir, 'docs'), { recursive: true });
      await writeFile(target, 'one\ntwo\nthree');
      const onDiskStat = await stat(target);

      const result = await readFileAtPath({ path: target });

      expect(result).toEqual({
        text: 'one\ntwo\nthree',
        lang: 'markdown',
        mtimeMs: onDiskStat.mtimeMs,
        totalLines: 3,
      });
    });

    it('reads a markdown file under OVERDECK_HOME', async () => {
      const { readFileAtPath } = await import('../file-at-path.js');
      const target = join(homeDir, 'drafts', 'PAN-3260.md');
      await mkdir(join(homeDir, 'drafts'), { recursive: true });
      await writeFile(target, 'draft body');

      const result = await readFileAtPath({ path: target });

      expect(result.text).toBe('draft body');
      expect(result.lang).toBe('markdown');
    });

    it('rejects a path outside every allowlisted root', async () => {
      const { readFileAtPath } = await import('../file-at-path.js');
      const outside = resolve(tempRoot, 'outside.md');
      await writeFile(outside, 'outside');

      await expectPanRpcError(readFileAtPath({ path: outside }), 'PATH_NOT_ALLOWED');
    });

    it('rejects a symlink that resolves outside every allowlisted root', async () => {
      const { readFileAtPath } = await import('../file-at-path.js');
      const outside = resolve(tempRoot, 'outside.md');
      await writeFile(outside, 'outside');
      const link = join(projectDir, 'escape.md');
      await symlink(outside, link);

      await expectPanRpcError(readFileAtPath({ path: link }), 'PATH_NOT_ALLOWED');
    });

    it('rejects an in-root .md symlink whose target is a non-markdown file, with UNSUPPORTED_FILE_TYPE', async () => {
      const { readFileAtPath } = await import('../file-at-path.js');
      const nonMarkdownTarget = join(projectDir, 'package.json');
      await writeFile(nonMarkdownTarget, '{}');
      const alias = join(projectDir, 'alias.md');
      await symlink(nonMarkdownTarget, alias);

      await expectPanRpcError(readFileAtPath({ path: alias }), 'UNSUPPORTED_FILE_TYPE');
    });

    it('rejects a non-markdown extension with UNSUPPORTED_FILE_TYPE', async () => {
      const { readFileAtPath } = await import('../file-at-path.js');
      const target = join(projectDir, 'src.ts');
      await writeFile(target, 'export {}');

      await expectPanRpcError(readFileAtPath({ path: target }), 'UNSUPPORTED_FILE_TYPE');
    });

    it('rejects a markdown file larger than 1 MiB with FILE_TOO_LARGE and returns no text', async () => {
      const { readFileAtPath } = await import('../file-at-path.js');
      const target = join(projectDir, 'large.md');
      await writeFile(target, 'a'.repeat(1024 * 1024 + 1));

      const promise = readFileAtPath({ path: target });
      await expectPanRpcError(promise, 'FILE_TOO_LARGE');
      await expect(promise).rejects.not.toHaveProperty('text');
    });

    it('rejects a path that does not exist with FILE_NOT_FOUND', async () => {
      const { readFileAtPath } = await import('../file-at-path.js');
      const missing = join(projectDir, 'missing.md');

      await expectPanRpcError(readFileAtPath({ path: missing }), 'FILE_NOT_FOUND');
    });

    it('treats a Windows drive-letter path as absolute, not rejecting it at the absoluteness gate', async () => {
      // PAN-3260 review fix: `C:\...` starts with neither `/` nor this host's
      // `path.sep`, so the old `path.startsWith(sep)` check rejected every
      // Windows path with PATH_NOT_ALLOWED / "Path must be absolute" even
      // though the dashboard also ships as a Windows desktop app. This path
      // doesn't exist on this (Linux) test host, so it still fails — but it
      // must fail at realpath (FILE_NOT_FOUND), not at the absoluteness check.
      const { readFileAtPath } = await import('../file-at-path.js');

      const promise = readFileAtPath({ path: 'C:\\Users\\test\\notes.md' });
      await expectPanRpcError(promise, 'FILE_NOT_FOUND');
      await expect(promise).rejects.not.toMatchObject({ message: expect.stringContaining('must be absolute') });
    });
  });

  describe('writeFileAtPath', () => {
    it('persists new content and returns the new mtimeMs when expectedMtimeMs matches', async () => {
      const { readFileAtPath, writeFileAtPath } = await import('../file-at-path.js');
      const target = join(projectDir, 'brief.md');
      await writeFile(target, 'original');
      const read = await readFileAtPath({ path: target });

      const result = await writeFileAtPath({ path: target, content: 'updated', expectedMtimeMs: read.mtimeMs });

      expect(result.mtimeMs).toBeTypeOf('number');
      const reread = await readFileAtPath({ path: target });
      expect(reread.text).toBe('updated');
    });

    it('rejects a stale expectedMtimeMs with WRITE_CONFLICT and leaves the file unchanged', async () => {
      const { writeFileAtPath } = await import('../file-at-path.js');
      const target = join(projectDir, 'brief.md');
      await writeFile(target, 'original');

      await expectPanRpcError(
        writeFileAtPath({ path: target, content: 'clobber', expectedMtimeMs: 1 }),
        'WRITE_CONFLICT',
      );
      const onDisk = await import('node:fs/promises').then((fs) => fs.readFile(target, 'utf8'));
      expect(onDisk).toBe('original');
    });

    it('writes without a conflict check when expectedMtimeMs is omitted', async () => {
      const { writeFileAtPath } = await import('../file-at-path.js');
      const target = join(projectDir, 'brief.md');
      await writeFile(target, 'original');

      await writeFileAtPath({ path: target, content: 'overwritten' });

      const onDisk = await import('node:fs/promises').then((fs) => fs.readFile(target, 'utf8'));
      expect(onDisk).toBe('overwritten');
    });

    it('never creates a new file — rejects a missing path with FILE_NOT_FOUND', async () => {
      const { writeFileAtPath } = await import('../file-at-path.js');
      const missing = join(projectDir, 'new.md');

      await expectPanRpcError(writeFileAtPath({ path: missing, content: 'hello' }), 'FILE_NOT_FOUND');
    });

    it('rejects a path outside every allowlisted root', async () => {
      const { writeFileAtPath } = await import('../file-at-path.js');
      const outside = resolve(tempRoot, 'outside.md');
      await writeFile(outside, 'outside');

      await expectPanRpcError(writeFileAtPath({ path: outside, content: 'hi' }), 'PATH_NOT_ALLOWED');
    });

    it('rejects a write through an in-root .md symlink to a non-markdown file, leaving it unchanged', async () => {
      const { writeFileAtPath } = await import('../file-at-path.js');
      const nonMarkdownTarget = join(projectDir, 'package.json');
      await writeFile(nonMarkdownTarget, '{}');
      const alias = join(projectDir, 'alias.md');
      await symlink(nonMarkdownTarget, alias);

      await expectPanRpcError(writeFileAtPath({ path: alias, content: 'clobbered' }), 'UNSUPPORTED_FILE_TYPE');
      const onDisk = await import('node:fs/promises').then((fs) => fs.readFile(nonMarkdownTarget, 'utf8'));
      expect(onDisk).toBe('{}');
    });
  });
});
