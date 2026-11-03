/**
 * PAN-4852 WI-2: the sageox build module, with an injected runner that writes
 * fake executables (no real `go`, no network).
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertGoAvailable,
  buildOx,
  isOxBuildReady,
  OX_BUILD_MARKER,
  OxBuildError,
  oxBuildCommands,
  oxBuildDownloads,
  oxBuildEnv,
  type OxBuildRunner,
} from '../ox-build.js';

const COMMIT = 'a'.repeat(40);
const GO_VERSION = 'go version go1.26.0 linux/amd64';
const dirs: string[] = [];

interface Call {
  cmd: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeout: number;
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'skill-pack-ox-build-'));
  dirs.push(root);
  const extractDir = join(root, 'packs', 'sageox', COMMIT);
  mkdirSync(extractDir, { recursive: true });
  return { extractDir, goDir: join(root, 'packs', 'sageox', 'go') };
}

/** Records calls; `go build -o <out>` writes an executable at `<out>`; `failOn` throws with a stderr. */
function fakeRunner(opts: { failOn?: (call: Call) => boolean; goVersion?: string } = {}) {
  const calls: Call[] = [];
  const run: OxBuildRunner = async (cmd, args, o) => {
    const call = { cmd, args, ...o };
    calls.push(call);
    if (opts.failOn?.(call)) {
      throw Object.assign(new Error('Command failed'), { stderr: 'line 1\n# ox\ncmd/ox/main.go:3: undefined: boom\n' });
    }
    if (args[0] === 'version') return { stdout: `${GO_VERSION}\n` };
    if (args[0] === 'env') return { stdout: `${opts.goVersion ?? 'go1.26.0'}\n` };
    if (args[0] === 'build') {
      const out = args[2]!;
      writeFileSync(out, '#!/bin/sh\necho fake\n');
      chmodSync(out, 0o755);
    }
    return { stdout: '' };
  };
  return { run, calls };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('oxBuildCommands', () => {
  it('builds ox and both adapters into the bin dir', () => {
    expect(oxBuildCommands('/p/bin')).toEqual([
      ['go', 'build', '-o', '/p/bin/ox', './cmd/ox'],
      ['go', 'build', '-o', '/p/bin/ox-adapter-claude-code', './cmd/ox-adapter-claude-code'],
      ['go', 'build', '-o', '/p/bin/ox-adapter-codex', './cmd/ox-adapter-codex'],
    ]);
  });
});

describe('oxBuildEnv', () => {
  it('keeps the base env and puts every Go dir under goDir', () => {
    const env = oxBuildEnv('/p/go', { PATH: '/usr/bin', HOME: '/home/u' });
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/u',
      GOCACHE: '/p/go/cache',
      GOMODCACHE: '/p/go/mod',
      GOPATH: '/p/go/path',
      XDG_CONFIG_HOME: '/p/go/config',
      GOFLAGS: '-modcacherw',
    });
  });
});

describe('buildOx', () => {
  it('runs the three commands in the extraction with every Go dir under goDir', async () => {
    const f = fixture();
    const { run, calls } = fakeRunner();
    await buildOx({ ...f, commit: COMMIT, run });

    const builds = calls.filter((c) => c.args[0] === 'build');
    expect(builds.map((c) => [c.cmd, ...c.args])).toEqual(oxBuildCommands(join(f.extractDir, 'bin')));
    for (const call of builds) {
      expect(call.cwd).toBe(f.extractDir);
      expect(call.timeout).toBe(15 * 60_000);
      for (const key of ['GOCACHE', 'GOMODCACHE', 'GOPATH', 'XDG_CONFIG_HOME']) {
        expect(call.env[key]!.startsWith(`${f.goDir}/`)).toBe(true);
      }
      expect(call.env['GOFLAGS']).toContain('-modcacherw');
    }
    // The go probe also runs with the build env, so it writes no telemetry into HOME.
    expect(calls[0]!.args).toEqual(['version']);
    expect(calls[0]!.env['XDG_CONFIG_HOME']).toBe(join(f.goDir, 'config'));
    expect(existsSync(f.goDir)).toBe(true);
  });

  it('is ready for the built commit only, with the marker written last', async () => {
    const f = fixture();
    const { run } = fakeRunner();
    await buildOx({ ...f, commit: COMMIT, run });

    expect(await isOxBuildReady(f.extractDir, COMMIT)).toBe(true);
    expect(await isOxBuildReady(f.extractDir, 'b'.repeat(40))).toBe(false);
    const marker = JSON.parse(readFileSync(join(f.extractDir, 'bin', OX_BUILD_MARKER), 'utf8'));
    expect(marker).toMatchObject({
      version: 1,
      commit: COMMIT,
      binaries: ['ox', 'ox-adapter-claude-code', 'ox-adapter-codex'],
      goVersion: GO_VERSION,
    });
    expect(Number.isNaN(Date.parse(marker.builtAt))).toBe(false);
  });

  it('records the go version the build ran with, read in the extraction with the build env', async () => {
    const f = fixture();
    const { run, calls } = fakeRunner();
    await buildOx({ ...f, commit: COMMIT, run });
    const last = calls.at(-1)!;
    expect(last.args).toEqual(['version']);
    expect(last.cwd).toBe(f.extractDir);
    expect(last.env['GOMODCACHE']).toBe(join(f.goDir, 'mod'));
  });

  it('replaces an earlier partial bin dir', async () => {
    const f = fixture();
    mkdirSync(join(f.extractDir, 'bin'));
    writeFileSync(join(f.extractDir, 'bin', 'stale'), 'x');
    await buildOx({ ...f, commit: COMMIT, run: fakeRunner().run });
    expect(existsSync(join(f.extractDir, 'bin', 'stale'))).toBe(false);
  });

  it('removes bin/ and reports the stderr tail when a command fails', async () => {
    const f = fixture();
    const { run } = fakeRunner({ failOn: (c) => c.args[0] === 'build' && c.args[3] === './cmd/ox-adapter-claude-code' });
    const error = await buildOx({ ...f, commit: COMMIT, run }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OxBuildError);
    expect((error as Error).name).toBe('OxBuildError');
    expect((error as Error).message).toBe('pack sageox: go build failed: line 1\n# ox\ncmd/ox/main.go:3: undefined: boom');
    expect(existsSync(join(f.extractDir, 'bin'))).toBe(false);
    expect(await isOxBuildReady(f.extractDir, COMMIT)).toBe(false);
  });

  it('fails with the go-missing message when go version fails, before building', async () => {
    const f = fixture();
    const { run, calls } = fakeRunner({ failOn: (c) => c.args[0] === 'version' });
    await expect(buildOx({ ...f, commit: COMMIT, run })).rejects.toThrow(
      new OxBuildError('pack sageox needs go on PATH (https://go.dev/dl/)'),
    );
    expect(calls.some((c) => c.args[0] === 'build')).toBe(false);
  });
});

describe('assertGoAvailable', () => {
  it('returns the go version output', async () => {
    expect(await assertGoAvailable(fakeRunner().run)).toBe(GO_VERSION);
  });

  it('throws exactly the go-missing message', async () => {
    const error = await assertGoAvailable(fakeRunner({ failOn: () => true }).run).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OxBuildError);
    expect((error as Error).message).toBe('pack sageox needs go on PATH (https://go.dev/dl/)');
  });
});

describe('isOxBuildReady', () => {
  it('is false without a marker, with a bad marker, or without an executable ox', async () => {
    const f = fixture();
    const binDir = join(f.extractDir, 'bin');
    expect(await isOxBuildReady(f.extractDir, COMMIT)).toBe(false);
    mkdirSync(binDir);
    writeFileSync(join(binDir, OX_BUILD_MARKER), 'not json');
    expect(await isOxBuildReady(f.extractDir, COMMIT)).toBe(false);
    writeFileSync(join(binDir, OX_BUILD_MARKER), JSON.stringify({ version: 1, commit: COMMIT }));
    expect(await isOxBuildReady(f.extractDir, COMMIT)).toBe(false);
    writeFileSync(join(binDir, 'ox'), 'x');
    chmodSync(join(binDir, 'ox'), 0o644);
    expect(await isOxBuildReady(f.extractDir, COMMIT)).toBe(false);
    chmodSync(join(binDir, 'ox'), 0o755);
    expect(await isOxBuildReady(f.extractDir, COMMIT)).toBe(true);
    writeFileSync(join(binDir, OX_BUILD_MARKER), JSON.stringify({ version: 2, commit: COMMIT }));
    expect(await isOxBuildReady(f.extractDir, COMMIT)).toBe(false);
  });
});

describe('oxBuildDownloads', () => {
  function withGoFiles(goLine: string) {
    const f = fixture();
    writeFileSync(join(f.extractDir, 'go.mod'), `module github.com/sageox/ox\n\n${goLine}\n\nrequire example.com/x v1.0.0\n`);
    writeFileSync(join(f.extractDir, 'go.sum'), 'example.com/x v1.0.0 h1:abc=\n');
    return f;
  }

  it('names the modules and the toolchain when the host go is older', async () => {
    const f = withGoFiles('go 1.26');
    expect(await oxBuildDownloads(f.extractDir, fakeRunner({ goVersion: 'go1.24.1' }).run)).toEqual([
      'Go modules listed in go.sum (proxy.golang.org)',
      'Go toolchain go1.26 (GOTOOLCHAIN=auto)',
    ]);
  });

  it('names only the modules when the host go is new enough', async () => {
    const f = withGoFiles('go 1.26.0');
    expect(await oxBuildDownloads(f.extractDir, fakeRunner({ goVersion: 'go1.26.0' }).run)).toEqual([
      'Go modules listed in go.sum (proxy.golang.org)',
    ]);
    expect(await oxBuildDownloads(f.extractDir, fakeRunner({ goVersion: 'go1.27.1' }).run)).toEqual([
      'Go modules listed in go.sum (proxy.golang.org)',
    ]);
  });

  it('names the toolchain line when go.mod asks for a newer toolchain than its go line', async () => {
    const f = withGoFiles('go 1.26.0\n\ntoolchain go1.27.3');
    expect(await oxBuildDownloads(f.extractDir, fakeRunner({ goVersion: 'go1.24.1' }).run)).toEqual([
      'Go modules listed in go.sum (proxy.golang.org)',
      'Go toolchain go1.27.3 (GOTOOLCHAIN=auto)',
    ]);
    expect(await oxBuildDownloads(f.extractDir, fakeRunner({ goVersion: 'go1.26.2' }).run)).toContain(
      'Go toolchain go1.27.3 (GOTOOLCHAIN=auto)',
    );
    expect(await oxBuildDownloads(f.extractDir, fakeRunner({ goVersion: 'go1.27.3' }).run)).toEqual([
      'Go modules listed in go.sum (proxy.golang.org)',
    ]);
  });

  it('discloses the toolchain when the host version cannot be read, and probes with the build env', async () => {
    const f = withGoFiles('go 1.26');
    const { run, calls } = fakeRunner({ failOn: (c) => c.args[0] === 'env' });
    expect(await oxBuildDownloads(f.extractDir, run, f.goDir)).toContain('Go toolchain go1.26 (GOTOOLCHAIN=auto)');
    expect(calls[0]!.env['XDG_CONFIG_HOME']).toBe(join(f.goDir, 'config'));
  });
});
