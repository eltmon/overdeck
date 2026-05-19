import { open, stat } from 'fs/promises';
import type { MemoryIdentity } from '@panctl/contracts';
import { getTranscriptCheckpoint } from './checkpoints.js';
import { extractFromTranscriptDelta, type ExtractFromTranscriptDeltaInput, type ExtractFromTranscriptDeltaResult } from './pipeline.js';
import { areMemoryObservationsEnabled } from './settings.js';
import { getActiveTranscriptEntries, type TranscriptEntry } from './transcript-source.js';
import { enqueueMemoryPipelineJob } from './worker-pool.js';

export const DEFAULT_MEMORY_POLLER_INTERVAL_MS = 2_000;
export const DEFAULT_MEMORY_POLLER_ACTIVITY_LINE_THRESHOLD = 20;
export const DEFAULT_MEMORY_POLLER_MIN_INTERVAL_MS = 60_000;
export const DEFAULT_MEMORY_POLLER_MAX_MID_TURN_EXTRACTIONS = 3;
export const MAX_MEMORY_POLLER_SAMPLE_BYTES = 64 * 1024;

export interface RegisteredTranscript {
  sessionId: string;
  transcriptPath: string;
  identity: MemoryIdentity;
  harness: string;
  lastSize: number;
  lastMtimeMs: number;
  lastObservedOffset: number;
  lastExtractionOffset: number;
  pendingLineCount: number;
}

export interface TranscriptPollerOptions {
  intervalMs?: number;
  activityLineThreshold?: number;
  minIntervalMs?: number;
  maxMidTurnExtractionsPerTurn?: number;
  now?: () => Date;
  getActiveTranscriptEntries?: () => Promise<TranscriptEntry[]>;
  statTranscript?: (path: string) => Promise<{ size: number; mtimeMs: number }>;
  readTranscriptSlice?: (path: string, fromOffset: number, toOffset: number) => Promise<string>;
  getTranscriptCheckpoint?: typeof getTranscriptCheckpoint;
  extractFromTranscriptDelta?: (input: ExtractFromTranscriptDeltaInput) => Promise<ExtractFromTranscriptDeltaResult>;
  enqueueTranscriptDelta?: (input: ExtractFromTranscriptDeltaInput) => void | Promise<unknown>;
  areObservationsEnabled?: () => boolean | Promise<boolean>;
}

export interface TranscriptPollerTickResult {
  scanned: number;
  unchanged: number;
  belowThreshold: number;
  rateLimited: number;
  fired: number;
  removed: number;
}

export class TranscriptPoller {
  private readonly entries = new Map<string, RegisteredTranscript>();
  private readonly intervalMs: number;
  private readonly activityLineThreshold: number;
  private readonly minIntervalMs: number;
  private readonly maxMidTurnExtractionsPerTurn: number;
  private readonly now: () => Date;
  private readonly getActiveEntries: () => Promise<TranscriptEntry[]>;
  private readonly statTranscript: (path: string) => Promise<{ size: number; mtimeMs: number }>;
  private readonly readTranscriptSlice: (path: string, fromOffset: number, toOffset: number) => Promise<string>;
  private readonly getCheckpoint: typeof getTranscriptCheckpoint;
  private readonly enqueueDelta: (input: ExtractFromTranscriptDeltaInput) => void | Promise<unknown>;
  private readonly areObservationsEnabled: () => boolean | Promise<boolean>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(options: TranscriptPollerOptions = {}) {
    this.intervalMs = options.intervalMs ?? DEFAULT_MEMORY_POLLER_INTERVAL_MS;
    this.activityLineThreshold = options.activityLineThreshold ?? DEFAULT_MEMORY_POLLER_ACTIVITY_LINE_THRESHOLD;
    this.minIntervalMs = options.minIntervalMs ?? DEFAULT_MEMORY_POLLER_MIN_INTERVAL_MS;
    this.maxMidTurnExtractionsPerTurn = options.maxMidTurnExtractionsPerTurn ?? DEFAULT_MEMORY_POLLER_MAX_MID_TURN_EXTRACTIONS;
    this.now = options.now ?? (() => new Date());
    this.getActiveEntries = options.getActiveTranscriptEntries ?? getActiveTranscriptEntries;
    this.statTranscript = options.statTranscript ?? stat;
    this.readTranscriptSlice = options.readTranscriptSlice ?? readTranscriptSlice;
    this.getCheckpoint = options.getTranscriptCheckpoint ?? getTranscriptCheckpoint;
    this.enqueueDelta = options.enqueueTranscriptDelta ?? options.extractFromTranscriptDelta ?? ((input) => { enqueueMemoryPipelineJob(input); });
    this.areObservationsEnabled = options.areObservationsEnabled ?? areMemoryObservationsEnabled;
  }

  register(entry: TranscriptEntry): void {
    const existing = this.entries.get(entry.sessionId);
    this.entries.set(entry.sessionId, {
      sessionId: entry.sessionId,
      transcriptPath: entry.transcriptPath,
      identity: entry.identity,
      harness: entry.harness,
      lastSize: entry.size,
      lastMtimeMs: entry.mtimeMs,
      lastObservedOffset: existing?.lastObservedOffset ?? entry.size,
      lastExtractionOffset: existing?.lastExtractionOffset ?? entry.size,
      pendingLineCount: existing?.pendingLineCount ?? 0,
    });
  }

  unregister(sessionId: string): void {
    this.entries.delete(sessionId);
  }

  registeredCount(): number {
    return this.entries.size;
  }

  snapshot(): RegisteredTranscript[] {
    return Array.from(this.entries.values()).map((entry) => ({ ...entry }));
  }

  async syncActiveTranscripts(): Promise<void> {
    if (!await this.areObservationsEnabled()) {
      for (const sessionId of this.entries.keys()) this.unregister(sessionId);
      return;
    }

    const active = await this.getActiveEntries();
    const activeIds = new Set(active.map((entry) => entry.sessionId));
    for (const entry of active) this.register(entry);
    for (const sessionId of this.entries.keys()) {
      if (!activeIds.has(sessionId)) this.unregister(sessionId);
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<TranscriptPollerTickResult> {
    const result: TranscriptPollerTickResult = {
      scanned: 0,
      unchanged: 0,
      belowThreshold: 0,
      rateLimited: 0,
      fired: 0,
      removed: 0,
    };
    if (this.ticking || this.entries.size === 0) return result;
    if (!await this.areObservationsEnabled()) return result;

    this.ticking = true;
    try {
      for (const entry of Array.from(this.entries.values())) {
        result.scanned += 1;
        const outcome = await this.tickEntry(entry);
        result[outcome] += 1;
      }
    } finally {
      this.ticking = false;
    }
    return result;
  }

  private async tickEntry(entry: RegisteredTranscript): Promise<Exclude<keyof TranscriptPollerTickResult, 'scanned'>> {
    let fileStat: { size: number; mtimeMs: number };
    try {
      fileStat = await this.statTranscript(entry.transcriptPath);
    } catch {
      this.entries.delete(entry.sessionId);
      return 'removed';
    }

    if (fileStat.size === entry.lastSize && fileStat.mtimeMs === entry.lastMtimeMs) return 'unchanged';
    if (fileStat.size <= entry.lastObservedOffset) {
      this.entries.set(entry.sessionId, { ...entry, lastSize: fileStat.size, lastMtimeMs: fileStat.mtimeMs, lastObservedOffset: fileStat.size, lastExtractionOffset: fileStat.size, pendingLineCount: 0 });
      return 'unchanged';
    }

    const inspectedOffset = Math.min(fileStat.size, entry.lastObservedOffset + MAX_MEMORY_POLLER_SAMPLE_BYTES);
    const exceededSample = inspectedOffset < fileStat.size;
    const delta = await this.readTranscriptSlice(entry.transcriptPath, entry.lastObservedOffset, inspectedOffset);
    const pendingLineCount = exceededSample
      ? this.activityLineThreshold
      : entry.pendingLineCount + countCompleteLines(delta);
    const nextEntry = {
      ...entry,
      lastSize: fileStat.size,
      lastMtimeMs: fileStat.mtimeMs,
      lastObservedOffset: inspectedOffset,
      pendingLineCount,
    };
    this.entries.set(entry.sessionId, nextEntry);

    if (pendingLineCount < this.activityLineThreshold) return 'belowThreshold';
    if (this.isRateLimited(entry.sessionId)) return 'rateLimited';

    const checkpoint = this.getCheckpoint(entry.sessionId);
    const fromOffset = checkpoint?.lastOffset ?? entry.lastExtractionOffset;
    const extractionResult = await this.enqueueDelta({
      sessionId: entry.sessionId,
      transcriptPath: entry.transcriptPath,
      fromOffset,
      toOffset: fileStat.size,
      identity: entry.identity,
      trigger: 'poller',
    });
    const durableOffset = isSuccessfulExtractionResult(extractionResult) ? fileStat.size : fromOffset;
    this.entries.set(entry.sessionId, {
      ...nextEntry,
      lastExtractionOffset: durableOffset,
      pendingLineCount: 0,
    });
    return 'fired';
  }

  private isRateLimited(sessionId: string): boolean {
    const checkpoint = this.getCheckpoint(sessionId);
    if (!checkpoint) return false;
    if (checkpoint.midTurnCountInCurrentTurn >= this.maxMidTurnExtractionsPerTurn) return true;
    if (!checkpoint.lastMidTurnAt) return false;
    return this.now().getTime() - new Date(checkpoint.lastMidTurnAt).getTime() < this.minIntervalMs;
  }
}

function isSuccessfulExtractionResult(result: unknown): boolean {
  return typeof result === 'object' && result !== null && 'status' in result && result.status === 'written';
}

const defaultTranscriptPoller = new TranscriptPoller();

export function getTranscriptPoller(): TranscriptPoller {
  return defaultTranscriptPoller;
}

export function startTranscriptPoller(): void {
  defaultTranscriptPoller.start();
}

export function stopTranscriptPoller(): void {
  defaultTranscriptPoller.stop();
}

export async function syncTranscriptPollerRegistry(): Promise<void> {
  await defaultTranscriptPoller.syncActiveTranscripts();
}

export function registerTranscriptForPolling(entry: TranscriptEntry): void {
  defaultTranscriptPoller.register(entry);
}

export function unregisterTranscriptForPolling(sessionId: string): void {
  defaultTranscriptPoller.unregister(sessionId);
}

async function readTranscriptSlice(path: string, fromOffset: number, toOffset: number): Promise<string> {
  const length = Math.min(Math.max(0, toOffset - fromOffset), MAX_MEMORY_POLLER_SAMPLE_BYTES);
  if (length === 0) return '';
  const file = await open(path, 'r');
  try {
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await file.read(buffer, 0, length, fromOffset);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await file.close();
  }
}

function countCompleteLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split('\n').length - 1;
}
