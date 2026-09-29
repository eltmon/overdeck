/**
 * Host contract probe for SageOx (PAN-2444 D7). Overdeck wires SageOx into a
 * launch only when the `ox` on PATH is the eltmon/ox fork build, which answers
 * `ox host-contract --json` with contract `overdeck-host/1`. Upstream `ox` has
 * no such command, so the probe fails there and Overdeck fails closed.
 *
 * The timeout is our own timer plus an AbortSignal (not execFile's `timeout`
 * option) so tests can drive it with fake timers.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const OX_HOST_CONTRACT = 'overdeck-host/1';
export const OX_PROBE_TIMEOUT_MS = 2000;

export type OxProbeResult =
  | { ok: true; version: string; commit: string }
  | { ok: false; reason: 'missing' | 'no-contract' | 'timeout' | 'bad-output' };

export async function probeOxHostContract(opts: { bin?: string; timeoutMs?: number } = {}): Promise<OxProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? OX_PROBE_TIMEOUT_MS);
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(opts.bin ?? 'ox', ['host-contract', '--json'], {
      signal: controller.signal,
      encoding: 'utf8',
    }));
  } catch (error) {
    if (controller.signal.aborted) return { ok: false, reason: 'timeout' };
    return { ok: false, reason: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'no-contract' };
  } finally {
    clearTimeout(timer);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { ok: false, reason: 'bad-output' };
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'bad-output' };
  const record = parsed as Record<string, unknown>;
  if (record['contract'] !== OX_HOST_CONTRACT) return { ok: false, reason: 'no-contract' };
  const version = typeof record['version'] === 'string' ? record['version'] : '';
  const commit = typeof record['commit'] === 'string' ? record['commit'] : '';
  return { ok: true, version, commit };
}
