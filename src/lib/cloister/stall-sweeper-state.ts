/**
 * Stall-sweeper per-row state (PAN-3485 phase 2).
 *
 * One small JSON file per (issueId, orbit) under ~/.overdeck/stall-sweeper/.
 * Tracks the current park episode: how many autonomous actions the sweeper has
 * taken, when the last one ran (cooldown), and when the row was last
 * re-surfaced to the operator (TTL). Runtime-plane residue — deleting the
 * directory only resets cooldowns, never loses pipeline state.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getOverdeckHome } from '../paths.js';

export interface StallSweeperRowState {
  /** Total autonomous actions taken for the current park episode. */
  actionCount: number;
  /** ISO of the last autonomous action (drives cooldowns). */
  lastActionAt?: string;
  /** ISO the sweeper first saw this park episode. */
  episodeStartedAt: string;
  /** ISO of the last operator re-surface (drives the escalation TTL). */
  lastEscalatedAt?: string;
  /** idle-running only: ISO of the last nudge + the activity stamp it targeted. */
  lastNudgedAt?: string;
  nudgedActivityAt?: string;
}

function sweeperDir(): string {
  return join(getOverdeckHome(), 'stall-sweeper');
}

function statePath(issueId: string, orbit: string): string {
  return join(sweeperDir(), `${issueId.toUpperCase()}--${orbit}.json`);
}

export function readSweeperRowState(issueId: string, orbit: string): StallSweeperRowState | null {
  const filePath = statePath(issueId, orbit);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as StallSweeperRowState;
  } catch {
    return null;
  }
}

export function writeSweeperRowState(issueId: string, orbit: string, state: StallSweeperRowState): void {
  mkdirSync(sweeperDir(), { recursive: true });
  writeFileSync(statePath(issueId, orbit), JSON.stringify(state, null, 2));
}

/** Episode over (row resolved or orbit changed) — forget so a future park starts fresh. */
export function clearSweeperRowState(issueId: string, orbit: string): void {
  rmSync(statePath(issueId, orbit), { force: true });
}

/** Population-signature persistence for change-only sweep.scan emission. */
export function readSweeperSignature(): string | null {
  const filePath = join(sweeperDir(), 'population-signature');
  if (!existsSync(filePath)) return null;
  try { return readFileSync(filePath, 'utf-8'); } catch { return null; }
}

export function writeSweeperSignature(signature: string): void {
  mkdirSync(sweeperDir(), { recursive: true });
  writeFileSync(join(sweeperDir(), 'population-signature'), signature);
}
