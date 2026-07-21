import { Effect } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import type { StoredEvent } from '../../event-store.js';
import { jsonResponse } from '../../http-helpers.js';
import { EventStoreService } from '../../services/domain-services.js';
import { httpHandler } from '../http-handler.js';

const WINDOW_MS = 24 * 60 * 60 * 1000;
const BUCKET_MS = 5 * 60 * 1000;
const MAX_POINTS = 288;
const MAX_ACTIVITY_EVENTS = 1000;

export interface ResourceHistorySample {
  timestamp?: string;
  cpuPercent: number;
  memoryPercent: number;
}

export interface ResourceHistoryPoint {
  ts: string;
  value: number;
}

export interface ResourceHistoryAnnotation {
  ts: string;
  label: string;
  targetKind: string;
  targetId: string;
}

export interface ResourceHistoryResponse {
  startedAt: string;
  cpu: ResourceHistoryPoint[];
  mem: ResourceHistoryPoint[];
  annotations: ResourceHistoryAnnotation[];
}

interface StoredSample {
  ts: number;
  cpuPercent: number;
  memoryPercent: number;
}

const samples: StoredSample[] = [];

function nowMs(): number {
  return Date.now();
}

function pruneSamples(now = nowMs()): void {
  const cutoff = now - WINDOW_MS;
  while (samples.length > 0 && samples[0]!.ts < cutoff) {
    samples.shift();
  }
}

export function resetResourceHistorySamples(): void {
  samples.length = 0;
}

export function recordResourceHistorySample(sample: ResourceHistorySample): void {
  const ts = sample.timestamp ? new Date(sample.timestamp).getTime() : nowMs();
  if (!Number.isFinite(ts)) return;

  samples.push({
    ts,
    cpuPercent: sample.cpuPercent,
    memoryPercent: sample.memoryPercent,
  });
  samples.sort((a, b) => a.ts - b.ts);
  pruneSamples(ts);
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function downsample(metric: 'cpuPercent' | 'memoryPercent'): ResourceHistoryPoint[] {
  pruneSamples();
  const buckets = new Map<number, number[]>();

  for (const sample of samples) {
    const bucket = Math.floor(sample.ts / BUCKET_MS) * BUCKET_MS;
    const values = buckets.get(bucket) ?? [];
    values.push(sample[metric]);
    buckets.set(bucket, values);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .slice(-MAX_POINTS)
    .map(([bucket, values]) => ({
      ts: new Date(bucket).toISOString(),
      value: Number(average(values).toFixed(2)),
    }));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function resourceAnnotationFromEvent(event: StoredEvent, now = nowMs()): ResourceHistoryAnnotation | null {
  const eventTs = new Date(event.timestamp).getTime();
  if (!Number.isFinite(eventTs) || eventTs <= now - WINDOW_MS || eventTs > now) return null;

  const payload = asRecord(event.payload);
  const details = asRecord(payload?.['details']);
  if (details?.['category'] !== 'resources') return null;

  const targetKind = details['targetKind'];
  const targetId = details['targetId'];
  if (typeof targetKind !== 'string' || typeof targetId !== 'string') return null;

  const message = payload?.['message'];
  return {
    ts: event.timestamp,
    label: typeof message === 'string' ? message : event.type,
    targetKind,
    targetId,
  };
}

export function buildResourceHistoryResponse(
  activityEvents: StoredEvent[],
  now = nowMs(),
): ResourceHistoryResponse {
  pruneSamples(now);
  const startedAt = samples[0]?.ts ?? now;

  return {
    startedAt: new Date(startedAt).toISOString(),
    cpu: downsample('cpuPercent'),
    mem: downsample('memoryPercent'),
    annotations: activityEvents
      .map((event) => resourceAnnotationFromEvent(event, now))
      .filter((annotation): annotation is ResourceHistoryAnnotation => Boolean(annotation)),
  };
}

export function getResourceHistoryEffect(): Effect.Effect<ReturnType<typeof jsonResponse>, never, EventStoreService> {
  return Effect.gen(function* () {
    const eventStore = yield* EventStoreService;
    const events = yield* eventStore.queryByType('activity.entry', MAX_ACTIVITY_EVENTS);
    return jsonResponse(buildResourceHistoryResponse(events));
  });
}

export const getResourceHistoryRoute = HttpRouter.add(
  'GET',
  '/api/resources/history/24h',
  httpHandler(getResourceHistoryEffect()),
);
