/**
 * PAN-4852 WI-3: the sageox pack builds `ox` at add, update and sync, against
 * real files under a temp OVERDECK_HOME and a local bare repo, with the build
 * runner injected (no real `go`, no network).
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { overdeckHome } = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-pack-sageox-home-'));
  process.env.OVERDECK_HOME = home;
  return { overdeckHome: home };
});

import { getGlobalConfigPath } from '../../config-yaml/load.js';
import { __setOxBuildRunnerForTests, isOxBuildReady, type OxBuildRunner } from '../ox-build.js';
import {
  addPack,
  getPack,
  packCacheDir,
  packExtractDir,
  packGoDir,
  packRepoDir,
  packsHome,
  PackSourceError,
  removePack,
  syncPack,
  updatePack,
} from '../sources.js';

const skillMd = (name: string): string => `---\nname: ${name}\ndescription: ${name}.\n---\n`;

/** A local bare repo on branch main, pushed to from a scratch working copy. */
function createUpstream() {
  const scratch = mkdtempSync(join(tmpdir(), 'skill-pack-sageox-upstream-'));
  const work = join(scratch, 'work');
  const url = join(scratch, 'upstream.git');
  const run = (...args: string[]): string =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd: work, encoding: 'utf8' }).trim();
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', url]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  run('remote', 'add', 'origin', url);
  const commitFile = (path: string, content: string, message: string): string => {
    mkdirSync(join(work, path, '..'), { recursive: true });
    writeFileSync(join(work, path), content);
    run('add', '-A');
    run('commit', '-q', '-m', message);
    run('push', '-q', 'origin', 'main');
    return run('rev-parse', 'HEAD');
  };
  return { scratch, url, commitFile };
}

interface Call {
  args: string[];
  cwd: string;
  registered: boolean;
}

/** Records `go` calls; `go build -o <out>` writes an executable; `goMissing` fails every call. */
function fakeRunner(opts: { goMissing?: boolean } = {}) {
  const calls: Call[] = [];
  const run: OxBuildRunner = async (_cmd, args, o) => {
    // Order check: the registry entry must not exist while a build runs.
    calls.push({ args, cwd: o.cwd, registered: (await getPack('sageox')) !== null });
    if (opts.goMissing) throw new Error('spawn go ENOENT');
    if (args[0] === 'version') return { stdout: 'go version go1.24.1 linux/amd64\n' };
    if (args[0] === 'env') return { stdout: 'go1.24.1\n' };
    if (args[0] === 'build') {
      const out = args[2]!;
      writeFileSync(out, '#!/bin/sh\necho fake\n');
      chmodSync(out, 0o755);
    }
    return { stdout: '' };
  };
  const builds = (): Call[] => calls.filter((call) => call.args[0] === 'build');
  return { run, calls, builds };
}

let up: ReturnType<typeof createUpstream>;
let first = '';
let second = '';
const accept = vi.fn(async () => true);
const decline = vi.fn(async () => false);

beforeAll(() => {
  up = createUpstream();
  up.commitFile('go.mod', 'module github.com/sageox/ox\n\ngo 1.26.0\n\ntoolchain go1.27.3\n', 'go.mod');
  up.commitFile('go.sum', 'example.com/x v1.0.0 h1:abc=\n', 'go.sum');
  up.commitFile('cmd/ox/main.go', 'package main\n\nfunc main() {}\n', 'ox');
  first = up.commitFile('extensions/skills/ox-session/SKILL.md', skillMd('ox-session'), 'skill');
  second = up.commitFile('extensions/skills/ox-team/SKILL.md', skillMd('ox-team'), 'second skill');
});

afterAll(() => {
  __setOxBuildRunnerForTests(undefined);
  rmSync(up.scratch, { recursive: true, force: true });
  rmSync(overdeckHome, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(getGlobalConfigPath(), { force: true });
  rmSync(packsHome(), { recursive: true, force: true });
  accept.mockClear();
  decline.mockClear();
});

const binDir = (commit: string): string => join(packExtractDir('sageox', commit), 'bin');

describe('addPack sageox', () => {
  it('previews the build; a declined confirm writes no entry and runs no build', async () => {
    const runner = fakeRunner();
    __setOxBuildRunnerForTests(runner.run);
    const result = await addPack({ id: 'sageox', url: up.url, ref: first }, decline);
    expect(result.written).toBe(false);
    expect(decline).toHaveBeenCalledOnce();
    const bin = binDir(first);
    expect(result.preview.oxBuild).toEqual({
      commands: [
        ['go', 'build', '-o', `${bin}/ox`, './cmd/ox'],
        ['go', 'build', '-o', `${bin}/ox-adapter-claude-code`, './cmd/ox-adapter-claude-code'],
        ['go', 'build', '-o', `${bin}/ox-adapter-codex`, './cmd/ox-adapter-codex'],
      ],
      writes: [`${bin}/`, `${packGoDir('sageox')}/`],
      downloads: ['Go modules listed in go.sum (proxy.golang.org)', 'Go toolchain go1.27.3 (GOTOOLCHAIN=auto)'],
    });
    expect(runner.builds()).toEqual([]);
    expect(await getPack('sageox')).toBeNull();
    expect(existsSync(bin)).toBe(false);
  });

  it('builds after consent, before the registry entry is written', async () => {
    const runner = fakeRunner();
    __setOxBuildRunnerForTests(runner.run);
    expect((await addPack({ id: 'sageox', url: up.url, ref: first }, accept)).written).toBe(true);
    expect(runner.builds().map((call) => call.args[3])).toEqual(['./cmd/ox', './cmd/ox-adapter-claude-code', './cmd/ox-adapter-codex']);
    expect(runner.builds().every((call) => call.cwd === packExtractDir('sageox', first) && !call.registered)).toBe(true);
    expect(await isOxBuildReady(packExtractDir('sageox', first), first)).toBe(true);
    expect(await getPack('sageox')).toEqual({ id: 'sageox', url: up.url, ref: first, commit: first });
  });

  it('refuses before asking when go is missing', async () => {
    __setOxBuildRunnerForTests(fakeRunner({ goMissing: true }).run);
    const error = await addPack({ id: 'sageox', url: up.url, ref: first }, accept).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PackSourceError);
    expect((error as PackSourceError).code).toBe('render');
    expect((error as Error).message).toBe('pack sageox needs go on PATH (https://go.dev/dl/)');
    expect(accept).not.toHaveBeenCalled();
    expect(await getPack('sageox')).toBeNull();
  });
});

describe('updatePack sageox', () => {
  it('previews and builds the new commit when it moves', async () => {
    __setOxBuildRunnerForTests(fakeRunner().run);
    await addPack({ id: 'sageox', url: up.url, ref: first }, accept);
    const runner = fakeRunner();
    __setOxBuildRunnerForTests(runner.run);
    const result = await updatePack('sageox', { ref: second }, accept);
    expect(result.written).toBe(true);
    expect(result.preview.oxBuild?.commands[0]).toEqual(['go', 'build', '-o', `${binDir(second)}/ox`, './cmd/ox']);
    expect(runner.builds()).toHaveLength(3);
    expect(runner.builds().every((call) => call.cwd === packExtractDir('sageox', second))).toBe(true);
    expect(await isOxBuildReady(packExtractDir('sageox', second), second)).toBe(true);
    expect((await getPack('sageox'))?.commit).toBe(second);
  });

  it('asks and builds nothing when the commit and ref are unchanged', async () => {
    __setOxBuildRunnerForTests(fakeRunner().run);
    await addPack({ id: 'sageox', url: up.url, ref: first }, accept);
    accept.mockClear();
    const runner = fakeRunner();
    __setOxBuildRunnerForTests(runner.run);
    const result = await updatePack('sageox', {}, accept);
    expect(result.written).toBe(false);
    expect(result.preview.oxBuild).toBeUndefined();
    expect(accept).not.toHaveBeenCalled();
    expect(runner.calls).toEqual([]);
  });
});

describe('syncPack sageox', () => {
  it('builds again after bin/ is removed, without asking', async () => {
    __setOxBuildRunnerForTests(fakeRunner().run);
    await addPack({ id: 'sageox', url: up.url, ref: first }, accept);
    accept.mockClear();
    rmSync(join(packsHome(), 'sageox', first, 'bin'), { recursive: true, force: true });
    const runner = fakeRunner();
    __setOxBuildRunnerForTests(runner.run);
    expect(await syncPack('sageox')).toEqual({ commit: first, dir: packExtractDir('sageox', first) });
    expect(runner.builds()).toHaveLength(3);
    expect(accept).not.toHaveBeenCalled();
    expect(await isOxBuildReady(packExtractDir('sageox', first), first)).toBe(true);
  });

  it('runs no go command when the build is ready', async () => {
    __setOxBuildRunnerForTests(fakeRunner().run);
    await addPack({ id: 'sageox', url: up.url, ref: first }, accept);
    const runner = fakeRunner();
    __setOxBuildRunnerForTests(runner.run);
    await syncPack('sageox');
    expect(runner.calls).toEqual([]);
  });
});

describe('removePack sageox (WI-4)', () => {
  it('keeps the binding store and deletes the rest of the pack cache', async () => {
    __setOxBuildRunnerForTests(fakeRunner().run);
    await addPack({ id: 'sageox', url: up.url, ref: first }, accept);
    const cacheDir = packCacheDir('sageox');
    const config = join(cacheDir, 'bindings', 'app', 'config.json');
    mkdirSync(join(cacheDir, 'bindings', 'app'), { recursive: true });
    writeFileSync(config, '{}\n');
    expect(existsSync(binDir(first))).toBe(true);
    expect(existsSync(packGoDir('sageox'))).toBe(true);
    expect(existsSync(packRepoDir('sageox'))).toBe(true);

    expect(await removePack('sageox')).toEqual({ removed: true, keptBindings: join(cacheDir, 'bindings') });
    expect(existsSync(config)).toBe(true);
    expect(existsSync(binDir(first))).toBe(false);
    expect(existsSync(packExtractDir('sageox', first))).toBe(false);
    expect(existsSync(packGoDir('sageox'))).toBe(false);
    expect(existsSync(packRepoDir('sageox'))).toBe(false);
    expect(await getPack('sageox')).toBeNull();
  });

  it('deletes a read-only Go toolchain tree in the module cache', async () => {
    __setOxBuildRunnerForTests(fakeRunner().run);
    await addPack({ id: 'sageox', url: up.url, ref: first }, accept);
    const toolchain = join(packGoDir('sageox'), 'mod', 'golang.org', 'toolchain@v0.0.1-go1.27.3.linux-amd64');
    mkdirSync(join(toolchain, 'src'), { recursive: true });
    writeFileSync(join(toolchain, 'LICENSE'), 'x');
    writeFileSync(join(toolchain, 'src', 'a.go'), 'x');
    chmodSync(join(toolchain, 'src'), 0o555);
    chmodSync(toolchain, 0o555);

    expect(await removePack('sageox')).toEqual({ removed: true });
    expect(existsSync(packCacheDir('sageox'))).toBe(false);
  });

  it('deletes the whole cache when there is no binding store', async () => {
    __setOxBuildRunnerForTests(fakeRunner().run);
    await addPack({ id: 'sageox', url: up.url, ref: first }, accept);
    expect(await removePack('sageox')).toEqual({ removed: true });
    expect(existsSync(packCacheDir('sageox'))).toBe(false);
  });
});
