import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tldrVenvMocks = vi.hoisted(() => ({
  installTldrVenv: vi.fn(async () => ['Created Python venv and installed llm-tldr (CPU-only torch)']),
}));

vi.mock('../../../lib/workspace-manager/tldr-venv.js', () => ({
  PYTHON_PROJECT_MARKERS: ['pyproject.toml', 'requirements.txt', 'Pipfile', 'setup.py'],
  installTldrVenv: tldrVenvMocks.installTldrVenv,
}));

vi.mock('../../exit.js', () => ({
  exitCli: vi.fn(async (_code: number) => undefined as never),
}));

describe('pan admin tldr install', () => {
  let root: string;
  let originalCwd: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'tldr-install-'));
    originalCwd = process.cwd();
    process.chdir(root);
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(root, { recursive: true, force: true });
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('does not call installTldrVenv and reports already installed when the venv exists (AC1)', async () => {
    const { tldrCommand } = await import('../admin/tldr-handler.js');
    const { exitCli } = await import('../../exit.js');
    mkdirSync(join(root, '.venv', 'bin'), { recursive: true });
    writeFileSync(join(root, '.venv', 'bin', 'tldr'), '');

    await tldrCommand('install');

    expect(tldrVenvMocks.installTldrVenv).not.toHaveBeenCalled();
    expect(logSpy.mock.calls.flat().some((line) => String(line).includes('already installed'))).toBe(true);
    expect(exitCli).not.toHaveBeenCalled();
  });

  it('exits 1 and does not call installTldrVenv when a Python-project marker exists (AC2)', async () => {
    const { tldrCommand } = await import('../admin/tldr-handler.js');
    const { exitCli } = await import('../../exit.js');
    writeFileSync(join(root, 'pyproject.toml'), '');

    await tldrCommand('install');

    expect(exitCli).toHaveBeenCalledWith(1);
    expect(tldrVenvMocks.installTldrVenv).not.toHaveBeenCalled();
  });

  it('calls installTldrVenv once with <root>/.venv on an empty root (AC3)', async () => {
    const { tldrCommand } = await import('../admin/tldr-handler.js');
    const { exitCli } = await import('../../exit.js');

    await tldrCommand('install');

    expect(tldrVenvMocks.installTldrVenv).toHaveBeenCalledTimes(1);
    expect(tldrVenvMocks.installTldrVenv).toHaveBeenCalledWith(join(root, '.venv'));
    expect(exitCli).not.toHaveBeenCalled();
  });

  it('exits 1 and does not call installTldrVenv when cwd is a linked worktree (.git is a file) (AC4)', async () => {
    const { tldrCommand } = await import('../admin/tldr-handler.js');
    const { exitCli } = await import('../../exit.js');
    writeFileSync(join(root, '.git'), 'gitdir: /somewhere/.git/worktrees/x\n');

    await tldrCommand('install');

    expect(exitCli).toHaveBeenCalledWith(1);
    expect(tldrVenvMocks.installTldrVenv).not.toHaveBeenCalled();
  });

  it('exits 1 and does not call installTldrVenv when .venv exists without a tldr binary', async () => {
    const { tldrCommand } = await import('../admin/tldr-handler.js');
    const { exitCli } = await import('../../exit.js');
    mkdirSync(join(root, '.venv'));

    await tldrCommand('install');

    expect(exitCli).toHaveBeenCalledWith(1);
    expect(tldrVenvMocks.installTldrVenv).not.toHaveBeenCalled();
  });

  it('shows install in the help output (AC5)', async () => {
    const { tldrCommand } = await import('../admin/tldr-handler.js');

    await tldrCommand('help');

    expect(logSpy.mock.calls.flat().some((line) => String(line).includes('install'))).toBe(true);
  });
});
