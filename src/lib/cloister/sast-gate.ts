/**
 * PAN-4590: pure logic for the built-in Semgrep `sast` verification gate.
 *
 * - Mode: `security.semgrep.gate` (default `advisory`), overridden per project
 *   by `verification.sast` in projects.yaml. `enabled: false` always means off.
 * - Scope: explicit file targets plus a filter that keeps only findings on
 *   lines the branch added (`git diff -U0 <merge-base>`, working tree). Never
 *   `--baseline-commit`, which registers a temporary git worktree.
 * - Verdict: only `blocking` mode with a completed scan and a counted finding
 *   fails. A scan that did not run is a skipped, non-required result.
 * - FR-10: added `nosemgrep` comments, `.semgrepignore` edits and changes under
 *   a repo-local rule path are listed for the security review lane.
 *
 * The process side (git, admission queue, the scanner child) is sast-run.ts.
 */

import { basename } from 'path';
import type { NormalizedSemgrepConfig, SemgrepGateMode, SemgrepSeverity } from '../config-yaml/semgrep.js';
import { SEMGREP_GATE_MODES } from '../config-yaml/semgrep.js';
import type { QualityGateResult } from './validation.js';

export const SAST_GATE_NAME = 'sast';
/** `<workspace>/.overdeck/sast-latest.json`, reused by the review context. */
export const SAST_LATEST_RELATIVE_PATH = '.overdeck/sast-latest.json';
const MAX_LISTED = 50;

export interface SastFinding {
  /** Repo-relative path; prefixed with `<repoKey>/` in a polyrepo workspace. */
  path: string;
  startLine: number;
  endLine: number;
  ruleId: string;
  severity: SemgrepSeverity;
  message: string;
  fix?: string;
}

export type SastSuppressionKind = 'nosemgrep' | 'semgrepignore' | 'rule-config';

export interface SastSuppression {
  kind: SastSuppressionKind;
  path: string;
  line?: number;
  /** The added line for `nosemgrep`; a change description otherwise. */
  detail: string;
}

export type SastRepoStatus = 'scanned' | 'no-targets' | 'error';

export interface SastRepoRecord {
  repoKey: string;
  head: string;
  status: SastRepoStatus;
  note?: string;
}

/** On-disk record the review context reuses for the same heads. */
export interface SastLatestRecord {
  version: 1;
  ranAt: string;
  mode: 'advisory' | 'blocking';
  severity: SemgrepSeverity;
  configs: string[];
  skipped: boolean;
  repos: SastRepoRecord[];
  findings: SastFinding[];
  suppressions: SastSuppression[];
}

// ─── Mode ──────────────────────────────────────────────────────────────────────

export interface SastModeDecision {
  mode: SemgrepGateMode;
  reason: string;
}

/**
 * The effective gate mode. `enabled: false` is off whatever the project says.
 * An invalid `verification.sast` value is ignored with a warning, never read as
 * `blocking`.
 */
export function resolveSastGateMode(
  semgrep: Pick<NormalizedSemgrepConfig, 'enabled' | 'gate'>,
  projectOverride: unknown,
  warn: (line: string) => void = console.warn,
): SastModeDecision {
  if (!semgrep.enabled) return { mode: 'off', reason: 'security.semgrep.enabled is false' };
  if (projectOverride !== undefined && projectOverride !== null) {
    if (typeof projectOverride === 'string' && (SEMGREP_GATE_MODES as readonly string[]).includes(projectOverride)) {
      return { mode: projectOverride as SemgrepGateMode, reason: `verification.sast: ${projectOverride} in projects.yaml` };
    }
    warn(`[sast] Ignoring verification.sast=${String(projectOverride)}: expected off, advisory or blocking`);
  }
  return { mode: semgrep.gate, reason: `security.semgrep.gate: ${semgrep.gate}` };
}

// ─── Scanner invocation ───────────────────────────────────────────────────────

/** `semgrep scan` argv. Targets follow `--`, so a path cannot become a flag. */
export function buildSemgrepArgv(configs: readonly string[], targets: readonly string[]): string[] {
  return [
    'scan',
    ...configs.flatMap((config) => ['--config', config]),
    '--json',
    '--metrics', 'off',
    '--error',
    '--',
    ...targets,
  ];
}

/** 0 = clean, 1 = findings (with `--error`), anything else = the scanner failed. */
export function classifySemgrepExit(code: number | null): 'clean' | 'findings' | 'error' {
  if (code === 0) return 'clean';
  if (code === 1) return 'findings';
  return 'error';
}

const SEVERITY_RANK: Record<SemgrepSeverity, number> = { INFO: 0, WARNING: 1, ERROR: 2 };

/** Map Semgrep's severity labels, current and newer, onto INFO/WARNING/ERROR. */
export function normalizeSemgrepSeverity(raw: unknown): SemgrepSeverity {
  switch (typeof raw === 'string' ? raw.toUpperCase() : '') {
    case 'ERROR':
    case 'CRITICAL':
    case 'HIGH':
      return 'ERROR';
    case 'INFO':
    case 'LOW':
      return 'INFO';
    default:
      return 'WARNING';
  }
}

export function severityMeetsThreshold(severity: SemgrepSeverity, threshold: SemgrepSeverity): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[threshold];
}

/** Parse `semgrep scan --json` stdout. Null when it is not a Semgrep report. */
export function parseSemgrepJson(stdout: string): SastFinding[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { results?: unknown }).results)) return null;
  const findings: SastFinding[] = [];
  for (const raw of (parsed as { results: unknown[] }).results) {
    if (!raw || typeof raw !== 'object') continue;
    const result = raw as {
      check_id?: unknown;
      path?: unknown;
      start?: { line?: unknown };
      end?: { line?: unknown };
      extra?: { message?: unknown; severity?: unknown; fix?: unknown };
    };
    if (typeof result.path !== 'string' || typeof result.start?.line !== 'number') continue;
    const startLine = result.start.line;
    const endLine = typeof result.end?.line === 'number' ? result.end.line : startLine;
    findings.push({
      path: result.path.replace(/^\.\//, ''),
      startLine,
      endLine: Math.max(startLine, endLine),
      ruleId: typeof result.check_id === 'string' ? result.check_id : 'unknown-rule',
      severity: normalizeSemgrepSeverity(result.extra?.severity),
      message: typeof result.extra?.message === 'string' ? result.extra.message.trim() : '',
      ...(typeof result.extra?.fix === 'string' && result.extra.fix.trim() ? { fix: result.extra.fix.trim() } : {}),
    });
  }
  return findings;
}

// ─── Diff scope ───────────────────────────────────────────────────────────────

export interface DiffFileChange {
  /** Path before the change; null for an added file. */
  oldPath: string | null;
  /** Path after the change; null for a deleted file. */
  newPath: string | null;
  /** Lines the change added, numbered in the new file. */
  added: Array<{ line: number; text: string }>;
}

function unquoteGitPath(raw: string): string {
  if (!raw.startsWith('"') || !raw.endsWith('"')) return raw;
  return raw.slice(1, -1).replace(/\\(["\\tn])/g, (_m, ch: string) => (ch === 't' ? '\t' : ch === 'n' ? '\n' : ch));
}

function headerPath(raw: string, prefix: 'a/' | 'b/'): string | null {
  const value = unquoteGitPath(raw.replace(/\t.*$/, ''));
  if (value === '/dev/null') return null;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

/**
 * Parse `git diff -U0 --src-prefix=a/ --dst-prefix=b/` output. Hunk bodies are
 * consumed by their declared counts, so an added line that itself starts with
 * `+++` or `diff --git` is never read as a header.
 */
export function parseUnifiedDiff(diff: string): DiffFileChange[] {
  const files: DiffFileChange[] = [];
  let current: DiffFileChange | null = null;
  let oldLeft = 0;
  let newLeft = 0;
  let nextNew = 0;
  for (const line of diff.split('\n')) {
    if (current && (oldLeft > 0 || newLeft > 0)) {
      if (line.startsWith('\\')) continue;
      if (line.startsWith('-') && oldLeft > 0) { oldLeft--; continue; }
      if (line.startsWith('+') && newLeft > 0) {
        current.added.push({ line: nextNew, text: line.slice(1) });
        nextNew++;
        newLeft--;
        continue;
      }
      oldLeft = 0;
      newLeft = 0;
    }
    if (line.startsWith('diff --git ')) {
      current = { oldPath: null, newPath: null, added: [] };
      files.push(current);
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      if (match && match[1] === match[2]) {
        current.oldPath = match[1]!;
        current.newPath = match[2]!;
      }
      continue;
    }
    if (!current) continue;
    if (line.startsWith('--- ')) { current.oldPath = headerPath(line.slice(4), 'a/'); continue; }
    if (line.startsWith('+++ ')) { current.newPath = headerPath(line.slice(4), 'b/'); continue; }
    if (line.startsWith('rename from ')) { current.oldPath = unquoteGitPath(line.slice(12)); continue; }
    if (line.startsWith('rename to ')) { current.newPath = unquoteGitPath(line.slice(10)); continue; }
    if (line.startsWith('new file mode')) { current.oldPath = null; continue; }
    if (line.startsWith('deleted file mode')) { current.newPath = null; continue; }
    const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
      nextNew = Number(hunk[2]);
      newLeft = hunk[3] === undefined ? 1 : Number(hunk[3]);
    }
  }
  return files;
}

/** Keep a finding only when one of its lines is a line the branch added. */
export function filterFindingsToAddedLines(findings: readonly SastFinding[], files: readonly DiffFileChange[]): SastFinding[] {
  const added = new Map<string, Set<number>>();
  for (const file of files) {
    if (!file.newPath || file.added.length === 0) continue;
    const lines = added.get(file.newPath) ?? new Set<number>();
    for (const entry of file.added) lines.add(entry.line);
    added.set(file.newPath, lines);
  }
  return findings.filter((finding) => {
    const lines = added.get(finding.path);
    if (!lines) return false;
    for (let line = finding.startLine; line <= finding.endLine; line++) {
      if (lines.has(line)) return true;
    }
    return false;
  });
}

const REGISTRY_CONFIG = /^(?:p|r|s)\/|^(?:auto|supply-chain|secrets)$|^https?:\/\//;
/** Project rule locations the `semgrep` skill and post-edit hook use, watched whatever the gate's configs are. */
const PROJECT_RULE_PATHS = ['.semgrep.yml', '.semgrep.yaml', '.semgrep'];

/** Repo-local rule files or directories: the configs that are not registry packs, plus the project rule locations. */
export function localRulePaths(configs: readonly string[]): string[] {
  return [...configs, ...PROJECT_RULE_PATHS]
    .filter((config) => !REGISTRY_CONFIG.test(config))
    .map((config) => config.replace(/^\.\//, '').replace(/\/+$/, ''))
    .filter((config, index, all) => config !== '' && config !== '.' && !config.startsWith('/') && all.indexOf(config) === index);
}

/** FR-10: suppressions and rule changes the diff introduces. */
export function detectSuppressionChanges(files: readonly DiffFileChange[], configs: readonly string[]): SastSuppression[] {
  const rulePaths = localRulePaths(configs);
  const out: SastSuppression[] = [];
  for (const file of files) {
    const path = file.newPath ?? file.oldPath;
    if (!path) continue;
    const touched = [file.oldPath, file.newPath].filter((p): p is string => Boolean(p));
    const change = !file.oldPath ? 'added' : !file.newPath ? 'deleted' : file.oldPath !== file.newPath ? `renamed from ${file.oldPath}` : 'modified';
    if (touched.some((p) => basename(p) === '.semgrepignore')) {
      out.push({ kind: 'semgrepignore', path, detail: `.semgrepignore ${change}` });
    }
    if (touched.some((p) => rulePaths.some((rule) => p === rule || p.startsWith(`${rule}/`)))) {
      out.push({ kind: 'rule-config', path, detail: `rule file ${change}` });
    }
    if (!file.newPath) continue;
    for (const entry of file.added) {
      if (/nosemgrep/i.test(entry.text)) {
        out.push({ kind: 'nosemgrep', path, line: entry.line, detail: entry.text.trim().slice(0, 200) });
      }
    }
  }
  return out;
}

// ─── Verdict and output ───────────────────────────────────────────────────────

export interface SastGateInput {
  mode: 'advisory' | 'blocking';
  severity: SemgrepSeverity;
  configs: readonly string[];
  /** Findings at or above the threshold on added lines, across every scanned repo. */
  findings: readonly SastFinding[];
  suppressions: readonly SastSuppression[];
  repos: readonly SastRepoRecord[];
  durationMs: number;
}

/** True when no repo completed a scan and at least one hit a scanner problem. */
export function sastScanSkipped(repos: readonly SastRepoRecord[]): boolean {
  return repos.some((repo) => repo.status === 'error') && !repos.some((repo) => repo.status === 'scanned');
}

export function formatSastOutput(input: SastGateInput): string {
  const lines: string[] = [
    `Semgrep sast gate: mode ${input.mode}, severity >= ${input.severity}, configs ${input.configs.join(', ')}`,
  ];
  if (sastScanSkipped(input.repos)) {
    lines.push('SKIPPED: Semgrep did not complete a scan, so this gate checked nothing.');
  } else if (input.findings.length === 0) {
    lines.push('No findings on lines this branch added.');
  } else {
    lines.push(`${input.findings.length} finding(s) on lines this branch added:`);
    for (const f of input.findings.slice(0, MAX_LISTED)) {
      const range = f.endLine > f.startLine ? `${f.startLine}-${f.endLine}` : `${f.startLine}`;
      lines.push(`  - ${f.path}:${range} [${f.severity}] ${f.ruleId}`);
      if (f.message) lines.push(`      ${f.message.replace(/\s+/g, ' ')}`);
      if (f.fix) lines.push(`      fix: ${f.fix.replace(/\s+/g, ' ')}`);
    }
    if (input.findings.length > MAX_LISTED) lines.push(`  ... and ${input.findings.length - MAX_LISTED} more`);
  }
  if (input.suppressions.length > 0) {
    lines.push('', 'New suppressions or rule changes in this diff (the security review lane checks each one):');
    for (const s of input.suppressions.slice(0, MAX_LISTED)) {
      lines.push(`  - ${s.kind} ${s.path}${s.line ? `:${s.line}` : ''}: ${s.detail}`);
    }
    if (input.suppressions.length > MAX_LISTED) lines.push(`  ... and ${input.suppressions.length - MAX_LISTED} more`);
  }
  const notes = input.repos.filter((repo) => repo.note);
  if (notes.length > 0) {
    lines.push('', 'Notes:');
    for (const repo of notes) lines.push(`  - ${repo.repoKey}: ${repo.note}`);
  }
  return lines.join('\n');
}

/**
 * The gate's verification result. Only `blocking` makes it required, and only
 * a counted finding from a completed scan fails it; a scan that did not run is
 * `passed: true, required: false, skipped: true` with the reason attached.
 */
export function decideSastGate(input: SastGateInput): QualityGateResult {
  const output = formatSastOutput(input);
  if (sastScanSkipped(input.repos)) {
    const reasons = input.repos.filter((repo) => repo.status === 'error' && repo.note).map((repo) => repo.note);
    return {
      name: SAST_GATE_NAME,
      passed: true,
      required: false,
      skipped: true,
      output,
      durationMs: input.durationMs,
      error: `Semgrep did not run: ${reasons.join('; ') || 'scanner error'}`,
    };
  }
  const passed = input.findings.length === 0;
  return {
    name: SAST_GATE_NAME,
    passed,
    required: input.mode === 'blocking',
    output,
    durationMs: input.durationMs,
    ...(passed ? {} : { error: `${input.findings.length} Semgrep finding(s) at or above ${input.severity} on changed lines` }),
  };
}

// ─── Review context ───────────────────────────────────────────────────────────

/** `semgrepFindings` on the review context manifest. */
export interface ReviewSemgrepFindings {
  /** `fresh`: the gate's record matches every reviewed head. `stale`: it was for other heads. `absent`: no record. */
  status: 'fresh' | 'stale' | 'absent';
  mode?: 'advisory' | 'blocking';
  skipped?: boolean;
  findings: SastFinding[];
  suppressions: SastSuppression[];
}

/** Reuse the gate's record only when it was made for exactly the heads under review. */
export function sastFindingsForReview(
  record: SastLatestRecord | null,
  heads: ReadonlyMap<string, string>,
): ReviewSemgrepFindings {
  if (!record || !Array.isArray(record.repos) || !Array.isArray(record.findings) || !Array.isArray(record.suppressions)) {
    return { status: 'absent', findings: [], suppressions: [] };
  }
  const matches = record.repos.length > 0
    && record.repos.length === heads.size
    && record.repos.every((repo) => heads.get(repo.repoKey) === repo.head);
  if (!matches) return { status: 'stale', mode: record.mode, findings: [], suppressions: [] };
  return {
    status: 'fresh',
    mode: record.mode,
    ...(record.skipped ? { skipped: true } : {}),
    findings: record.findings,
    suppressions: record.suppressions,
  };
}
