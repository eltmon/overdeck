import { describe, it, expect, vi } from 'vitest';
import { checkCoreCommands, checkFirstRunLogins } from '../../../src/cli/commands/doctor-first-run.js';

// PAN-4282 D9, FR-24: tmux warns (not errors) under Herdr; Claude/gh login rows.

describe('checkCoreCommands', () => {
  it('warns on missing tmux under the herdr backend', () => {
    const has = (cmd: string) => cmd !== 'tmux';
    const checks = checkCoreCommands({ backend: 'herdr', has });
    const tmux = checks.find((c) => c.name === 'tmux');
    expect(tmux?.status).toBe('warn');
  });

  it('errors on missing tmux under the tmux backend', () => {
    const has = (cmd: string) => cmd !== 'tmux';
    const checks = checkCoreCommands({ backend: 'tmux', has });
    const tmux = checks.find((c) => c.name === 'tmux');
    expect(tmux?.status).toBe('error');
  });

  it('reports git, Node.js and Claude CLI as ok when present', () => {
    const checks = checkCoreCommands({ backend: 'herdr', has: () => true });
    expect(checks.find((c) => c.name === 'Git')).toMatchObject({ status: 'ok' });
    expect(checks.find((c) => c.name === 'Node.js')).toMatchObject({ status: 'ok' });
    expect(checks.find((c) => c.name === 'Claude CLI')).toMatchObject({ status: 'ok' });
    expect(checks.find((c) => c.name === 'tmux')).toMatchObject({ status: 'ok' });
  });

  it('errors on missing git, node, or the Claude CLI regardless of backend', () => {
    const checks = checkCoreCommands({ backend: 'herdr', has: () => false });
    expect(checks.find((c) => c.name === 'Git')).toMatchObject({ status: 'error' });
    expect(checks.find((c) => c.name === 'Node.js')).toMatchObject({ status: 'error' });
    expect(checks.find((c) => c.name === 'Claude CLI')).toMatchObject({ status: 'error' });
  });
});

describe('checkFirstRunLogins', () => {
  it('warns when gh is installed but not signed in, with a fix mentioning gh auth login', async () => {
    const checks = await checkFirstRunLogins({
      has: (cmd) => cmd === 'gh',
      claudeLogin: vi.fn(),
      ghLogin: vi.fn().mockResolvedValue({ installed: true, ok: false }),
    });
    const gh = checks.find((c) => c.name === 'GitHub login');
    expect(gh?.status).toBe('warn');
    expect(gh?.fix).toContain('gh auth login');
  });

  it('reports Claude login as ok when signed in', async () => {
    const checks = await checkFirstRunLogins({
      has: (cmd) => cmd === 'claude',
      claudeLogin: vi.fn().mockResolvedValue({ ok: true, detail: 'Signed in (max)' }),
      ghLogin: vi.fn(),
    });
    const claude = checks.find((c) => c.name === 'Claude login');
    expect(claude?.status).toBe('ok');
  });

  it('skips the Claude login row when the Claude CLI is not installed', async () => {
    const claudeLogin = vi.fn();
    const checks = await checkFirstRunLogins({
      has: () => false,
      claudeLogin,
      ghLogin: vi.fn(),
    });
    expect(checks.find((c) => c.name === 'Claude login')).toBeUndefined();
    expect(claudeLogin).not.toHaveBeenCalled();
  });

  it('skips the GitHub login row when gh is not installed', async () => {
    const ghLogin = vi.fn();
    const checks = await checkFirstRunLogins({
      has: () => false,
      claudeLogin: vi.fn(),
      ghLogin,
    });
    expect(checks.find((c) => c.name === 'GitHub login')).toBeUndefined();
    expect(ghLogin).not.toHaveBeenCalled();
  });
});
