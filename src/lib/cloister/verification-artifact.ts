/**
 * Verification gate artifact — the durable record of the most recent
 * quality-gate run for a workspace, written by the verification runner and
 * served to the dashboard's issue-tree Lint node.
 *
 * Lives at `<workspace>/.overdeck/verification-latest.json` (workspace runtime
 * plane, gitignored alongside continue.json). PAN-3847 (FR-11): every terminal
 * run ALSO writes an immutable per-run file under `.overdeck/verification/`
 * named by run time and head, so feedback references a file later runs cannot
 * overwrite. `verification-latest.json` remains the dashboard's read path.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { QualityGateResult } from './validation.js';

export interface VerificationGateRecord {
  name: string;
  passed: boolean;
  required: boolean;
  durationMs: number;
  /** Complete gate stdout+stderr for failed gates. */
  output?: string;
  error?: string;
}

export interface VerificationArtifact {
  issueId: string;
  ranAt: string;
  outcome: 'running' | 'passed' | 'failed';
  /** Gate currently executing — only present while outcome is 'running'. */
  currentGate?: string;
  /** Rolling tail of the running gate's stdout/stderr (ANSI-stripped). */
  currentGateOutput?: string;
  failedCheck?: string;
  gates: VerificationGateRecord[];
  /** Immutable per-run file this artifact was written to — terminal writes only (PAN-3847). */
  path?: string;
}

const ARTIFACT_RELATIVE_PATH = join('.overdeck', 'verification-latest.json');
const RUNS_RELATIVE_DIR = join('.overdeck', 'verification');

/** PAN-3847: per-run artifacts are kept for 30 days, then pruned by the idle-stack patrol. */
export const VERIFICATION_RUN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function verificationArtifactPath(workspacePath: string): string {
  return join(workspacePath, ARTIFACT_RELATIVE_PATH);
}

/** The immutable per-run artifact path: `<workspace>/.overdeck/verification/<ranAt>-<head8>.json`. */
export function verificationRunArtifactPath(workspacePath: string, ranAt: string, head8: string): string {
  return join(workspacePath, RUNS_RELATIVE_DIR, `${ranAt.replace(/[:.]/g, '-')}-${head8}.json`);
}

export function writeVerificationArtifact(
  workspacePath: string,
  issueId: string,
  gateResults: QualityGateResult[],
  options?: {
    currentGate?: string;
    currentGateOutput?: string;
    /** Terminal writes: run-start timestamp + workspace head — write the immutable per-run file too. */
    ranAt?: string;
    head8?: string;
  },
): VerificationArtifact {
  const failed = gateResults.find((r) => !r.passed && r.required !== false);
  // Progress writes carry no ranAt; terminal per-run writes always do (PAN-3847).
  const running = options !== undefined && options.ranAt === undefined;
  const isRunWrite = !running && Boolean(options?.ranAt && options?.head8);
  const artifact: VerificationArtifact = {
    issueId,
    ranAt: options?.ranAt ?? new Date().toISOString(),
    outcome: running ? 'running' : failed ? 'failed' : 'passed',
    ...(running && options?.currentGate ? { currentGate: options.currentGate } : {}),
    ...(running && options?.currentGateOutput ? { currentGateOutput: options.currentGateOutput } : {}),
    ...(!running && failed ? { failedCheck: failed.name } : {}),
    gates: gateResults.map((r) => ({
      name: r.name,
      passed: r.passed,
      required: r.required !== false,
      durationMs: r.durationMs,
      // Keep full output only where it matters: failures. Passing gates get a
      // clean record without megabytes of build noise.
      ...(r.passed ? {} : { output: r.output }),
      ...(r.error ? { error: r.error } : {}),
    })),
  };
  mkdirSync(join(workspacePath, '.overdeck'), { recursive: true });
  if (isRunWrite) {
    // The per-run file is the immutable record; the latest file is a copy so the
    // dashboard reader stays unchanged.
    const runPath = verificationRunArtifactPath(workspacePath, options!.ranAt!, options!.head8!);
    mkdirSync(join(workspacePath, RUNS_RELATIVE_DIR), { recursive: true });
    const json = JSON.stringify(artifact, null, 2);
    writeFileSync(runPath, json);
    writeFileSync(verificationArtifactPath(workspacePath), json);
    artifact.path = runPath;
    return artifact;
  }
  writeFileSync(verificationArtifactPath(workspacePath), JSON.stringify(artifact, null, 2));
  return artifact;
}

/** Delete per-run artifacts older than the retention window. Returns the count removed. */
export function pruneVerificationRunArtifacts(workspacePath: string, nowMs = Date.now()): number {
  const dir = join(workspacePath, RUNS_RELATIVE_DIR);
  if (!existsSync(dir)) return 0;
  let pruned = 0;
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.json')) continue;
    const file = join(dir, entry);
    try {
      if (nowMs - statSync(file).mtimeMs > VERIFICATION_RUN_RETENTION_MS) {
        rmSync(file, { force: true });
        pruned += 1;
      }
    } catch { /* best-effort retention — a locked or racing file is retried next patrol */ }
  }
  return pruned;
}

export function readVerificationArtifact(workspacePath: string): VerificationArtifact | null {
  const path = verificationArtifactPath(workspacePath);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as VerificationArtifact;
    if (!parsed || !Array.isArray(parsed.gates)) return null;
    return parsed;
  } catch {
    return null;
  }
}
