/**
 * Codex-plugin job adapter (PAN-3920 W20, Q2, D22).
 *
 * The Codex plugin for Claude Code (`openai-codex/codex`) launches detached
 * `codex` jobs that Overdeck did not start. Their only traces are the plugin's
 * job records and the Codex rollouts, and the plugin deletes the job records
 * when the parent Claude session ends. So this adapter registers every job the
 * first time it sees it, recording the parent link while it still exists.
 *
 * It only reads the plugin's files: it never writes under
 * `~/.claude/plugins/**`. Writes go to the external registry
 * (`~/.overdeck/agents/ext-codex-plugin-<job>/`), write-once facts plus the
 * append-only sessions.json transcript link. A job is registered once
 * (a registration that parses is the "seen" check; a torn one is rewritten)
 * and its transcript is linked once (a recorded `path` ends the work for it).
 *
 * Every file it opens is checked first: job records and the job log must be
 * regular files under the plugin root, the rollout a regular file under the
 * Codex sessions root, and reads use O_NONBLOCK (external-paths.ts), so a
 * FIFO can never wedge a scan.
 *
 * Retire this adapter when plugin hooks (PAN-3940) let the plugin call the
 * registration door itself.
 *
 * Facts checked on plugin 1.0.6 (`state/<workspace>-<hash>/jobs/<id>.json`):
 * `id`, `kindLabel`, `summary`, `createdAt`, `sessionId` (the parent Claude
 * session), `status` (queued|running|completed|failed|cancelled), `pid` (set
 * while queued or running), `logFile`, `request.cwd`, `request.model`, and
 * `threadId` once the job completes; the log holds `Thread ready (<id>).` as
 * soon as the Codex thread starts.
 */
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  checkRegularFileUnder,
  checkTranscriptPath,
  codexHomeDir,
  readRegularFile,
} from '../../../lib/agents/external-paths.js';
import {
  EXTERNAL_AGENT_PREFIX,
  externalAgentId,
  hasRecordedTranscript,
  readExternalRegistration,
  readPidStartTime,
  recordExternalTranscript,
  registerExternalAgent,
} from '../../../lib/agents/external-registry.js';
import { getOverdeckHome } from '../../../lib/paths.js';
import { parseSessionIndex, type SessionIndexEntry } from '../../../lib/session-history.js';

export const CODEX_PLUGIN_SOURCE = 'codex-plugin';
export const CODEX_PLUGIN_SCAN_MS = 15_000;
const LOG_HEAD_BYTES = 16 * 1024;
const JOB_RECORD_MAX_BYTES = 1024 * 1024;
const SESSION_INDEX_MAX_BYTES = 4 * 1024 * 1024;
const THREAD_READY_RE = /Thread ready \(([0-9a-f-]{36})\)/;
const ISSUE_FROM_CWD_RE = /\/workspaces\/feature-([a-z]+-\d+)(?:\/|$)/i;
const DAY_MS = 86_400_000;

/** The job-record fields the adapter reads. */
export interface CodexPluginJob {
  id: string;
  sessionId: string;
  status: string | null;
  pid: number | null;
  logFile: string | null;
  summary: string | null;
  kindLabel: string | null;
  threadId: string | null;
  createdAt: string | null;
  cwd: string | null;
  model: string | null;
}

export interface ConversationSessionRef {
  readonly tmuxSession: string;
  readonly claudeSessionId: string | null;
}

export interface CodexPluginImporterDeps {
  /** Plugin data root; default `$OVERDECK_CODEX_PLUGIN_DATA` or `~/.claude/plugins/data/codex-openai-codex`. */
  readonly root?: string;
  /** Codex home whose `sessions/` holds the rollouts; default `$CODEX_HOME`, else `~/.codex` (the transcript root rollouts must sit under). */
  readonly codexHome?: string;
  readonly listConversations?: () => Promise<readonly ConversationSessionRef[]>;
  /** Agent directory names under `~/.overdeck/agents` (agents and conversations). */
  readonly listAgentDirs?: () => Promise<readonly string[]>;
  readonly readSessionIndex?: (agentDir: string) => Promise<readonly SessionIndexEntry[]>;
  readonly readPidStartTime?: (pid: number) => Promise<string | null>;
  readonly findRollout?: (codexHome: string, threadId: string, createdAt: string | null) => Promise<string | null>;
  readonly warn?: (message: string) => void;
}

export interface ScanResult {
  jobs: number;
  registered: number;
  transcripts: number;
}

export function codexPluginDataRoot(): string {
  return process.env.OVERDECK_CODEX_PLUGIN_DATA ?? join(homedir(), '.claude', 'plugins', 'data', 'codex-openai-codex');
}

// ─── parsing ─────────────────────────────────────────────────────────────────

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Parse one job record; null when it is not JSON or lacks `id`/`sessionId`. */
export function parseCodexPluginJob(raw: string): CodexPluginJob | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  const job = value as Record<string, unknown>;
  const id = text(job.id);
  const sessionId = text(job.sessionId);
  if (!id || !sessionId) return null;
  const request = job.request && typeof job.request === 'object' ? job.request as Record<string, unknown> : {};
  return {
    id,
    sessionId,
    status: text(job.status),
    pid: typeof job.pid === 'number' && Number.isInteger(job.pid) && job.pid > 0 ? job.pid : null,
    logFile: text(job.logFile),
    summary: text(job.summary),
    kindLabel: text(job.kindLabel),
    threadId: text(job.threadId),
    createdAt: text(job.createdAt),
    cwd: text(request.cwd) ?? text(job.workspaceRoot),
    model: text(request.model),
  };
}

/** `…/workspaces/feature-pan-3920[/…]` → `PAN-3920`. */
export function issueFromCwd(cwd: string | null): string | null {
  const match = cwd ? ISSUE_FROM_CWD_RE.exec(cwd) : null;
  return match ? match[1]!.toUpperCase() : null;
}

/**
 * The Codex thread id from the first 16 KiB of a job log. The log must be a
 * regular file under the plugin data root (a job record names it; a FIFO or a
 * symlink out of the root is never opened).
 */
export async function parseThreadReady(logFile: string, root: string = codexPluginDataRoot()): Promise<string | null> {
  const checked = await checkRegularFileUnder(logFile, [root]);
  if (!checked.ok) return null;
  const head = await readRegularFile(checked.path, LOG_HEAD_BYTES);
  return head === null ? null : THREAD_READY_RE.exec(head)?.[1] ?? null;
}

// ─── default sources ─────────────────────────────────────────────────────────

async function defaultListConversations(): Promise<readonly ConversationSessionRef[]> {
  const { listConversations } = await import('../../../lib/overdeck/conversations.js');
  return listConversations().map((row) => ({ tmuxSession: row.tmuxSession, claudeSessionId: row.claudeSessionId }));
}

async function defaultListAgentDirs(): Promise<readonly string[]> {
  const entries = await readdir(join(getOverdeckHome(), 'agents'), { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function defaultReadSessionIndex(agentDir: string): Promise<readonly SessionIndexEntry[]> {
  const raw = await readRegularFile(join(getOverdeckHome(), 'agents', agentDir, 'sessions.json'), SESSION_INDEX_MAX_BYTES);
  return raw === null ? [] : parseSessionIndex(raw);
}

function localDayDir(ms: number): string[] {
  const date = new Date(ms);
  return [
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ];
}

/** Bounds on the fallback walk of `sessions/`: YYYY/MM/DD/<file>, at most this many entries. */
export const ROLLOUT_WALK_MAX_DEPTH = 4;
export const ROLLOUT_WALK_MAX_ENTRIES = 50_000;
/** A thread the fallback walk did not find is not walked for again this soon. */
export const ROLLOUT_WALK_MISS_TTL_MS = 10 * 60_000;

/** Fallback-walk results per thread for the process lifetime: a path, or the time of the miss. */
const walkedThreads = new Map<string, { path: string } | { missedAt: number }>();

/**
 * Async, bounded walk of `sessions/` for `*-<threadId>.jsonl`: never deeper
 * than YYYY/MM/DD, never more than ROLLOUT_WALK_MAX_ENTRIES directory entries,
 * and only regular files match. Newest years/months/days first.
 */
export async function walkForRollout(sessionsRoot: string, threadId: string): Promise<string | null> {
  const suffix = `-${threadId}.jsonl`;
  let budget = ROLLOUT_WALK_MAX_ENTRIES;
  const walk = async (dir: string, depth: number): Promise<string | null> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    budget -= entries.length;
    const hit = entries.find((entry) => entry.isFile() && entry.name.endsWith(suffix));
    if (hit) return join(dir, hit.name);
    if (depth >= ROLLOUT_WALK_MAX_DEPTH) return null;
    const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();
    for (const name of dirs) {
      if (budget <= 0) return null;
      const found = await walk(join(dir, name), depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(sessionsRoot, 1);
}

/**
 * The rollout for a thread: first the `sessions/YYYY/MM/DD` directories around
 * the job's creation day, then the bounded async walk, cached per thread for
 * the process lifetime (a miss is retried after ROLLOUT_WALK_MISS_TTL_MS, since
 * a running job's rollout may not exist yet).
 */
async function defaultFindRollout(codexHome: string, threadId: string, createdAt: string | null): Promise<string | null> {
  const sessionsRoot = join(codexHome, 'sessions');
  const created = createdAt ? Date.parse(createdAt) : Number.NaN;
  if (Number.isFinite(created)) {
    for (const ms of [created, created - DAY_MS, created + DAY_MS]) {
      const dir = join(sessionsRoot, ...localDayDir(ms));
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      const hit = entries.find((entry) => entry.isFile() && entry.name.endsWith(`-${threadId}.jsonl`));
      if (hit) return join(dir, hit.name);
    }
  }
  const cached = walkedThreads.get(threadId);
  if (cached && 'path' in cached) return cached.path;
  if (cached && Date.now() - cached.missedAt < ROLLOUT_WALK_MISS_TTL_MS) return null;
  const path = await walkForRollout(sessionsRoot, threadId);
  walkedThreads.set(threadId, path ? { path } : { missedAt: Date.now() });
  return path;
}

// ─── scan ────────────────────────────────────────────────────────────────────

/** Job-record paths the adapter already warned about; each is warned once. */
const warnedPaths = new Set<string>();

async function listJobFiles(root: string): Promise<string[]> {
  const stateDir = join(root, 'state');
  const workspaces = await readdir(stateDir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const workspace of workspaces) {
    if (!workspace.isDirectory()) continue;
    const jobsDir = join(stateDir, workspace.name, 'jobs');
    // Regular files only: a FIFO, symlink or directory named *.json is never read.
    for (const entry of await readdir(jobsDir, { withFileTypes: true }).catch(() => [])) {
      if (entry.isFile() && entry.name.endsWith('.json')) files.push(join(jobsDir, entry.name));
    }
  }
  return files.sort();
}

function parentResolver(deps: CodexPluginImporterDeps): (sessionId: string) => Promise<string> {
  let conversations: Promise<readonly ConversationSessionRef[]> | null = null;
  let agentIndexes: Promise<Array<{ dir: string; sessionIds: Set<string> }>> | null = null;
  return async (sessionId) => {
    conversations ??= (deps.listConversations ?? defaultListConversations)().catch(() => []);
    const conversation = (await conversations).find((row) => row.claudeSessionId === sessionId);
    if (conversation) return conversation.tmuxSession;
    agentIndexes ??= (async () => {
      const dirs = (await (deps.listAgentDirs ?? defaultListAgentDirs)().catch(() => [] as string[]))
        .filter((dir) => !dir.startsWith(EXTERNAL_AGENT_PREFIX));
      const readIndex = deps.readSessionIndex ?? defaultReadSessionIndex;
      return Promise.all(dirs.map(async (dir) => ({
        dir,
        sessionIds: new Set((await readIndex(dir).catch(() => [])).map((entry) => entry.sessionId)),
      })));
    })();
    // An agent dir is the agent id; a conv-* dir is the conversation's tmux session.
    const owner = (await agentIndexes).find((index) => index.sessionIds.has(sessionId));
    return owner ? owner.dir : `claude-session:${sessionId}`;
  };
}

/**
 * One pass over every plugin job record: register jobs not seen before and
 * link each job's rollout once its thread id is known. Idempotent: a job with
 * a registration and a recorded transcript path costs one small read.
 */
export async function scanCodexPluginJobsOnce(deps: CodexPluginImporterDeps = {}): Promise<ScanResult> {
  const root = deps.root ?? codexPluginDataRoot();
  const codexHome = deps.codexHome ?? codexHomeDir();
  const warn = deps.warn ?? ((message: string) => console.warn(message));
  const warnOnce = (key: string, message: string) => {
    if (warnedPaths.has(key)) return;
    warnedPaths.add(key);
    warn(message);
  };
  const parentFor = parentResolver(deps);
  const findRollout = deps.findRollout ?? defaultFindRollout;
  const result: ScanResult = { jobs: 0, registered: 0, transcripts: 0 };

  for (const file of await listJobFiles(root)) {
    // Removed between readdir and read (the plugin pruned it) or no longer a regular file: skip.
    const raw = await readRegularFile(file, JOB_RECORD_MAX_BYTES);
    if (raw === null) continue;
    const job = parseCodexPluginJob(raw);
    if (!job) {
      warnOnce(file, `[codex-plugin-importer] skipping unreadable job record ${file} (not JSON, or no id/sessionId)`);
      continue;
    }
    result.jobs++;
    const id = externalAgentId(CODEX_PLUGIN_SOURCE, job.id);
    if (await hasRecordedTranscript(id)) continue;

    try {
      // Seen = a registration that parses. A torn or empty file is not seen and is rewritten.
      const seen = (await readExternalRegistration(id)) !== null;
      if (!seen) {
        const live = job.status === 'queued' || job.status === 'running';
        const pid = live ? job.pid : null;
        const registered = await registerExternalAgent({
          source: CODEX_PLUGIN_SOURCE,
          externalId: job.id,
          harness: 'codex',
          model: job.model,
          cwd: job.cwd,
          issueId: issueFromCwd(job.cwd),
          parentId: await parentFor(job.sessionId),
          label: job.summary ?? job.kindLabel,
          pid,
          pidStartTime: pid === null ? null : await (deps.readPidStartTime ?? readPidStartTime)(pid),
          logFile: job.logFile,
        });
        if (registered.created) result.registered++;
      }

      const threadId = job.threadId ?? (job.logFile ? await parseThreadReady(job.logFile, root) : null);
      if (!threadId) continue;
      const found = await findRollout(codexHome, threadId, job.createdAt);
      if (!found) continue;
      const rollout = await checkTranscriptPath(found);
      if (!rollout.ok) {
        warnOnce(found, `[codex-plugin-importer] not linking ${job.id}: rollout ${rollout.error}`);
        continue;
      }
      const recorded = await recordExternalTranscript(id, {
        sessionId: threadId,
        harness: 'codex',
        ...(job.model ? { model: job.model } : {}),
        path: rollout.path,
      });
      if (recorded) result.transcripts++;
    } catch (error) {
      warn(`[codex-plugin-importer] could not register ${job.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}

// ─── schedule ────────────────────────────────────────────────────────────────

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

/**
 * Scan once now and every 15 s (unref'd). Returns false when already started.
 * A tick that finds the previous scan still running is skipped.
 */
export function startCodexPluginImporter(
  deps: CodexPluginImporterDeps = {},
  scan: (deps: CodexPluginImporterDeps) => Promise<unknown> = scanCodexPluginJobsOnce,
  intervalMs = CODEX_PLUGIN_SCAN_MS,
): boolean {
  if (timer) return false;
  const tick = () => {
    if (inFlight) return;
    inFlight = true;
    void scan(deps)
      .catch((error: unknown) => {
        console.warn('[codex-plugin-importer] scan failed:', error instanceof Error ? error.message : String(error));
      })
      .finally(() => { inFlight = false; });
  };
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();
  return true;
}

export function stopCodexPluginImporter(): void {
  if (timer) clearInterval(timer);
  timer = null;
  inFlight = false;
}

/** Test seam: forget warned paths and walked threads. */
export function _resetCodexPluginImporterForTests(): void {
  stopCodexPluginImporter();
  warnedPaths.clear();
  walkedThreads.clear();
}
