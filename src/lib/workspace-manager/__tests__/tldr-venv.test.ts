import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { installTldrVenv, setupWorkspaceTldr } from '../tldr-venv.js';
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

  it('copies the venv from the project root when the project already has one', async () => {
    const exec = fakeExec();
    const projectVenvTldr = join(projectPath, '.venv', 'bin', 'tldr');
    const workspaceVenvTldr = join(workspacePath, '.venv', 'bin', 'tldr');
    let workspaceHasVenv = false;
    const startDaemon = vi.fn(async () => {});

    const steps = await setupWorkspaceTldr(workspacePath, projectPath, {
      exec: (async (cmd: string, opts?: { cwd?: string; timeout?: number }) => {
        if (cmd.startsWith('cp -a')) workspaceHasVenv = true;
        return fakeExec()(cmd, opts);
      }) as TldrVenvDeps['exec'],
      exists: (path: string) => path === projectVenvTldr || (path === workspaceVenvTldr && workspaceHasVenv),
      startDaemon,
    });

    expect(steps).toContain('Copied Python venv from main branch (shebangs relocated)');
    expect(steps.some((s) => s.includes('Created Python venv'))).toBe(false);
  });

  it('builds a fresh venv when neither the workspace nor the project has one', async () => {
    const exec = fakeExec();
    const startDaemon = vi.fn(async () => {});

    const steps = await setupWorkspaceTldr(workspacePath, projectPath, {
      exec,
      exists: () => false,
      startDaemon,
    });

    expect(steps).toContain('Created Python venv and installed llm-tldr (CPU-only torch)');
    expect(steps).toContain('TLDR setup incomplete: tldr binary not found after venv creation');
    expect(startDaemon).not.toHaveBeenCalled();
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

  it('reports a skipped step, without throwing, when python3 is unavailable', async () => {
    const exec = vi.fn(async (cmd: string) => {
      if (cmd === 'python3 --version') throw new Error('python3: command not found');
      return { stdout: '', stderr: '' };
    }) as TldrVenvDeps['exec'];

    const steps = await setupWorkspaceTldr(workspacePath, projectPath, { exec, exists: () => false });

    expect(steps).toEqual(['Skipped TLDR setup (python3 not available)']);
  });
});
