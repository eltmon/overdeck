import { randomUUID } from 'crypto';
import type { MemoryObservation } from '@panctl/contracts';
import {
  extractObservationFromTurn,
  type ExtractObservationCall,
  type ExtractObservationInput,
  type ExtractObservationResult,
} from './extract.js';
import { updateMemoryHealth, type MemoryHealthUpdate } from './health.js';
import { writeObservation, type WriteObservationResult } from './observations.js';
import { extractWithProviderPolicy, type MemoryExtractionPolicyResult } from './providers/index.js';
import { extractFromTranscriptDelta, type ExtractFromTranscriptDeltaInput, type ExtractFromTranscriptDeltaResult } from './pipeline.js';
import { getMemoryWorkerConcurrency } from './settings.js';

export const DEFAULT_MEMORY_WORKER_CONCURRENCY = 4;
export const DEFAULT_MEMORY_WORKER_QUEUE_LIMIT = 500;

export interface MemoryExtractionJob extends ExtractObservationInput {
  jobId?: string;
}

export type MemoryExtractionJobResult =
  | { jobId: string; status: 'written'; observation: MemoryObservation; writeResult: WriteObservationResult }
  | { jobId: string; status: 'skipped'; reason: Extract<ExtractObservationResult, { status: 'skipped' }>['reason'] }
  | { jobId: string; status: 'dropped'; reason: Extract<ExtractObservationResult, { status: 'dropped' }>['reason'] }
  | { jobId: string; status: 'failed'; reason: 'write-failed' | 'worker-error'; error: unknown };

export interface MemoryExtractionWorkerPoolOptions {
  loadConcurrency?: () => number | Promise<number>;
  writeObservation?: (observation: MemoryObservation) => Promise<WriteObservationResult>;
  updateHealth?: (identity: MemoryExtractionJob['identity'], update: MemoryHealthUpdate) => Promise<unknown>;
  onResult?: (result: MemoryExtractionJobResult) => void | Promise<void>;
  queueLimit?: number;
}

export interface MemoryPipelineJob extends ExtractFromTranscriptDeltaInput {
  jobId?: string;
}

export type MemoryPipelineJobResult =
  | { jobId: string; status: 'completed'; result: ExtractFromTranscriptDeltaResult }
  | { jobId: string; status: 'failed'; error: unknown };

export interface MemoryPipelineWorkerPoolOptions {
  loadConcurrency?: () => number | Promise<number>;
  extractFromTranscriptDelta?: (input: ExtractFromTranscriptDeltaInput) => Promise<ExtractFromTranscriptDeltaResult>;
  onResult?: (result: MemoryPipelineJobResult) => void | Promise<void>;
  queueLimit?: number;
}

interface QueuedMemoryExtractionJob {
  jobId: string;
  job: MemoryExtractionJob;
}

interface QueuedMemoryPipelineJob {
  jobId: string;
  job: MemoryPipelineJob;
}

function normalizeQueueLimit(value: number | undefined): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : DEFAULT_MEMORY_WORKER_QUEUE_LIMIT;
}

function earliestOffset(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.min(left, right);
}

export class MemoryExtractionWorkerPool {
  private readonly queue: QueuedMemoryExtractionJob[] = [];
  private readonly loadConcurrency: () => number | Promise<number>;
  private readonly writeObservation: (observation: MemoryObservation) => Promise<WriteObservationResult>;
  private readonly updateHealth: (identity: MemoryExtractionJob['identity'], update: MemoryHealthUpdate) => Promise<unknown>;
  private readonly onResult?: (result: MemoryExtractionJobResult) => void | Promise<void>;
  private readonly queueLimit: number;
  private droppedJobs = 0;
  private active = 0;
  private pumping = false;
  private idleResolvers: Array<() => void> = [];

  constructor(options: MemoryExtractionWorkerPoolOptions = {}) {
    this.loadConcurrency = options.loadConcurrency ?? getMemoryWorkerConcurrency;
    this.writeObservation = options.writeObservation ?? writeObservation;
    this.updateHealth = options.updateHealth ?? updateMemoryHealth;
    this.onResult = options.onResult;
    this.queueLimit = normalizeQueueLimit(options.queueLimit);
  }

  enqueue(job: MemoryExtractionJob): string {
    const jobId = job.jobId ?? randomUUID();
    this.dropOldestIfFull();
    this.queue.push({ jobId, job: { ...job, jobId } });
    void this.pump();
    return jobId;
  }

  enqueueReconciliationSweep(jobs: MemoryExtractionJob[]): string[] {
    return jobs.map((job) => this.enqueue(job));
  }

  pendingCount(): number {
    return this.queue.length + this.active;
  }

  droppedCount(): number {
    return this.droppedJobs;
  }

  async waitForIdle(): Promise<void> {
    if (this.pendingCount() === 0) return;
    await new Promise<void>((resolve) => this.idleResolvers.push(resolve));
  }

  private dropOldestIfFull(): void {
    if (this.queue.length < this.queueLimit) return;
    this.queue.shift();
    this.droppedJobs += 1;
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length > 0 && this.active < await this.effectiveConcurrency()) {
        const queued = this.queue.shift();
        if (!queued) break;
        this.active += 1;
        void this.runQueuedJob(queued);
      }
    } finally {
      this.pumping = false;
      this.resolveIdleIfNeeded();
    }
  }

  private async runQueuedJob(queued: QueuedMemoryExtractionJob): Promise<void> {
    let result: MemoryExtractionJobResult;
    try {
      result = await this.processJob(queued.jobId, queued.job);
    } catch (error) {
      await this.recordHealth(queued.job.identity, { status: 'failing', reason: 'worker-error', success: false });
      result = { jobId: queued.jobId, status: 'failed', reason: 'worker-error', error };
    }

    try {
      await this.onResult?.(result);
    } catch {
      // Result observers must not feed failures back into the extraction path.
    } finally {
      this.active -= 1;
      void this.pump();
      this.resolveIdleIfNeeded();
    }
  }

  private async processJob(jobId: string, job: MemoryExtractionJob): Promise<MemoryExtractionJobResult> {
    const result = await extractObservationFromTurn({
      ...job,
      extract: job.extract ?? this.extractWithoutProviderHealth(job),
    });

    if (result.status === 'skipped') {
      await this.recordHealth(job.identity, { status: 'degraded', reason: result.reason, success: false });
      return { jobId, status: 'skipped', reason: result.reason };
    }

    if (result.status === 'dropped') {
      await this.recordHealth(job.identity, { status: 'failing', reason: result.reason, success: false });
      return { jobId, status: 'dropped', reason: result.reason };
    }

    try {
      const writeResult = await this.writeObservation(result.observation);
      await this.recordHealth(job.identity, { status: 'healthy', success: true });
      return { jobId, status: 'written', observation: result.observation, writeResult };
    } catch (error) {
      await this.recordHealth(job.identity, { status: 'failing', reason: 'write-failed', success: false });
      return { jobId, status: 'failed', reason: 'write-failed', error };
    }
  }

  private extractWithoutProviderHealth(job: MemoryExtractionJob): ExtractObservationCall {
    return (prompt, jsonSchema): Promise<MemoryExtractionPolicyResult<unknown>> => extractWithProviderPolicy(prompt, jsonSchema, {
      identity: job.identity,
      settings: job.settings,
      perDayCostCapUsd: job.perDayCostCapUsd,
    }, {
      recordHealth: async () => undefined,
    });
  }

  private async recordHealth(identity: MemoryExtractionJob['identity'], update: MemoryHealthUpdate): Promise<void> {
    try {
      await this.updateHealth(identity, update);
    } catch {
      // Health telemetry must never block or fail extraction jobs.
    }
  }

  private async effectiveConcurrency(): Promise<number> {
    const concurrency = await this.loadConcurrency();
    return Number.isInteger(concurrency) && concurrency > 0 ? concurrency : DEFAULT_MEMORY_WORKER_CONCURRENCY;
  }

  private resolveIdleIfNeeded(): void {
    if (this.pendingCount() !== 0) return;
    const resolvers = this.idleResolvers;
    this.idleResolvers = [];
    for (const resolve of resolvers) resolve();
  }
}

export class MemoryPipelineWorkerPool {
  private readonly queue: QueuedMemoryPipelineJob[] = [];
  private readonly loadConcurrency: () => number | Promise<number>;
  private readonly extractDelta: (input: ExtractFromTranscriptDeltaInput) => Promise<ExtractFromTranscriptDeltaResult>;
  private readonly onResult?: (result: MemoryPipelineJobResult) => void | Promise<void>;
  private readonly queueLimit: number;
  private droppedJobs = 0;
  private active = 0;
  private pumping = false;
  private idleResolvers: Array<() => void> = [];

  constructor(options: MemoryPipelineWorkerPoolOptions = {}) {
    this.loadConcurrency = options.loadConcurrency ?? getMemoryWorkerConcurrency;
    this.extractDelta = options.extractFromTranscriptDelta ?? extractFromTranscriptDelta;
    this.onResult = options.onResult;
    this.queueLimit = normalizeQueueLimit(options.queueLimit);
  }

  enqueue(job: MemoryPipelineJob): string {
    const jobId = job.jobId ?? randomUUID();
    const queuedJob = this.coalesceOrDrop({ ...job, jobId });
    this.queue.push({ jobId, job: queuedJob });
    void this.pump();
    return jobId;
  }

  pendingCount(): number {
    return this.queue.length + this.active;
  }

  droppedCount(): number {
    return this.droppedJobs;
  }

  async waitForIdle(): Promise<void> {
    if (this.pendingCount() === 0) return;
    await new Promise<void>((resolve) => this.idleResolvers.push(resolve));
  }

  private coalesceOrDrop(job: MemoryPipelineJob): MemoryPipelineJob {
    if (this.queue.length < this.queueLimit) return job;
    const existingIndex = this.queue.findIndex((queued) => queued.job.sessionId === job.sessionId);
    if (existingIndex !== -1) {
      const [existing] = this.queue.splice(existingIndex, 1);
      if (!existing) return job;
      return {
        ...job,
        fromOffset: earliestOffset(existing.job.fromOffset, job.fromOffset),
        toOffset: job.toOffset,
        transcriptPath: existing.job.transcriptPath,
        identity: existing.job.identity,
      };
    }
    this.queue.shift();
    this.droppedJobs += 1;
    return job;
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length > 0 && this.active < await this.effectiveConcurrency()) {
        const queued = this.queue.shift();
        if (!queued) break;
        this.active += 1;
        void this.runQueuedJob(queued);
      }
    } finally {
      this.pumping = false;
      this.resolveIdleIfNeeded();
    }
  }

  private async runQueuedJob(queued: QueuedMemoryPipelineJob): Promise<void> {
    let result: MemoryPipelineJobResult;
    try {
      result = { jobId: queued.jobId, status: 'completed', result: await this.extractDelta(queued.job) };
    } catch (error) {
      result = { jobId: queued.jobId, status: 'failed', error };
    }

    try {
      await this.onResult?.(result);
    } catch {
      // Result observers must not feed failures back into the extraction path.
    } finally {
      this.active -= 1;
      void this.pump();
      this.resolveIdleIfNeeded();
    }
  }

  private async effectiveConcurrency(): Promise<number> {
    const concurrency = await this.loadConcurrency();
    return Number.isInteger(concurrency) && concurrency > 0 ? concurrency : DEFAULT_MEMORY_WORKER_CONCURRENCY;
  }

  private resolveIdleIfNeeded(): void {
    if (this.pendingCount() !== 0) return;
    const resolvers = this.idleResolvers;
    this.idleResolvers = [];
    for (const resolve of resolvers) resolve();
  }
}

const defaultMemoryExtractionWorkerPool = new MemoryExtractionWorkerPool();
const defaultMemoryPipelineWorkerPool = new MemoryPipelineWorkerPool();

export function getMemoryExtractionWorkerPool(): MemoryExtractionWorkerPool {
  return defaultMemoryExtractionWorkerPool;
}

export function getMemoryPipelineWorkerPool(): MemoryPipelineWorkerPool {
  return defaultMemoryPipelineWorkerPool;
}

export function enqueueMemoryExtractionJob(job: MemoryExtractionJob): string {
  return defaultMemoryExtractionWorkerPool.enqueue(job);
}

export function enqueueMemoryPipelineJob(job: MemoryPipelineJob): string {
  return defaultMemoryPipelineWorkerPool.enqueue(job);
}

export function enqueueReconciledMemoryExtractionJobs(jobs: MemoryExtractionJob[]): string[] {
  return defaultMemoryExtractionWorkerPool.enqueueReconciliationSweep(jobs);
}
