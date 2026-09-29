import { describe, expect, it } from 'vitest';
import { checkClaudeCode } from '../doctor-claude-code.js';
import type { ClaudeCodeStatus } from '../../../lib/claude-code/status.js';

function baseStatus(overrides: Partial<ClaudeCodeStatus> = {}): ClaudeCodeStatus {
  return {
    found: true,
    binaryPath: '/home/u/.config/nvm/versions/node/v22.22.0/bin/claude',
    version: '2.1.284',
    install: { method: 'npm', realPath: '/home/u/.config/nvm/versions/node/v22.22.0/lib/node_modules/@anthropic-ai/claude-code/cli.js', npmPrefix: '/home/u/.config/nvm/versions/node/v22.22.0' },
    upgrade: { method: 'npm', argv: ['npm', 'install'], display: 'npm install -g --prefix /home/u/.config/nvm/versions/node/v22.22.0 @anthropic-ai/claude-code@latest', runnable: true },
    requirements: [],
    outdated: false,
    shadows: [],
    checkedAt: '2026-09-29T00:00:00.000Z',
    ...overrides,
  };
}

describe('checkClaudeCode', () => {
  it('reports ok with version, install method and path when every requirement is satisfied', async () => {
    const status = baseStatus({
      requirements: [
        { model: 'claude-sonnet-5-5', displayName: 'Claude Sonnet 5.5', minVersion: '2.1.284', sources: ['roles.work.model', 'workhorses.mid'], satisfied: true },
      ],
    });

    const results = await checkClaudeCode({ getStatus: async () => status });

    expect(results[0]).toMatchObject({ name: 'Claude Code', status: 'ok' });
    expect(results[0]?.message).toContain('2.1.284');
    expect(results[0]?.message).toContain('npm global');
    expect(results[0]?.message).toContain(status.binaryPath);

    const requirementRow = results.find((r) => r.name === 'Claude Code for Claude Sonnet 5.5');
    expect(requirementRow).toMatchObject({ status: 'ok' });
    expect(requirementRow?.message).toContain('needs 2.1.284');
    expect(requirementRow?.message).toContain('have 2.1.284');
  });

  it('reports error with a fix when a configured model needs a newer version', async () => {
    const status = baseStatus({
      version: '2.1.280',
      requirements: [
        { model: 'claude-sonnet-5-5', displayName: 'Claude Sonnet 5.5', minVersion: '2.1.284', sources: ['roles.work.model'], satisfied: false },
      ],
    });

    const results = await checkClaudeCode({ getStatus: async () => status });

    const requirementRow = results.find((r) => r.name === 'Claude Code for Claude Sonnet 5.5');
    expect(requirementRow).toMatchObject({ status: 'error' });
    expect(requirementRow?.message).toContain('needs 2.1.284');
    expect(requirementRow?.message).toContain('have 2.1.280');
    expect(requirementRow?.fix).toBe(status.upgrade?.display);
  });

  it('warns when the installed version could not be read', async () => {
    const status = baseStatus({
      version: null,
      requirements: [
        { model: 'claude-sonnet-5-5', displayName: 'Claude Sonnet 5.5', minVersion: '2.1.284', sources: [], satisfied: null },
      ],
    });

    const results = await checkClaudeCode({ getStatus: async () => status });

    expect(results[0]).toMatchObject({ name: 'Claude Code', status: 'warn' });
    expect(results[0]?.message).toContain(status.binaryPath);
  });

  it('warns per shadow binary, naming both paths and versions', async () => {
    const status = baseStatus({
      shadows: [{ path: '/usr/local/bin/claude', realPath: '/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js', version: '2.0.19' }],
    });

    const results = await checkClaudeCode({ getStatus: async () => status });

    const shadowRow = results.find((r) => r.name === 'Claude Code shadow');
    expect(shadowRow?.status).toBe('warn');
    expect(shadowRow?.message).toContain('/usr/local/bin/claude');
    expect(shadowRow?.message).toContain('2.0.19');
    expect(shadowRow?.message).toContain(status.binaryPath as string);
    expect(shadowRow?.message).toContain('2.1.284');
    expect(shadowRow?.fix).toBeTruthy();
  });

  it('errors without other rows when Claude Code is not found', async () => {
    const results = await checkClaudeCode({
      getStatus: async () => ({
        found: false,
        binaryPath: null,
        version: null,
        install: null,
        upgrade: null,
        requirements: [],
        outdated: false,
        shadows: [],
        checkedAt: '2026-09-29T00:00:00.000Z',
      }),
    });

    expect(results).toEqual([{ name: 'Claude Code', status: 'error', message: 'Not found on PATH', fix: expect.any(String) }]);
  });
});
