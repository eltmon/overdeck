import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NormalizedSemgrepConfig } from '../../../../src/lib/config-yaml/semgrep.js';
import type { WorkspaceRepoRoot } from '../../../../src/lib/project-repos.js';
import type { SastLatestRecord } from '../../../../src/lib/cloister/sast-gate.js';
import {
  runSastGate,
  runScannerProcess,
  sastScannerEnv,
  type ScannerOutcome,
  type SastRunDeps,
} from '../../../../src/lib/cloister/sast-run.js';

const ROOT: WorkspaceRepoRoot = {
  repoKey: 'pan-1',
  dir: '/ws/feature-pan-1',
  sourceBranch: 'feature/pan-1',
  targetBranch: 'main',
  isPolyrepo: false,
};

const DIFF = [
  'diff --git a/src/app.py b/src/app.py',
  '--- a/src/app.py',
  '+++ b/src/app.py',
  '@@ -2,0 +3,1 @@',
  '+    subprocess.call(x, shell=True)  # nosemgrep',
  '',
].join('\n');

const REPORT = (line: number, severity = 'ERROR') => JSON.stringify({
  results: [{ check_id: 'rule.shell', path: 'src/app.py', start: { line }, end: { line }, extra: { message: 'avoid shell=True', severity } }],
  errors: [],
});

function semgrepConfig(over: Partial<NormalizedSemgrepConfig> = {}): NormalizedSemgrepConfig {
  return {
    enabled: true, mcp: false, edit_hook: false, gate: 'advisory', severity: 'ERROR', configs: ['p/default'], timeout_seconds: 300,
    ...over,
  };
}

function harness(opts: {
  config?: Partial<NormalizedSemgrepConfig>;
  targets?: string;
  diff?: string;
  binary?: boolean;
  scanner?: ScannerOutcome | (() => Promise<ScannerOutcome>);
  git?: SastRunDeps['git'];
} = {}) {
  const release = vi.fn(async () => undefined);
  const acquire = vi.fn(async () => ({
    admittedAt: '2026-11-16T00:00:00.000Z', slot: 0, slots: 2, footprintBytes: 0, admittedAlone: false,
    recordPeak: async () => undefined, release,
  }));
  const git = vi.fn(opts.git ?? (async (_cwd: string, args: string[]) => {
    if (args[0] === 'rev-parse') return 'headsha\n';
    if (args[0] === 'merge-base') return 'basesha\n';
    if (args.includes('--name-only')) return opts.targets ?? 'src/app.py\0';
    return opts.diff ?? DIFF;
  }));
  const scanner = opts.scanner ?? { exitCode: 1, stdout: REPORT(3), stderr: '', timedOut: false };
  const runScanner = vi.fn(typeof scanner === 'function' ? scanner : async () => scanner);
  const writeRecord = vi.fn(async (_path: string, _record: SastLatestRecord) => undefined);
  const deps: SastRunDeps = {
    loadSemgrepConfig: async () => semgrepConfig(opts.config),
    binaryPath: '/home/u/.overdeck/bin/semgrep',
    binaryExists: async () => opts.binary ?? true,
    git,
    runScanner,
    acquireAdmission: acquire as unknown as SastRunDeps['acquireAdmission'],
    writeRecord,
    log: () => undefined,
  };
  return { deps, git, runScanner, acquire, release, writeRecord };
}

const run = (deps: SastRunDeps, over: { repoRoots?: WorkspaceRepoRoot[]; projectOverride?: unknown } = {}) =>
  runSastGate({
    issueId: 'PAN-1',
    workspacePath: '/ws/feature-pan-1',
    repoRoots: over.repoRoots ?? [ROOT],
    projectOverride: over.projectOverride,
    logPrefix: 'test',
  }, deps);

describe('runSastGate: off means nothing runs', () => {
  it('returns null and runs no git or scanner while Semgrep is disabled, even with a blocking override', async () => {
    const h = harness({ config: { enabled: false, gate: 'blocking' } });
    expect(await run(h.deps, { projectOverride: 'blocking' })).toBeNull();
    expect(h.git).not.toHaveBeenCalled();
    expect(h.runScanner).not.toHaveBeenCalled();
    expect(h.writeRecord).not.toHaveBeenCalled();
  });

  it('returns null when the gate is off globally or by project override', async () => {
    expect(await run(harness({ config: { gate: 'off' } }).deps)).toBeNull();
    expect(await run(harness({ config: { gate: 'blocking' } }).deps, { projectOverride: 'off' })).toBeNull();
  });

  it('returns null when config.yaml cannot be loaded', async () => {
    const h = harness();
    expect(await run({ ...h.deps, loadSemgrepConfig: async () => { throw new Error('bad yaml'); } })).toBeNull();
  });
});

describe('runSastGate: verdicts', () => {
  it('advisory (the default) records a finding without making the gate required', async () => {
    const h = harness();
    const result = await run(h.deps);
    expect(result).toMatchObject({ name: 'sast', passed: false, required: false });
    expect(result?.output).toContain('src/app.py:3 [ERROR] rule.shell');
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.acquire).toHaveBeenCalledWith(expect.objectContaining({ gateName: 'sast', workspacePath: ROOT.dir }));
  });

  it('blocking fails on a finding on an added line', async () => {
    expect(await run(harness({ config: { gate: 'blocking' } }).deps)).toMatchObject({ passed: false, required: true });
  });

  it('a project override can make one project blocking', async () => {
    expect(await run(harness().deps, { projectOverride: 'blocking' })).toMatchObject({ passed: false, required: true });
  });

  it('blocking passes when the finding is on an unchanged line', async () => {
    const h = harness({ config: { gate: 'blocking' }, scanner: { exitCode: 1, stdout: REPORT(40), stderr: '', timedOut: false } });
    expect(await run(h.deps)).toMatchObject({ passed: true, required: true });
  });

  it('blocking passes when the finding is below the severity threshold', async () => {
    const h = harness({ config: { gate: 'blocking' }, scanner: { exitCode: 1, stdout: REPORT(3, 'WARNING'), stderr: '', timedOut: false } });
    expect(await run(h.deps)).toMatchObject({ passed: true, required: true });
  });

  it('scans the changed files with the managed binary, the configs and the scrubbed env', async () => {
    const h = harness({ config: { configs: ['p/default', 'rules/'], timeout_seconds: 60 }, targets: 'src/app.py\0src/b.ts\0' });
    await run(h.deps);
    expect(h.runScanner).toHaveBeenCalledWith(
      '/home/u/.overdeck/bin/semgrep',
      ['scan', '--config', 'p/default', '--config', 'rules/', '--json', '--metrics', 'off', '--error', '--', 'src/app.py', 'src/b.ts'],
      expect.objectContaining({ cwd: ROOT.dir, timeoutMs: 60_000 }),
    );
  });

  it('runs no scan when the branch changed no existing files', async () => {
    const h = harness({ config: { gate: 'blocking' }, targets: '' });
    const result = await run(h.deps);
    expect(h.runScanner).not.toHaveBeenCalled();
    expect(h.acquire).not.toHaveBeenCalled();
    expect(result).toMatchObject({ passed: true, required: true });
    expect(result?.skipped).toBeUndefined();
  });

  it('prefixes polyrepo paths with the repo key', async () => {
    const h = harness();
    const result = await run(h.deps, { repoRoots: [{ ...ROOT, repoKey: 'fe', dir: '/ws/fe', isPolyrepo: true }] });
    expect(result?.output).toContain('fe/src/app.py:3');
    const record = h.writeRecord.mock.calls[0]![1];
    expect(record.findings[0]!.path).toBe('fe/src/app.py');
    expect(record.suppressions[0]!.path).toBe('fe/src/app.py');
  });

  it('writes sast-latest.json keyed by head', async () => {
    const h = harness();
    await run(h.deps);
    const [path, record] = h.writeRecord.mock.calls[0]!;
    expect(path).toBe('/ws/feature-pan-1/.overdeck/sast-latest.json');
    expect(record).toMatchObject({
      version: 1, mode: 'advisory', skipped: false,
      repos: [{ repoKey: 'pan-1', head: 'headsha', status: 'scanned' }],
      suppressions: [{ kind: 'nosemgrep', path: 'src/app.py', line: 3 }],
    });
  });
});

describe('runSastGate: a scan that cannot run is skipped, never failed', () => {
  const expectSkipped = (result: Awaited<ReturnType<typeof runSastGate>>, reason: RegExp) => {
    expect(result).toMatchObject({ name: 'sast', passed: true, required: false, skipped: true });
    expect(result?.error).toMatch(reason);
  };

  it('a missing binary skips with a clear note and still reports suppressions', async () => {
    const h = harness({ config: { gate: 'blocking' }, binary: false });
    const result = await run(h.deps);
    expectSkipped(result, /Semgrep binary not found at \/home\/u\/\.overdeck\/bin\/semgrep/);
    expect(h.runScanner).not.toHaveBeenCalled();
    expect(result?.output).toContain('nosemgrep src/app.py:3');
    expect(h.writeRecord.mock.calls[0]![1]).toMatchObject({ skipped: true });
  });

  it('a scanner error (exit 2, registry unreachable) skips', async () => {
    const h = harness({ config: { gate: 'blocking' }, scanner: { exitCode: 2, stdout: '', stderr: 'requests.exceptions.ProxyError', timedOut: false } });
    expectSkipped(await run(h.deps), /exited 2.*ProxyError/);
  });

  it('a timeout skips', async () => {
    const h = harness({ config: { gate: 'blocking', timeout_seconds: 5 }, scanner: { exitCode: null, stdout: '', stderr: '', timedOut: true } });
    expectSkipped(await run(h.deps), /timed out after 5s/);
  });

  it('unparseable output skips', async () => {
    const h = harness({ config: { gate: 'blocking' }, scanner: { exitCode: 1, stdout: 'not json', stderr: '', timedOut: false } });
    expectSkipped(await run(h.deps), /not a JSON report/);
  });

  it('a git failure skips instead of throwing', async () => {
    const h = harness({ config: { gate: 'blocking' }, git: async () => { throw new Error('fatal: no merge base'); } });
    expectSkipped(await run(h.deps), /no merge base/);
  });

  it('releases the admission slot when the scanner throws', async () => {
    const h = harness({ config: { gate: 'blocking' }, scanner: async () => { throw new Error('boom'); } });
    expectSkipped(await run(h.deps), /boom/);
    expect(h.release).toHaveBeenCalledTimes(1);
  });

  it('an admission failure skips', async () => {
    const h = harness({ config: { gate: 'blocking' } });
    h.acquire.mockRejectedValueOnce(new Error('queue unreadable'));
    expectSkipped(await run(h.deps), /queue unreadable/);
  });

  it('a record write failure does not change the verdict', async () => {
    const h = harness({ config: { gate: 'blocking' } });
    h.writeRecord.mockRejectedValueOnce(new Error('EACCES'));
    expect(await run(h.deps)).toMatchObject({ passed: false, required: true });
  });
});

describe('sastScannerEnv', () => {
  it('sets the quiet env and strips platform credentials', () => {
    const env = sastScannerEnv({ PATH: '/bin', SEMGREP_APP_TOKEN: 'secret', SEMGREP_RULES: 'p/x' });
    expect(env).toMatchObject({
      PATH: '/bin',
      SEMGREP_ENABLE_VERSION_CHECK: '0',
      SEMGREP_SEND_METRICS: 'off',
      OVERDECK_GATE_ADMITTED: '1',
    });
    expect(env.SEMGREP_APP_TOKEN).toBeUndefined();
    expect(env.SEMGREP_RULES).toBeUndefined();
  });
});

describe('runScannerProcess', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function fakeChild() {
    const child = Object.assign(new EventEmitter(), { pid: 4242, stdout: new EventEmitter(), stderr: new EventEmitter() });
    return child;
  }

  it('collects output and the exit code', async () => {
    const child = fakeChild();
    const spawn = vi.fn(() => child);
    const pending = runScannerProcess('/bin/semgrep', ['scan'], { cwd: '/ws', env: {}, timeoutMs: 1000 }, { spawn: spawn as never });
    child.stdout.emit('data', Buffer.from('{"results":'));
    child.stdout.emit('data', Buffer.from('[]}'));
    child.emit('close', 0);
    await expect(pending).resolves.toEqual({ exitCode: 0, stdout: '{"results":[]}', stderr: '', timedOut: false });
    expect(spawn).toHaveBeenCalledWith('/bin/semgrep', ['scan'], expect.objectContaining({ cwd: '/ws', detached: process.platform !== 'win32' }));
  });

  it('kills the whole process group at the timeout', async () => {
    const child = fakeChild();
    const kill = vi.fn();
    const pending = runScannerProcess('/bin/semgrep', ['scan'], { cwd: '/ws', env: {}, timeoutMs: 1000 }, { spawn: (() => child) as never, kill });
    await vi.advanceTimersByTimeAsync(999);
    expect(kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(kill).toHaveBeenCalledWith(process.platform === 'win32' ? 4242 : -4242, 'SIGKILL');
    child.emit('close', null);
    await expect(pending).resolves.toMatchObject({ exitCode: null, timedOut: true });
  });

  it('reports a spawn error', async () => {
    const child = fakeChild();
    const pending = runScannerProcess('/missing', [], { cwd: '/ws', env: {}, timeoutMs: 1000 }, { spawn: (() => child) as never });
    child.emit('error', new Error('spawn /missing ENOENT'));
    await expect(pending).resolves.toMatchObject({ exitCode: null, error: 'spawn /missing ENOENT' });
  });
});
