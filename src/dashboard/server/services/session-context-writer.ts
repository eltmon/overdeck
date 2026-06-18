import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DashboardSnapshot, FeatureRegistryEntry } from '@overdeck/contracts';
import { assembleLiveBriefingMarkdown } from '../../../lib/briefing-assembler.js';
import { resolveSessionContextBriefingPath } from '../../../lib/briefing-freshness.js';
import { listFeatureRegistryEntries } from '../../../lib/registry/feature-registry-storage.js';

export interface SessionContextWriter {
  schedule(): void;
  writeNow(): Promise<void>;
  stop(): void;
}

export interface StartSessionContextWriterOptions {
  readSnapshot: () => Promise<DashboardSnapshot>;
  subscribe: (listener: () => void) => () => void;
  debounceMs?: number;
  path?: string;
  now?: () => Date;
  mkdir?: typeof mkdir;
  writeFile?: typeof writeFile;
  listRegistryEntries?: () => Promise<FeatureRegistryEntry[]>;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  logger?: Pick<Console, 'error' | 'warn'>;
}

export function startSessionContextWriter(options: StartSessionContextWriterOptions): SessionContextWriter {
  const debounceMs = options.debounceMs ?? 500;
  const path = options.path ?? resolveSessionContextBriefingPath();
  const mkdirFn = options.mkdir ?? mkdir;
  const writeFileFn = options.writeFile ?? writeFile;
  const listRegistryEntriesFn = options.listRegistryEntries ?? (() => listFeatureRegistryEntries({ limit: 50 }));
  const setTimeoutFn = options.setTimeout ?? setTimeout;
  const clearTimeoutFn = options.clearTimeout ?? clearTimeout;
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? console;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let writing = false;
  let pendingAfterWrite = false;

  const writeLatest = async (): Promise<void> => {
    if (stopped) return;
    if (writing) {
      pendingAfterWrite = true;
      return;
    }

    writing = true;
    try {
      const [snapshot, registryEntries] = await Promise.all([
        options.readSnapshot(),
        readRegistryEntries(listRegistryEntriesFn, logger),
      ]);
      const content = await assembleLiveBriefingMarkdown({ snapshot, registryEntries, now: now() });
      await mkdirFn(dirname(path), { recursive: true });
      await writeFileFn(path, content, 'utf8');
    } catch (error) {
      logger.error('[session-context] Failed to write live briefing:', error);
    } finally {
      writing = false;
      if (pendingAfterWrite && !stopped) {
        pendingAfterWrite = false;
        schedule();
      }
    }
  };

  const schedule = (): void => {
    if (stopped) return;
    if (timer) clearTimeoutFn(timer);
    timer = setTimeoutFn(() => {
      timer = null;
      void writeLatest();
    }, debounceMs);
  };

  const unsubscribe = options.subscribe(schedule);
  void writeLatest();

  return {
    schedule,
    writeNow: writeLatest,
    stop() {
      stopped = true;
      if (timer) {
        clearTimeoutFn(timer);
        timer = null;
      }
      unsubscribe();
    },
  };
}

async function readRegistryEntries(
  listRegistryEntries: () => Promise<FeatureRegistryEntry[]>,
  logger: Pick<Console, 'warn'>,
): Promise<FeatureRegistryEntry[]> {
  try {
    return await listRegistryEntries();
  } catch (error) {
    logger.warn('[session-context] Failed to load feature registry entries:', error);
    return [];
  }
}
