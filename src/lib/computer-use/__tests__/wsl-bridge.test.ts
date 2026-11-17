import { describe, expect, it, vi } from 'vitest';

import { isComputerUseError } from '../errors.js';
import type { ExecFileFn } from '../helper.js';
import {
  EXECUTION_POLICY_MESSAGE,
  POWERSHELL_FALLBACK,
  ensureHelperCopied,
  interopEnabled,
  resolveHelperDir,
  resolvePowershell,
  runWindowsHelper,
  windowsVersion,
  type WslBridgeDeps,
} from '../wsl-bridge.js';

const PS = '/mnt/c/WINDOWS/System32/WindowsPowerShell/v1.0/powershell.exe';
const HELPER_SOURCE = '/pkg/native/computer-use-windows/runtime.ps1';
const CACHE = '/home/me/.overdeck/computer-use/windows-helper-dir.txt';
const LINUX_DIR = '/mnt/c/Users/me/AppData/Local/Overdeck/computer-use';
const WIN_DIR = 'C:\\Users\\me\\AppData\\Local\\Overdeck\\computer-use';
const VENDORED = 'param()\n# vendored helper\n';

type ExecCall = { file: string; args: string[]; options: Parameters<ExecFileFn>[2] };

/** An in-memory file system plus a scripted execFile, injected through WslBridgeDeps. */
function makeHarness(options: {
  files?: Record<string, string>;
  helperStdout?: string;
  helperError?: unknown;
  which?: string | null;
  env?: NodeJS.ProcessEnv;
  sockets?: string[];
} = {}) {
  const files = new Map<string, string>(Object.entries({ [HELPER_SOURCE]: VENDORED, ...options.files }));
  const dirs = new Set<string>();
  const calls: ExecCall[] = [];
  const writes: string[] = [];
  const renames: Array<[string, string]> = [];
  const removed: string[] = [];

  const execFile: ExecFileFn = vi.fn(async (file, args, execOptions) => {
    calls.push({ file, args, options: execOptions });
    if (file === 'which') {
      if (options.which === null) throw Object.assign(new Error('not found'), { code: 1 });
      return { stdout: `${options.which ?? PS}\n`, stderr: '' };
    }
    if (file === 'wslpath') {
      const [flag, path] = args;
      if (flag === '-u') return { stdout: '/mnt/c/Users/me/AppData/Local\n', stderr: '' };
      return { stdout: `C:${path.replace('/mnt/c', '').replaceAll('/', '\\')}\n`, stderr: '' };
    }
    if (args.includes('-Command')) {
      return { stdout: 'C:\\Users\\me\\AppData\\Local\r\n', stderr: '' };
    }
    if (options.helperError) throw options.helperError;
    return { stdout: options.helperStdout ?? '{"ok":true,"capabilities":{"platform":"win32"}}\r\n', stderr: '' };
  });

  const deps: WslBridgeDeps = {
    execFile,
    env: options.env ?? { WSL_INTEROP: '/run/WSL/42_interop' },
    readFile: vi.fn(async (path: unknown) => {
      const content = files.get(String(path));
      if (content === undefined) throw Object.assign(new Error(`ENOENT: ${String(path)}`), { code: 'ENOENT' });
      return Buffer.from(content);
    }) as unknown as WslBridgeDeps['readFile'],
    writeFile: vi.fn(async (path: unknown, data: unknown) => {
      writes.push(String(path));
      files.set(String(path), String(data));
    }) as unknown as WslBridgeDeps['writeFile'],
    mkdir: vi.fn(async (path: unknown) => {
      dirs.add(String(path));
      return undefined;
    }) as unknown as WslBridgeDeps['mkdir'],
    rm: vi.fn(async (path: unknown) => {
      removed.push(String(path));
      files.delete(String(path));
    }) as unknown as WslBridgeDeps['rm'],
    rename: vi.fn(async (from: unknown, to: unknown) => {
      renames.push([String(from), String(to)]);
      files.set(String(to), files.get(String(from)) ?? '');
      files.delete(String(from));
    }) as unknown as WslBridgeDeps['rename'],
    stat: vi.fn(async (path: unknown) => {
      if (!dirs.has(String(path))) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return { isDirectory: () => true };
    }) as unknown as WslBridgeDeps['stat'],
    readdir: vi.fn(async () => options.sockets ?? []),
    exists: () => false,
    randomUUID: () => 'fixed-uuid',
    helperSource: () => HELPER_SOURCE,
    helperDirCachePath: () => CACHE,
  };
  return { deps, files, dirs, calls, writes, renames, removed };
}

function helperCall(calls: ExecCall[]): ExecCall | undefined {
  return calls.find((call) => call.args.includes('-File'));
}

describe('resolvePowershell (PAN-5462 D-2)', () => {
  it('returns the PATH hit first and the fallback only when which finds nothing (ac1)', async () => {
    const onPath = makeHarness({ which: '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe' });
    onPath.deps.exists = (path) => path === POWERSHELL_FALLBACK;
    expect(await resolvePowershell(onPath.deps)).toBe('/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe');

    const offPath = makeHarness({ which: null });
    offPath.deps.exists = (path) => path === POWERSHELL_FALLBACK;
    expect(await resolvePowershell(offPath.deps)).toBe(POWERSHELL_FALLBACK);

    const nowhere = makeHarness({ which: null });
    expect(await resolvePowershell(nowhere.deps)).toBeNull();
  });
});

describe('interopEnabled (PAN-5462 D-16)', () => {
  it('reads the WSLInterop and WSLInterop-late binfmt entries', () => {
    expect(interopEnabled({ exists: (path) => path.endsWith('/WSLInterop') })).toBe(true);
    expect(interopEnabled({ exists: (path) => path.endsWith('/WSLInterop-late') })).toBe(true);
    expect(interopEnabled({ exists: () => false })).toBe(false);
  });
});

describe('resolveHelperDir (PAN-5462 D-5)', () => {
  it('resolves %LOCALAPPDATA% once and caches both paths', async () => {
    const harness = makeHarness();
    const dir = await resolveHelperDir(harness.deps);
    expect(dir).toEqual({ linux: LINUX_DIR, win: WIN_DIR });
    expect(harness.files.get(CACHE)).toBe(`${LINUX_DIR}\n${WIN_DIR}\n`);

    harness.calls.length = 0;
    expect(await resolveHelperDir(harness.deps)).toEqual({ linux: LINUX_DIR, win: WIN_DIR });
    expect(harness.calls).toEqual([]);
  });

  it('sets WSL_INTEROP for the LocalApplicationData probe when the env lacks it (D-17)', async () => {
    const harness = makeHarness({ env: { PATH: '/usr/bin' }, sockets: ['1_interop'] });
    await resolveHelperDir(harness.deps);
    const probe = harness.calls.find((call) => call.args.includes('-Command'));
    expect(probe?.options.env.WSL_INTEROP).toBe('/run/WSL/1_interop');
  });

  it('re-resolves when the cached dir is gone', async () => {
    const harness = makeHarness({ files: { [CACHE]: '/mnt/c/old/computer-use\nC:\\old\\computer-use\n' } });
    expect(await resolveHelperDir(harness.deps)).toEqual({ linux: LINUX_DIR, win: WIN_DIR });
    expect(harness.calls.some((call) => call.args.includes('-Command'))).toBe(true);
  });
});

describe('ensureHelperCopied (PAN-5462 D-5, D-18)', () => {
  it('writes no new copy when the sha256 matches, and overwrites a mismatch (ac2)', async () => {
    const same = makeHarness({ files: { [`${LINUX_DIR}/runtime.ps1`]: VENDORED } });
    await ensureHelperCopied(LINUX_DIR, same.deps);
    expect(same.writes).toEqual([]);
    expect(same.renames).toEqual([]);

    const stale = makeHarness({ files: { [`${LINUX_DIR}/runtime.ps1`]: 'old helper' } });
    await ensureHelperCopied(LINUX_DIR, stale.deps);
    expect(stale.files.get(`${LINUX_DIR}/runtime.ps1`)).toBe(VENDORED);
  });
});

describe('runWindowsHelper (PAN-5462 WI-1)', () => {
  it('does not rewrite a matching helper copy during a call (ac2)', async () => {
    const harness = makeHarness({ files: { [`${LINUX_DIR}/runtime.ps1`]: VENDORED } });
    await runWindowsHelper({ tool: 'handshake' }, harness.deps);
    expect(harness.writes.filter((path) => path.includes('runtime.ps1'))).toEqual([]);
  });

  it('returns the parsed response, passes both paths through wslpath -w and removes the op file (ac3)', async () => {
    const harness = makeHarness();
    const result = await runWindowsHelper({ tool: 'handshake' }, harness.deps);

    expect(result).toEqual({ ok: true, capabilities: { platform: 'win32' } });
    const wslpathW = harness.calls.filter((call) => call.file === 'wslpath' && call.args[0] === '-w').map((call) => call.args[1]);
    expect(wslpathW).toEqual([`${LINUX_DIR}/runtime.ps1`, `${LINUX_DIR}/ops/fixed-uuid.json`]);
    const call = helperCall(harness.calls);
    expect(call?.file).toBe(PS);
    expect(call?.args).toEqual([
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      `${WIN_DIR}\\runtime.ps1`,
      `${WIN_DIR}\\ops\\fixed-uuid.json`,
    ]);
    expect(call?.options).toMatchObject({ timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 });
    expect(harness.removed).toContain(`${LINUX_DIR}/ops/fixed-uuid.json`);
    expect(harness.files.has(`${LINUX_DIR}/ops/fixed-uuid.json`)).toBe(false);
  });

  it('throws helper_error with the helper message for ok:false and still removes the op file (ac4)', async () => {
    const harness = makeHarness({ helperStdout: '{"ok":false,"error":"target_elevated: Notepad runs as administrator"}\r\n' });
    const error = await runWindowsHelper({ tool: 'click' }, harness.deps).catch((e: unknown) => e);
    expect(isComputerUseError(error) && error.code).toBe('helper_error');
    expect((error as Error).message).toBe('target_elevated: Notepad runs as administrator');
    expect(harness.removed).toContain(`${LINUX_DIR}/ops/fixed-uuid.json`);
  });

  it('throws helper_timeout when the process is killed and still removes the op file (ac4)', async () => {
    const harness = makeHarness({ helperError: Object.assign(new Error('killed'), { killed: true, signal: 'SIGKILL' }) });
    const error = await runWindowsHelper({ tool: 'list_apps' }, harness.deps).catch((e: unknown) => e);
    expect(isComputerUseError(error) && error.code).toBe('helper_timeout');
    expect(harness.removed).toContain(`${LINUX_DIR}/ops/fixed-uuid.json`);
  });

  it('throws helper_error for non-JSON output and still removes the op file (ac4)', async () => {
    const harness = makeHarness({ helperStdout: 'Add-Type : compilation failed\r\n' });
    const error = await runWindowsHelper({ tool: 'list_apps' }, harness.deps).catch((e: unknown) => e);
    expect(isComputerUseError(error) && error.code).toBe('helper_error');
    expect((error as Error).message).toContain('not JSON');
    expect(harness.removed).toContain(`${LINUX_DIR}/ops/fixed-uuid.json`);
  });

  it('maps an execution-policy failure to the Group Policy message (ac5)', async () => {
    const stderr =
      'File C:\\...\\runtime.ps1 cannot be loaded. For more information, see about_Execution_Policies.\r\n' +
      '    + FullyQualifiedErrorId : UnauthorizedAccess\r\n';
    const harness = makeHarness({ helperError: Object.assign(new Error('Command failed'), { code: 1, stderr }) });
    const error = await runWindowsHelper({ tool: 'handshake' }, harness.deps).catch((e: unknown) => e);
    expect(isComputerUseError(error) && error.code).toBe('helper_error');
    expect((error as Error).message).toBe(EXECUTION_POLICY_MESSAGE);
  });

  it('sets WSL_INTEROP from /run/WSL when the env lacks it, and copies through a temp file (ac6)', async () => {
    const harness = makeHarness({ env: { PATH: '/usr/bin' }, sockets: ['7_interop', '1_interop', 'other'] });
    await runWindowsHelper({ tool: 'handshake' }, harness.deps);

    expect(helperCall(harness.calls)?.options.env.WSL_INTEROP).toBe('/run/WSL/1_interop');
    expect(harness.renames).toEqual([[`${LINUX_DIR}/runtime.ps1.tmp-fixed-uuid`, `${LINUX_DIR}/runtime.ps1`]]);
    expect(harness.files.get(`${LINUX_DIR}/runtime.ps1`)).toBe(VENDORED);
  });

  it('falls back to the socket with the lowest pid when 1_interop is absent', async () => {
    const harness = makeHarness({ env: {}, sockets: ['91_interop', '12_interop'] });
    await runWindowsHelper({ tool: 'handshake' }, harness.deps);
    expect(helperCall(harness.calls)?.options.env.WSL_INTEROP).toBe('/run/WSL/12_interop');
  });

  it('refuses with no_desktop_session when powershell.exe is nowhere', async () => {
    const harness = makeHarness({ which: null });
    const error = await runWindowsHelper({ tool: 'handshake' }, harness.deps).catch((e: unknown) => e);
    expect(isComputerUseError(error) && error.code).toBe('no_desktop_session');
  });
});

describe('windowsVersion (PAN-5462 WI-1)', () => {
  it('returns the PowerShell version and the Windows build from one call', async () => {
    const harness = makeHarness();
    harness.deps.execFile = vi.fn(async (file: string) =>
      file === 'which' ? { stdout: `${PS}\n`, stderr: '' } : { stdout: '5.1.22621.4391\r\n10.0.22631.0\r\n', stderr: '' },
    );
    expect(await windowsVersion(harness.deps)).toEqual({ powershell: '5.1.22621.4391', build: '10.0.22631.0' });
  });
});
