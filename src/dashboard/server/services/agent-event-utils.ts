/**
 * Agent event utilities — shared between HTTP route handlers and background
 * pollers (PAN-1134). Extracted from routes/agents.ts so Pi event polling
 * can reuse bodyToEvent without importing a heavy route module.
 */

import { Schema } from 'effect';
import {
  DomainEvent,
  normalizeChannelReplyPayload,
} from '@panctl/contracts';

/**
 * Translate a decoded body into an unsigned DomainEvent (no sequence yet).
 * Returns null if the body doesn't map to a runtime event.
 */
export const bodyToEvent = (
  agentId: string,
  body: Record<string, unknown>,
  timestamp: string,
): Record<string, unknown> | null => {
  const source = body;
  if (typeof source['kind'] !== 'string') return null;
  const kind = source['kind'] as string;
  switch (kind) {
    case 'activity':
      return {
        type: 'agent.activity_changed',
        timestamp,
        payload: {
          agentId,
          activity: source['activity'],
          currentTool: source['tool'] as string | undefined,
        },
      };
    case 'thinking_start':
      return {
        type: 'agent.thinking_started',
        timestamp,
        payload: {
          agentId,
          lastToolAt: (source['lastToolAt'] as string) ?? timestamp,
        },
      };
    case 'thinking_stop':
      return {
        type: 'agent.thinking_stopped',
        timestamp,
        payload: {
          agentId,
          resolvedBy: source['resolvedBy'] ?? 'tool',
        },
      };
    case 'waiting_start':
      return {
        type: 'agent.waiting_started',
        timestamp,
        payload: {
          agentId,
          reason: source['reason'] ?? 'other',
          message: source['message'] as string | undefined,
        },
      };
    case 'waiting_clear':
      return {
        type: 'agent.waiting_cleared',
        timestamp,
        payload: {
          agentId,
          clearedBy: source['clearedBy'] ?? 'user_response',
        },
      };
    case 'message_received':
      return {
        type: 'agent.message_received',
        timestamp,
        payload: {
          agentId,
          direction: source['direction'] ?? 'to_agent',
          source: source['source'] ?? 'user',
        },
      };
    case 'channel_reply': {
      const reply = normalizeChannelReplyPayload(source['reply'], 'reply');
      return {
        type: 'agent.channel_reply',
        timestamp,
        payload: {
          agentId,
          reply: {
            ...reply,
            reportedAt: timestamp,
          },
        },
      };
    }
    case 'model_set':
      return {
        type: 'agent.model_set',
        timestamp,
        payload: {
          agentId,
          model: source['model'],
          claudeSessionId: source['claudeSessionId'] as string | undefined,
          sessionModel: source['sessionModel'] as string | undefined,
          sessionHarness: source['sessionHarness'] as string | undefined,
        },
      };
    case 'cost-event': {
      const usage = source['usage'] && typeof source['usage'] === 'object'
        ? source['usage'] as Record<string, unknown>
        : {};
      return {
        type: 'cost.event_recorded',
        timestamp,
        payload: {
          agentId,
          issueId: typeof source['issueId'] === 'string' && source['issueId'] ? source['issueId'] : 'UNKNOWN-0',
          cost: typeof source['costUsd'] === 'number' ? source['costUsd'] : 0,
          inputTokens: typeof usage['inputTokens'] === 'number' ? usage['inputTokens'] : 0,
          outputTokens: typeof usage['outputTokens'] === 'number' ? usage['outputTokens'] : 0,
        },
      };
    }
    case 'resolution_set':
      return {
        type: 'agent.resolution_changed',
        timestamp,
        payload: {
          agentId,
          resolution: source['resolution'],
          resolutionCount: Number(source['resolutionCount'] ?? 1),
        },
      };
    case 'current_issue_set':
      return {
        type: 'agent.current_issue_set',
        timestamp,
        payload: {
          agentId,
          currentIssue: source['currentIssue'] as string | undefined,
        },
      };
    case 'context_saturation_changed':
      return {
        type: 'agent.context_saturation_changed',
        timestamp,
        payload: {
          agentId,
          contextSaturatedAt: source['contextSaturatedAt'] as string | undefined,
        },
      };
    default:
      return null;
  }
};

// Runtime-event decoder. We validate the assembled event (with a placeholder
// sequence) against the DomainEvent union — bad payloads are rejected rather
// than silently corrupting the AgentRuntimeSnapshot.
export const decodeDomainEvent = Schema.decodeUnknownResult(DomainEvent);
