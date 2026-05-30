/**
 * Dev-supervisor marker — lets the rest of the platform know an interactive
 * `pan dev` session owns the dashboard ports.
 *
 * `pan dev` runs the API server and Vite as *child processes* it supervises.
 * The shared stop machinery (`stopDashboard`, used by `pan down`/`pan restart`)
 * works by finding whatever PID holds the dashboard ports and SIGTERMing it —
 * which, under `pan dev`, is the dev session's children. Killing those children
 * out from under the supervisor used to silently take the whole dev server down
 * (PAN: dashboard-dev-resilience).
 *
 * The marker closes that gap two ways:
 *   - `pan down` routes its SIGTERM to the *supervisor* pid (not the children),
 *     so the dev session tears down gracefully and stays down on purpose.
 *   - `pan restart` / `pan reload` / `pan up` detect the marker and refuse to
 *     hijack a running dev session into detached production mode.
 *
 * The supervisor's own child-respawn logic keys off the same intentional-vs-stray
 * distinction: a stray kill of a child respawns it; a SIGTERM to the supervisor
 * is intentional and tears everything down.
 *
 * CLI-side only — sync I/O is fine here.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { getPanopticonHome } from './paths.js';

export interface DevSupervisorMarker {
  /** PID of the `pan dev` process (the supervisor itself, not its children). */
  pid: number;
  dashboardPort: number;
  apiPort: number;
  startedAt: string;
}

function markerPath(): string {
  return join(getPanopticonHome(), 'dev-supervisor.json');
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    // Signal 0 performs error checking without delivering a signal.
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // EPERM means the process exists but we can't signal it — still alive.
    return err?.code === 'EPERM';
  }
}

export function writeDevSupervisorMarker(info: Omit<DevSupervisorMarker, 'startedAt'>): void {
  const marker: DevSupervisorMarker = { ...info, startedAt: new Date().toISOString() };
  const path = markerPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(marker, null, 2), 'utf-8');
}

/**
 * Returns the live dev-supervisor marker, or null if absent or stale.
 * A marker whose pid is no longer running is deleted as a side effect so a
 * crashed `pan dev` can't block `pan up`/`pan restart` forever.
 */
export function readDevSupervisorMarker(): DevSupervisorMarker | null {
  const path = markerPath();
  if (!existsSync(path)) return null;
  let marker: DevSupervisorMarker;
  try {
    marker = JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    // Corrupt marker — treat as stale.
    clearDevSupervisorMarker();
    return null;
  }
  if (!isProcessAlive(marker.pid)) {
    clearDevSupervisorMarker();
    return null;
  }
  return marker;
}

export function clearDevSupervisorMarker(): void {
  const path = markerPath();
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // ignore
  }
}

/**
 * Human-facing lines explaining why a detached lifecycle command (`pan up`,
 * `pan restart`, `pan reload`) is refusing to run while an interactive dev
 * session owns the dashboard ports. `action` completes the sentence
 * "Refusing to <action>".
 */
export function devSupervisorRefusalLines(action: string, marker: DevSupervisorMarker): string[] {
  return [
    `A \`pan dev\` session (pid ${marker.pid}) currently owns the dashboard ports.`,
    `Refusing to ${action} — it would hijack your interactive dev server into detached production mode.`,
    `  • Stop it:    \`pan down\`  (or Ctrl-C in the pan dev terminal)`,
    `  • Restart it: re-run \`pan dev\` in that terminal`,
  ];
}
