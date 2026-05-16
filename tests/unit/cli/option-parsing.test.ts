/**
 * CLI option-parsing regression tests (PAN-705).
 *
 * These tests lock two options that specialists and skills rely on:
 *
 *   1. `pan review request <id> -m "..."`  — used by the rebase-and-submit
 *      skill, work.md prompt, and verification-runner to re-enter the
 *      specialist pipeline after addressing feedback. If -m is not
 *      registered, Commander.js rejects it as an unknown option and the
 *      whole re-review path breaks.
 *
 *   2. `pan done <id> --force` — the pre-flight check error message in
 *      done.ts:284 tells users "Use --force to skip checks." If --force
 *      is not registered, users have no way to bypass.
 *
 * Tests invoke the built dist CLI with --help on the subcommand so
 * they don't depend on dashboard state, workspaces, or network.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, '../../../dist/cli/index.js');

function runCli(args: string[]): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync('node', [CLI_PATH, ...args], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 2_000,
    });
    return { stdout, stderr: '', status: 0 };
  } catch (e: any) {
    return {
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
      status: e.status ?? 1,
    };
  }
}

describe('pan review request <id> — option parsing', () => {
  it('registers -m, --message <text> on the subcommand', () => {
    const { stdout, status } = runCli(['review', 'request', '--help']);
    expect(status).toBe(0);
    expect(stdout).toMatch(/-m, --message <text>/);
    expect(stdout).toMatch(/Message describing the fixes/);
  });

  it('does NOT reject -m as an unknown option when parsing a real invocation', () => {
    const { stdout, stderr } = runCli([
      'review', 'request', 'PAN-TEST-NOEXIST',
      '-m', 'test message',
      '--help',
    ]);
    const all = stdout + stderr;
    expect(all).not.toMatch(/unknown option/i);
    expect(all).not.toMatch(/error: option/i);
  });

  it('does NOT reject --message as an unknown option (long form)', () => {
    const { stdout, stderr } = runCli([
      'review', 'request', 'PAN-TEST-NOEXIST',
      '--message', 'test',
      '--help',
    ]);
    const all = stdout + stderr;
    expect(all).not.toMatch(/unknown option/i);
  });
});

describe('pan done <id> — option parsing', () => {
  it('registers --force on the subcommand', () => {
    const { stdout, status } = runCli(['done', '--help']);
    expect(status).toBe(0);
    expect(stdout).toMatch(/--force/);
    expect(stdout).toMatch(/Skip pre-flight completion checks/);
  });

  it('does NOT reject --force as an unknown option when parsing a real invocation', () => {
    // The issue ID doesn't exist so the command will fail downstream, but it
    // MUST get past option parsing without "error: unknown option '--force'".
    const { stdout, stderr } = runCli(['done', 'PAN-TEST-NOEXIST', '--force']);
    const all = stdout + stderr;
    expect(all).not.toMatch(/unknown option/i);
    expect(all).not.toMatch(/error: option '--force'/i);
  });

  it('still registers -c/--comment alongside --force', () => {
    const { stdout } = runCli(['done', '--help']);
    expect(stdout).toMatch(/-c, --comment <message>/);
  });
});

describe('pan swarm <id> — option parsing', () => {
  it('registers both --auto-advance and --no-auto-advance', () => {
    const { stdout, status } = runCli(['swarm', '--help']);
    expect(status).toBe(0);
    expect(stdout).toMatch(/--auto-advance/);
    expect(stdout).toMatch(/--no-auto-advance/);
  });
});
