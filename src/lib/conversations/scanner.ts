/**
 * Scanner orchestrator (PAN-457).
 *
 * Walks ~/.claude/projects/ to discover JSONL session files, parses metadata,
 * correlates with Panopticon conversations, and upserts into discovered_sessions.
 *
 * Three scan modes:
 *   targeted — only sessions whose resolved workspace is under the given dirs
 *   watched  — sessions under config.conversations.watchDirs
 *   system   — all sessions under ~/.claude/projects/
 *
 * Zero sync FS calls — uses fs/promises throughout.
 */

import { promises as fs } from 'fs';
import { basename, join, relative, resolve } from 'path';
import { encodeClaudeProjectDir } from '../paths.js';
import { homedir } from 'os';

import {
  getDiscoveredSessionByJsonlPath,
  upsertDiscoveredSession,
} from '../database/discovered-sessions-db.js';
import { parseSessionJsonl } from './jsonl-async.js';
import { HashResolver } from './hash-resolver.js';
import { getSystemCapabilities } from './system-probe.js';
import { Effect } from 'effect';
import { runWithPool } from './work-pool.js';
import { buildCorrelationMap } from './correlator.js';
import { getModelCapability } from '../model-capabilities.js';
import { resolveModelId } from '../model-capabilities.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ScanMode = 'targeted' | 'watched' | 'system';

export interface ScanOptions {
  mode: ScanMode;
  /** For 'targeted' mode: absolute paths to scan under */
  dirs?: string[];
  /** Directories configured in watchDirs (for 'watched' mode) */
  watchDirs?: string[];
  /** If true, do not write to DB */
  dryRun?: boolean;
  /** Override parallelism from system-probe */
  maxParallel?: number | null;
  /** Progress callback */
  onProgress?: (progress: ScanProgress) => void | Promise<void>;
  /** Injected parser for integration tests */
  parseJsonl?: typeof parseSessionJsonl;
}

export interface ScanProgress {
  dirsProcessed: number;
  dirsTotal: number;
  sessionsFound: number;
  elapsedMs: number;
}

export interface ScanResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  durationMs: number;
  warnings?: string[];
}

// ─── Discovery ────────────────────────────────────────────────────────────────

/**
 * Recursively collect all .jsonl files under a project directory.
 * Follows subdirectories (e.g. <uuid>/subagents/) so nested subagent transcripts
 * are discovered alongside top-level session files.
 * The projectDir (top-level hash dir) is preserved on every result entry for mode filtering.
 */
async function collectJsonlFiles(
  projectDir: string,
  dir: string,
  result: Array<{ projectDir: string; jsonlPath: string }>,
  warnings: string[],
): Promise<void> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') {
      warnings.push(`Permission denied while scanning ${dir}`);
    }
    return;
  }
  for (const entry of entries) {
    const name = String(entry.name);
    if (entry.isFile() && name.endsWith('.jsonl')) {
      result.push({ projectDir, jsonlPath: join(dir, name) });
    } else if (entry.isDirectory()) {
      await collectJsonlFiles(projectDir, join(dir, name), result, warnings);
    }
  }
}

/**
 * Walk ~/.claude/projects/ and return all .jsonl files (including nested subagent transcripts).
 * Each entry is { projectDir, jsonlPath }.
 */
async function discoverJsonlFiles(
  warnings: string[],
  targetEncodings?: string[],
): Promise<Array<{ projectDir: string; jsonlPath: string }>> {
  const claudeProjectsDir = join(homedir(), '.claude', 'projects');
  const result: Array<{ projectDir: string; jsonlPath: string }> = [];

  let projectDirs: string[];
  try {
    const entries = await fs.readdir(claudeProjectsDir, { withFileTypes: true });
    projectDirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => join(claudeProjectsDir, e.name));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') {
      warnings.push(`Permission denied while scanning ${claudeProjectsDir}`);
    }
    return result;
  }

  for (const projectDir of projectDirs) {
    if (targetEncodings && !projectDirMatchesAnyTarget(projectDir, targetEncodings)) continue;
    await collectJsonlFiles(projectDir, projectDir, result, warnings);
  }

  return result;
}

// ─── Scanner ──────────────────────────────────────────────────────────────────

export async function scan(opts: ScanOptions): Promise<ScanResult> {
  const startTs = Date.now();
  const result: ScanResult = { inserted: 0, updated: 0, skipped: 0, errors: 0, durationMs: 0, warnings: [] };

  const parseJsonl = opts.parseJsonl ?? parseSessionJsonl;

  // 1. Discover JSONL candidates
  const discoveryEncodings = targetEncodingsForMode(opts);
  const allFiles = discoveryEncodings?.length === 0
    ? []
    : await discoverJsonlFiles(result.warnings!, discoveryEncodings ?? undefined);

  // 2. Filter by mode
  const filteredFiles = filterByMode(allFiles, opts);
  const resolver = new HashResolver(opts.watchDirs ?? []);

  if (opts.dryRun) {
    for (const { jsonlPath } of filteredFiles) {
      if (opts.mode === 'targeted') {
        try {
          const meta = await parseJsonl(jsonlPath);
          const resolved = await resolver.resolve(jsonlPath, meta.cwdFromFirstMessage);
          if (resolved.warning) result.warnings!.push(resolved.warning);
          if (!workspaceUnderAnyDir(resolved.workspacePath, opts.dirs ?? [])) continue;
        } catch {
          result.errors++;
          continue;
        }
      }
      const existing = getDiscoveredSessionByJsonlPath(jsonlPath);
      try {
        const stat = await fs.stat(jsonlPath);
        const fileMtime = new Date(stat.mtimeMs).toISOString();
        if (existing && existing.fileSize === stat.size && existing.fileMtime === fileMtime) {
          result.skipped++;
        } else if (existing) {
          result.updated++;
        } else {
          result.inserted++;
        }
      } catch {
        result.errors++;
      }
    }
    result.durationMs = Date.now() - startTs;
    if (result.warnings?.length === 0) delete result.warnings;
    return result;
  }

  // 3. Build correlation map (Panopticon-managed detection)
  const allPaths = filteredFiles.map((f) => f.jsonlPath);
  const correlationMap = buildCorrelationMap(allPaths);

  // 4. Determine parallelism from system-probe
  // Adapter boundary: scanner.ts is still Promise-based; provide services and bridge to Promise.
  // This will be replaced with yield* when scanner.ts is migrated in its own wave-5 slot.
  const { layer: NodeServicesLayer } = await import('@effect/platform-node/NodeServices');
  const caps = await Effect.runPromise(
    getSystemCapabilities(opts.maxParallel).pipe(Effect.provide(NodeServicesLayer)),
  );
  const maxParallel = caps.recommendedParallelism;

  // 5. Track progress
  let dirsProcessed = 0;
  const dirsTotal = filteredFiles.length;
  let sessionsFound = 0;

  // 7. Build tasks
  const tasks = filteredFiles.map(({ jsonlPath }) => async () => {
    // Change detection: skip if file unchanged
    const existing = getDiscoveredSessionByJsonlPath(jsonlPath);
    let stat: { size: number; mtimeMs: number } | null = null;
    try {
      const s = await fs.stat(jsonlPath);
      stat = { size: s.size, mtimeMs: s.mtimeMs };
    } catch {
      result.errors++;
      return;
    }

    const fileMtime = new Date(stat.mtimeMs).toISOString();
    const correlation = correlationMap.get(jsonlPath) ?? {
      panopticonManaged: false,
      panIssueId: null,
      panAgentId: null,
      actualCost: null,
      costEventCount: 0,
    };
    if (
      existing &&
      existing.fileSize === stat.size &&
      existing.fileMtime === fileMtime
    ) {
      const correlationChanged =
        existing.panopticonManaged !== correlation.panopticonManaged ||
        existing.panIssueId !== correlation.panIssueId ||
        existing.panAgentId !== correlation.panAgentId;

      if (correlationChanged) {
        if (correlation.actualCost != null) {
          validateEstimatedCost(jsonlPath, existing.estimatedCost, correlation.actualCost, result.warnings!);
        }
        upsertDiscoveredSession({
          jsonlPath,
          sessionId: existing.sessionId,
          workspacePath: existing.workspacePath,
          workspaceHash: existing.workspaceHash,
          messageCount: existing.messageCount,
          firstTs: existing.firstTs,
          lastTs: existing.lastTs,
          modelsUsed: existing.modelsUsed,
          primaryModel: existing.primaryModel,
          tokenInput: existing.tokenInput,
          tokenOutput: existing.tokenOutput,
          estimatedCost: existing.estimatedCost,
          toolsUsed: existing.toolsUsed,
          filesTouched: existing.filesTouched,
          panopticonManaged: correlation.panopticonManaged,
          panIssueId: correlation.panIssueId,
          panAgentId: correlation.panAgentId,
          fileSize: stat.size,
          fileMtime,
        });
        result.updated++;
        sessionsFound++;
      } else {
        result.skipped++;
      }
      dirsProcessed++;
      await opts.onProgress?.({
        dirsProcessed,
        dirsTotal,
        sessionsFound,
        elapsedMs: Date.now() - startTs,
      });
      return;
    }

    // Parse, resolve, and upsert — wrap so one bad file can't leave progress incomplete.
    try {
      const meta = await parseJsonl(jsonlPath);

      // Resolve workspace path
      const resolved = await resolver.resolve(jsonlPath, meta.cwdFromFirstMessage);
      if (resolved.warning) result.warnings!.push(resolved.warning);
      if (opts.mode === 'targeted' && !workspaceUnderAnyDir(resolved.workspacePath, opts.dirs ?? [])) {
        dirsProcessed++;
        await opts.onProgress?.({
          dirsProcessed,
          dirsTotal,
          sessionsFound,
          elapsedMs: Date.now() - startTs,
        });
        return;
      }

      // Estimate cost from token counts using model-capabilities pricing
      const estimatedCost = estimateCost(meta.primaryModel, meta.tokenInput, meta.tokenOutput);
      if (correlation.actualCost != null) {
        validateEstimatedCost(jsonlPath, estimatedCost, correlation.actualCost, result.warnings!);
      }

      // Upsert into DB
      const wasExisting = !!existing;
      upsertDiscoveredSession({
        jsonlPath,
        sessionId: meta.sessionId,
        workspacePath: resolved.workspacePath,
        workspaceHash: resolved.workspaceHash,
        messageCount: meta.messageCount,
        firstTs: meta.firstTs,
        lastTs: meta.lastTs,
        modelsUsed: meta.modelsUsed,
        primaryModel: meta.primaryModel,
        tokenInput: meta.tokenInput,
        tokenOutput: meta.tokenOutput,
        estimatedCost,
        toolsUsed: meta.toolsUsed,
        filesTouched: meta.filesTouched,
        panopticonManaged: correlation.panopticonManaged,
        panIssueId: correlation.panIssueId,
        panAgentId: correlation.panAgentId,
        fileSize: stat.size,
        fileMtime,
      });

      sessionsFound++;
      if (wasExisting) {
        result.updated++;
      } else {
        result.inserted++;
      }
    } catch {
      result.errors++;
    }

    dirsProcessed++;
    await opts.onProgress?.({
      dirsProcessed,
      dirsTotal,
      sessionsFound,
      elapsedMs: Date.now() - startTs,
    });
  });

  // 8. Run with bounded parallelism
  await runWithPool(tasks, maxParallel, (taskResult) => {
    if (taskResult instanceof Error) {
      result.errors++;
    }
  });

  result.durationMs = Date.now() - startTs;
  if (result.warnings?.length === 0) delete result.warnings;
  return result;
}

// ─── Cost estimation ──────────────────────────────────────────────────────────

/**
 * Simple cost estimate from token counts using model-capabilities pricing.
 * Falls back to $0 if the model is unknown.
 */
function estimateCost(
  primaryModel: string | null,
  tokenInput: number,
  tokenOutput: number,
): number {
  if (!primaryModel) return 0;
  try {
    const modelId = resolveModelId(primaryModel);
    const cap = getModelCapability(modelId);
    // costPer1MTokens is an average blended rate
    return (cap.costPer1MTokens / 1_000_000) * (tokenInput + tokenOutput);
  } catch {
    return 0;
  }
}

export function validateEstimatedCost(
  jsonlPath: string,
  estimatedCost: number,
  actualCost: number,
  warnings: string[],
): void {
  const delta = Math.abs(estimatedCost - actualCost);
  const tolerance = Math.max(0.01, actualCost * 0.20);
  if (delta > tolerance) {
    warnings.push(
      `Estimated cost for ${jsonlPath} differs from cost_events by $${delta.toFixed(4)} ` +
      `(estimated $${estimatedCost.toFixed(4)}, actual $${actualCost.toFixed(4)})`,
    );
  }
}

// ─── Mode filtering ───────────────────────────────────────────────────────────

function filterByMode(
  files: Array<{ projectDir: string; jsonlPath: string }>,
  opts: ScanOptions,
): Array<{ projectDir: string; jsonlPath: string }> {
  const targetEncodings = targetEncodingsForMode(opts);
  if (!targetEncodings) return files;
  if (targetEncodings.length === 0) return [];
  return files.filter(({ projectDir }) => projectDirMatchesAnyTarget(projectDir, targetEncodings));
}

function targetEncodingsForMode(opts: ScanOptions): string[] | null {
  if (opts.mode === 'system') return null;
  const rawDirs = opts.mode === 'targeted' ? (opts.dirs ?? []) : (opts.watchDirs ?? []);
  return rawDirs.map(normalizeDir).map(encodeClaudeProjectDir);
}

function projectDirMatchesAnyTarget(projectDir: string, targetEncodings: string[]): boolean {
  const hash = basename(projectDir);
  return targetEncodings.some((enc) => hash === enc || hash.startsWith(enc + '-'));
}

function workspaceUnderAnyDir(workspacePath: string | null, dirs: string[]): boolean {
  if (!workspacePath) return false;
  const normalizedWorkspace = resolve(normalizeDir(workspacePath));
  return dirs.map((dir) => resolve(normalizeDir(dir))).some((dir) => {
    const rel = relative(dir, normalizedWorkspace);
    return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/') && rel !== '..');
  });
}

function normalizeDir(dir: string): string {
  if (dir.startsWith('~/')) return join(homedir(), dir.slice(2));
  return dir;
}
