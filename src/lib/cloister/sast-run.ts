/**
 * PAN-4590: run the built-in Semgrep `sast` gate for a workspace.
 *
 * Per repo root: diff against `merge-base origin/<target> HEAD` (working tree),
 * scan only the added/modified/renamed files with the managed Semgrep binary,
 * and keep findings on added lines (sast-gate.ts). Each scan holds a quality
 * gate admission slot, runs in its own process group, and is killed with the
 * group at `security.semgrep.timeout_seconds`.
 *
 * This function never throws. Off (or Semgrep disabled) returns null and runs
 * nothing; every other problem becomes a skipped, non-required result.
 */

import { execFile, spawn } from 'child_process';
import { access, mkdir, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { dirname, join } from 'path';
import { promisify } from 'util';
import { loadConfigNoMigration } from '../config-yaml.js';
import type { NormalizedSemgrepConfig } from '../config-yaml/semgrep.js';
import type { WorkspaceRepoRoot } from '../project-repos.js';
import { SEMGREP_QUIET_ENV, managedSemgrepPath, semgrepToolsDir } from '../semgrep/install.js';
import { acquireQualityGateAdmission } from './quality-gate-admission.js';
import {
  buildSemgrepArgv,
  classifySemgrepExit,
  decideSastGate,
  detectSuppressionChanges,
  filterFindingsToAddedLines,
  parseSemgrepJson,
  parseUnifiedDiff,
  resolveSastGateMode,
  SAST_GATE_NAME,
  SAST_LATEST_RELATIVE_PATH,
  severityMeetsThreshold,
  type SastFinding,
  type SastLatestRecord,
  type SastRepoRecord,
  type SastSuppression,
} from './sast-gate.js';
import type { QualityGateResult } from './validation.js';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export interface ScannerOutcome {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Set when the process could not be started or its output overflowed. */
  error?: string;
}

export type RunScanner = (
  binary: string,
  argv: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
) => Promise<ScannerOutcome>;

type SpawnFn = typeof spawn;

/**
 * Run the scanner in its own process group and kill the whole group at the
 * timeout (PAN-2669: killing only the direct child leaves workers behind).
 */
export function runScannerProcess(
  binary: string,
  argv: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
  deps: { spawn?: SpawnFn; kill?: (pid: number, signal: NodeJS.Signals) => void } = {},
): Promise<ScannerOutcome> {
  const spawnFn = deps.spawn ?? spawn;
  const kill = deps.kill ?? ((pid, signal) => process.kill(pid, signal));
  const ownGroup = process.platform !== 'win32';
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let timedOut = false;
    let overflow = false;
    let settled = false;
    const finish = (outcome: ScannerOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    let child: ReturnType<SpawnFn>;
    try {
      child = spawnFn(binary, argv, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'], detached: ownGroup });
    } catch (err) {
      resolve({ exitCode: null, stdout: '', stderr: '', timedOut: false, error: err instanceof Error ? err.message : String(err) });
      return;
    }
    const killGroup = () => {
      const pid = child.pid;
      if (!pid) return;
      try { kill(ownGroup ? -pid : pid, 'SIGKILL'); } catch { /* already gone */ }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, opts.timeoutMs);
    const collect = (chunk: Buffer | string, into: 'stdout' | 'stderr') => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) {
        if (!overflow) { overflow = true; killGroup(); }
        return;
      }
      if (into === 'stdout') stdout += String(chunk);
      else stderr += String(chunk);
    };
    child.stdout?.on('data', (chunk) => collect(chunk, 'stdout'));
    child.stderr?.on('data', (chunk) => collect(chunk, 'stderr'));
    child.on('error', (err) => finish({ exitCode: null, stdout, stderr, timedOut, error: err.message }));
    child.on('close', (code) => finish({
      exitCode: code,
      stdout,
      stderr,
      timedOut,
      ...(overflow ? { error: `output exceeded ${MAX_OUTPUT_BYTES} bytes` } : {}),
    }));
  });
}

export interface SastRunDeps {
  loadSemgrepConfig?: () => Promise<NormalizedSemgrepConfig>;
  binaryPath?: string;
  binaryExists?: (path: string) => Promise<boolean>;
  git?: (cwd: string, args: string[]) => Promise<string>;
  runScanner?: RunScanner;
  acquireAdmission?: typeof acquireQualityGateAdmission;
  writeRecord?: (path: string, record: SastLatestRecord) => Promise<void>;
  now?: () => number;
  log?: (line: string) => void;
}

export interface SastRunOptions {
  issueId: string;
  workspacePath: string;
  repoRoots: readonly WorkspaceRepoRoot[];
  /** `verification.sast` from projects.yaml. */
  projectOverride: unknown;
  logPrefix: string;
  onAdmissionPhase?: (state: { phase: 'queued' | 'running'; gateName: string; attempt: number; admittedAt?: string }) => void;
}

async function defaultGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd, encoding: 'utf-8', timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES,
  });
  return stdout;
}

async function defaultBinaryExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function defaultWriteRecord(path: string, record: SastLatestRecord): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`);
}

/** Child env: quiet and metrics-off (NFR-2), state in the managed dir, no platform credentials. */
export function sastScannerEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...base,
    ...SEMGREP_QUIET_ENV,
    SEMGREP_SETTINGS_FILE: join(semgrepToolsDir(), 'settings.yml'),
    SEMGREP_LOG_FILE: join(semgrepToolsDir(), 'semgrep.log'),
    OVERDECK_GATE_ADMITTED: '1',
  };
  delete env.SEMGREP_APP_TOKEN;
  delete env.SEMGREP_RULES;
  return env;
}

function tail(text: string, max = 400): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `…${trimmed.slice(-max)}` : trimmed;
}

/**
 * Run the `sast` gate. Returns null when the gate is off; never throws.
 */
export async function runSastGate(opts: SastRunOptions, deps: SastRunDeps = {}): Promise<QualityGateResult | null> {
  const log = deps.log ?? ((line: string) => console.log(`[${opts.logPrefix}] ${line}`));
  const now = deps.now ?? Date.now;
  let semgrep: NormalizedSemgrepConfig;
  try {
    semgrep = deps.loadSemgrepConfig
      ? await deps.loadSemgrepConfig()
      : (await loadConfigNoMigration()).config.security.semgrep;
  } catch (err) {
    log(`sast gate not run: could not load config.yaml (${err instanceof Error ? err.message : String(err)})`);
    return null;
  }
  const decision = resolveSastGateMode(semgrep, opts.projectOverride);
  if (decision.mode === 'off') return null;
  const mode = decision.mode;
  const startedAt = now();
  log(`Running sast gate for ${opts.issueId} (mode ${mode}: ${decision.reason})`);

  const repos: SastRepoRecord[] = [];
  const findings: SastFinding[] = [];
  const suppressions: SastSuppression[] = [];
  try {
    const git = deps.git ?? defaultGit;
    const binary = deps.binaryPath ?? managedSemgrepPath();
    const binaryExists = await (deps.binaryExists ?? defaultBinaryExists)(binary);
    const runScanner = deps.runScanner ?? ((b, a, o) => runScannerProcess(b, a, o));
    const acquire = deps.acquireAdmission ?? acquireQualityGateAdmission;
    const isPolyrepo = opts.repoRoots.some((root) => root.isPolyrepo);

    for (const root of opts.repoRoots) {
      const prefix = isPolyrepo ? `${root.repoKey}/` : '';
      const record: SastRepoRecord = { repoKey: root.repoKey, head: '', status: 'error' };
      repos.push(record);
      try {
        record.head = (await git(root.dir, ['rev-parse', 'HEAD'])).trim();
        const base = (await git(root.dir, ['merge-base', `origin/${root.targetBranch}`, 'HEAD'])).trim();
        const targets = (await git(root.dir, [
          '-c', 'core.quotePath=false', 'diff', '--name-only', '-z', '--diff-filter=AMR', '--no-ext-diff', base, '--',
        ])).split('\0').filter(Boolean);
        const diffFiles = parseUnifiedDiff(await git(root.dir, [
          '-c', 'core.quotePath=false', 'diff', '-U0', '--no-color', '--no-ext-diff', '--no-textconv',
          '--src-prefix=a/', '--dst-prefix=b/', base, '--',
        ]));
        // FR-10: suppression changes come from the diff alone, so they are
        // reported even when the scanner cannot run.
        suppressions.push(...detectSuppressionChanges(diffFiles, semgrep.configs)
          .map((s) => ({ ...s, path: `${prefix}${s.path}` })));

        if (targets.length === 0) {
          record.status = 'no-targets';
          continue;
        }
        if (!binaryExists) {
          record.note = `Semgrep binary not found at ${binary}; run pan install (or pan doctor) with security.semgrep.enabled: true`;
          continue;
        }

        opts.onAdmissionPhase?.({ phase: 'queued', gateName: SAST_GATE_NAME, attempt: 1 });
        const admission = await acquire({
          issueId: opts.issueId,
          workspacePath: root.dir,
          gateName: SAST_GATE_NAME,
          attempt: 1,
        });
        let outcome: ScannerOutcome;
        try {
          opts.onAdmissionPhase?.({ phase: 'running', gateName: SAST_GATE_NAME, attempt: 1, admittedAt: admission.admittedAt });
          outcome = await runScanner(binary, buildSemgrepArgv(semgrep.configs, targets), {
            cwd: root.dir,
            env: sastScannerEnv(),
            timeoutMs: semgrep.timeout_seconds * 1000,
          });
        } finally {
          await admission.release().catch(() => undefined);
        }

        if (outcome.timedOut) {
          record.note = `Semgrep timed out after ${semgrep.timeout_seconds}s and was killed`;
          continue;
        }
        if (outcome.error) {
          record.note = `Semgrep could not run: ${outcome.error}`;
          continue;
        }
        const exit = classifySemgrepExit(outcome.exitCode);
        const parsed = exit === 'error' ? null : parseSemgrepJson(outcome.stdout);
        if (!parsed) {
          const detail = tail(outcome.stderr) || tail(outcome.stdout);
          record.note = exit === 'error'
            ? `Semgrep exited ${outcome.exitCode} (scanner error or registry unreachable)${detail ? `: ${detail}` : ''}`
            : 'Semgrep output was not a JSON report';
          continue;
        }
        record.status = 'scanned';
        const counted = filterFindingsToAddedLines(
          parsed.filter((f) => severityMeetsThreshold(f.severity, semgrep.severity)),
          diffFiles,
        );
        findings.push(...counted.map((f) => ({ ...f, path: `${prefix}${f.path}` })));
      } catch (err) {
        record.status = 'error';
        record.note = `sast gate error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  } catch (err) {
    repos.push({ repoKey: '*', head: '', status: 'error', note: `sast gate error: ${err instanceof Error ? err.message : String(err)}` });
  }

  let result: QualityGateResult;
  try {
    result = decideSastGate({
      mode,
      severity: semgrep.severity,
      configs: semgrep.configs,
      findings,
      suppressions,
      repos,
      durationMs: now() - startedAt,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { name: SAST_GATE_NAME, passed: true, required: false, skipped: true, output: reason, durationMs: 0, error: `Semgrep did not complete: ${reason}` };
  }
  const record: SastLatestRecord = {
    version: 1,
    ranAt: new Date(startedAt).toISOString(),
    mode,
    severity: semgrep.severity,
    configs: [...semgrep.configs],
    skipped: result.skipped === true,
    repos,
    findings,
    suppressions,
  };
  try {
    await (deps.writeRecord ?? defaultWriteRecord)(join(opts.workspacePath, SAST_LATEST_RELATIVE_PATH), record);
  } catch (err) {
    log(`Could not write ${SAST_LATEST_RELATIVE_PATH}: ${err instanceof Error ? err.message : String(err)}`);
  }
  log(result.skipped
    ? `sast gate SKIPPED for ${opts.issueId}: ${result.error}`
    : `sast gate for ${opts.issueId}: ${findings.length} finding(s), ${suppressions.length} suppression change(s), mode ${mode}`);
  return result;
}
