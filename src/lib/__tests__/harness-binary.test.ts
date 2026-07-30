import { describe, expect, it, vi } from 'vitest';

const configMock = vi.hoisted(() => ({ loadConfigSync: vi.fn(() => ({ config: {} })) }));
vi.mock('../config-yaml.js', () => ({ loadConfigSync: configMock.loadConfigSync }));

import {
  configuredHarnessBinaryPath,
  harnessBinaryName,
  harnessPathExport,
  prepareHarnessLaunch,
  resolveExecutable,
} from '../harness-binary.js';

function executableAccess(executablePaths: readonly string[]) {
  const executable = new Set(executablePaths);
  return vi.fn(async (path: string) => {
    if (!executable.has(path)) throw Object.assign(new Error('not executable'), { code: 'EACCES' });
  });
}

describe('resolveExecutable', () => {
  it('prefers the supplied PATH and returns an absolute executable path', async () => {
    const accessExecutable = executableAccess(['/opt/tools/claude', '/home/test/.local/bin/claude']);
    const runCommand = vi.fn();

    await expect(resolveExecutable('claude', {
      pathValue: '/opt/tools:/usr/bin',
      home: '/home/test',
      accessExecutable,
      runCommand,
    })).resolves.toBe('/opt/tools/claude');

    expect(runCommand).not.toHaveBeenCalled();
  });

  it.each([
    ['~/.local/bin', '/home/test/.local/bin/claude'],
    ['~/.claude/local', '/home/test/.claude/local/claude'],
    ['~/.kimi-code/bin', '/home/test/.kimi-code/bin/claude'],
    ['~/.npm-global/bin', '/home/test/.npm-global/bin/claude'],
    ['~/.bun/bin', '/home/test/.bun/bin/claude'],
  ])('finds an executable in %s when the server PATH omits it', async (_label, candidate) => {
    const runCommand = vi.fn(async (command: string) => command === 'npm' ? '/opt/npm-prefix\n' : '');

    await expect(resolveExecutable('claude', {
      pathValue: '/usr/bin',
      home: '/home/test',
      accessExecutable: executableAccess([candidate]),
      runCommand,
      allowLoginShell: false,
    })).resolves.toBe(candidate);
  });

  it('checks the global npm prefix between npm-global and Bun', async () => {
    const attempts: string[] = [];
    const accessExecutable = vi.fn(async (path: string) => {
      attempts.push(path);
      if (path !== '/opt/npm-prefix/bin/claude') throw new Error('missing');
    });
    const runCommand = vi.fn(async () => '/opt/npm-prefix\n');

    await expect(resolveExecutable('claude', {
      pathValue: '/usr/bin',
      home: '/home/test',
      accessExecutable,
      runCommand,
      allowLoginShell: false,
    })).resolves.toBe('/opt/npm-prefix/bin/claude');

    expect(attempts).toEqual([
      '/usr/bin/claude',
      '/home/test/.local/bin/claude',
      '/home/test/.claude/local/claude',
      '/home/test/.kimi-code/bin/claude',
      '/home/test/.npm-global/bin/claude',
      '/opt/npm-prefix/bin/claude',
    ]);
  });

  it('uses the login shell only after all directory candidates fail', async () => {
    const runCommand = vi.fn(async (command: string, args: string[]) => {
      if (command === 'npm') throw new Error('npm missing');
      expect(command).toBe('/bin/zsh');
      expect(args).toEqual(['-lc', 'command -v claude']);
      return '/custom/login/bin/claude\n';
    });

    await expect(resolveExecutable('claude', {
      pathValue: '/usr/bin',
      home: '/home/test',
      shell: '/bin/zsh',
      accessExecutable: executableAccess(['/custom/login/bin/claude']),
      runCommand,
    })).resolves.toBe('/custom/login/bin/claude');
  });

  it('rejects relative and non-executable login-shell results', async () => {
    const runCommand = vi.fn(async (command: string) => command === 'npm' ? '' : 'aliases/claude\n');

    await expect(resolveExecutable('claude', {
      pathValue: '',
      home: '/home/test',
      shell: '/bin/sh',
      accessExecutable: executableAccess([]),
      runCommand,
    })).resolves.toBeNull();
  });

  it('uses an explicit absolute executable without searching fallback locations', async () => {
    const accessExecutable = executableAccess(['/opt/kimi code/bin/kimi']);
    const runCommand = vi.fn(async () => '/usr/local/bin/kimi\n');

    await expect(resolveExecutable('kimi', {
      executablePath: '/opt/kimi code/bin/kimi',
      pathValue: '/usr/local/bin',
      accessExecutable,
      runCommand,
    })).resolves.toBe('/opt/kimi code/bin/kimi');

    expect(accessExecutable).toHaveBeenCalledTimes(1);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('returns null for a non-executable explicit path without falling back to PATH', async () => {
    const accessExecutable = executableAccess(['/usr/local/bin/kimi']);
    const runCommand = vi.fn(async () => '/usr/local/bin/kimi\n');

    await expect(resolveExecutable('kimi', {
      executablePath: '/configured/kimi',
      pathValue: '/usr/local/bin',
      accessExecutable,
      runCommand,
    })).resolves.toBeNull();

    expect(accessExecutable).toHaveBeenCalledTimes(1);
    expect(accessExecutable).toHaveBeenCalledWith('/configured/kimi');
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('rejects a relative configured executable path', async () => {
    await expect(resolveExecutable('kimi', {
      executablePath: './bin/kimi',
    })).rejects.toThrow('Configured executable path must be absolute: ./bin/kimi');
  });

  it('keeps bare-name discovery when no explicit executable is configured', async () => {
    await expect(resolveExecutable('kimi', {
      pathValue: '/opt/default/bin',
      accessExecutable: executableAccess(['/opt/default/bin/kimi']),
      allowLoginShell: false,
    })).resolves.toBe('/opt/default/bin/kimi');
  });

  it('finds the Kimi Code CLI in its installer directory when no PATH or login shell exposes it', async () => {
    // The installer writes ~/.kimi-code/bin/kimi and exports it only from the
    // interactive section of the shell rc, so neither the server's inherited
    // PATH nor a non-interactive login shell can see it.
    const runCommand = vi.fn(async (command: string) => {
      if (command === 'npm') return '/opt/npm-prefix\n';
      return '';
    });

    await expect(resolveExecutable('kimi', {
      pathValue: '/usr/bin',
      home: '/home/test',
      shell: '/bin/bash',
      accessExecutable: executableAccess(['/home/test/.kimi-code/bin/kimi']),
      runCommand,
    })).resolves.toBe('/home/test/.kimi-code/bin/kimi');
  });
});

describe('prepareHarnessLaunch', () => {
  it('returns a launcher PATH export for the resolved harness directory', async () => {
    await expect(prepareHarnessLaunch('claude-code', {
      pathValue: '/usr/bin',
      home: '/home/test',
      accessExecutable: executableAccess(['/home/test/.local/bin/claude']),
      runCommand: vi.fn(async () => ''),
      allowLoginShell: false,
    })).resolves.toEqual({
      binaryPath: '/home/test/.local/bin/claude',
      pathExport: "export PATH='/home/test/.local/bin':\"$PATH\"",
    });
  });

  it('names a configured ACP executable that is missing or not executable', async () => {
    await expect(prepareHarnessLaunch('acp', {
      executablePath: '/configured/missing-kimi',
      accessExecutable: executableAccess([]),
    })).rejects.toThrow(
      'Kimi Code CLI configured executable "/configured/missing-kimi" was not found or is not executable',
    );
  });

  it('throws an actionable error without raw exec output when the harness is absent', async () => {
    let error: unknown;
    try {
      await prepareHarnessLaunch('claude-code', {
        pathValue: '/usr/bin',
        home: '/home/test',
        accessExecutable: executableAccess([]),
        runCommand: vi.fn(async () => { throw new Error('execvp(3) failed: No such file or directory'); }),
        allowLoginShell: false,
      });
    } catch (cause) {
      error = cause;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Install Claude Code or add its installation directory to PATH');
    expect((error as Error).message).not.toContain('execvp');
  });

  it('quotes harness directories in PATH exports', () => {
    expect(harnessPathExport("/home/test/O'Reilly/bin/claude"))
      .toBe("export PATH='/home/test/O'\\''Reilly/bin':\"$PATH\"");
  });

  it('names the configured Kimi Code CLI executable when missing or not executable', async () => {
    await expect(prepareHarnessLaunch('kimi-code', {
      executablePath: '/configured/missing-kimi',
      accessExecutable: executableAccess([]),
    })).rejects.toThrow(
      'Kimi Code CLI configured executable "/configured/missing-kimi" was not found or is not executable',
    );
  });
});

describe('harnessBinaryName', () => {
  it("maps 'kimi-code' to the 'kimi' binary, same as 'acp'", () => {
    expect(harnessBinaryName('kimi-code')).toBe('kimi');
    expect(harnessBinaryName('acp')).toBe('kimi');
  });
});

describe('configuredHarnessBinaryPath', () => {
  it("reads config.kimiCode.binaryPath for 'kimi-code'", () => {
    configMock.loadConfigSync.mockReturnValueOnce({ config: { kimiCode: { binaryPath: '/opt/kimi-code/bin/kimi' } } });
    expect(configuredHarnessBinaryPath('kimi-code')).toBe('/opt/kimi-code/bin/kimi');
  });

  it("returns undefined for 'kimi-code' when unset", () => {
    configMock.loadConfigSync.mockReturnValueOnce({ config: {} });
    expect(configuredHarnessBinaryPath('kimi-code')).toBeUndefined();
  });

  it("still reads config.acp.kimi.binaryPath for 'acp', unaffected by kimiCode", () => {
    configMock.loadConfigSync.mockReturnValueOnce({ config: { acp: { kimi: { binaryPath: '/opt/acp/bin/kimi' } } } });
    expect(configuredHarnessBinaryPath('acp')).toBe('/opt/acp/bin/kimi');
  });

  it('returns undefined for harnesses with no configured binary path', () => {
    configMock.loadConfigSync.mockReturnValueOnce({ config: {} });
    expect(configuredHarnessBinaryPath('claude-code')).toBeUndefined();
  });
});
