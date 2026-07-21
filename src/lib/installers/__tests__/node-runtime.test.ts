import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readShimOwnership,
  resolveNode24Runtime,
  writeOkShim,
  type NodeRuntimeCommandResult,
  type NodeRuntimeListDir,
  type NodeVersionManager,
} from '../node-runtime.js';

const home = '/home/tester';
const success = (stdout: string): NodeRuntimeCommandResult => ({ stdout, stderr: '' });
const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'overdeck-node-runtime-'));
  tempDirectories.push(directory);
  return directory;
}

function fakeListDir(tree: Record<string, readonly string[]>): NodeRuntimeListDir {
  return vi.fn(async (directory: string) => {
    const entries = tree[directory];
    if (!entries) throw new Error(`ENOENT: ${directory}`);
    return entries;
  });
}

function nvmTree(root: string, versions: string[]): Record<string, readonly string[]> {
  const versionsDirectory = join(root, 'versions', 'node');
  return {
    [root]: ['versions'],
    [versionsDirectory]: versions,
    ...Object.fromEntries(versions.map((version) => [join(versionsDirectory, version, 'bin'), ['node', 'npm']])),
  };
}

describe('resolveNode24Runtime', () => {
  it('returns the Node 24 runtime from a fake nvm tree containing Node 22 and Node 24', async () => {
    const root = join(home, '.nvm');
    const runCommand = vi.fn(async () => success('v24.17.0\n'));

    const result = await resolveNode24Runtime({
      env: {},
      homedir: () => home,
      listDir: fakeListDir(nvmTree(root, ['v22.22.0', 'v24.17.0'])),
      runCommand,
    });

    expect(result).toEqual({
      kind: 'runtime',
      nodePath: join(root, 'versions', 'node', 'v24.17.0', 'bin', 'node'),
      source: 'nvm',
    });
  });

  it.each<{
    manager: NodeVersionManager;
    root: string;
    versionsDirectory: string;
    nodeDirectory: (version: string) => string;
  }>([
    {
      manager: 'fnm',
      root: join(home, '.local', 'share', 'fnm'),
      versionsDirectory: join(home, '.local', 'share', 'fnm', 'node-versions'),
      nodeDirectory: (version) => join(home, '.local', 'share', 'fnm', 'node-versions', version, 'installation', 'bin'),
    },
    {
      manager: 'volta',
      root: join(home, '.volta'),
      versionsDirectory: join(home, '.volta', 'tools', 'image', 'node'),
      nodeDirectory: (version) => join(home, '.volta', 'tools', 'image', 'node', version, 'bin'),
    },
    {
      manager: 'mise',
      root: join(home, '.local', 'share', 'mise'),
      versionsDirectory: join(home, '.local', 'share', 'mise', 'installs', 'node'),
      nodeDirectory: (version) => join(home, '.local', 'share', 'mise', 'installs', 'node', version, 'bin'),
    },
    {
      manager: 'asdf',
      root: join(home, '.asdf'),
      versionsDirectory: join(home, '.asdf', 'installs', 'nodejs'),
      nodeDirectory: (version) => join(home, '.asdf', 'installs', 'nodejs', version, 'bin'),
    },
  ])('resolves the $manager runtime layout', async ({ manager, root, versionsDirectory, nodeDirectory }) => {
    const version = '24.17.0';
    const runCommand = vi.fn(async () => success(`v${version}\n`));
    const result = await resolveNode24Runtime({
      env: {},
      homedir: () => home,
      listDir: fakeListDir({
        [root]: ['installed'],
        [versionsDirectory]: [version],
        [nodeDirectory(version)]: ['node'],
      }),
      runCommand,
    });

    expect(result).toEqual({
      kind: 'runtime',
      nodePath: join(nodeDirectory(version), 'node'),
      source: manager,
    });
  });

  it('returns the detected manager when all installed runtimes are older than Node 24', async () => {
    const root = join(home, '.nvm');
    const runCommand = vi.fn(async () => success('v22.22.0\n'));

    const result = await resolveNode24Runtime({
      env: {},
      homedir: () => home,
      listDir: fakeListDir(nvmTree(root, ['v20.19.4', 'v22.22.0'])),
      runCommand,
    });

    expect(result).toEqual({ kind: 'manager-without-24', manager: 'nvm' });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('returns none when no version-manager roots exist', async () => {
    const runCommand = vi.fn(async () => success('v24.17.0\n'));

    const result = await resolveNode24Runtime({
      env: {},
      homedir: () => home,
      listDir: fakeListDir({}),
      runCommand,
    });

    expect(result).toEqual({ kind: 'none' });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('uses a valid explicit override without scanning version managers', async () => {
    const override = '/opt/node-v24/bin/node';
    const listDir = vi.fn(async () => {
      throw new Error('manager scan should not run');
    });
    const runCommand = vi.fn(async () => success('v24.17.0\n'));

    const result = await resolveNode24Runtime({
      env: { OVERDECK_OPEN_KNOWLEDGE_NODE: override },
      homedir: () => home,
      listDir,
      runCommand,
    });

    expect(result).toEqual({ kind: 'runtime', nodePath: override, source: 'override' });
    expect(runCommand).toHaveBeenCalledOnce();
    expect(runCommand).toHaveBeenCalledWith(override, ['--version']);
    expect(listDir).not.toHaveBeenCalled();
  });

  it('rejects an invalid explicit override with the environment variable name', async () => {
    const override = '/opt/node-v22/bin/node';
    const runCommand = vi.fn(async () => success('v22.22.0\n'));

    await expect(resolveNode24Runtime({
      env: { OVERDECK_OPEN_KNOWLEDGE_NODE: override },
      homedir: () => home,
      listDir: fakeListDir({}),
      runCommand,
    })).rejects.toThrow('OVERDECK_OPEN_KNOWLEDGE_NODE');
  });

  it('selects the highest version from path segments and validates only that binary', async () => {
    const root = join(home, '.nvm');
    const runCommand = vi.fn(async () => success('v25.1.0\n'));
    const result = await resolveNode24Runtime({
      env: {},
      homedir: () => home,
      listDir: fakeListDir(nvmTree(root, ['v24.17.0', 'v25.1.0', 'v24.2.1'])),
      runCommand,
    });
    const selectedPath = join(root, 'versions', 'node', 'v25.1.0', 'bin', 'node');

    expect(result).toEqual({ kind: 'runtime', nodePath: selectedPath, source: 'nvm' });
    expect(runCommand).toHaveBeenCalledOnce();
    expect(runCommand).toHaveBeenCalledWith(selectedPath, ['--version']);
  });
});

describe('OpenKnowledge shim', () => {
  it('writes an executable managed shim with the pinned node and entry script', async () => {
    const directory = await createTempDirectory();
    const shimPath = join(directory, '.local', 'bin', 'ok');

    const result = await writeOkShim({
      nodePath: '/opt/node-v24/bin/node',
      entryScript: '/opt/node-v24/lib/node_modules/@inkeep/open-knowledge/dist/cli.mjs',
      shimPath,
    });

    const [content, fileStat] = await Promise.all([readFile(shimPath, 'utf8'), stat(shimPath)]);
    expect(result).toBe(shimPath);
    expect(content).toContain('# overdeck-managed shim (PAN-2984)');
    expect(content).toContain(
      'exec "/opt/node-v24/bin/node" "/opt/node-v24/lib/node_modules/@inkeep/open-knowledge/dist/cli.mjs" "$@"',
    );
    expect(fileStat.mode & 0o777).toBe(0o755);
  });

  it('refuses to overwrite a foreign file and preserves its bytes', async () => {
    const directory = await createTempDirectory();
    const shimPath = join(directory, 'ok');
    const foreignContent = Buffer.from('#!/bin/sh\necho user-owned\n');
    await writeFile(shimPath, foreignContent);

    await expect(writeOkShim({
      nodePath: '/opt/node-v24/bin/node',
      entryScript: '/opt/open-knowledge/cli.mjs',
      shimPath,
    })).rejects.toThrow(shimPath);

    expect(await readFile(shimPath)).toEqual(foreignContent);
  });

  it('rewrites an existing Overdeck-managed shim with new pinned paths', async () => {
    const directory = await createTempDirectory();
    const shimPath = join(directory, 'ok');
    await writeFile(shimPath, '#!/bin/sh\n# overdeck-managed shim (PAN-2984)\nexec old old "$@"\n');

    await writeOkShim({
      nodePath: '/new/node-v24/bin/node',
      entryScript: '/new/open-knowledge/cli.mjs',
      shimPath,
    });

    const content = await readFile(shimPath, 'utf8');
    expect(content).toContain('exec "/new/node-v24/bin/node" "/new/open-knowledge/cli.mjs" "$@"');
    expect(content).not.toContain('exec old old');
  });

  it('classifies absent, managed, and foreign shim files', async () => {
    const directory = await createTempDirectory();
    const absentPath = join(directory, 'absent');
    const managedPath = join(directory, 'managed');
    const foreignPath = join(directory, 'foreign');
    await writeFile(managedPath, '# overdeck-managed shim (PAN-2984)\n');
    await writeFile(foreignPath, '#!/bin/sh\necho foreign\n');

    await expect(readShimOwnership(absentPath)).resolves.toBe('absent');
    await expect(readShimOwnership(managedPath)).resolves.toBe('overdeck');
    await expect(readShimOwnership(foreignPath)).resolves.toBe('foreign');
  });
});
