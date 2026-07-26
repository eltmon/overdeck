/**
 * Remote tmux/SSH plumbing for Fly-hosted agents.
 *
 * Extracted from remote-agents.ts (file-size ceiling) — the remote tmux
 * server is the crash-independent component for remote sessions, and both
 * remote-agents.ts and remote-keyed-delivery.ts build on these primitives.
 */

import { Effect } from 'effect';
import type { FlyProvider } from './fly-provider.js';
import type { ExecResult } from './interface.js';
import { getManagedTmuxSocketName } from '../tmux.js';

export const REMOTE_PAN_DIR = '/workspace/.pan';
const REMOTE_TMUX_DIR = `${REMOTE_PAN_DIR}/tmux`;
const REMOTE_TMUX_CONFIG_PATH = `${REMOTE_TMUX_DIR}/overdeck.tmux.conf`;
const REMOTE_TMUX_CONFIG_CONTENT = [
  '# Overdeck-managed tmux config',
  '# Keep this minimal and include only behavior Overdeck intentionally depends on.',
  'set -g mouse on',
  '',
].join('\n');

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function getRemoteTmuxBaseArgs(): string[] {
  return ['-L', getManagedTmuxSocketName(), '-f', REMOTE_TMUX_CONFIG_PATH];
}

export function buildRemoteTmuxCommand(args: string[]): string {
  return ['tmux', ...getRemoteTmuxBaseArgs(), ...args].map(shellQuote).join(' ');
}

/** Run a FlyProvider Effect at the async/Promise boundary. */
export function runSsh(
  provider: FlyProvider,
  vmName: string,
  command: string,
): Promise<ExecResult> {
  return Effect.runPromise(provider.ssh(vmName, command));
}

export async function ensureRemoteTmuxContext(provider: FlyProvider, vmName: string): Promise<void> {
  const configBase64 = Buffer.from(REMOTE_TMUX_CONFIG_CONTENT).toString('base64');
  await runSsh(
    provider,
    vmName,
    `mkdir -p ${shellQuote(REMOTE_TMUX_DIR)} && echo ${shellQuote(configBase64)} | base64 -d > ${shellQuote(REMOTE_TMUX_CONFIG_PATH)}`,
  );
}
