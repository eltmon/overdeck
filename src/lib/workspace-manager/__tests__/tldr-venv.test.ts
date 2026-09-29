import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { installTldrVenv, setupWorkspaceTldr, linkWorkspaceTldrVenv, ensureVenvExcluded } from '../tldr-venv.js';
import type { TldrVenvDeps } from '../tldr-venv.js';

function fakeExec(): TldrVenvDeps['exec'] {
  return vi.fn(async () => ({ stdout: '', stderr: '' }));
}

describe('installTldrVenv', () => {
  it('issues venv, torch, then llm-tldr installs in order', async () => {
    const exec = fakeExec();
    const venvPath = '/tmp/some-workspace/.venv';

    await installTldrVenv(venvPath, { exec, exists: () => false });

    const commands = (exec as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0] as string);
    expect(commands).toEqual([
      `python3 -m venv "${venvPath}"`,
      `"${join(venvPath, 'bin', 'pip')}" install torch --index-url https://download.pytorch.org/whl/cpu`,
      `"${join(venvPath, 'bin', 'pip')}" install llm-tldr`,
    ]);
  });

  it('returns the created-venv step and skips the patch when the script is absent', async () => {
    const exec = fakeExec();

    const steps = await installTldrVenv('/tmp/some-workspace/.venv', { exec, exists: () => false });

    expect(steps).toEqual(['Created Python venv and installed llm-tldr (CPU-only torch)']);
  });

  it('applies the .tsx/.jsx patch when the patch script exists', async () => {
    const exec = fakeExec();

    const steps = await installTldrVenv('/tmp/some-workspace/.venv', { exec, exists: () => true });

    expect(steps).toEqual([
      'Created Python venv and installed llm-tldr (CPU-only torch)',
      'Applied llm-tldr .tsx/.jsx patch',
    ]);
    const commands = (exec as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0] as string);
    expect(commands[3]).toContain('llm-tldr-tsx-support.py');
  });
});

describe('setupWorkspaceTldr', () => {
  const workspacePath = '/tmp/ws';
  const projectPath = '/tmp/project';

  it('returns "Python venv already present" and issues no venv or pip command when the workspace already has a tldr binary', async () => {
    const exec = fakeExec();
    const tldrBin = join(workspacePath, '.venv', 'bin', 'tldr');
    const startDaemon = vi.fn(async () => {});

    const steps = await setupWorkspaceTldr(workspacePath, projectPath, {
      exec,
      exists: (path: string) => path === tldrBin,
      startDaemon,
    });

    expect(steps).toContain('Python venv already present');
    const commands = (exec as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0] as string);
    expect(commands.some((cmd) => cmd.includes('-m venv'))).toBe(false);
    expect(commands.some((cmd) => cmd.includes('pip install'))).toBe(false);
    expect(startDaemon).toHaveBeenCalledWith(workspacePath, join(workspacePath, '.venv'));
  });

  it('starts the daemon and reports a warm step once the tldr binary is present', async () => {
    const exec = fakeExec();
    const tldrBin = join(workspacePath, '.venv', 'bin', 'tldr');
    const startDaemon = vi.fn(async () => {});

    const steps = await setupWorkspaceTldr(workspacePath, projectPath, {
      exec,
      exists: (path: string) => path === tldrBin,
      startDaemon,
    });

    expect(steps).toContain('Started TLDR daemon');
    expect(steps).toContain('TLDR index warm initiated (background)');
  });

  it('links the workspace .venv to the project-root venv and issues no cp, venv, or pip command (AC1)', async () => {
    const exec = fakeExec();
    const projectVenvPath = join(projectPath, '.venv');
    const projectVenvTldr = join(projectVenvPath, 'bin', 'tldr');
    const symlink = vi.fn();
    const startDaemon = vi.fn(async () => {});

    const steps = await setupWorkspaceTldr(workspacePath, projectPath, {
      exec,
      exists: (path: string) => path === projectVenvTldr,
      symlink,
      gitPath: async () => '/tmp/exclude-does-not-exist',
      readFile: () => '',
      appendFile: () => {},
      startDaemon,
    });

    expect(symlink).toHaveBeenCalledWith(projectVenvPath, join(workspacePath, '.venv'));
    expect(steps).toContain(`Linked .venv to shared project venv ${projectVenvPath}`);
    const commands = (exec as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0] as string);
    expect(commands.some((cmd) => cmd.startsWith('cp'))).toBe(false);
    expect(commands.some((cmd) => cmd.includes('-m venv'))).toBe(false);
    expect(commands.some((cmd) => cmd.includes('pip install'))).toBe(false);
  });

  it('skips the link and returns a "Python project" step when a Python-project marker exists (AC2)', async () => {
    const exec = fakeExec();
    const symlink = vi.fn();

    const steps = await setupWorkspaceTldr(workspacePath, projectPath, {
      exec,
      exists: (path: string) => path === join(workspacePath, 'pyproject.toml'),
      symlink,
    });

    expect(symlink).not.toHaveBeenCalled();
    expect(steps.some((s) => s.includes('Python project'))).toBe(true);
  });

  it('names `pan admin tldr install` and issues no venv or pip command when the project root has no venv (AC3)', async () => {
    const exec = fakeExec();
    const symlink = vi.fn();

    const steps = await setupWorkspaceTldr(workspacePath, projectPath, {
      exec,
      exists: () => false,
      symlink,
    });

    expect(symlink).not.toHaveBeenCalled();
    expect(steps.some((s) => s.includes('pan admin tldr install'))).toBe(true);
    const commands = (exec as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0] as string);
    expect(commands.some((cmd) => cmd.includes('-m venv') || cmd.includes('pip install'))).toBe(false);
  });
});

describe('linkWorkspaceTldrVenv', () => {
  it('symlinks the workspace .venv to the given project venv path', () => {
    const symlink = vi.fn();

    linkWorkspaceTldrVenv('/tmp/ws', '/tmp/project/.venv', { symlink });

    expect(symlink).toHaveBeenCalledWith('/tmp/project/.venv', join('/tmp/ws', '.venv'));
  });
});

describe('ensureVenvExcluded', () => {
  it('appends /.venv on its own line, adding a leading newline when the file lacks a trailing one, and is idempotent (AC4)', async () => {
    let fileContent = '*.log';
    const readFile = vi.fn(() => fileContent);
    const appendFile = vi.fn((_path: string, content: string) => {
      fileContent += content;
    });
    const gitPath = async () => '/repo/.git/info/exclude';

    const first = await ensureVenvExcluded('/tmp/ws', { gitPath, readFile, appendFile });
    expect(first).toBe(true);
    expect(fileContent).toBe('*.log\n/.venv\n');

    const second = await ensureVenvExcluded('/tmp/ws', { gitPath, readFile, appendFile });
    expect(second).toBe(false);
    expect(fileContent).toBe('*.log\n/.venv\n');
  });

  it('does not append when a bare .venv line already excludes it', async () => {
    const appendFile = vi.fn();

    const changed = await ensureVenvExcluded('/tmp/ws', {
      gitPath: async () => '/repo/.git/info/exclude',
      readFile: () => 'node_modules\n.venv\n',
      appendFile,
    });

    expect(changed).toBe(false);
    expect(appendFile).not.toHaveBeenCalled();
  });

  it('treats a `.venv/` line as not matching (it does not exclude a symlink)', async () => {
    const appendFile = vi.fn();

    const changed = await ensureVenvExcluded('/tmp/ws', {
      gitPath: async () => '/repo/.git/info/exclude',
      readFile: () => '.venv/\n',
      appendFile,
    });

    expect(changed).toBe(true);
    expect(appendFile).toHaveBeenCalledWith('/repo/.git/info/exclude', '/.venv\n');
  });

  it('returns false without throwing when resolving the exclude path fails', async () => {
    const changed = await ensureVenvExcluded('/tmp/ws', {
      gitPath: async () => {
        throw new Error('not a git repo');
      },
    });

    expect(changed).toBe(false);
  });
});
