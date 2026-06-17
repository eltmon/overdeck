import { describe, it, expect } from 'vitest';
import { bodyToEvent, decodeDomainEvent } from '../agent-event-utils.js';

describe('bodyToEvent', () => {
  describe('kind=cost-event', () => {
    it('maps a pi cost-event body to a cost.event_recorded domain event', () => {
      const event = bodyToEvent('agent-pan-1935', {
        kind: 'cost-event',
        issueId: 'PAN-1935',
        costUsd: 0.0042,
        model: 'kimi-k2.7-code',
        agentRole: 'work',
        usage: {
          inputTokens: 1000,
          outputTokens: 250,
          cacheReadTokens: 50,
          cacheWriteTokens: 25,
        },
      }, '2026-06-16T12:00:00.000Z');

      expect(event).toEqual({
        type: 'cost.event_recorded',
        timestamp: '2026-06-16T12:00:00.000Z',
        payload: {
          agentId: 'agent-pan-1935',
          issueId: 'PAN-1935',
          cost: 0.0042,
          inputTokens: 1000,
          outputTokens: 250,
          cacheReadTokens: 50,
          cacheWriteTokens: 25,
          model: 'kimi-k2.7-code',
          sessionType: 'work',
        },
      });
    });

    it('uses UNKNOWN-0 when issueId is missing and omits optional fields when absent', () => {
      const event = bodyToEvent('agent-pan-1935', {
        kind: 'cost-event',
        costUsd: 0.001,
      }, '2026-06-16T12:00:00.000Z');

      expect(event).toEqual({
        type: 'cost.event_recorded',
        timestamp: '2026-06-16T12:00:00.000Z',
        payload: {
          agentId: 'agent-pan-1935',
          issueId: 'UNKNOWN-0',
          cost: 0.001,
          inputTokens: 0,
          outputTokens: 0,
        },
      });
    });

    it('falls back to cost when costUsd is not present', () => {
      const event = bodyToEvent('agent-pan-1935', {
        kind: 'cost-event',
        cost: 0.0033,
      }, '2026-06-16T12:00:00.000Z');

      expect(event?.payload).toMatchObject({ cost: 0.0033 });
    });

    it('decodes against the DomainEvent schema', () => {
      const event = bodyToEvent('agent-pan-1935', {
        kind: 'cost-event',
        issueId: 'PAN-1935',
        costUsd: 0.0042,
        model: 'kimi-k2.7-code',
        agentRole: 'work',
        usage: {
          inputTokens: 1000,
          outputTokens: 250,
          cacheReadTokens: 50,
          cacheWriteTokens: 25,
        },
      }, '2026-06-16T12:00:00.000Z');

      const decoded = decodeDomainEvent({ ...event, sequence: 0 });
      expect(decoded._tag).toBe('Success');
    });
  });
});
