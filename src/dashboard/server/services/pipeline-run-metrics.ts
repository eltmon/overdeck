import { getSharedDb, initEventStore, type DbAdapter, type StoredEvent } from '../event-store.js';

export type PipelineRunOutcome = 'merged' | 'parked' | 'cancelled' | 'in_flight';

export interface PipelineRunMetrics {
  plan: number | null;
  work: number | null;
  review: number;
  test: number;
  ship: number | null;
  mergeMs: number | null;
  outcome: PipelineRunOutcome;
  interventionCount: number;
  passCount: number;
  headSha?: string;
}

interface EventRow {
  sequence: number;
  type: string;
  timestamp: string;
  payload: string;
}

export interface PipelineRunMetricsReader {
  derivePipelineRunMetrics(issueId: string): PipelineRunMetrics;
}

export interface VerificationAttemptMetrics {
  issueId: string;
  stage: 'review' | 'test';
  passed: boolean;
  headSha?: string;
  substrateAttributable?: boolean;
}

export interface PipelineRunStatsSample {
  issueId: string;
  metrics: PipelineRunMetrics;
  beadsCount?: number;
  planItemsCount?: number;
}

export interface PipelineRunStatsInputs {
  completedPipelineRuns: number;
  pipelineRuns: PipelineRunStatsSample[];
  verificationAttempts: VerificationAttemptMetrics[];
}

const relevantEventTypes = [
  'agent.created',
  'agent.completed',
  'pipeline.review-started',
  'pipeline.review-completed',
  'pipeline.test-started',
  'pipeline.test-completed',
  'operator.intervention',
  'issue.closed',
  'issue.statusChanged',
  'issue.status_changed',
  'plan.item_status_changed',
  'plan.subitem_status_changed',
] as const;

const eventTypePlaceholders = relevantEventTypes.map(() => '?').join(', ');

function rowToStoredEvent(row: EventRow): StoredEvent {
  return {
    sequence: row.sequence,
    type: row.type,
    timestamp: row.timestamp,
    payload: JSON.parse(row.payload),
  };
}

function payloadOf(event: StoredEvent): Record<string, unknown> {
  return (event.payload ?? {}) as Record<string, unknown>;
}

function roleOf(event: StoredEvent): string | undefined {
  const payload = payloadOf(event);
  const agent = payload['agent'] as Record<string, unknown> | undefined;
  return typeof payload['role'] === 'string'
    ? payload['role']
    : typeof agent?.['role'] === 'string'
      ? agent['role']
      : undefined;
}

function timeOf(event: StoredEvent): number | null {
  const time = Date.parse(event.timestamp);
  return Number.isFinite(time) ? time : null;
}

function durationBetween(start: StoredEvent | undefined, end: StoredEvent | undefined): number | null {
  if (!start || !end) return null;
  const startMs = timeOf(start);
  const endMs = timeOf(end);
  if (startMs === null || endMs === null || endMs < startMs) return null;
  return endMs - startMs;
}

function completedPassed(event: StoredEvent): boolean | null {
  const passed = payloadOf(event)['passed'];
  return typeof passed === 'boolean' ? passed : null;
}

function addCycleDuration(starts: StoredEvent[], completed: StoredEvent): number {
  const started = starts.shift();
  return durationBetween(started, completed) ?? 0;
}

function terminalOutcome(event: StoredEvent): PipelineRunOutcome | null {
  if (event.type === 'issue.closed') return 'merged';

  if (event.type !== 'issue.statusChanged' && event.type !== 'issue.status_changed') return null;

  const payload = payloadOf(event);
  const rawStatus = typeof payload['canonicalStatus'] === 'string'
    ? payload['canonicalStatus']
    : typeof payload['status'] === 'string'
      ? payload['status']
      : '';
  const status = rawStatus.toLowerCase().replace(/[ -]/g, '_');

  if (status === 'parked') return 'parked';
  if (status === 'cancelled' || status === 'canceled') return 'cancelled';
  if (status === 'merged' || status === 'closed' || status === 'done' || status === 'verifying_on_main') return 'merged';
  return null;
}

function isMergeCompleteEvent(event: StoredEvent): boolean {
  return terminalOutcome(event) === 'merged';
}

function headShaOf(event: StoredEvent): string | undefined {
  const payload = payloadOf(event);
  if (typeof payload['headSha'] === 'string') return payload['headSha'];
  if (typeof payload['head_sha'] === 'string') return payload['head_sha'];
  if (typeof payload['commitSha'] === 'string') return payload['commitSha'];
  return undefined;
}

function issueIdOf(event: StoredEvent): string | null {
  const issueId = payloadOf(event)['issueId'];
  return typeof issueId === 'string' ? issueId : null;
}

function timestampInWindow(event: StoredEvent, since: string, until: string): boolean {
  return event.timestamp >= since && event.timestamp <= until;
}

function optionalBoolean(payload: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'boolean') return value;
  }
  return undefined;
}

function verificationAttemptFromEvent(event: StoredEvent): VerificationAttemptMetrics | null {
  if (event.type !== 'pipeline.review-completed' && event.type !== 'pipeline.test-completed') return null;
  const issueId = issueIdOf(event);
  if (!issueId) return null;
  const payload = payloadOf(event);
  const passed = payload['passed'];
  if (typeof passed !== 'boolean') return null;
  const attempt: VerificationAttemptMetrics = {
    issueId,
    stage: event.type === 'pipeline.review-completed' ? 'review' : 'test',
    passed,
  };
  const headSha = headShaOf(event);
  if (headSha) attempt.headSha = headSha;
  const substrateAttributable = optionalBoolean(payload, 'substrateAttributable', 'substrate_attributable');
  if (substrateAttributable !== undefined) attempt.substrateAttributable = substrateAttributable;
  return attempt;
}

function countPlanItems(events: StoredEvent[], issueId: string): number | undefined {
  const ids = new Set<string>();
  for (const event of events) {
    if (issueIdOf(event) !== issueId) continue;
    const payload = payloadOf(event);
    if (typeof payload['itemId'] === 'string') ids.add(payload['itemId']);
  }
  return ids.size > 0 ? ids.size : undefined;
}

export function derivePipelineRunMetricsFromEvents(events: StoredEvent[], issueId: string): PipelineRunMetrics {
  let planStarted: StoredEvent | undefined;
  let planCompleted: StoredEvent | undefined;
  let workStarted: StoredEvent | undefined;
  let firstReviewStarted: StoredEvent | undefined;
  let reviewMs = 0;
  let testMs = 0;
  let passCount = 0;
  let interventionCount = 0;
  let lastPassingVerification: StoredEvent | undefined;
  let mergeComplete: StoredEvent | undefined;
  let outcome: PipelineRunOutcome = 'in_flight';
  let headSha: string | undefined;

  const reviewStarts: StoredEvent[] = [];
  const testStarts: StoredEvent[] = [];

  for (const event of events) {
    const payload = payloadOf(event);
    if (payload['issueId'] !== issueId) continue;

    headSha = headSha ?? headShaOf(event);

    if (event.type === 'agent.created') {
      const role = roleOf(event);
      if (role === 'plan') planStarted = planStarted ?? event;
      if (role === 'work') workStarted = workStarted ?? event;
      continue;
    }

    if (event.type === 'agent.completed' && roleOf(event) === 'plan') {
      planCompleted = planCompleted ?? event;
      continue;
    }

    if (event.type === 'pipeline.review-started') {
      firstReviewStarted = firstReviewStarted ?? event;
      reviewStarts.push(event);
      continue;
    }

    if (event.type === 'pipeline.review-completed') {
      reviewMs += addCycleDuration(reviewStarts, event);
      const passed = completedPassed(event);
      if (passed === false) passCount += 1;
      if (passed === true) lastPassingVerification = event;
      continue;
    }

    if (event.type === 'pipeline.test-started') {
      testStarts.push(event);
      continue;
    }

    if (event.type === 'pipeline.test-completed') {
      testMs += addCycleDuration(testStarts, event);
      const passed = completedPassed(event);
      if (passed === false) passCount += 1;
      if (passed === true) lastPassingVerification = event;
      continue;
    }

    if (event.type === 'operator.intervention') {
      interventionCount += 1;
      continue;
    }

    const terminal = terminalOutcome(event);
    if (terminal) {
      outcome = terminal;
      if (!mergeComplete && isMergeCompleteEvent(event)) mergeComplete = event;
    }
  }

  const ship = durationBetween(lastPassingVerification, mergeComplete);
  const mergeMs = durationBetween(planStarted, mergeComplete);
  const metrics: PipelineRunMetrics = {
    plan: durationBetween(planStarted, planCompleted),
    work: durationBetween(workStarted, firstReviewStarted),
    review: reviewMs,
    test: testMs,
    ship,
    mergeMs,
    outcome,
    interventionCount,
    passCount,
  };

  if (headSha) metrics.headSha = headSha;
  return metrics;
}

export function derivePipelineRunStatsInputsFromEvents(events: StoredEvent[], since: string, until: string): PipelineRunStatsInputs {
  const completedIssueIds = new Set<string>();
  for (const event of events) {
    const issueId = issueIdOf(event);
    if (!issueId || !timestampInWindow(event, since, until)) continue;
    if (terminalOutcome(event)) completedIssueIds.add(issueId);
  }

  const pipelineRuns = [...completedIssueIds].sort().map((issueId) => {
    const sample: PipelineRunStatsSample = {
      issueId,
      metrics: derivePipelineRunMetricsFromEvents(events, issueId),
    };
    const planItemsCount = countPlanItems(events, issueId);
    if (planItemsCount !== undefined) sample.planItemsCount = planItemsCount;
    return sample;
  });

  return {
    completedPipelineRuns: pipelineRuns.length,
    pipelineRuns,
    verificationAttempts: events
      .filter((event) => timestampInWindow(event, since, until))
      .flatMap((event) => {
        const attempt = verificationAttemptFromEvent(event);
        return attempt ? [attempt] : [];
      }),
  };
}

export function createPipelineRunMetricsReader(db: DbAdapter): PipelineRunMetricsReader {
  const eventsForIssueStmt = db.prepare<EventRow>(
    `SELECT sequence, type, timestamp, payload
     FROM events
     WHERE type IN (${eventTypePlaceholders})
       AND json_extract(payload, '$.issueId') = ?
     ORDER BY sequence ASC`,
  );

  return {
    derivePipelineRunMetrics(issueId: string): PipelineRunMetrics {
      const rows = eventsForIssueStmt.all([...relevantEventTypes, issueId]);
      return derivePipelineRunMetricsFromEvents(rows.map(rowToStoredEvent), issueId);
    },
  };
}

export function createPipelineRunStatsInputsReader(db: DbAdapter) {
  const eventsUntilStmt = db.prepare<EventRow>(
    `SELECT sequence, type, timestamp, payload
     FROM events
     WHERE type IN (${eventTypePlaceholders})
       AND timestamp <= ?
     ORDER BY sequence ASC`,
  );

  return {
    derivePipelineRunStatsInputs(since: string, until: string): PipelineRunStatsInputs {
      const rows = eventsUntilStmt.all([...relevantEventTypes, until]);
      return derivePipelineRunStatsInputsFromEvents(rows.map(rowToStoredEvent), since, until);
    },
  };
}

export async function derivePipelineRunMetrics(issueId: string): Promise<PipelineRunMetrics> {
  await initEventStore();
  return createPipelineRunMetricsReader(getSharedDb()).derivePipelineRunMetrics(issueId);
}

export async function derivePipelineRunStatsInputs(since: string, until: string): Promise<PipelineRunStatsInputs> {
  await initEventStore();
  return createPipelineRunStatsInputsReader(getSharedDb()).derivePipelineRunStatsInputs(since, until);
}
