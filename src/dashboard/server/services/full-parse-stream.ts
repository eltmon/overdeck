import { Effect, Queue, Stream } from 'effect';
import { watch as fsWatch } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import type { ConversationEvent, PanRpcError } from '@overdeck/contracts';
import type { ParseResult } from './conversation/types.js';
import { createTranscriptDelta } from './transcript-delta.js';
import { listCodexSubagents } from './conversation/codex-subagents.js';
import { startSubagentListPolling, type SubagentListPoller } from './conversation/subagents.js';

/**
 * Watch full-parser transcripts and emit an initial snapshot followed by changed rows for harnesses without incremental parsing.
 * Path resolution, file watching, debounce state, and event emission stay on the main
 * thread. Callers supply a parser callback that sends CPU-bound parsing through the
 * dashboard DB worker's parse lane via the job door.
 */
export function streamResolvedFullParseSnapshots(
  resolve: () => Promise<string | null>,
  parse: (file: string) => Promise<ParseResult>,
  model: string | null,
  // When true, "no transcript file resolved yet" is treated as an EMPTY (ready)
  // conversation rather than a still-discovering one. Interactive pi/codex
  // conversations write no transcript until their first turn, so a brand-new
  // one that is alive and simply waiting for the user's first message would
  // otherwise sit on "Discovering conversation…" forever. resolve() returns
  // null ONLY when no transcript exists on disk (a resumed conversation already
  // has its file), so emitting an empty snapshot here never blanks real history.
  unresolvedMeansEmpty = false,
  discoverSubagents = false,
): Stream.Stream<ConversationEvent, PanRpcError> {
  return Stream.callback<ConversationEvent, PanRpcError>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        let subagentPoller: SubagentListPoller | null = null;
        let latestWorkLog: ParseResult['workLog'] = [];
        let stopped = false;
        let resolving = false;
        let discoveryTimer: ReturnType<typeof setInterval> | null = null;
        let debounce: ReturnType<typeof setTimeout> | null = null;
        let watcher: ReturnType<typeof fsWatch> | null = null;
        let parsing = false;
        let pendingReparse = false;
        let sessionFile: string | null = null;
        // Whether we've already emitted the empty/ready snapshot for an
        // unresolved interactive conversation, so the 2s discovery poll doesn't
        // re-offer it on every tick.
        let announcedEmpty = false;
        // Lock onto a transcript only once we've actually parsed content from it.
        // A brand-new pi/codex conversation can briefly resolve to an empty
        // placeholder transcript while the real session is written under a
        // different (session-id) filename. The old code stopped discovery at the
        // FIRST resolved file and tailed that empty file forever — so the panel
        // showed the empty "How can I help you?" state until a manual refresh
        // re-subscribed. We keep re-resolving (and switch to the newest file)
        // until content appears, which also covers a watcher that misses appends.
        let hasContent = false;
        const delta = createTranscriptDelta(model);
        let previousFile: { dev: number; ino: number; size: number; mtimeMs: number; generation?: number } | undefined;

        const stopDiscovery = () => {
          if (discoveryTimer) { clearInterval(discoveryTimer); discoveryTimer = null; }
        };

        const offer = (event: ConversationEvent) => {
          try {
            Queue.offerUnsafe(queue, event);
          } catch {
            // Queue shut down (client disconnected) — ignore.
          }
        };

        const emit = async (): Promise<void> => {
          if (!sessionFile || stopped) return;
          if (parsing) { pendingReparse = true; return; }
          parsing = true;
          try {
            const file = sessionFile;
            const before = await stat(file);
            const result = await parse(file);
            const after = await stat(file);
            // A writer may replace/truncate while parsing. Wait for the next
            // parse rather than publishing a mixed snapshot as an authoritative reset.
            if (before.dev !== after.dev || before.ino !== after.ino ||
              (after.size <= before.size && after.mtimeMs !== before.mtimeMs) || after.size < before.size) {
              pendingReparse = true;
              return;
            }
            const reset = previousFile !== undefined && (previousFile.dev !== before.dev ||
              previousFile.ino !== before.ino || before.size < previousFile.size ||
              (before.size === previousFile.size && before.mtimeMs !== previousFile.mtimeMs) ||
              previousFile.generation !== result.transcriptGeneration);
            previousFile = { dev: before.dev, ino: before.ino, size: before.size,
              mtimeMs: before.mtimeMs, generation: result.transcriptGeneration };
            if (stopped) return;
            latestWorkLog = result.workLog;
            if (result.messages.length > 0 && !hasContent) {
              // Real content arrived — lock onto this file and stop polling.
              hasContent = true;
              stopDiscovery();
            }
            const event = delta(result, reset);
            if (event) offer(event);
            if (discoverSubagents) {
              if (subagentPoller) await subagentPoller.refresh();
              else {
                const file = sessionFile;
                subagentPoller = await startSubagentListPolling(file, () => new Set(), offer,
                  () => listCodexSubagents(file, latestWorkLog));
                if (stopped) subagentPoller.stop();
              }
            }
          } catch {
            // Transient parse failure (read during a write) — the next change
            // event re-parses cleanly.
          } finally {
            parsing = false;
            if (pendingReparse) { pendingReparse = false; void emit(); }
          }
        };

        const watchFile = (file: string) => {
          try {
            // Watch the directory so atomic file replacement does not strand us
            // on the old inode. Ignore writes to unrelated transcripts.
            watcher = fsWatch(dirname(file), (_event, filename) => {
              if (stopped || (filename && filename.toString() !== basename(file)) || debounce) return;
              debounce = setTimeout(() => { debounce = null; void emit(); }, 300);
            });
          } catch {
            // If the watcher can't attach, the discovery poll still re-parses.
          }
        };

        const tryResolve = async (): Promise<void> => {
          if (stopped || resolving || hasContent) return;
          resolving = true;
          try {
            const resolved = await resolve();
            if (stopped) return;
            if (!resolved) {
              // No transcript on disk yet. For an interactive conversation that
              // means it is brand-new and waiting for its first turn — show the
              // ready (empty) state like claude-code, not an endless
              // "Discovering…" spinner. Emit once; keep polling so the first
              // turn's transcript switches us to showing real content.
              if (unresolvedMeansEmpty) {
                if (!sessionFile && !announcedEmpty) {
                  announcedEmpty = true;
                  offer({ kind: 'messages', messages: [], workLog: [], streaming: false, snapshot: true });
                }
                return;
              }
              // Only announce "discovering" before we've ever resolved a file, so
              // we don't blank an already-shown (empty) snapshot.
              if (!sessionFile) offer({ kind: 'discovering' });
              return;
            }
            if (resolved !== sessionFile) {
              // First resolution, or a newer transcript appeared — point the
              // watcher at it and re-parse.
              if (watcher) { try { watcher.close(); } catch { /* ignore */ } watcher = null; }
              subagentPoller?.stop();
              subagentPoller = null;
              sessionFile = resolved;
              // Attach first: appends during the initial parse must queue another read.
              if (!stopped) watchFile(resolved);
              await emit();
            } else {
              // Same (still-empty) file resolved — re-parse in case it grew
              // without firing a watch event (some FS/watch combos miss appends).
              await emit();
            }
          } catch {
            // Discovery races file creation; the next poll retries resolution.
          } finally {
            resolving = false;
          }
        };

        // Return the cleanup handle immediately, even when initial parsing is
        // still in flight, so disconnects can close watchers and timers at once.
        void tryResolve();
        if (!hasContent) {
          // Keep polling until the transcript has real content. Cheap readdir+stat
          // every 2s; self-stops via stopDiscovery() the moment content is parsed.
          discoveryTimer = setInterval(() => { void tryResolve(); }, 2000);
        }

        return {
          stop: () => {
            stopped = true;
            subagentPoller?.stop();
            if (discoveryTimer) { clearInterval(discoveryTimer); discoveryTimer = null; }
            if (debounce) { clearTimeout(debounce); debounce = null; }
            if (watcher) { try { watcher.close(); } catch { /* ignore */ } }
          },
        };
      }),
      (handle) => Effect.sync(() => handle.stop()),
    ),
  );
}
