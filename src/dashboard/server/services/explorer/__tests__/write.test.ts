import {
  chmod,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  rename as fsRename,
  rm,
  stat,
  symlink,
  writeFile as fsWriteFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PanRpcError } from '@overdeck/contracts';
import type { ExplorerRoot } from '../roots.js';
import { diskSignature } from '../signature.js';
import {
  copy,
  create,
  MAX_EDITABLE_TEXT_BYTES,
  moveEntry,
  type MoveOps,
  rename,
  statEntry,
  WRITE_TEMP_MARKER,
  writeFile,
} from '../write.js';
import { makeFixtureRepo, type FixtureRepo } from './fixture-repo.js';

let repo: FixtureRepo;
let root: ExplorerRoot;

function rootAt(absPath: string, kind: ExplorerRoot['kind'] = 'issue'): ExplorerRoot {
  return {
    kind,
    id: kind === 'project' ? 'project:p' : 'issue:PAN-1',
    absPath,
    writable: kind !== 'project',
    projectKey: 'p',
    defaultBranch: 'main',
  };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PanRpcError);
    return (error as PanRpcError).code;
  }
  return 'resolved';
}

async function exists(abs: string): Promise<boolean> {
  try {
    await lstat(abs);
    return true;
  } catch {
    return false;
  }
}

async function tempFilesIn(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((name) => name.includes(WRITE_TEMP_MARKER));
}

beforeEach(async () => {
  repo = await makeFixtureRepo({ 'a.txt': 'alpha\n', 'src/x.ts': 'export {};\n', 'bin/run.sh': '#!/bin/sh\n' });
  root = rootAt(await realpath(repo.dir));
});

afterEach(async () => {
  await repo.cleanup();
});

describe('writeFile precondition', () => {
  it('writes when the signature matches and returns the signature of the new text', async () => {
    const result = await writeFile(root, 'a.txt', 'beta\n', diskSignature('alpha\n'), false);
    expect(await readFile(join(root.absPath, 'a.txt'), 'utf8')).toBe('beta\n');
    expect(result.signature).toBe(diskSignature('beta\n'));
    expect(result.mtimeMs).toBe((await stat(join(root.absPath, 'a.txt'))).mtimeMs);
  });

  it('throws DISK_CONFLICT on a mismatching signature and leaves the file unchanged', async () => {
    expect(await codeOf(writeFile(root, 'a.txt', 'beta\n', diskSignature('something else'), false))).toBe('DISK_CONFLICT');
    expect(await readFile(join(root.absPath, 'a.txt'), 'utf8')).toBe('alpha\n');
  });

  it('overwrites a changed file when expectedSignature is null', async () => {
    await fsWriteFile(join(root.absPath, 'a.txt'), 'changed elsewhere\n');
    await writeFile(root, 'a.txt', 'mine\n', null, false);
    expect(await readFile(join(root.absPath, 'a.txt'), 'utf8')).toBe('mine\n');
  });

  it('throws DISK_CONFLICT for a missing file with a signature and allowMissing false', async () => {
    expect(await codeOf(writeFile(root, 'gone.txt', 'x', diskSignature('x'), false))).toBe('DISK_CONFLICT');
    expect(await exists(join(root.absPath, 'gone.txt'))).toBe(false);
  });

  it('creates a missing file and its missing parent folder with allowMissing true', async () => {
    await writeFile(root, 'new/deep/file.txt', 'hello\n', diskSignature('old'), true);
    expect(await readFile(join(root.absPath, 'new/deep/file.txt'), 'utf8')).toBe('hello\n');
  });

  it('creates a missing file when expectedSignature is null', async () => {
    await writeFile(root, 'fresh.txt', 'hi\n', null, false);
    expect(await readFile(join(root.absPath, 'fresh.txt'), 'utf8')).toBe('hi\n');
  });

  it('refuses to write over a folder', async () => {
    expect(await codeOf(writeFile(root, 'src', 'x', null, false))).toBe('ALREADY_EXISTS');
  });
});

describe('writeFile on disk', () => {
  it('keeps mode 0o755', async () => {
    const abs = join(root.absPath, 'bin/run.sh');
    await chmod(abs, 0o755);
    await writeFile(root, 'bin/run.sh', '#!/bin/sh\necho hi\n', diskSignature('#!/bin/sh\n'), false);
    expect((await stat(abs)).mode & 0o777).toBe(0o755);
  });

  it('follows a symlink inside the root and keeps the link a link', async () => {
    await symlink('a.txt', join(root.absPath, 'link.txt'));
    await writeFile(root, 'link.txt', 'through the link\n', diskSignature('alpha\n'), false);
    const linkStats = await lstat(join(root.absPath, 'link.txt'));
    expect(linkStats.isSymbolicLink()).toBe(true);
    expect(await readlink(join(root.absPath, 'link.txt'))).toBe('a.txt');
    expect(await readFile(join(root.absPath, 'a.txt'), 'utf8')).toBe('through the link\n');
  });

  it('throws NOT_FOUND for a dangling symlink and creates nothing', async () => {
    await symlink('missing-target.txt', join(root.absPath, 'dangling.txt'));
    expect(await codeOf(writeFile(root, 'dangling.txt', 'x', null, true))).toBe('NOT_FOUND');
    expect(await exists(join(root.absPath, 'missing-target.txt'))).toBe(false);
    expect(await tempFilesIn(root.absPath)).toEqual([]);
  });

  it('leaves no temp file behind', async () => {
    await writeFile(root, 'src/x.ts', 'export const x = 1;\n', diskSignature('export {};\n'), false);
    await writeFile(root, 'src/y.ts', 'export const y = 1;\n', null, false);
    expect(await tempFilesIn(join(root.absPath, 'src'))).toEqual([]);
  });
});

describe('writeFile refusals', () => {
  it('refuses a project root with EDIT_WORKSPACE_REQUIRED', async () => {
    const projectRoot = rootAt(root.absPath, 'project');
    expect(await codeOf(writeFile(projectRoot, 'a.txt', 'x', null, false))).toBe('EDIT_WORKSPACE_REQUIRED');
    expect(await readFile(join(root.absPath, 'a.txt'), 'utf8')).toBe('alpha\n');
  });

  it('refuses .git/config with PATH_IN_GIT_DIR', async () => {
    const before = await readFile(join(root.absPath, '.git/config'), 'utf8');
    expect(await codeOf(writeFile(root, '.git/config', 'x', null, false))).toBe('PATH_IN_GIT_DIR');
    expect(await readFile(join(root.absPath, '.git/config'), 'utf8')).toBe(before);
  });

  it('refuses text one byte over the limit with FILE_TOO_LARGE', async () => {
    const text = 'a'.repeat(MAX_EDITABLE_TEXT_BYTES + 1);
    expect(await codeOf(writeFile(root, 'big.txt', text, null, false))).toBe('FILE_TOO_LARGE');
    expect(await exists(join(root.absPath, 'big.txt'))).toBe(false);
  });

  it('accepts text exactly at the limit', async () => {
    const text = 'a'.repeat(MAX_EDITABLE_TEXT_BYTES);
    await writeFile(root, 'big.txt', text, null, false);
    expect((await stat(join(root.absPath, 'big.txt'))).size).toBe(MAX_EDITABLE_TEXT_BYTES);
  });

  it('keeps a dangling symlink that resolves outside the root a PATH_OUTSIDE_ROOT refusal for its children', async () => {
    await symlink('/nonexistent-dir-for-explorer-test', join(root.absPath, 'out'));
    expect(await codeOf(writeFile(root, 'out/file.txt', 'x', null, true))).toBe('PATH_OUTSIDE_ROOT');
  });
});

describe('create', () => {
  it('creates an empty file and returns its entry', async () => {
    const { entry } = await create(root, 'src/new.ts', 'file');
    expect(entry).toMatchObject({ name: 'new.ts', path: 'src/new.ts', kind: 'file', size: 0, ignored: false });
    expect(await readFile(join(root.absPath, 'src/new.ts'), 'utf8')).toBe('');
  });

  it('creates a folder and returns its entry', async () => {
    const { entry } = await create(root, 'docs', 'dir');
    expect(entry).toMatchObject({ name: 'docs', path: 'docs', kind: 'dir', ignored: false });
    expect((await stat(join(root.absPath, 'docs'))).isDirectory()).toBe(true);
  });

  it('creates missing parent folders', async () => {
    await create(root, 'one/two/three.txt', 'file');
    await create(root, 'four/five', 'dir');
    expect(await exists(join(root.absPath, 'one/two/three.txt'))).toBe(true);
    expect((await stat(join(root.absPath, 'four/five'))).isDirectory()).toBe(true);
  });

  it('throws ALREADY_EXISTS over an existing file or folder and leaves it unchanged', async () => {
    expect(await codeOf(create(root, 'a.txt', 'file'))).toBe('ALREADY_EXISTS');
    expect(await codeOf(create(root, 'a.txt', 'dir'))).toBe('ALREADY_EXISTS');
    expect(await readFile(join(root.absPath, 'a.txt'), 'utf8')).toBe('alpha\n');
    expect(await codeOf(create(root, 'src', 'dir'))).toBe('ALREADY_EXISTS');
    expect(await codeOf(create(root, 'src', 'file'))).toBe('ALREADY_EXISTS');
    expect(await readFile(join(root.absPath, 'src/x.ts'), 'utf8')).toBe('export {};\n');
  });

  it('throws ALREADY_EXISTS over a dangling symlink without creating its target', async () => {
    await symlink('missing-target.txt', join(root.absPath, 'dangling.txt'));
    expect(await codeOf(create(root, 'dangling.txt', 'file'))).toBe('ALREADY_EXISTS');
    expect(await exists(join(root.absPath, 'missing-target.txt'))).toBe(false);
  });

  it('refuses a project root and a git folder', async () => {
    expect(await codeOf(create(rootAt(root.absPath, 'project'), 'n.txt', 'file'))).toBe('EDIT_WORKSPACE_REQUIRED');
    expect(await codeOf(create(root, '.git/hooks/x', 'file'))).toBe('PATH_IN_GIT_DIR');
  });
});

describe('statEntry', () => {
  it('reports a symlink as a symlink, not as its target', async () => {
    await symlink('src', join(root.absPath, 'src-link'));
    expect(await statEntry(root, 'src-link')).toMatchObject({ name: 'src-link', path: 'src-link', kind: 'symlink' });
  });
});

describe('rename', () => {
  it('renames a file', async () => {
    const { entry } = await rename(root, 'a.txt', 'b.txt');
    expect(entry).toMatchObject({ name: 'b.txt', path: 'b.txt', kind: 'file' });
    expect(await exists(join(root.absPath, 'a.txt'))).toBe(false);
    expect(await readFile(join(root.absPath, 'b.txt'), 'utf8')).toBe('alpha\n');
  });

  it('moves a folder with its contents into another folder', async () => {
    await mkdir(join(root.absPath, 'lib'));
    const { entry } = await rename(root, 'src', 'lib/src');
    expect(entry).toMatchObject({ name: 'src', path: 'lib/src', kind: 'dir' });
    expect(await exists(join(root.absPath, 'src'))).toBe(false);
    expect(await readFile(join(root.absPath, 'lib/src/x.ts'), 'utf8')).toBe('export {};\n');
  });

  it('renames a symlink, not its target', async () => {
    await symlink('a.txt', join(root.absPath, 'link.txt'));
    await rename(root, 'link.txt', 'link2.txt');
    expect(await readlink(join(root.absPath, 'link2.txt'))).toBe('a.txt');
    expect(await readFile(join(root.absPath, 'a.txt'), 'utf8')).toBe('alpha\n');
  });

  it('throws ALREADY_EXISTS for an occupied target and moves nothing', async () => {
    expect(await codeOf(rename(root, 'a.txt', 'src/x.ts'))).toBe('ALREADY_EXISTS');
    expect(await readFile(join(root.absPath, 'a.txt'), 'utf8')).toBe('alpha\n');
    expect(await readFile(join(root.absPath, 'src/x.ts'), 'utf8')).toBe('export {};\n');
  });

  it('throws INVALID_TARGET for a folder moved into its own subfolder or onto itself', async () => {
    expect(await codeOf(rename(root, 'src', 'src/inner/src'))).toBe('INVALID_TARGET');
    expect(await codeOf(rename(root, 'src', 'src'))).toBe('INVALID_TARGET');
    expect(await exists(join(root.absPath, 'src/x.ts'))).toBe(true);
  });

  it('throws NOT_FOUND for a missing source or a missing target folder', async () => {
    expect(await codeOf(rename(root, 'nope.txt', 'b.txt'))).toBe('NOT_FOUND');
    expect(await codeOf(rename(root, 'a.txt', 'missing/b.txt'))).toBe('NOT_FOUND');
    expect(await exists(join(root.absPath, 'a.txt'))).toBe(true);
  });

  it('renames a.txt to A.txt by case only', async () => {
    await rename(root, 'a.txt', 'A.txt');
    expect(await exists(join(root.absPath, 'A.txt'))).toBe(true);
  });

  it('refuses a project root and a move into a git folder', async () => {
    expect(await codeOf(rename(rootAt(root.absPath, 'project'), 'a.txt', 'b.txt'))).toBe('EDIT_WORKSPACE_REQUIRED');
    expect(await codeOf(rename(root, 'a.txt', '.git/a.txt'))).toBe('PATH_IN_GIT_DIR');
  });
});

describe('moveEntry', () => {
  it('copies then removes the source when rename throws EXDEV', async () => {
    const calls: string[] = [];
    const ops: MoveOps = {
      rename: (async () => {
        calls.push('rename');
        throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
      }) as unknown as MoveOps['rename'],
      cp: (async (...args: Parameters<typeof cp>) => {
        calls.push('cp');
        return cp(...args);
      }) as MoveOps['cp'],
      rm: (async (...args: Parameters<typeof rm>) => {
        calls.push('rm');
        return rm(...args);
      }) as MoveOps['rm'],
    };
    await moveEntry(join(root.absPath, 'src'), join(root.absPath, 'moved'), ops);
    expect(calls).toEqual(['rename', 'cp', 'rm']);
    expect(await exists(join(root.absPath, 'src'))).toBe(false);
    expect(await readFile(join(root.absPath, 'moved/x.ts'), 'utf8')).toBe('export {};\n');
  });

  it('rethrows a rename error other than EXDEV without copying', async () => {
    const ops: MoveOps = {
      rename: (async () => {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      }) as unknown as MoveOps['rename'],
      cp: (async () => {
        throw new Error('cp must not run');
      }) as unknown as MoveOps['cp'],
      rm: fsRename as unknown as MoveOps['rm'],
    };
    await expect(moveEntry(join(root.absPath, 'a.txt'), join(root.absPath, 'b.txt'), ops)).rejects.toMatchObject({
      code: 'EACCES',
    });
    expect(await exists(join(root.absPath, 'a.txt'))).toBe(true);
  });
});

describe('copy', () => {
  it('copies a file with identical bytes and keeps the source', async () => {
    const bytes = Buffer.from([0, 1, 2, 255, 10, 13]);
    await fsWriteFile(join(root.absPath, 'blob.bin'), bytes);
    const { entry } = await copy(root, 'blob.bin', 'blob copy.bin');
    expect(entry).toMatchObject({ name: 'blob copy.bin', path: 'blob copy.bin', kind: 'file', size: bytes.length });
    expect(Buffer.compare(await readFile(join(root.absPath, 'blob copy.bin')), bytes)).toBe(0);
    expect(Buffer.compare(await readFile(join(root.absPath, 'blob.bin')), bytes)).toBe(0);
  });

  it('copies a folder recursively', async () => {
    await fsWriteFile(join(root.absPath, 'src/nested.txt'), 'n\n');
    await mkdir(join(root.absPath, 'src/deep'));
    await fsWriteFile(join(root.absPath, 'src/deep/z.ts'), 'z\n');
    const { entry } = await copy(root, 'src', 'src2');
    expect(entry).toMatchObject({ path: 'src2', kind: 'dir' });
    for (const rel of ['x.ts', 'nested.txt', 'deep/z.ts']) {
      expect(await readFile(join(root.absPath, 'src2', rel), 'utf8')).toBe(await readFile(join(root.absPath, 'src', rel), 'utf8'));
    }
  });

  it('copies a symlink as a symlink', async () => {
    await symlink('a.txt', join(root.absPath, 'link.txt'));
    await copy(root, 'link.txt', 'link2.txt');
    expect(await readlink(join(root.absPath, 'link2.txt'))).toBe('a.txt');
  });

  it('throws ALREADY_EXISTS for an occupied target and leaves it unchanged', async () => {
    expect(await codeOf(copy(root, 'a.txt', 'src/x.ts'))).toBe('ALREADY_EXISTS');
    expect(await readFile(join(root.absPath, 'src/x.ts'), 'utf8')).toBe('export {};\n');
  });

  it('throws INVALID_TARGET for a copy into its own subfolder', async () => {
    expect(await codeOf(copy(root, 'src', 'src/inner'))).toBe('INVALID_TARGET');
    expect(await exists(join(root.absPath, 'src/inner'))).toBe(false);
  });

  it('throws NOT_FOUND for a missing source', async () => {
    expect(await codeOf(copy(root, 'nope.txt', 'b.txt'))).toBe('NOT_FOUND');
  });
});
