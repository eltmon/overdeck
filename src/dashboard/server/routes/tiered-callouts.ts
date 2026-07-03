import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { deliverAgentMessage, type DeliveryResult } from '../../../lib/agents.js';
import { getIssueWorkspacePath } from '../../../lib/pan-dir/record.js';
import { readWorkspacePlanSync } from '../../../lib/vbrief/io.js';
import type { VBriefItem } from '../../../lib/vbrief/types.js';
import { loadConfigSync } from '../../../lib/config-yaml.js';
import { getReviewStatusSync, setReviewStatusSync } from '../../../lib/review-status.js';
import { emitActivityEntrySync, emitActivityTtsSync } from '../../../lib/activity-logger.js';
import {
  deliverCommitForReview,
  supervisorAgentId,
  type DeliverCommitForReviewOptions,
} from '../../../lib/agents/tier-supervisor.js';
import {
  resolveTieredExecutionEnabled,
  type ValidatedTieredExecutionConfig,
} from '../../../lib/agents/tier-table.js';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';

export type FeedCalloutPolicy = 'off' | 'notify' | 'corroborate';

export interface TieredCalloutBody {
  issueId: string;
  sha: string;
  beadId?: string;
  tierName: string;
  agentId: string;
  claim: string;
}

export interface TieredCalloutConfig extends Pick<ValidatedTieredExecutionConfig, 'enabled'> {
  feed?: {
    callouts?: FeedCalloutPolicy;
  };
}

export interface TieredCalloutDeps {
  loadConfig?: (issueId: string) => TieredCalloutConfig | undefined;
  loadPlanMetadata?: (issueId: string) => Record<string, unknown> | undefined;
  getWorkspacePath?: (issueId: string) => string | null;
  getItem?: (issueId: string, beadId: string) => VBriefItem | undefined;
  recordCallout?: (callout: TieredCalloutBody) => void | Promise<void>;
  surfaceCallout?: (callout: TieredCalloutBody) => Promise<unknown>;
  deliverSupervisorReview?: (options: DeliverCommitForReviewOptions) => Promise<DeliveryResult>;
}

export type TieredCalloutResponse =
  | { status: 200; body: { ok: true; policy: FeedCalloutPolicy; supervisorDeliveries: number } }
  | { status: 400 | 404 | 409; body: { error: string } };

function parseCalloutBody(body: unknown): TieredCalloutBody | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const record = body as Record<string, unknown>;
  const issueId = typeof record.issueId === 'string' ? record.issueId.trim().toUpperCase() : '';
  const sha = typeof record.sha === 'string' ? record.sha.trim() : '';
  const tierName = typeof record.tierName === 'string' ? record.tierName.trim() : '';
  const agentId = typeof record.agentId === 'string' ? record.agentId.trim() : '';
  const claim = typeof record.claim === 'string' ? record.claim.trim() : '';
  const beadId = typeof record.beadId === 'string' && record.beadId.trim().length > 0
    ? record.beadId.trim()
    : undefined;
  if (!issueId || !sha || !tierName || !agentId || !claim) return undefined;
  return { issueId, sha, beadId, tierName, agentId, claim };
}

function calloutPolicy(config: TieredCalloutConfig): FeedCalloutPolicy {
  const policy = config.feed?.callouts;
  return policy === 'notify' || policy === 'corroborate' ? policy : 'off';
}

function defaultWorkspacePath(issueId: string): string | null {
  return getIssueWorkspacePath(issueId);
}

function defaultPlanMetadata(issueId: string): Record<string, unknown> | undefined {
  const workspacePath = defaultWorkspacePath(issueId);
  if (!workspacePath) return undefined;
  return readWorkspacePlanSync(workspacePath)?.plan.metadata;
}

function defaultItem(issueId: string, beadId: string): VBriefItem | undefined {
  const workspacePath = defaultWorkspacePath(issueId);
  if (!workspacePath) return undefined;
  return readWorkspacePlanSync(workspacePath)?.plan.items.find((item) => item.id === beadId);
}

function defaultRecordCallout(callout: TieredCalloutBody): void {
  const summary = `Tier ${callout.tierName} call-out on ${callout.issueId} ${callout.sha.slice(0, 8)}: ${callout.claim}`;
  emitActivityEntrySync({
    source: 'supervisor',
    level: 'warn',
    issueId: callout.issueId,
    message: summary,
    details: JSON.stringify(callout),
  });
  emitActivityTtsSync({
    utterance: `${callout.issueId} tier call-out from ${callout.tierName}`,
    priority: 1,
    issueId: callout.issueId,
    source: 'supervisor',
    eventType: 'tiered.callout',
  });

  const existing = getReviewStatusSync(callout.issueId);
  setReviewStatusSync(callout.issueId, {
    inspectNotes: [
      existing?.inspectNotes,
      summary,
    ].filter(Boolean).join('\n'),
  });
}

function defaultSurfaceCallout(callout: TieredCalloutBody): Promise<unknown> {
  return deliverAgentMessage(
    callout.agentId,
    `Tiered execution call-out recorded for ${callout.issueId} ${callout.sha}: ${callout.claim}`,
    'tiered-callout',
  );
}

function defaultConfig(): TieredCalloutConfig {
  return loadConfigSync().config.tieredExecution as TieredCalloutConfig;
}

export async function handleTieredCallout(
  rawBody: unknown,
  deps: TieredCalloutDeps = {},
): Promise<TieredCalloutResponse> {
  const callout = parseCalloutBody(rawBody);
  if (!callout) return { status: 400, body: { error: 'malformed tiered callout body' } };

  const config = deps.loadConfig?.(callout.issueId) ?? defaultConfig();
  const planMetadata = deps.loadPlanMetadata?.(callout.issueId) ?? defaultPlanMetadata(callout.issueId);
  if (!resolveTieredExecutionEnabled(config, planMetadata)) {
    return { status: 404, body: { error: 'tiered execution is not enabled for this issue' } };
  }

  const policy = calloutPolicy(config);
  if (policy === 'off') {
    return { status: 409, body: { error: 'tiered callouts are disabled for this issue' } };
  }

  let supervisorReview: DeliverCommitForReviewOptions | undefined;
  if (policy === 'corroborate') {
    if (!callout.beadId) return { status: 400, body: { error: 'beadId is required for corroborate callouts' } };
    const workspacePath = deps.getWorkspacePath?.(callout.issueId) ?? defaultWorkspacePath(callout.issueId);
    const item = deps.getItem?.(callout.issueId, callout.beadId) ?? defaultItem(callout.issueId, callout.beadId);
    if (!workspacePath || !item) {
      return { status: 409, body: { error: 'unable to resolve supervisor review context' } };
    }
    supervisorReview = {
      supervisorAgentId: supervisorAgentId(callout.issueId),
      workspacePath,
      issueId: callout.issueId,
      item,
      sha: callout.sha,
      beadId: callout.beadId,
    };
  }

  if (deps.recordCallout) {
    await deps.recordCallout(callout);
  } else {
    defaultRecordCallout(callout);
  }
  await (deps.surfaceCallout ?? defaultSurfaceCallout)(callout);

  let supervisorDeliveries = 0;
  if (supervisorReview) {
    const deliver = deps.deliverSupervisorReview ?? deliverCommitForReview;
    await deliver(supervisorReview);
    supervisorDeliveries = 1;
  }

  return { status: 200, body: { ok: true, policy, supervisorDeliveries } };
}

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return undefined;
  }
});

const postTieredCalloutsRoute = HttpRouter.add(
  'POST',
  '/api/tiered/callouts',
  httpHandler(Effect.gen(function* () {
    const body = yield* readJsonBody;
    const result = yield* Effect.promise(() => handleTieredCallout(body));
    return jsonResponse(result.body, { status: result.status });
  })),
);

export const tieredCalloutsRouteLayer = Layer.mergeAll(postTieredCalloutsRoute);
