import { existsSync } from 'fs';
import { join } from 'path';
import { Effect } from 'effect';
import { FsError, TmuxError } from '../errors.js';
import type { AgentStatus } from '@overdeck/contracts';
import type { AgentState, Role } from '../agents.js';
import { getAgentState, isRole, normalizeAgentId } from '../agents.js';
import { killSession, listSessions, listSessionsSync } from '../tmux.js';
import { AGENTS_DIR } from '../paths.js';
import { getRollbackAgentStatePath } from '../overdeck/agent-rollback-state.js';
import { listOverdeckAgentStatesSync } from '../overdeck/agent-state-sync.js';

export function listRunningAgentsSync(): (AgentState & { tmuxActive: boolean })[] {
  // Match liveness against ALL overdeck-socket sessions, not just `agent-*`.
  // Agent state dirs are named by role prefix (planning-/agent-/conv-/strike-);
  // getAgentSessions only returns `agent-*`, so planning/conv/strike sessions
  // would always read tmuxActive:false and get dropped by the enrichment poller.
  const tmuxSessions = listSessionsSync();
  const tmuxNames = new Set(tmuxSessions.map(s => s.name));

  return listOverdeckAgentStatesSync().map((state) => {
    const normalizedId = normalizeAgentId(state.id);
    return {
      ...state,
      id: normalizedId,
      tmuxActive: tmuxNames.has(normalizedId),
    };
  });
}

/**
 * PAN-1908: list all agents in the SQLite registry with optional filtering.
 * This is the replacement for enumerating ~/.overdeck/agents/ directories.
 */
export function listAgentStates(options?: { status?: AgentStatus; role?: Role }): AgentState[] {
  return listOverdeckAgentStatesSync()
    .filter((state) => {
      if (options?.status && state.status !== options.status) return false;
      if (options?.role && state.role !== options.role) return false;
      return true;
    });
}


export const listRunningAgents = (): Effect.Effect<(AgentState & { tmuxActive: boolean })[], FsError | TmuxError> =>
  Effect.gen(function* () {
    // PAN-1908: authoritative registry is the SQLite agents table; no directory scan.
    //
    // TRAP — `tmuxActive` reflects whether THIS process can see the agent's tmux
    // session on the `overdeck` socket. Run this from a one-off `tsx -e`/CLI
    // process that lacks access to that socket and `listSessions()` returns
    // empty, so EVERY agent comes back `tmuxActive: false` — including ones that
    // are genuinely running. Do not conclude "the agent isn't running" / "the
    // enrichment poller skips it" from an out-of-server-process reading. Trust
    // the live dashboard server's view (it owns the socket) or check the tmux
    // session directly with `tmux -L overdeck list-sessions`.
    //
    // Use the UNFILTERED session list (not getAgentSessions, which is `agent-*`
    // only): agent state dirs carry role prefixes (planning-/agent-/conv-/strike-),
    // and planning/conv/strike sessions must read tmuxActive:true so the
    // enrichment poller scans them for AskUserQuestion / pending input (PAN-1395).
    const tmuxSessions = yield* listSessions();
    const tmuxNames = new Set(tmuxSessions.map(s => s.name));

    return listOverdeckAgentStatesSync().map((state) => {
      const normalizedId = normalizeAgentId(state.id);
      return {
        ...state,
        id: normalizedId,
        tmuxActive: tmuxNames.has(normalizedId),
      };
    });
  });

/**
 * PAN-1048 P2: async startup migration.
 *
 * The previous synchronous version used readdirSync, readFileSync,
 * killSession (sync tmux subprocess), and rmSync — all on the Node
 * event loop. Called from warnOnBareNumericIssueIds() during dashboard
 * read-model bootstrap, this blocked all HTTP/WebSocket/PTY traffic on
 * server startup while it scanned every agent dir, killed stale tmux
 * sessions, and recursively deleted directories.
 *
 * This async variant does the same work using fs/promises and the
 * already-async killSessionAsync() so the bootstrap path no longer
 * stalls the event loop.
 */
export async function dropLegacyAgentStatesMissingRoleAsync(): Promise<number> {
  if (!existsSync(AGENTS_DIR)) return 0;

  const fsp = await import('fs/promises');
  let entries: string[];
  try {
    entries = await fsp.readdir(AGENTS_DIR);
  } catch {
    return 0;
  }

  let dropped = 0;
  await Promise.all(
    entries.map(async (entry) => {
      const dirPath = join(AGENTS_DIR, entry);
      let stat;
      try {
        stat = await fsp.stat(dirPath);
      } catch {
        return;
      }
      if (!stat.isDirectory()) return;

      const agentId = normalizeAgentId(entry);
      const stateFile = getRollbackAgentStatePath(agentId);
      let raw: { role?: unknown };
      try {
        const contents = await fsp.readFile(stateFile, 'utf8');
        raw = JSON.parse(contents) as { role?: unknown };
      } catch {
        return;
      }
      if (isRole(raw.role)) return;

      try { await Effect.runPromise(killSession(agentId)); } catch { /* best effort */ }
      try {
        await fsp.rm(dirPath, { recursive: true, force: true });
        dropped++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[agents] Failed to drop legacy agent state ${agentId}: ${msg}`);
      }
    }),
  );

  return dropped;
}

/**
 * Scan ~/.overdeck/agents/ for state files with bare numeric issueIds
 * (e.g. "484" instead of "PAN-484") and log warnings to stderr.
 *
 * These workspaces were created before the pan- prefix convention and may
 * cause cross-tracker pollution if their in_review transition is triggered.
 * Called once at server startup to surface legacy state files.
 */
/**
 * PAN-1048 P2: bootstrap-path migration is async.
 *
 * Sweeps legacy state files missing a `role` field and warns on bare
 * numeric issueIds. Both passes used to be synchronous (readdirSync,
 * readFileSync, killSession, rmSync), which blocked the dashboard
 * server's event loop on startup. The async version scans the same
 * directory once per concern and uses fs/promises throughout.
 */
export async function warnOnBareNumericIssueIds(): Promise<void> {
  const droppedLegacyAgents = await dropLegacyAgentStatesMissingRoleAsync();
  if (droppedLegacyAgents > 0) {
    console.warn(`[agents] Dropped ${droppedLegacyAgents} legacy agent state file(s) missing role`);
  }

  if (!existsSync(AGENTS_DIR)) return;

  const fsp = await import('fs/promises');
  let entries: string[];
  try {
    entries = await fsp.readdir(AGENTS_DIR);
  } catch {
    return;
  }

  const legacy: string[] = [];
  await Promise.all(
    entries.map(async (entry) => {
      const dirPath = join(AGENTS_DIR, entry);
      try {
        const stat = await fsp.stat(dirPath);
        if (!stat.isDirectory()) return;
      } catch {
        return;
      }
      const state = await Effect.runPromise(getAgentState(entry));
      if (state?.issueId && /^\d+$/.test(state.issueId)) {
        legacy.push(`${entry} (issueId: "${state.issueId}")`);
      }
    }),
  );

  if (legacy.length > 0) {
    console.warn(
      `[agents] WARNING: ${legacy.length} agent state file(s) have bare numeric issueIds ` +
      `(created before the pan- prefix convention). These agents will not be able to ` +
      `transition tracker state. Consider removing or updating them:\n` +
      legacy.map(l => `  ~/.overdeck/agents/${l}`).join('\n')
    );
  }
}
