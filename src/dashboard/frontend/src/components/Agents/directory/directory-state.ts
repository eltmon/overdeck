/**
 * What the Agents Directory shows for an entry's state (PAN-3920). Pure.
 *
 * The entry's own state comes from the server (D3). On top of it, the issue's
 * derived attention — already in the store, derived and never stored — marks
 * the issue's own agent `stuck` (idle with unpushed work past the threshold)
 * or `api-error`, the way the old card grid's STUCK badge did. `unknown` is
 * never shown as a word: a remote agent reads `remote`, anything else
 * `no status`.
 */
import type { DirectoryEntry, IssueAttention } from '@overdeck/contracts';

export type DirectoryDisplayState =
  | 'working'
  | 'blocked'
  | 'stuck'
  | 'api-error'
  | 'idle'
  | 'done'
  | 'stopped'
  | 'remote'
  | 'no-status';

/** Roles whose pane the issue's attention is about. */
const ISSUE_AGENT_ROLES = new Set(['work', 'strike']);

export function displayStateOf(entry: DirectoryEntry, attention?: IssueAttention): DirectoryDisplayState {
  if (entry.state === 'blocked') return 'blocked';
  const issueAgent = entry.kind === 'agent' && entry.issueId !== null && ISSUE_AGENT_ROLES.has(entry.role ?? '');
  if (issueAgent && attention === 'api-error' && (entry.state === 'working' || entry.state === 'idle')) return 'api-error';
  if (issueAgent && attention === 'stuck' && entry.state === 'idle') return 'stuck';
  if (entry.state === 'unknown') return entry.location === 'remote' ? 'remote' : 'no-status';
  return entry.state;
}

/** Who launched an external agent, in words (PAN-3920 Phase C). */
export function externalSourceLabel(source: DirectoryEntry['source']): string {
  return source === 'codex-plugin' ? 'a Codex plugin job' : 'a registered external agent';
}

/** A known field value, or null for the server's `unknown` placeholder (never displayed). */
export function known(value: string | null | undefined): string | null {
  return value && value !== 'unknown' ? value : null;
}

/** Whole hours since the entry's last activity — the old grid's `STUCK · Nh`. */
export function hoursSince(iso: string | null, now: Date): number | undefined {
  const at = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(at) ? Math.max(0, Math.floor((now.getTime() - at) / 3_600_000)) : undefined;
}
