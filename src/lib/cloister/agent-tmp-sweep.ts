/**
 * Removes idle Claude Code session scratch directories under the agent tmp
 * root (PAN-4998), modeled on `transcript-retention.ts`: a session directory
 * is deleted when its newest mtime is older than
 * {@link AGENT_TMP_RETENTION_DAYS} and its uuid is not recorded in a live
 * agent's `sessions.json`. A `null` liveness inventory skips the whole pass —
 * never delete when liveness is indeterminate.
 */
import type { Dirent, Stats } from 'node:fs';
import { lstat, readdir, readFile, realpath, rm, rmdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import { getAgentTmpDir, AGENT_TMP_RETENTION_DAYS } from '../agent-tmpdir.js';
import { AGENTS_DIR } from '../paths.js';
import { listLiveAgentIds } from '../terminal-backends/inventory.js';
import { isDeaconGloballyPaused } from '../overdeck/control-settings.js';

export interface AgentTmpSweepDeps {
  readDir(path: string): Promise<Dirent[]>;
  lstat(path: string): Promise<Stats>;
  realpath(path: string): Promise<string>;
  removeTree(path: string): Promise<void>;
  removeEmptyDir(path: string): Promise<void>;
  readSessionsIndex(agentId: string): Promise<string | null>;
  listLiveAgentIds(): Promise<ReadonlySet<string> | null>;
  isPaused(): boolean;
  now(): number;
  log(message: string): void;
}

export interface AgentTmpSweepOptions {
  root?: string;
  agentsDir?: string;
  deps?: Partial<AgentTmpSweepDeps>;
}

const defaultReadSessionsIndex = (agentsDir: string) => async (agentId: string): Promise<string | null> => {
  try {
    return await readFile(join(agentsDir, agentId, 'sessions.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
};

function defaultDeps(agentsDir: string): AgentTmpSweepDeps {
  return {
    readDir: (path) => readdir(path, { withFileTypes: true }),
    lstat,
    realpath,
    removeTree: (path) => rm(path, { recursive: true, force: true }),
    removeEmptyDir: rmdir,
    readSessionsIndex: defaultReadSessionsIndex(agentsDir),
    listLiveAgentIds,
    isPaused: isDeaconGloballyPaused,
    now: () => Date.now(),
    log: (message) => console.log(`[deacon] ${message}`),
  };
}

const hasErrorCode = (error: unknown, code: string): boolean => (error as NodeJS.ErrnoException).code === code;

/** Session ids recorded across every live agent's append-only `sessions.json`. */
async function liveSessionIds(liveAgentIds: ReadonlySet<string>, deps: AgentTmpSweepDeps): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const agentId of liveAgentIds) {
    let text: string | null;
    try {
      text = await deps.readSessionsIndex(agentId);
    } catch {
      continue;
    }
    if (!text) continue;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as { sessionId?: unknown };
        if (typeof parsed.sessionId === 'string') ids.add(parsed.sessionId);
      } catch {
        continue;
      }
    }
  }
  return ids;
}

/**
 * Newest `lstat` mtime of `path` and everything under it, never following
 * symlinks. Returns as soon as an entry at or newer than `cutoffMs` is found
 * (D6) — the caller only needs to know whether the directory is idle.
 */
async function newestMtimeAtLeast(path: string, cutoffMs: number, deps: AgentTmpSweepDeps): Promise<boolean> {
  const selfStat = await deps.lstat(path);
  if (selfStat.mtimeMs >= cutoffMs) return true;
  if (!selfStat.isDirectory()) return false;

  let entries: Dirent[];
  try {
    entries = await deps.readDir(path);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return false;
    throw error;
  }
  for (const entry of entries) {
    if (await newestMtimeAtLeast(join(path, entry.name), cutoffMs, deps)) return true;
  }
  return false;
}

function isContained(canonicalRoot: string, canonicalCandidate: string): boolean {
  const fromRoot = relative(canonicalRoot, canonicalCandidate);
  return fromRoot !== '' && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && fromRoot.split(sep).length === 3;
}

export async function sweepAgentTmpDirs(options: AgentTmpSweepOptions = {}): Promise<string[]> {
  const agentsDir = options.agentsDir ?? AGENTS_DIR;
  const deps = { ...defaultDeps(agentsDir), ...options.deps };

  if (deps.isPaused()) return [];

  const root = options.root ?? getAgentTmpDir();
  let rootEntries: Dirent[];
  try {
    rootEntries = await deps.readDir(root);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return [];
    throw error;
  }

  let live: ReadonlySet<string>;
  try {
    const inventory = await deps.listLiveAgentIds();
    if (inventory === null) throw new Error('indeterminate backend inventory');
    live = inventory;
  } catch {
    const action = 'Agent tmp sweep skipped: backend liveness inventory unavailable';
    deps.log(action);
    return [action];
  }

  const liveSessions = await liveSessionIds(live, deps);
  const canonicalRoot = await deps.realpath(root);
  const cutoffMs = deps.now() - AGENT_TMP_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  let removed = 0;
  let kept = 0;

  for (const uidEntry of rootEntries) {
    if (!uidEntry.isDirectory() || !/^claude-\d+$/.test(uidEntry.name)) continue;
    const uidDir = join(root, uidEntry.name);

    let projectEntries: Dirent[];
    try {
      projectEntries = await deps.readDir(uidDir);
    } catch {
      continue;
    }

    for (const projectEntry of projectEntries) {
      if (!projectEntry.isDirectory()) continue;
      const projectDir = join(uidDir, projectEntry.name);

      let sessionEntries: Dirent[];
      try {
        sessionEntries = await deps.readDir(projectDir);
      } catch {
        continue;
      }

      let removedInProject = 0;
      for (const sessionEntry of sessionEntries) {
        if (!sessionEntry.isDirectory()) continue;
        const sessionDir = join(projectDir, sessionEntry.name);

        try {
          if (liveSessions.has(sessionEntry.name)) {
            kept++;
            continue;
          }
          if (await newestMtimeAtLeast(sessionDir, cutoffMs, deps)) {
            kept++;
            continue;
          }

          const canonicalSessionDir = await deps.realpath(sessionDir);
          if (!isContained(canonicalRoot, canonicalSessionDir)) continue;

          await deps.removeTree(sessionDir);
          removed++;
          removedInProject++;
        } catch {
          continue;
        }
      }

      if (removedInProject > 0) {
        try {
          await deps.removeEmptyDir(projectDir);
        } catch (error) {
          if (!hasErrorCode(error, 'ENOTEMPTY') && !hasErrorCode(error, 'ENOENT')) continue;
        }
      }
    }
  }

  const dirLabel = `session director${removed === 1 ? 'y' : 'ies'}`;
  const action = `Agent tmp sweep: removed ${removed} ${dirLabel} idle over ${AGENT_TMP_RETENTION_DAYS} days; kept ${kept} live`;
  deps.log(action);
  return [action];
}
