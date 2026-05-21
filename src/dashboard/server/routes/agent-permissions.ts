import type { ChannelPermissionRequestSnapshot, ResolvedChannelPermissionDecision as ContractsResolvedChannelPermissionDecision } from '@panctl/contracts';
import { Effect } from 'effect';
import * as Result from 'effect/Result';

import {
  normalizeChannelPermissionRequestFields,
  type NormalizedChannelPermissionRequestFields,
} from '../../../lib/channels/permission-payload.js';

const MAX_ACTIVITY_PREVIEW_CHARS = 2048;

export type ResolvedChannelPermissionDecision = ContractsResolvedChannelPermissionDecision;

export function buildPermissionWaitingMessage(toolName: string, description: string): string {
  return `Waiting for permission: ${toolName} — ${description}`;
}

export function permissionResolutionVerb(behavior: 'allow' | 'deny'): 'allowed' | 'denied' {
  return behavior === 'allow' ? 'allowed' : 'denied';
}

export function normalizePermissionRequestBody(body: Record<string, unknown>):
  | { ok: true; value: NormalizedChannelPermissionRequestFields }
  | { ok: false; error: string } {
  const result = Effect.runSync(
    Effect.result(
      normalizeChannelPermissionRequestFields({
        requestId: body['requestId'],
        toolName: body['toolName'],
        description: body['description'],
        inputPreview: body['inputPreview'],
      }),
    ),
  );
  if (Result.isFailure(result)) {
    return { ok: false, error: result.failure.message };
  }
  return { ok: true, value: result.success };
}

export function parsePermissionResponseBehavior(body: Record<string, unknown>):
  | { ok: true; value: 'allow' | 'deny' }
  | { ok: false; error: string } {
  const behavior = body['behavior'];
  if (behavior !== 'allow' && behavior !== 'deny') {
    return { ok: false, error: 'behavior must be allow or deny' };
  }
  return { ok: true, value: behavior };
}

export function redactPermissionInputPreview(inputPreview: string): string {
  let redacted = inputPreview;
  redacted = redacted.replace(
    /(((?:["']?(?:api[_-]?key|token|secret|password|passwd)["']?)\s*[:=]\s*["']?))([^\s,'"`]+)(["']?)/gi,
    (_match, prefix: string, _quotedPrefix: string, _value: string, suffix: string) => `${prefix}[REDACTED]${suffix}`,
  );
  redacted = redacted.replace(
    /(Bearer\s+)([A-Za-z0-9._~+/=-]+)/g,
    (_match, prefix: string) => `${prefix}[REDACTED]`,
  );
  redacted = redacted.replace(
    /(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]+/g,
    '[REDACTED]',
  );
  redacted = redacted.replace(
    /(?:sk|rk)-[A-Za-z0-9]+/g,
    '[REDACTED]',
  );
  if (redacted.length <= MAX_ACTIVITY_PREVIEW_CHARS) {
    return redacted;
  }
  return `${redacted.slice(0, MAX_ACTIVITY_PREVIEW_CHARS)}…[truncated]`;
}

export function buildPermissionActivityDetails(description: string, inputPreview: string): string {
  const safePreview = redactPermissionInputPreview(inputPreview);
  return safePreview.trim().length > 0
    ? `${description}\n\nInput preview:\n${safePreview}`
    : description;
}

export interface ProcessPermissionResponseDeps {
  getPendingRequest: (requestId: string) => Promise<ChannelPermissionRequestSnapshot | null>;
  getResolvedDecision: (requestId: string) => Promise<ResolvedChannelPermissionDecision | null>;
  appendResolutionEvents: (
    request: ChannelPermissionRequestSnapshot,
    behavior: 'allow' | 'deny',
  ) => Promise<void>;
  deliverDecision: (
    agentId: string,
    requestId: string,
    behavior: 'allow' | 'deny',
  ) => Promise<void>;
  emitResolvedActivity: (request: ChannelPermissionRequestSnapshot, behavior: 'allow' | 'deny') => void;
}

export interface ProcessPermissionResponseResult {
  status: number;
  body: { ok: boolean; error?: string; duplicate?: boolean };
}

export async function processPermissionResponse(
  deps: ProcessPermissionResponseDeps,
  args: {
    agentId: string;
    requestId: string;
    behavior: 'allow' | 'deny';
  },
): Promise<ProcessPermissionResponseResult> {
  const pendingRequest = await deps.getPendingRequest(args.requestId);
  if (pendingRequest) {
    if (pendingRequest.agentId !== args.agentId) {
      return {
        status: 409,
        body: {
          ok: false,
          error: `permission request ${args.requestId} belongs to ${pendingRequest.agentId}`,
        },
      };
    }

    try {
      await deps.appendResolutionEvents(pendingRequest, args.behavior);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        status: 500,
        body: { ok: false, error: `failed to persist permission decision: ${msg}` },
      };
    }

    try {
      await deps.deliverDecision(args.agentId, args.requestId, args.behavior);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        status: 502,
        body: { ok: false, error: `failed to deliver permission decision: ${msg}` },
      };
    }

    deps.emitResolvedActivity(pendingRequest, args.behavior);
    return { status: 200, body: { ok: true } };
  }

  const resolvedDecision = await deps.getResolvedDecision(args.requestId);
  if (!resolvedDecision) {
    return {
      status: 404,
      body: { ok: false, error: `permission request ${args.requestId} not found` },
    };
  }
  if (resolvedDecision.agentId !== args.agentId) {
    return {
      status: 409,
      body: {
        ok: false,
        error: `permission request ${args.requestId} belongs to ${resolvedDecision.agentId}`,
      },
    };
  }
  if (resolvedDecision.behavior !== args.behavior) {
    return {
      status: 409,
      body: {
        ok: false,
        error: `permission request ${args.requestId} was already ${resolvedDecision.behavior}`,
      },
    };
  }

  try {
    await deps.deliverDecision(args.agentId, args.requestId, args.behavior);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      status: 502,
      body: { ok: false, error: `failed to deliver permission decision: ${msg}` },
    };
  }

  return { status: 200, body: { ok: true, duplicate: true } };
}
