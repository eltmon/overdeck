import { describe, expect, it } from 'vitest';
import { buildEnrichSessionsJobPayload, filterDomainEventForIssue } from '../ws-rpc.js';
import type { DomainEvent } from '@panctl/contracts';
import type { RuntimeConversationsConfig } from '../../../lib/config-yaml.js';

describe('ws-rpc enrichSessions payload', () => {
  it('forwards fullTranscript to the dashboard DB worker payload', () => {
    const config: RuntimeConversationsConfig = {
      compactionModel: 'claude-haiku-4-5',
      manualCompactMode: 'claude-code',
      richCompaction: true,
      titleModel: 'claude-haiku-4-5',
      watchDirs: [],
      scanMaxParallel: null,
      embeddings: false,
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
      embeddingAutoOnDeep: true,
      enrichment: {
        quickModel: null,
        deepModel: null,
        maxParallel: 3,
        costConfirmThreshold: 1,
      },
      apiKeys: {},
      enabledProviders: new Set(['anthropic']),
    };

    const payload = buildEnrichSessionsJobPayload({
      level: 3,
      ids: [42],
      model: 'claude-sonnet-4-6',
      customPrompt: 'focus on decisions',
      confirmed: true,
      fullTranscript: true,
    }, config);

    expect(payload).toMatchObject({
      tier: 3,
      sessionIds: [42],
      maxParallel: 3,
      modelOverride: 'claude-sonnet-4-6',
      promptSuffix: 'focus on decisions',
      fullTranscript: true,
      skipAlreadyEnriched: true,
      force: true,
    });
  });
});

describe('filterDomainEventForIssue', () => {
  it('keeps direct issue events for the requested issue only', () => {
    const event: DomainEvent = {
      type: 'review.status_changed',
      sequence: 1,
      timestamp: '2026-05-19T00:00:00.000Z',
      payload: { issueId: 'PAN-1', status: { issueId: 'PAN-1' } },
    } as DomainEvent;

    expect(filterDomainEventForIssue(event, 'PAN-1')).toBe(event);
    expect(filterDomainEventForIssue(event, 'PAN-2')).toBeNull();
  });

  it('keeps agent runtime events using the agent snapshot issue association', () => {
    const event: DomainEvent = {
      type: 'agent.activity_changed',
      sequence: 2,
      timestamp: '2026-05-19T00:00:00.000Z',
      payload: { agentId: 'agent-pan-1-review-security', message: 'reviewing' },
    } as DomainEvent;
    const lookup = new Map([['agent-pan-1-review-security', 'pan-1']]);

    expect(filterDomainEventForIssue(event, 'PAN-1', lookup)).toBe(event);
    expect(filterDomainEventForIssue(event, 'PAN-2', lookup)).toBeNull();
  });

  it('filters aggregate snapshot events to matching issue records', () => {
    const issuesSnapshot: DomainEvent = {
      type: 'issues.snapshot',
      sequence: 2,
      timestamp: '2026-05-19T00:00:00.000Z',
      payload: {
        issues: [
          { id: 'PAN-1', identifier: 'PAN-1' },
          { id: 'PAN-2', identifier: 'PAN-2' },
        ],
      },
    } as DomainEvent;
    const activity: DomainEvent = {
      type: 'activity.updated',
      sequence: 3,
      timestamp: '2026-05-19T00:00:00.000Z',
      payload: {
        events: [
          { id: 'a', issueId: 'PAN-1' },
          { id: 'agent-event', agentId: 'agent-pan-1-review-requirements' },
          { id: 'b', issueId: 'PAN-2' },
        ],
      },
    } as DomainEvent;

    expect(filterDomainEventForIssue(issuesSnapshot, 'PAN-1')).toMatchObject({
      type: 'issues.snapshot',
      payload: { issues: [{ id: 'PAN-1', identifier: 'PAN-1' }] },
    });
    const lookup = new Map([['agent-pan-1-review-requirements', 'pan-1']]);

    expect(filterDomainEventForIssue(activity, 'PAN-1', lookup)).toMatchObject({
      type: 'activity.updated',
      payload: { events: [{ id: 'a', issueId: 'PAN-1' }, { id: 'agent-event', agentId: 'agent-pan-1-review-requirements' }] },
    });
    expect(filterDomainEventForIssue(issuesSnapshot, 'PAN-3')).toBeNull();
    expect(filterDomainEventForIssue(activity, 'PAN-3')).toBeNull();
  });
});
