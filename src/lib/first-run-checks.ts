/**
 * First-run probes (PAN-4282 D1): whether Claude and `gh` are logged in, and
 * whether this host's terminal backend can serve agents right now.
 *
 * Each check is memoized for 60 s (the memo stores the in-flight promise, so
 * concurrent callers share one probe), bypassed with `{ force: true }`. A
 * rejected probe deletes its memo entry so the next call retries instead of
 * caching a failure. The dashboard's `/api/prerequisites` report and
 * `pan doctor` both call these directly; this module imports nothing from
 * `src/dashboard/`.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { getClaudeAuthStatus } from './claude-auth.js';
import { hostTerminalBackendName, probeHerdrAvailability } from './terminal-backends/select.js';
import type { TerminalBackendName } from './terminal-backends/types.js';

const execFileAsync = promisify(execFile);

const MEMO_TTL_MS = 60_000;

export interface ClaudeLoginCheck {
  readonly ok: boolean;
  readonly detail: string;
}

export interface GhLoginCheck {
  readonly installed: boolean;
  readonly ok: boolean;
}

export interface HostBackendCheck {
  readonly name: TerminalBackendName;
  readonly available: boolean;
  readonly reason: string | null;
}

export interface CheckOptions {
  readonly force?: boolean;
}

const memo = new Map<string, { readonly at: number; readonly value: Promise<unknown> }>();

function memoized<T>(key: string, force: boolean | undefined, probe: () => Promise<T>): Promise<T> {
  const cached = memo.get(key);
  if (!force && cached && Date.now() - cached.at < MEMO_TTL_MS) {
    return cached.value as Promise<T>;
  }
  const value = probe().catch((cause) => {
    memo.delete(key);
    throw cause;
  });
  memo.set(key, { at: Date.now(), value });
  return value;
}

async function probeClaudeLogin(): Promise<ClaudeLoginCheck> {
  const status = await Effect.runPromise(getClaudeAuthStatus());
  const ok = (status.loggedIn && !status.expired) || status.hasAnthropicApiKey;
  let detail: string;
  if (status.loggedIn && !status.expired) {
    detail = `Signed in (${status.subscriptionType ?? 'unknown'})`;
  } else if (status.hasAnthropicApiKey) {
    detail = 'Using ANTHROPIC_API_KEY';
  } else if (status.loggedIn && status.expired) {
    detail = 'Sign-in expired';
  } else {
    detail = 'Not signed in';
  }
  return { ok, detail };
}

async function probeGhLogin(): Promise<GhLoginCheck> {
  try {
    await execFileAsync('gh', ['auth', 'status'], { timeout: 5000 });
    return { installed: true, ok: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { installed: false, ok: false };
    }
    return { installed: true, ok: false };
  }
}

async function probeHostBackend(options?: CheckOptions & { tmuxFound?: boolean }): Promise<HostBackendCheck> {
  const name = await hostTerminalBackendName();
  if (name === 'tmux') {
    const available = options?.tmuxFound ?? true;
    return { name, available, reason: available ? null : 'tmux is not installed.' };
  }
  const probe = await probeHerdrAvailability();
  return { name, available: probe.available, reason: probe.reason ?? null };
}

export function checkClaudeLogin(options?: CheckOptions): Promise<ClaudeLoginCheck> {
  return memoized('claude', options?.force, probeClaudeLogin);
}

export function checkGhLogin(options?: CheckOptions): Promise<GhLoginCheck> {
  return memoized('gh', options?.force, probeGhLogin);
}

export function checkHostBackend(options?: CheckOptions & { tmuxFound?: boolean }): Promise<HostBackendCheck> {
  return memoized('backend', options?.force, () => probeHostBackend(options));
}

/** Tests only: drop every memoized check result. */
export function resetFirstRunCheckMemo(): void {
  memo.clear();
}
