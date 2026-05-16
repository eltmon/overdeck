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
        },
      };
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
    default:
      return null;
  }
};

// Runtime-event decoder. We validate the assembled event (with a placeholder
// sequence) against the DomainEvent union — bad payloads are rejected rather
// than silently corrupting the AgentRuntimeSnapshot.
export const decodeDomainEvent = Schema.decodeUnknownResult(DomainEvent);
