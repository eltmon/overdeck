/**
 * Scanner orchestrator (PAN-457).
 *
 * Walks ~/.claude/projects/ to discover JSONL session files, parses metadata,
 * correlates with Overdeck conversations, and upserts into discovered_sessions.
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
} from '../overdeck/discovered-sessions.js';
import { getOverdeckDatabaseSync } from '../overdeck/infra.js';
import { parseSessionJsonl } from './jsonl-async.js';
import { HashResolver } from './hash-resolver.js';
import { getSystemCapabilities } from './system-probe.js';
import { Effect } from 'effect';
import { runWithPool } from './work-pool.js';
import { buildCorrelationMapSync, buildLocatorCorrelationMapSync, mergeCorrelation, type CorrelationResult } from './correlator.js';
import { getModelCapabilitySync } from '../model-capabilities.js';
import { resolveModelIdSync } from '../model-capabilities.js';
import { discoverJsonlFiles, type DiscoveredFile } from './harness-discovery.js';
import { parseCodexSessionMetadata, parsePiSessionMetadata } from './harness-metadata.js';

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

// ─── Scanner ──────────────────────────────────────────────────────────────────

export async function scan(opts: ScanOptions): Promise<ScanResult> {
  const startTs = Date.now();
  const result: ScanResult = { inserted: 0, updated: 0, skipped: 0, errors: 0, durationMs: 0, warnings: [] };

  const parseJsonlEff = opts.parseJsonl ?? parseSessionJsonl;
  const parseJsonl = (path: string) => Effect.runPromise(parseJsonlEff(path));
  const resolver = new HashResolver(opts.watchDirs ?? []);
  const parseMetadata = (file: DiscoveredFile) => {
    if (file.harness === 'pi' || file.harness === 'ohmypi') {
      return parsePiSessionMetadata(file.jsonlPath);
    }
    if (file.harness === 'codex') {
      return parseCodexSessionMetadata(file.jsonlPath);
    }
    return parseJsonl(file.jsonlPath);
  };
  const resolveWorkspace = async (file: DiscoveredFile, cwdFromFirstMessage: string | null) => {
    if (file.harness === 'claude-code') {
      return resolver.resolve(file.jsonlPath, cwdFromFirstMessage);
    }
    if (cwdFromFirstMessage) {
      return { workspacePath: cwdFromFirstMessage, workspaceHash: null as string | null, warning: null as string | null };
    }
    if (file.harness === 'codex') {
      return { workspacePath: resolveCodexAgentWorkspace(file.jsonlPath), workspaceHash: null as string | null, warning: null as string | null };
    }
    return { workspacePath: null as string | null, workspaceHash: null as string | null, warning: null as string | null };
  };

  // 1. Discover JSONL candidates
  const discoveryEncodings = targetEncodingsForMode(opts);
  const allFiles = discoveryEncodings?.length === 0
    ? []
    : await discoverJsonlFiles(result.warnings!, discoveryEncodings ?? undefined);

  // 2. Filter by mode
  const filteredFiles = filterByMode(allFiles, opts);

  if (opts.dryRun) {
    for (const file of filteredFiles) {
      const { jsonlPath, harness } = file;
      if (opts.mode === 'targeted') {
        try {
          const meta = await parseMetadata(file);
          const resolved = await resolveWorkspace(file, meta.cwdFromFirstMessage);
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

  // 3. Build correlation map (Overdeck-managed detection)
  const allPaths = filteredFiles.map((f) => f.jsonlPath);
  const correlationMap = buildCorrelationMapSync(allPaths);
  const locatorCorrelationMap = buildLocatorCorrelationMapSync();

  // 4. Determine parallelism from system-probe
  const caps = await Effect.runPromise(getSystemCapabilities(opts.maxParallel));
  const maxParallel = caps.recommendedParallelism;

  // 5. Track progress
  let dirsProcessed = 0;
  const dirsTotal = filteredFiles.length;
  let sessionsFound = 0;

  // 7. Build tasks
  const tasks = filteredFiles.map((file) => async () => {
    const { jsonlPath, harness } = file;
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
    const baseCorrelation = correlationMap.get(jsonlPath);
    const correlation = combineCorrelation(baseCorrelation, harness === 'claude-code' ? null : existing?.sessionId, locatorCorrelationMap);
    if (
      existing &&
      existing.fileSize === stat.size &&
      existing.fileMtime === fileMtime
    ) {
      const correlationChanged =
        existing.overdeckManaged !== correlation.overdeckManaged ||
        existing.panIssueId !== correlation.panIssueId ||
        existing.panAgentId !== correlation.panAgentId;

      if (correlationChanged) {
        if (correlation.actualCost != null) {
          validateEstimatedCost(jsonlPath, existing.estimatedCost, correlation.actualCost, result.warnings!);
        }
        upsertDiscoveredSession({
          jsonlPath,
          harness,
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
          overdeckManaged: correlation.overdeckManaged,
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
      const meta = await parseMetadata(file);
      const effectiveCorrelation = combineCorrelation(correlationMap.get(jsonlPath), harness === 'claude-code' ? null : meta.sessionId, locatorCorrelationMap);

      // Resolve workspace path
      const resolved = await resolveWorkspace(file, meta.cwdFromFirstMessage);
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
      if (effectiveCorrelation.actualCost != null) {
        validateEstimatedCost(jsonlPath, estimatedCost, effectiveCorrelation.actualCost, result.warnings!);
      }

      // Upsert into DB
      const wasExisting = !!existing;
      upsertDiscoveredSession({
        jsonlPath,
        harness,
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
        overdeckManaged: effectiveCorrelation.overdeckManaged,
        panIssueId: effectiveCorrelation.panIssueId,
        panAgentId: effectiveCorrelation.panAgentId,
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
  await Effect.runPromise(runWithPool(tasks, maxParallel, (taskResult) => {
    if (taskResult instanceof Error) {
      result.errors++;
    }
  }));

  result.durationMs = Date.now() - startTs;
  if (result.warnings?.length === 0) delete result.warnings;
  return result;
}

function emptyCorrelation(): CorrelationResult {
  return {
    overdeckManaged: false,
    panIssueId: null,
    panAgentId: null,
    actualCost: null,
    costEventCount: 0,
  };
}

function combineCorrelation(
  base: CorrelationResult | undefined,
  sessionId: string | null | undefined,
  locatorCorrelationMap: ReadonlyMap<string, CorrelationResult>,
): CorrelationResult {
  const fallback = base ?? emptyCorrelation();
  if (!sessionId) return fallback;
  const byLocator = locatorCorrelationMap.get(sessionId);
  return byLocator ? mergeCorrelation(fallback, byLocator) : fallback;
}

function resolveCodexAgentWorkspace(jsonlPath: string): string | null {
  const normalized = jsonlPath.replace(/\\/g, '/');
  const match = normalized.match(/\/\.overdeck\/agents\/([^/]+)\//);
  const agentId = match?.[1];
  if (!agentId) return null;
  const row = getOverdeckDatabaseSync()
    .prepare(`SELECT workspace FROM agents WHERE id = ?`)
    .get(agentId) as { workspace: string | null } | undefined;
  return row?.workspace ?? null;
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
    const modelId = resolveModelIdSync(primaryModel);
    const cap = getModelCapabilitySync(modelId);
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
  files: DiscoveredFile[],
  opts: ScanOptions,
): DiscoveredFile[] {
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
