import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runSemgrepCiSetup = vi.fn();
const exitCli = vi.fn(async (_code: number) => undefined);

vi.mock('../../../src/lib/semgrep/ci-setup.js', () => ({ runSemgrepCiSetup: (...args: unknown[]) => runSemgrepCiSetup(...args) }));
vi.mock('../../../src/cli/exit.js', () => ({ exitCli: (code: number) => exitCli(code) }));

const { registerSemgrepCommands } = await import('../../../src/cli/commands/semgrep.js');

async function pan(...args: string[]): Promise<void> {
  const program = new Command().exitOverride();
  registerSemgrepCommands(program);
  await program.parseAsync(['node', 'pan', ...args]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('pan semgrep ci-setup (PAN-4592)', () => {
  it('passes the project and both flags to runSemgrepCiSetup', async () => {
    runSemgrepCiSetup.mockResolvedValue({ ok: true, prUrl: null, existing: false, dryRun: true });

    await pan('semgrep', 'ci-setup', 'myapp', '--dry-run', '--sarif-upload');

    expect(runSemgrepCiSetup).toHaveBeenCalledWith({ projectKey: 'myapp', dryRun: true, sarifUpload: true });
    expect(exitCli).not.toHaveBeenCalled();
  });

  it('prints the pull request URL', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    runSemgrepCiSetup.mockResolvedValue({ ok: true, prUrl: 'https://github.com/o/r/pull/7', existing: false, dryRun: false });

    await pan('semgrep', 'ci-setup', 'myapp');

    expect(runSemgrepCiSetup).toHaveBeenCalledWith({ projectKey: 'myapp', dryRun: false, sarifUpload: false });
    expect(log).toHaveBeenCalledWith('Pull request: https://github.com/o/r/pull/7');
    log.mockRestore();
  });

  it('writes a refusal to stderr and exits 1', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    runSemgrepCiSetup.mockResolvedValue({ ok: false, message: 'Unknown project "myapp". Run: pan project list' });

    await pan('semgrep', 'ci-setup', 'myapp');

    expect(error).toHaveBeenCalledWith('Unknown project "myapp". Run: pan project list');
    expect(exitCli).toHaveBeenCalledWith(1);
    error.mockRestore();
  });
});
