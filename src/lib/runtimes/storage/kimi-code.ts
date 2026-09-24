/**
 * Kimi Code transcript storage (PAN-3958 CH-7, D11): the only place that knows
 * where the native Kimi CLI keeps its sessions —
 * `~/.kimi-code/sessions/<work-dir key>/<session-id>/agents/main/wire.jsonl`.
 *
 * Leaf module: imports only `node:*`, so any layer can import it without
 * creating a cycle. `npm run lint:harness-storage` keeps these paths from being
 * rebuilt anywhere else.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

/** Kimi Code's home directory: `~/.kimi-code`. */
export function kimiHomeDefault(): string {
  return join(homedir(), '.kimi-code');
}

/** One Kimi session's transcript: `<kimiHome>/sessions/<work-dir key>/<session-id>/agents/main/wire.jsonl`. */
export function kimiWirePath(kimiHome: string, workDir: string, sessionId: string): string {
  return join(kimiSessionsRoot(kimiHome, workDir), sessionId, 'agents', 'main', 'wire.jsonl');
}

/** True for a native Kimi CLI transcript path (`.../agents/main/wire.jsonl`). */
export function isKimiWirePath(path: string): boolean {
  return path.endsWith('/agents/main/wire.jsonl');
}

/**
 * Locate wire.jsonl for a specific captured session id under the workspace's
 * bucket. Falls back to the newest session directory when the captured id's
 * wire.jsonl is missing (e.g. never captured, or the id file is stale).
 */
export function findKimiWirePath(kimiHome: string, workspace: string, sessionId: string | null): string | null {
  if (sessionId) {
    const candidate = join(kimiSessionsRoot(kimiHome, workspace), sessionId, 'agents', 'main', 'wire.jsonl');
    if (existsSync(candidate)) return candidate;
  }
  return findLatestKimiSession(kimiHome, workspace);
}

/** Fallback: the newest session directory by wire.jsonl mtime under the workspace's bucket. */
export function findLatestKimiSession(kimiHome: string, workspace: string): string | null {
  const bucketDir = kimiSessionsRoot(kimiHome, workspace);
  let entries: string[];
  try {
    entries = readdirSync(bucketDir);
  } catch {
    return null;
  }
  let newest: { path: string; mtimeMs: number } | null = null;
  for (const entry of entries) {
    const wirePath = join(bucketDir, entry, 'agents', 'main', 'wire.jsonl');
    let mtimeMs: number;
    try {
      mtimeMs = statSync(wirePath).mtimeMs;
    } catch {
      continue;
    }
    if (!newest || mtimeMs > newest.mtimeMs) newest = { path: wirePath, mtimeMs };
  }
  return newest?.path ?? null;
}

/** The per-work-dir session bucket name Kimi derives from the absolute work dir. */
export function kimiWorkDirKey(workDir: string): string {
  const hash = createHash('sha256').update(workDir).digest('hex').slice(0, 12);
  return `wd_${basename(workDir)}_${hash}`;
}

/** A work dir's session bucket: `<kimiHome>/sessions/<work-dir key>`. */
export function kimiSessionsRoot(kimiHome: string, workDir: string): string {
  return join(kimiHome, 'sessions', kimiWorkDirKey(workDir));
}

/**
 * Async twin of {@link findKimiWirePath} (PAN-1837 review fix, P2). The
 * dashboard's transcript resolver runs on the event loop and Command Deck
 * polling re-resolves the same session repeatedly, so the sync
 * readdirSync/statSync walk here would block the loop on every poll as a
 * session's history grows. Runtime-side sync callers (kill/spawn lifecycle)
 * keep using the sync versions above — this pair exists only for dashboard
 * routes, per the runtime's own documented sync contract.
 */
export async function findKimiWirePathAsync(
  kimiHome: string,
  workspace: string,
  sessionId: string | null,
): Promise<string | null> {
  if (sessionId) {
    const candidate = join(kimiSessionsRoot(kimiHome, workspace), sessionId, 'agents', 'main', 'wire.jsonl');
    try {
      await stat(candidate);
      return candidate;
    } catch { /* fall through to newest-session fallback */ }
  }
  return findLatestKimiSessionAsync(kimiHome, workspace);
}

export async function findLatestKimiSessionAsync(
  kimiHome: string,
  workspace: string,
): Promise<string | null> {
  const bucketDir = kimiSessionsRoot(kimiHome, workspace);
  const entries = await readdir(bucketDir).catch(() => []);
  let newest: { path: string; mtimeMs: number } | null = null;
  for (const entry of entries.sort()) {
    const path = join(bucketDir, entry, 'agents', 'main', 'wire.jsonl');
    const mtimeMs = await stat(path).then(info => info.mtimeMs, () => -1);
    if (mtimeMs >= 0 && (!newest || mtimeMs > newest.mtimeMs || (mtimeMs === newest.mtimeMs && path < newest.path))) {
      newest = { path, mtimeMs };
    }
  }
  return newest?.path ?? null;
}
