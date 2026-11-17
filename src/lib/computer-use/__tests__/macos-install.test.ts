import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isComputerUseError } from '../errors.js';
import {
  bundledZipPath,
  HELPER_APP_NAME,
  installedHelperDir,
  installedHelperPath,
  installHelper,
  isInstalledCurrent,
  type MacosInstallDeps,
} from '../macos-install.js';

const HOME = '/home/tester/.overdeck';
const PKG = '/pkg';
const ZIP = `${PKG}/native/computer-use-macos/dist/overdeck-computer-use-macos.zip`;
const DIR = `${HOME}/computer-use/macos`;
const APP = `${DIR}/${HELPER_APP_NAME}`;

/** An in-memory filesystem: `files` maps a path to its text; `dirs` holds existing paths without text. */
function makeFs(files: Record<string, string>, dirs: string[] = []) {
  const text = new Map(Object.entries(files));
  const present = new Set(dirs);
  const exists = (path: string) => text.has(path) || present.has(path);
  return {
    text,
    present,
    deps: {
      readFile: vi.fn(async (path: string) => {
        const value = text.get(path);
        if (value === undefined) throw Object.assign(new Error(`ENOENT ${path}`), { code: 'ENOENT' });
        return value;
      }),
      writeFile: vi.fn(async (path: string, data: string) => {
        text.set(path, data);
      }),
      mkdir: vi.fn(async (path: string) => {
        present.add(path);
      }),
      rename: vi.fn(async (from: string, to: string) => {
        if (!present.has(from)) throw new Error(`rename: no ${from}`);
        present.delete(from);
        present.add(to);
      }),
      rm: vi.fn(async (path: string) => {
        present.delete(path);
        text.delete(path);
      }),
      pathExists: vi.fn(async (path: string) => exists(path)),
      randomUUID: () => 'uuid-1',
      packageRoot: PKG,
    } satisfies MacosInstallDeps,
  };
}

/** A ditto fake that "extracts" the app into the target dir. */
function dittoInto(present: Set<string>) {
  return vi.fn(async (file: string, args: string[]) => {
    if (file === '/usr/bin/ditto') present.add(`${args[3]}/${HELPER_APP_NAME}`);
    return { stdout: '', stderr: '' };
  });
}

describe('macos-install (PAN-5463)', () => {
  const previousHome = process.env.OVERDECK_HOME;
  beforeEach(() => {
    process.env.OVERDECK_HOME = HOME;
  });
  afterEach(() => {
    if (previousHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = previousHome;
  });

  it('resolves the installed helper under OVERDECK_HOME and the zip under the package root', () => {
    expect(installedHelperDir()).toBe(DIR);
    expect(installedHelperPath()).toBe(APP);
    expect(bundledZipPath(PKG)).toBe(ZIP);
  });

  it('installs a fresh helper: ditto into a temp dir, rename into place, write installed.sha256 (ac1)', async () => {
    const fs = makeFs({ [`${ZIP}.sha256`]: 'aaa\n' }, [ZIP]);
    const execFile = dittoInto(fs.present);

    const result = await installHelper({ ...fs.deps, execFile });

    expect(result).toEqual({ status: 'installed' });
    expect(execFile).toHaveBeenCalledWith('/usr/bin/ditto', ['-x', '-k', ZIP, `${DIR}/.extract-uuid-1`], expect.any(Object));
    expect(fs.deps.mkdir).toHaveBeenCalledWith(DIR, { recursive: true, mode: 0o700 });
    expect(fs.deps.rename).toHaveBeenCalledWith(`${DIR}/.extract-uuid-1/${HELPER_APP_NAME}`, APP);
    expect(fs.text.get(`${DIR}/installed.sha256`)).toBe('aaa\n');
    expect(fs.deps.rm).toHaveBeenCalledWith(`${DIR}/.extract-uuid-1`, { recursive: true, force: true });
    expect(fs.present.has(APP)).toBe(true);
  });

  it('skips extraction when the installed sha matches the bundled sha (ac2)', async () => {
    const fs = makeFs({ [`${ZIP}.sha256`]: 'aaa\n', [`${DIR}/installed.sha256`]: 'aaa\n' }, [ZIP, APP]);
    const execFile = vi.fn();

    expect(await isInstalledCurrent({ ...fs.deps, execFile })).toBe(true);
    expect(await installHelper({ ...fs.deps, execFile })).toEqual({ status: 'current' });
    expect(execFile).not.toHaveBeenCalled();
  });

  it('is not current when the app is missing even if the sha matches', async () => {
    const fs = makeFs({ [`${ZIP}.sha256`]: 'aaa', [`${DIR}/installed.sha256`]: 'aaa' }, [ZIP]);
    expect(await isInstalledCurrent(fs.deps)).toBe(false);
  });

  it('re-extracts and reports updated when the installed sha differs (ac3)', async () => {
    const fs = makeFs({ [`${ZIP}.sha256`]: 'bbb\n', [`${DIR}/installed.sha256`]: 'aaa\n' }, [ZIP, APP]);
    const execFile = dittoInto(fs.present);

    expect(await isInstalledCurrent({ ...fs.deps, execFile })).toBe(false);
    const result = await installHelper({ ...fs.deps, execFile });

    expect(result).toEqual({ status: 'updated' });
    expect(fs.deps.rm).toHaveBeenCalledWith(APP, { recursive: true, force: true });
    expect(execFile).toHaveBeenCalledWith('/usr/bin/ditto', expect.any(Array), expect.any(Object));
    expect(fs.text.get(`${DIR}/installed.sha256`)).toBe('bbb\n');
  });

  it('throws helper_missing_dependency naming xcode-select --install when there is no zip and no toolchain (ac4)', async () => {
    const fs = makeFs({});
    const execFile = vi.fn();

    const error = await installHelper({ ...fs.deps, execFile, hasSwiftToolchain: async () => false }).catch((e: unknown) => e);

    expect(isComputerUseError(error) && error.code).toBe('helper_missing_dependency');
    expect((error as Error).message).toContain('xcode-select --install');
    expect(execFile).not.toHaveBeenCalled();
  });

  it('builds the helper from source when there is no zip but a toolchain exists (D-11)', async () => {
    const fs = makeFs({});
    const execFile = vi.fn(async (file: string, args: string[]) => {
      if (file === 'npm') {
        fs.present.add(ZIP);
        fs.text.set(`${ZIP}.sha256`, 'ccc\n');
      }
      if (file === '/usr/bin/ditto') fs.present.add(`${args[3]}/${HELPER_APP_NAME}`);
      return { stdout: '', stderr: '' };
    });

    const result = await installHelper({ ...fs.deps, execFile, hasSwiftToolchain: async () => true });

    expect(result).toEqual({ status: 'installed' });
    expect(execFile).toHaveBeenCalledWith('npm', ['run', 'build:computer-macos'], expect.objectContaining({ cwd: PKG }));
  });

  it('removes the temp dir and reports helper_error when ditto fails', async () => {
    const fs = makeFs({ [`${ZIP}.sha256`]: 'aaa' }, [ZIP]);
    const execFile = vi.fn().mockRejectedValue(Object.assign(new Error('exit 1'), { stderr: 'bad zip' }));

    const error = await installHelper({ ...fs.deps, execFile }).catch((e: unknown) => e);

    expect(isComputerUseError(error) && error.code).toBe('helper_error');
    expect((error as Error).message).toContain('bad zip');
    expect(fs.deps.rm).toHaveBeenCalledWith(`${DIR}/.extract-uuid-1`, { recursive: true, force: true });
    expect(fs.deps.rename).not.toHaveBeenCalled();
  });
});
