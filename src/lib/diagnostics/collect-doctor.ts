/**
 * Doctor collector for `pan diagnose` bundles (PAN-4643 D2, FR-8).
 *
 * Runs `pan doctor --json` out of process — isolating a crashing or hanging
 * check from the bundle, and not depending on `pan` being on `PATH` (#2630).
 * A minimal structural shape for the parsed report is re-declared here (the
 * house pattern, as `doctor-first-run.ts` does for `CheckResult`), because
 * `src/lib/diagnostics/**` imports nothing from `src/cli/**`, not even types.
 */

import { spawn as spawnCb, type ChildProcess } from 'child_process';
import type { BundleEntry, CollectorFailure, CollectorOutcome } from './bundle.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const OUTPUT_CAP_BYTES = 24 * 1024;
const ACCUMULATION_CAP_BYTES = OUTPUT_CAP_BYTES * 4;
const INSPECT_FLAG_PATTERN = /^--inspect(-brk|-port)?(=.*)?$/;

/** Minimal structural shape of `DoctorJsonReport` (doctor-report.ts). */
interface MinimalDoctorJsonReport {
  schemaVersion: unknown;
  checks: unknown;
}

function isValidDoctorReport(value: unknown): value is MinimalDoctorJsonReport {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.schemaVersion === 1 && Array.isArray(candidate.checks);
}

/**
 * Drop any `--inspect`, `--inspect-brk` or `--inspect-port` entry (with or
 * without `=value`) so a debugged parent process does not make the child
 * fight over the debugger port.
 */
export function filterExecArgv(execArgv: string[]): string[] {
  return execArgv.filter((arg) => !INSPECT_FLAG_PATTERN.test(arg));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function appendCapped(current: Buffer<ArrayBufferLike>, chunk: Buffer<ArrayBufferLike>): Buffer<ArrayBufferLike> {
  const combined = Buffer.concat([current, chunk]);
  return combined.length > ACCUMULATION_CAP_BYTES
    ? combined.subarray(combined.length - ACCUMULATION_CAP_BYTES)
    : combined;
}

function capTail(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, 'utf-8');
  return buf.length <= maxBytes ? text : buf.subarray(buf.length - maxBytes).toString('utf-8');
}

interface ChildResult {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: string | null;
  timedOut: boolean;
}

function buildDoctorOutputEntry(result: ChildResult): BundleEntry {
  const content = [
    `exit code: ${result.code ?? 'null'}`,
    `signal: ${result.signal ?? 'null'}`,
    '',
    '--- stdout ---',
    capTail(result.stdout, OUTPUT_CAP_BYTES),
    '',
    '--- stderr ---',
    capTail(result.stderr, OUTPUT_CAP_BYTES),
    '',
  ].join('\n');

  return {
    path: 'doctor-output.txt',
    content,
    kind: 'text',
    description: 'pan doctor --json raw output (did not parse as JSON, or timed out)',
  };
}

export interface CollectDoctorOptions {
  spawn?: typeof spawnCb;
  execPath?: string;
  execArgv?: string[];
  cliEntry?: string;
  timeoutMs?: number;
}

function runDoctorChild(options: {
  spawn: typeof spawnCb;
  execPath: string;
  args: string[];
  timeoutMs: number;
}): Promise<ChildResult> {
  return new Promise((resolve) => {
    const child: ChildProcess = options.spawn(options.execPath, options.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdoutBuf: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderrBuf: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      resolve({ stdout: stdoutBuf.toString('utf-8'), stderr: stderrBuf.toString('utf-8'), code: null, signal: null, timedOut: true });
    }, options.timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf = appendCapped(stdoutBuf, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf = appendCapped(stderrBuf, chunk);
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stderrText = stderrBuf.toString('utf-8');
      resolve({
        stdout: stdoutBuf.toString('utf-8'),
        stderr: stderrText ? `${stderrText}\n${errorMessage(error)}` : errorMessage(error),
        code: null,
        signal: null,
        timedOut: false,
      });
    });

    child.on('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout: stdoutBuf.toString('utf-8'), stderr: stderrBuf.toString('utf-8'), code, signal, timedOut: false });
    });
  });
}

export async function collectDoctor(options: CollectDoctorOptions = {}): Promise<CollectorOutcome> {
  const spawnFn = options.spawn ?? spawnCb;
  const execPath = options.execPath ?? process.execPath;
  const execArgv = options.execArgv ?? filterExecArgv(process.execArgv);
  const cliEntry = options.cliEntry ?? process.argv[1] ?? '';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const args = [...execArgv, cliEntry, 'doctor', '--json'];

  const result = await runDoctorChild({ spawn: spawnFn, execPath, args, timeoutMs });

  if (result.timedOut) {
    return {
      entries: [buildDoctorOutputEntry(result)],
      failures: [{ source: 'pan doctor --json', reason: `timed out after ${Math.round(timeoutMs / 1000)}s` }],
    };
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    parsed = null;
  }

  if (isValidDoctorReport(parsed)) {
    return {
      entries: [{
        path: 'doctor.json',
        content: `${JSON.stringify(parsed, null, 2)}\n`,
        kind: 'text',
        description: 'pan doctor --json report',
      }],
      failures: [],
    };
  }

  return {
    entries: [buildDoctorOutputEntry(result)],
    failures: [{ source: 'pan doctor --json', reason: 'stdout did not parse as a doctor JSON report' }],
  };
}
