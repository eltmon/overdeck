import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { mkdir as mkdirAsync, writeFile as writeFileAsync } from 'fs/promises';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { Effect } from 'effect';
import {
  getAgentDir,
  getAgentStateSync,
  getAgentState,
  saveAgentStateSync,
  saveAgentState,
  markAgentStoppedState,
  saveAgentRuntimeState,
  normalizeAgentId,
} from '../agents.js';
import { emitAgentEvent } from '../agent-runtime.js';
import { AGENTS_DIR } from '../paths.js';
import {
  sessionExistsSync,
  capturePaneSync,
  killSessionSync,
  sessionExists,
  capturePane,
  killSession,
} from '../tmux.js';
import { FsError, TmuxError } from '../errors.js';

const execAsync = promisify(exec);

/**
 * True when the PID is a tmux process (client or server). Used to keep the
 * per-agent launcher kill sweep from ever signalling the shared tmux server
 * (PAN-1798). Reads /proc/<pid>/comm; on non-Linux or read failure returns
 * false (fail-open matches pre-fix behavior for non-tmux processes).
 */
function isTmuxProcessSync(pid: number): boolean {
  try {
    return readFileSync(`/proc/${pid}/comm`, 'utf-8').trim() === 'tmux';
  } catch {
    return false;
  }
}

/**
 * Find and kill any running `launcher.sh` process for the given agent.
 *
 * PAN-1527: `tmux kill-session` only signals tmux-managed children. Planning
 * agents (and any agent whose launcher escapes its tmux session) leave
 * orphan launcher.sh processes alive — state.json says stopped, but bash is
 * still burning CPU and tokens hours later. This locates them by command
 * line and walks SIGTERM → grace → SIGKILL.
 *
 * Sync version: callable from CLI (`pan kill`) and from the existing
 * `stopAgentSync`. Uses execSync only via `pgrep`, which is fast and
 * non-blocking in practice. Acceptable per CLAUDE.md because this path is
 * sync-by-nature already and is only called from CLI contexts and existing
 * sync internals.
 */
function killLauncherProcessSync(agentId: string): void {
  const launcherPath = join(AGENTS_DIR, agentId, 'launcher.sh');
  let pidsOut: string;
  try {
    pidsOut = execSync(
      `pgrep -f ${JSON.stringify(launcherPath)}`,
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  } catch {
    return; // pgrep exits 1 when there are no matches — nothing to kill
  }

  const pids = pidsOut
    .split('\n')
    .map(s => Number.parseInt(s, 10))
    .filter(n => Number.isFinite(n) && n > 0 && n !== process.pid)
    // PAN-1798: when this agent's spawn FOUNDED the shared tmux server, the
    // server's cmdline embeds this launcher path (`tmux ... new-session ...
    // bash .../launcher.sh`), so pgrep -f matches the server itself. Killing
    // it destroys every session on the socket — agents, reviews, and all
    // conversations. Never signal a tmux process from the per-agent sweep.
    .filter(pid => !isTmuxProcessSync(pid));
  if (pids.length === 0) return;

  for (const pid of pids) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  }

  // ~500ms grace period for orderly shutdown. Sync spawn of `sleep` is
  // acceptable in CLI context; this function is never reached from the
  // dashboard server (which uses the async `stopAgent` Effect below).
  try {
    execSync('sleep 0.5', { stdio: 'ignore' });
  } catch { /* ignore */ }

  const survivors: number[] = [];
  for (const pid of pids) {
    try {
      process.kill(pid, 0);
      survivors.push(pid);
    } catch {
      /* already dead */
    }
  }
  for (const pid of survivors) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
  }
}

async function killLauncherProcessAsync(agentId: string): Promise<void> {
  const launcherPath = join(AGENTS_DIR, agentId, 'launcher.sh');
  let pidsOut: string;
  try {
    const { stdout } = await execAsync(`pgrep -f ${JSON.stringify(launcherPath)}`);
    pidsOut = stdout.trim();
  } catch {
    return; // pgrep exits 1 when there are no matches
  }

  const pids = pidsOut
    .split('\n')
    .map(s => Number.parseInt(s, 10))
    .filter(n => Number.isFinite(n) && n > 0 && n !== process.pid)
    // PAN-1798: see killLauncherProcessSync — the founding tmux server's
    // cmdline embeds this launcher path; never signal tmux from this sweep.
    .filter(pid => !isTmuxProcessSync(pid));
  if (pids.length === 0) return;

  for (const pid of pids) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  }

  await new Promise<void>(resolve => setTimeout(resolve, 500));

  for (const pid of pids) {
    try {
      process.kill(pid, 0);
      try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
    } catch {
      /* already dead */
    }
  }
}

export function stopAgentSync(agentId: string): void {
  const normalizedId = normalizeAgentId(agentId);

  if (sessionExistsSync(normalizedId)) {
    // Capture tmux output before killing so logs remain viewable after stop
    try {
      const output = capturePaneSync(normalizedId, 5000);
      if (output) {
        const agentDir = getAgentDir(normalizedId);
        mkdirSync(agentDir, { recursive: true });
        writeFileSync(join(agentDir, 'output.log'), output);
      }
    } catch {
      // Non-fatal — best effort log capture
    }

    killSessionSync(normalizedId);
  }

  // PAN-1527: kill orphan launcher.sh processes that escape tmux (planning
  // agents, dashboard-spawned launchers, anything that survived tmux
  // kill-session). Runs even when no tmux session existed in the first place.
  killLauncherProcessSync(normalizedId);

  const state = getAgentStateSync(normalizedId);
  if (state) {
    // Ensure id is set — runtime state files may lack it (PAN-150)
    if (!state.id) state.id = normalizedId;

    markAgentStoppedState(state);
    saveAgentStateSync(state);
  }

  // Also mark runtime.json as stopped so Cloister/Deacon won't auto-restart.
  // state.json and runtime.json are separate files — both must agree the agent
  // was intentionally stopped to prevent race conditions with health check polls.
  console.log(`[agents] Stopping ${normalizedId}: tmux=${sessionExistsSync(normalizedId)} stateStatus=${state?.status ?? 'none'}`);
  saveAgentRuntimeState(normalizedId, {
    state: 'stopped',
    lastActivity: new Date().toISOString(),
  });
}

export const stopAgent = (agentId: string): Effect.Effect<void, FsError | TmuxError> => {
  const normalizedId = normalizeAgentId(agentId);

  return Effect.gen(function* () {
    if (yield* sessionExists(normalizedId)) {
      yield* Effect.gen(function* () {
        const output = yield* capturePane(normalizedId, 5000);
        if (!output) return;

        const agentDir = getAgentDir(normalizedId);
        const outputFile = join(agentDir, 'output.log');
        yield* Effect.tryPromise({
          try: () => mkdirAsync(agentDir, { recursive: true }),
          catch: (cause) => new FsError({ operation: 'mkdir', path: agentDir, cause }),
        });
        yield* Effect.tryPromise({
          try: () => writeFileAsync(outputFile, output),
          catch: (cause) => new FsError({ operation: 'write', path: outputFile, cause }),
        });
      }).pipe(Effect.catch(() => Effect.void));

      yield* killSession(normalizedId);
    }

    // PAN-1527: same orphan-launcher kill as stopAgentSync. Runs after
    // killSession so tmux gets the first chance to take everything down
    // cleanly; falls through and kills any survivor by command-line match.
    yield* Effect.tryPromise({
      try: () => killLauncherProcessAsync(normalizedId),
      catch: (cause): never => { throw cause; },
    }).pipe(Effect.catch(() => Effect.void));

    const state = yield* getAgentState(normalizedId);
    if (state) {
      if (!state.id) state.id = normalizedId;

      markAgentStoppedState(state);
      yield* saveAgentState(state);
    }

    const tmuxActive = yield* sessionExists(normalizedId);
    console.log(`[agents] Stopping ${normalizedId} (async): tmux=${tmuxActive} stateStatus=${state?.status ?? 'none'}`);
    yield* Effect.forkDetach(emitAgentEvent(normalizedId, {
      kind: 'activity',
      activity: 'stopped',
    }));
  });
};
