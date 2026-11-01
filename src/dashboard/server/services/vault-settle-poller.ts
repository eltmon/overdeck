/**
 * Session Vault growth poller for active managed conversations and pipeline
 * agents inside their tracking window (PAN-4307 WI-5, PAN-4647, FR-1..FR-3,
 * FR-5, NFR-5).
 *
 * `watchConversation` only streams while a browser has a conversation open
 * (`services/conversation/watch.ts`), so nothing settles a transcript that
 * keeps growing with no viewer attached. This poller covers that gap: every
 * `pollMs` it stats each active managed conversation's transcript, and a size
 * change (re)arms a `debounceSec` timer that settles it. A subject that
 * leaves the active list is settled once, forced, and forgotten (FR-2). Every
 * owned transcript of any origin is still covered by the sync cycle's own
 * `syncOnce` step 2, which stats every owned path each cycle — this poller
 * only shortens the gap for a subject nobody is watching.
 *
 * Standalone: the default `settle` here calls the engine directly and is not
 * queued. `vault-service.ts` overrides it with a queued implementation so
 * poller settles serialize with the sync cycle and eviction operations
 * (FR-6); this module has no dependency on `vault-service.ts`.
 */
import { listConversations, type LegacyConversation } from '../../../lib/overdeck/conversations.js';
import { resolveSessionFile } from '../../../lib/overdeck/conversation-reads.js';
import { readVaultConfig as readVaultConfigDefault } from '../../../lib/vault/config.js';
import { openVaultContext as openVaultContextDefault } from '../../../lib/vault/open.js';
import { settle as settleDefault } from '../../../lib/vault/settle.js';
import type { WipMode } from '../../../lib/vault/wip-capture.js';
import { listPipelineAgentSubjects as listPipelineAgentSubjectsDefault } from './vault-agent-subjects.js';

/** Matches the directory watcher's default poll period (`conversation-directory-watcher.ts`). */
export const VAULT_POLL_MS = 15_000;

/** One transcript the poller tracks: a managed conversation or a pipeline agent session (PAN-4647). */
export interface VaultPollSubject {
  /** Stable key; a subject that drops out of the list is force-settled once and forgotten. */
  name: string;
  harness?: string | null;
  /** Pre-resolved transcript path; when set, resolvePath is never called for this subject. */
  transcriptPath?: string;
  /** Title for a record the first settle mints. */
  recordTitle?: string;
}

export interface VaultSettlePollerDeps {
  listActive?: () => VaultPollSubject[] | Promise<VaultPollSubject[]>;
  resolvePath?: (subject: VaultPollSubject) => Promise<string | null>;
  statSize?: (path: string) => Promise<number | null>;
  settle?: (path: string, harness: string, wip: WipMode, options?: { recordTitle?: string }) => Promise<void>;
  readConfig?: typeof readVaultConfigDefault;
  pollMs?: number;
}

type ResolvedDeps = Required<VaultSettlePollerDeps>;

async function defaultStatSize(path: string): Promise<number | null> {
  const { stat } = await import('node:fs/promises');
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

async function defaultSettle(path: string, harness: string, wip: WipMode): Promise<void> {
  const opened = await openVaultContextDefault();
  if (opened.status !== 'open') return;
  const config = await readVaultConfigDefault();
  await settleDefault({ nativePath: path, harness, store: opened.vault.store, keys: opened.vault.keys, config, wip });
}

function conversationSubjects(): LegacyConversation[] {
  return listConversations().filter((conv) => conv.status === 'active' && (conv.harness === 'claude-code' || conv.harness === 'codex'));
}

async function defaultListActive(): Promise<VaultPollSubject[]> {
  return [...conversationSubjects(), ...(await listPipelineAgentSubjectsDefault())];
}

function resolveDeps(deps: VaultSettlePollerDeps): ResolvedDeps {
  return {
    listActive: deps.listActive ?? defaultListActive,
    resolvePath: deps.resolvePath ?? ((subject) => resolveSessionFile(subject as LegacyConversation)),
    statSize: deps.statSize ?? defaultStatSize,
    settle: deps.settle ?? defaultSettle,
    readConfig: deps.readConfig ?? readVaultConfigDefault,
    pollMs: deps.pollMs ?? VAULT_POLL_MS,
  };
}

interface PollState {
  path: string | null;
  harness: string;
  recordTitle?: string;
  lastSize: number | null;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface VaultSettlePoller {
  start(): void;
  stop(): void;
  /** Cancels every debounce timer, then force-settles every tracked path, bounded by `budgetMs`. */
  flush(budgetMs: number): Promise<void>;
}

async function pollOnce(deps: ResolvedDeps, state: Map<string, PollState>): Promise<void> {
  const config = await deps.readConfig();
  if (!config.backend) {
    // FR-7: the vault is off, so every operation is a no-op; drop any tracked
    // state rather than statting files and arming timers for nothing.
    for (const entry of state.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    state.clear();
    return;
  }
  const debounceMs = config.debounceSec * 1000;
  const active = await deps.listActive();
  const activeNames = new Set(active.map((subject) => subject.name));

  for (const subject of active) {
    let entry = state.get(subject.name);
    if (!entry) {
      entry = { path: null, harness: subject.harness ?? '', lastSize: null, timer: null };
      state.set(subject.name, entry);
    }
    entry.harness = subject.harness ?? entry.harness;
    entry.recordTitle = subject.recordTitle;
    // NFR-5: resolve the path once; re-resolve only while the cache is null.
    if (entry.path === null) entry.path = subject.transcriptPath ?? await deps.resolvePath(subject);
    if (!entry.path) continue;
    const size = await deps.statSize(entry.path);
    if (size === null) continue;
    if (entry.lastSize === null) {
      entry.lastSize = size;
      continue;
    }
    if (size === entry.lastSize) continue;
    entry.lastSize = size;
    if (entry.timer) clearTimeout(entry.timer);
    const path = entry.path;
    const harness = entry.harness;
    const titleArg = entry.recordTitle ? [{ recordTitle: entry.recordTitle }] as const : [];
    entry.timer = setTimeout(() => {
      entry!.timer = null;
      void deps.settle(path, harness, 'auto', ...titleArg).catch((error) => console.warn(`[vault] settle failed for ${path}:`, error));
    }, debounceMs);
    if (typeof entry.timer.unref === 'function') entry.timer.unref();
  }

  for (const [name, entry] of state) {
    if (activeNames.has(name)) continue;
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.path) {
      const path = entry.path;
      const harness = entry.harness;
      const titleArg = entry.recordTitle ? [{ recordTitle: entry.recordTitle }] as const : [];
      void deps.settle(path, harness, 'force', ...titleArg).catch((error) => console.warn(`[vault] settle failed for ${path}:`, error));
    }
    state.delete(name);
  }
}

async function flush(deps: ResolvedDeps, state: Map<string, PollState>, budgetMs: number): Promise<void> {
  const deadline = Date.now() + budgetMs;
  const entries = [...state.entries()];
  for (const [, entry] of entries) {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
  }
  let skipped = 0;
  for (const [, entry] of entries) {
    const remaining = deadline - Date.now();
    if (!entry.path) continue;
    if (remaining <= 0) {
      skipped++;
      continue;
    }
    const path = entry.path;
    const harness = entry.harness;
    const titleArg = entry.recordTitle ? [{ recordTitle: entry.recordTitle }] as const : [];
    let timedOut = false;
    await Promise.race([
      deps.settle(path, harness, 'force', ...titleArg).catch(() => undefined),
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          timedOut = true;
          resolve();
        }, remaining);
        if (typeof timer.unref === 'function') timer.unref();
      }),
    ]);
    if (timedOut) skipped++;
  }
  state.clear();
  if (skipped > 0) console.warn(`[vault] shutdown flush skipped ${skipped} transcript(s)`);
}

export function createVaultSettlePoller(deps: VaultSettlePollerDeps = {}): VaultSettlePoller {
  const resolved = resolveDeps(deps);
  const state = new Map<string, PollState>();
  let intervalTimer: ReturnType<typeof setInterval> | null = null;

  return {
    start() {
      if (intervalTimer) return;
      const runPoll = (): void => {
        void pollOnce(resolved, state).catch((error) => console.warn('[vault] poll failed:', error));
      };
      runPoll();
      intervalTimer = setInterval(runPoll, resolved.pollMs);
      if (typeof intervalTimer.unref === 'function') intervalTimer.unref();
    },
    stop() {
      if (intervalTimer) {
        clearInterval(intervalTimer);
        intervalTimer = null;
      }
      for (const entry of state.values()) {
        if (entry.timer) clearTimeout(entry.timer);
      }
    },
    flush: (budgetMs: number) => flush(resolved, state, budgetMs),
  };
}
