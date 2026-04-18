/**
 * Flywheel Daemon — Autonomous self-improvement loop (PAN-709)
 *
 * Sits alongside the deacon as a second Cloister loop. Responsibilities:
 *  - On merge complete: spawn retro-agent for the merged issue
 *  - On cycle detected in FLYWHEEL-STATE: file substrate-improvement issue
 *  - Every 30 min: run synthesis step if new retros exist
 *  - Every 24 hours: full flywheel cycle
 *  - Awaiting Merge queue exceeds threshold: emit dashboard banner notification
 *
 * Guards (always checked before any action):
 *  - Quiet hours: configurable "22:00-08:00", no non-blocker actions
 *  - Active session backoff: skip synthesis if user has a recent Claude Code session
 *  - Mutex: ~/.panopticon/flywheel.lock prevents concurrent cycles
 */

import { existsSync } from 'fs';
import { readFile, writeFile, unlink, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { PANOPTICON_HOME } from '../paths.js';
import { loadCloisterConfig, type FlywheelConfig } from './config.js';

export type { FlywheelConfig };

const DEFAULT_CONFIG: FlywheelConfig = {
  autonomous: true,
  quiet_hours: '22:00-08:00',
  trigger_interval_minutes: 30,
  full_cycle_interval_hours: 24,
  backoff_on_active_session: true,
  awaiting_merge_notify_threshold: 5,
};

const FLYWHEEL_LOCK_FILE = join(PANOPTICON_HOME, 'flywheel.lock');
const FLYWHEEL_STATE_FILE = join(homedir(), 'docs', 'FLYWHEEL-STATE.md');
const FLYWHEEL_PENDING_RETROS_FILE = join(PANOPTICON_HOME, 'flywheel-pending-retros.json');

// ============================================================================
// State
// ============================================================================

let daemonInterval: NodeJS.Timeout | null = null;
let lastSynthesisAt: number = 0;
let lastFullCycleAt: number = 0;

/** Callbacks registered by other modules */
let mergeCompleteHandler: ((issueId: string) => void) | null = null;
let awaitingMergeNotifier: ((count: number) => void) | null = null;

// ============================================================================
// Guard: quiet hours
// ============================================================================

/**
 * Parse "HH:MM-HH:MM" format into hour+minute numbers.
 */
function parseQuietHours(range: string): { startH: number; startM: number; endH: number; endM: number } | null {
  const m = range.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return {
    startH: parseInt(m[1], 10),
    startM: parseInt(m[2], 10),
    endH: parseInt(m[3], 10),
    endM: parseInt(m[4], 10),
  };
}

function isQuietHours(config: FlywheelConfig): boolean {
  const parsed = parseQuietHours(config.quiet_hours);
  if (!parsed) return false;

  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const startMins = parsed.startH * 60 + parsed.startM;
  const endMins = parsed.endH * 60 + parsed.endM;

  if (startMins < endMins) {
    // e.g. 09:00-17:00 — quiet during the day
    return nowMins >= startMins && nowMins < endMins;
  } else {
    // e.g. 22:00-08:00 — quiet overnight
    return nowMins >= startMins || nowMins < endMins;
  }
}

// ============================================================================
// Guard: active session backoff
// ============================================================================

/**
 * Return true if there's a recent Claude Code session active on this machine.
 * Heuristic: check if any process named "claude" was active in the last 5 minutes
 * by looking at recently-modified jsonl heartbeat files.
 */
export async function hasActiveClaudeSession(): Promise<boolean> {
  try {
    const agentsDir = join(PANOPTICON_HOME, 'agents');
    if (!existsSync(agentsDir)) return false;
    const fiveMinsAgo = Date.now() - 5 * 60 * 1000;
    const entries = await readdir(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const heartbeatFile = join(agentsDir, entry.name, 'runtime.json');
      try {
        const { mtimeMs } = await stat(heartbeatFile);
        if (mtimeMs > fiveMinsAgo) {
          const state = JSON.parse(await readFile(heartbeatFile, 'utf-8')) as { state?: string };
          if (state.state === 'active') return true;
        }
      } catch { /* file may not exist or be unreadable */ }
    }
    return false;
  } catch {
    return false;
  }
}

// ============================================================================
// Guard: mutex lock
// ============================================================================

export async function acquireLock(): Promise<boolean> {
  if (existsSync(FLYWHEEL_LOCK_FILE)) {
    try {
      const lockData = JSON.parse(await readFile(FLYWHEEL_LOCK_FILE, 'utf-8'));
      const lockAge = Date.now() - lockData.ts;
      // Stale lock older than 30 minutes — take it
      if (lockAge < 30 * 60 * 1000) {
        console.log(`[flywheel-daemon] Lock held by pid ${lockData.pid}, age ${Math.round(lockAge / 1000)}s — skipping`);
        return false;
      }
      console.log(`[flywheel-daemon] Removing stale lock (${Math.round(lockAge / 60000)}min old)`);
    } catch {
      // Corrupt lock file — remove it
    }
  }
  try {
    await writeFile(FLYWHEEL_LOCK_FILE, JSON.stringify({ pid: process.pid, ts: Date.now() }), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

export async function releaseLock(): Promise<void> {
  try {
    if (existsSync(FLYWHEEL_LOCK_FILE)) await unlink(FLYWHEEL_LOCK_FILE);
  } catch { /* non-fatal */ }
}

// ============================================================================
// Core actions (stubs — implementations land in subsequent beads)
// ============================================================================

/**
 * Spawn the retro-agent for a merged issue (PAN-284).
 */
async function spawnRetroAgentForIssue(issueId: string): Promise<void> {
  const { spawnRetroAgent } = await import('./retro-agent.js');
  const result = await spawnRetroAgent(issueId);
  if (!result.success) {
    console.warn(`[flywheel-daemon] Retro-agent for ${issueId} failed: ${result.error}`);
    if (result.timedOut) {
      console.warn(`[flywheel-daemon] Retro-agent for ${issueId} timed out`);
    }
  } else {
    console.log(`[flywheel-daemon] Retro-agent for ${issueId} completed`);
  }
}

/**
 * Run the synthesis step: read non-archived retros, apply threshold, file PAN issues,
 * archive processed retros, and append to FLYWHEEL-REPORT.md.
 */
async function runSynthesis(): Promise<void> {
  console.log('[flywheel-daemon] Synthesis step — starting');
  try {
    const { runSynthesis: synthesize } = await import('../flywheel/synthesis.js');
    const { fileFlywheelIssues } = await import('../flywheel/issue-filer.js');
    const { archiveProcessedRetros } = await import('../flywheel/retro-archiver.js');
    const { appendFlywheelReport } = await import('../flywheel/flywheel-report.js');

    const result = await synthesize();
    console.log(`[flywheel-daemon] Synthesis: ${result.proposals.length} proposals, ${result.watchlist.length} watchlist, filterRatio=${result.filterRatio.toFixed(2)}`);

    if (result.proposals.length === 0 && result.watchlist.length === 0) {
      console.log('[flywheel-daemon] Synthesis is a no-op (no retros)');
      return;
    }

    // File GitHub issues for above-threshold proposals
    const filingResult = await fileFlywheelIssues(result.proposals);
    console.log(`[flywheel-daemon] Filed ${filingResult.filed.length} issues, deferred ${filingResult.deferred.length}`);

    // Archive processed retros
    const archiveResult = await archiveProcessedRetros(result.processedRetros);
    console.log(`[flywheel-daemon] Archived ${archiveResult.archived.length} retros, wontfixed ${archiveResult.wontfixed.length}`);

    // Determine run number from archive state
    const runNumberMatch = archiveResult.archived.length > 0 ? 1 : 0; // rough — appendFlywheelReport tracks its own counter
    void runNumberMatch;

    // Append to FLYWHEEL-REPORT.md
    await appendFlywheelReport({
      runNumber: Date.now(), // monotonic stand-in; synthesis-commit derives the pretty number
      timestamp: new Date().toISOString(),
      trigger: 'daemon-scheduled',
      issuesMergedThisRun: [],
      skillChangesFiled: filingResult.filed.map(f => ({
        issueId: String(f.issueNumber),
        title: f.title,
        signals: 0,
      })),
      substrateInlineFixes: [],
      topFrictionPatterns: result.proposals.slice(0, 5).map(p => ({
        pattern: p.signature.targetSkill,
        issueCount: p.retroCount,
      })),
      watchlist: result.watchlist.map(w => ({
        description: `${w.signature.targetSkill}: ${w.signature.gapDescription}`,
        signals: w.retroCount,
      })),
      retroStats: {
        total: result.processedRetros.length,
        surprise: Math.round(result.filterRatio * result.processedRetros.length),
        noop: result.processedRetros.length - Math.round(result.filterRatio * result.processedRetros.length),
      },
    });
  } catch (err) {
    console.warn('[flywheel-daemon] Synthesis step failed:', err);
  }
}

/**
 * Read FLYWHEEL-STATE.md and return any cycling alerts.
 * Returns a list of issue IDs that appear to be cycling.
 */
export async function readCyclingAlerts(): Promise<string[]> {
  if (!existsSync(FLYWHEEL_STATE_FILE)) return [];
  try {
    const content = await readFile(FLYWHEEL_STATE_FILE, 'utf-8');
    // Parse "cycling alerts" section — lines matching "- PAN-NNN"
    const section = content.match(/## Cycling Alerts\n([\s\S]*?)(?:\n##|$)/i);
    if (!section) return [];
    const alerts: string[] = [];
    for (const line of section[1].split('\n')) {
      const m = line.match(/[-*]\s+(PAN-\d+|[A-Z]+-\d+)/i);
      if (m) alerts.push(m[1].toUpperCase());
    }
    return alerts;
  } catch {
    return [];
  }
}

// ============================================================================
// Pending-retro queue (persists merge-complete events that arrive during quiet hours)
// ============================================================================

async function loadPendingRetros(): Promise<string[]> {
  try {
    const content = await readFile(FLYWHEEL_PENDING_RETROS_FILE, 'utf-8');
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function savePendingRetros(items: string[]): Promise<void> {
  await writeFile(FLYWHEEL_PENDING_RETROS_FILE, JSON.stringify([...new Set(items)]), 'utf-8');
}

/**
 * File a substrate-improvement issue for a cycling issue.
 * Idempotent: skips filing if an open substrate-improvement issue already exists for this cycling issue.
 */
export async function fileSubstrateIssue(cyclingIssueId: string): Promise<void> {
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    // Check for existing open substrate-improvement issue to avoid filing on every tick
    const { stdout: existingJson } = await execFileAsync('gh', [
      'issue', 'list',
      '--label', 'substrate-improvement',
      '--state', 'open',
      '--search', `cycling ${cyclingIssueId} in:title`,
      '--json', 'number',
    ]);
    const existing: Array<{ number: number }> = JSON.parse(existingJson);
    if (existing.length > 0) {
      console.log(`[flywheel-daemon] Substrate-improvement issue already exists for cycling ${cyclingIssueId} — skipping`);
      return;
    }

    await execFileAsync('gh', [
      'issue', 'create',
      '--title', `substrate: cycling detected in ${cyclingIssueId}`,
      '--body', `The flywheel daemon detected cycling behavior in ${cyclingIssueId}.\n\nThis issue tracks the substrate improvement needed to break the cycle. Filed automatically by flywheel-daemon.`,
      '--label', 'substrate-improvement',
    ]);
    console.log(`[flywheel-daemon] Filed substrate-improvement issue for cycling ${cyclingIssueId}`);
  } catch (err) {
    console.warn(`[flywheel-daemon] Failed to file substrate-improvement issue for ${cyclingIssueId}:`, err);
  }
}

/**
 * Check how many flywheel-change issues are in Awaiting Merge (readyForMerge=true).
 * Returns the count or 0 if unable to determine.
 */
async function getFlywheelAwaitingMergeCount(): Promise<number> {
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    // Get all open flywheel-change issue numbers from GitHub
    const { stdout } = await execFileAsync('gh', [
      'issue', 'list',
      '--label', 'flywheel-change',
      '--state', 'open',
      '--json', 'number',
    ]);
    const ghIssues: Array<{ number: number }> = JSON.parse(stdout);
    if (ghIssues.length === 0) return 0;
    const ghNumbers = new Set(ghIssues.map(i => i.number));

    // Cross-reference with review-status.json to find which are readyForMerge=true
    const statusFile = join(homedir(), '.panopticon', 'review-status.json');
    let statuses: Record<string, { readyForMerge?: boolean }> = {};
    try {
      statuses = JSON.parse(await readFile(statusFile, 'utf-8'));
    } catch { /* no status file or parse error */ }

    let count = 0;
    for (const [issueId, status] of Object.entries(statuses)) {
      if (!status.readyForMerge) continue;
      const numMatch = issueId.match(/(\d+)$/);
      if (!numMatch) continue;
      if (ghNumbers.has(parseInt(numMatch[1], 10))) count++;
    }
    return count;
  } catch {
    return 0;
  }
}

// ============================================================================
// Daemon tick
// ============================================================================

function loadFlywheelConfig(): FlywheelConfig {
  try {
    const cloisterConfig = loadCloisterConfig();
    return { ...DEFAULT_CONFIG, ...cloisterConfig.flywheel };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

async function daemonTick(): Promise<void> {
  const config = loadFlywheelConfig();

  if (!config.autonomous) {
    console.log('[flywheel-daemon] Autonomous mode disabled — skipping tick');
    return;
  }

  // Guard: quiet hours
  if (isQuietHours(config)) {
    console.log('[flywheel-daemon] Quiet hours — skipping tick');
    return;
  }

  // Guard: active session backoff
  if (config.backoff_on_active_session && await hasActiveClaudeSession()) {
    console.log('[flywheel-daemon] Active Claude Code session detected — backing off');
    return;
  }

  // Drain retros that were queued during quiet hours
  try {
    const pending = await loadPendingRetros();
    if (pending.length > 0) {
      await savePendingRetros([]); // Clear before spawning to prevent re-processing on next tick
      for (const pendingIssueId of pending) {
        console.log(`[flywheel-daemon] Draining pending retro for ${pendingIssueId}`);
        spawnRetroAgentForIssue(pendingIssueId).catch(err =>
          console.warn(`[flywheel-daemon] Failed to drain pending retro for ${pendingIssueId}:`, err)
        );
      }
    }
  } catch (err) {
    console.warn('[flywheel-daemon] Failed to drain pending retros:', err);
  }

  // Check awaiting-merge threshold (no mutex needed — just a count query)
  try {
    const flywheelCount = await getFlywheelAwaitingMergeCount();
    if (flywheelCount >= config.awaiting_merge_notify_threshold) {
      console.log(`[flywheel-daemon] Awaiting Merge: ${flywheelCount} flywheel-change issues (threshold: ${config.awaiting_merge_notify_threshold})`);
      if (awaitingMergeNotifier) {
        awaitingMergeNotifier(flywheelCount);
      }
    }
  } catch (err) {
    console.warn('[flywheel-daemon] Failed to check awaiting-merge count:', err);
  }

  // Check for cycling alerts in FLYWHEEL-STATE
  try {
    const cycling = await readCyclingAlerts();
    for (const issueId of cycling) {
      await fileSubstrateIssue(issueId);
    }
  } catch (err) {
    console.warn('[flywheel-daemon] Failed to process cycling alerts:', err);
  }

  // Scheduled synthesis (every 30 min)
  const nowMs = Date.now();
  const synthIntervalMs = config.trigger_interval_minutes * 60 * 1000;
  if (nowMs - lastSynthesisAt > synthIntervalMs) {
    if (!await acquireLock()) return;
    try {
      lastSynthesisAt = nowMs;
      await runSynthesis();
    } catch (err) {
      console.warn('[flywheel-daemon] Synthesis step failed:', err);
    } finally {
      await releaseLock();
    }
  }

  // Scheduled full cycle (every 24h)
  const fullCycleIntervalMs = config.full_cycle_interval_hours * 60 * 60 * 1000;
  if (nowMs - lastFullCycleAt > fullCycleIntervalMs) {
    if (!await acquireLock()) return;
    try {
      lastFullCycleAt = nowMs;
      console.log('[flywheel-daemon] Full 24h flywheel cycle — running synthesis');
      await runSynthesis();
    } catch (err) {
      console.warn('[flywheel-daemon] Full cycle failed:', err);
    } finally {
      await releaseLock();
    }
  }
}

// ============================================================================
// Merge-complete event hook
// ============================================================================

/**
 * Call this when a merge completes.
 * Safe to call from postMergeLifecycle() — never throws, errors are logged.
 */
export function notifyFlywheelMergeComplete(issueId: string): void {
  console.log(`[flywheel-daemon] Received merge-complete for ${issueId}`);
  const config = loadFlywheelConfig();
  if (!config.autonomous) return;
  if (isQuietHours(config)) {
    console.log(`[flywheel-daemon] Quiet hours — persisting retro for ${issueId} to pending queue`);
    loadPendingRetros().then(pending => {
      if (!pending.includes(issueId)) {
        return savePendingRetros([...pending, issueId]);
      }
    }).catch(err => console.warn('[flywheel-daemon] Failed to enqueue pending retro:', err));
    return;
  }
  spawnRetroAgentForIssue(issueId).catch((err) => {
    console.error(`[flywheel-daemon] Failed to spawn retro-agent for ${issueId}:`, err);
  });
  if (mergeCompleteHandler) {
    mergeCompleteHandler(issueId);
  }
}

// ============================================================================
// Start / Stop / Status
// ============================================================================

/**
 * Register a handler to be called when a merge-complete event fires.
 * Used by the dashboard read-model to update Awaiting Merge state.
 */
export function setFlywheelMergeCompleteHandler(fn: (issueId: string) => void): void {
  mergeCompleteHandler = fn;
}

/**
 * Register a handler to be called when the Awaiting Merge count exceeds the threshold.
 * Used by the dashboard to render a notification banner.
 */
export function setFlywheelAwaitingMergeNotifier(fn: (count: number) => void): void {
  awaitingMergeNotifier = fn;
}

/** Interval between daemon ticks (1 minute, matching the deacon patrol interval). */
const TICK_INTERVAL_MS = 60_000;

/**
 * Start the flywheel daemon loop.
 * Called from CloisterService.start() after startDeacon().
 */
export function startFlywheelDaemon(): void {
  if (daemonInterval) {
    console.log('[flywheel-daemon] Already running');
    return;
  }

  const config = loadFlywheelConfig();
  console.log(`[flywheel-daemon] Starting autonomous flywheel daemon (tick every ${TICK_INTERVAL_MS / 1000}s, synthesis every ${config.trigger_interval_minutes}min, full cycle every ${config.full_cycle_interval_hours}h)`);

  // Initial tick (non-blocking)
  daemonTick().catch((err) => console.error('[flywheel-daemon] Tick error:', err));

  daemonInterval = setInterval(() => {
    daemonTick().catch((err) => console.error('[flywheel-daemon] Tick error:', err));
  }, TICK_INTERVAL_MS);
}

/**
 * Stop the flywheel daemon loop.
 * Called from CloisterService.stop() alongside stopDeacon().
 */
export function stopFlywheelDaemon(): void {
  if (daemonInterval) {
    clearInterval(daemonInterval);
    daemonInterval = null;
    void releaseLock(); // async fire-and-forget on clean shutdown
    console.log('[flywheel-daemon] Stopped');
  }
}

export function isFlywheelDaemonRunning(): boolean {
  return daemonInterval !== null;
}

export interface FlywheelDaemonStatus {
  isRunning: boolean;
  config: FlywheelConfig;
  lastSynthesisAt: number | null;
  lastFullCycleAt: number | null;
  lockHeld: boolean;
}

export function getFlywheelDaemonStatus(): FlywheelDaemonStatus {
  return {
    isRunning: isFlywheelDaemonRunning(),
    config: loadFlywheelConfig(),
    lastSynthesisAt: lastSynthesisAt || null,
    lastFullCycleAt: lastFullCycleAt || null,
    lockHeld: existsSync(FLYWHEEL_LOCK_FILE),
  };
}
