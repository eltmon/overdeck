import { describe, it, expect } from 'vitest';
import { deriveRoundMarkers } from '../deriveRoundMarkers';
import type { ReviewerRoundMetadata } from '@panopticon/contracts';

const MESSAGES = [
  { id: 'm1', createdAt: '2026-04-26T10:00:00Z' },
  { id: 'm2', createdAt: '2026-04-26T10:05:00Z' },
  { id: 'm3', createdAt: '2026-04-26T10:10:00Z' },
  { id: 'm4', createdAt: '2026-04-26T10:15:00Z' },
  { id: 'm5', createdAt: '2026-04-26T10:20:00Z' },
];

describe('deriveRoundMarkers', () => {
  it('returns empty array when no roundMetadata', () => {
    expect(deriveRoundMarkers(undefined, MESSAGES)).toEqual([]);
  });

  it('returns empty array when no messages', () => {
    const meta: ReviewerRoundMetadata = {
      roundCount: 1,
      latestRound: 1,
      history: [{ round: 1, endedAt: '2026-04-26T10:05:00Z', status: 'passed' }],
    };
    expect(deriveRoundMarkers(meta, [])).toEqual([]);
  });

  it('anchors each round to the last message before round end', () => {
    const meta: ReviewerRoundMetadata = {
      roundCount: 2,
      latestRound: 2,
      history: [
        { round: 1, endedAt: '2026-04-26T10:06:00Z', status: 'passed' },
        { round: 2, endedAt: '2026-04-26T10:16:00Z', status: 'failed' },
      ],
    };
    const markers = deriveRoundMarkers(meta, MESSAGES);
    expect(markers).toHaveLength(2);
    expect(markers[0]).toMatchObject({ afterMessageId: 'm2', round: 1, verdict: 'passed' });
    expect(markers[1]).toMatchObject({ afterMessageId: 'm4', round: 2, verdict: 'failed' });
  });

  it('skips rounds without endedAt', () => {
    const meta: ReviewerRoundMetadata = {
      roundCount: 2,
      latestRound: 2,
      history: [
        { round: 1, status: 'running' },
        { round: 2, endedAt: '2026-04-26T10:16:00Z', status: 'failed' },
      ],
    };
    const markers = deriveRoundMarkers(meta, MESSAGES);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ round: 2, verdict: 'failed' });
  });

  it('anchors to last message when round end is after all messages', () => {
    const meta: ReviewerRoundMetadata = {
      roundCount: 1,
      latestRound: 1,
      history: [{ round: 1, endedAt: '2026-04-26T11:00:00Z', status: 'passed' }],
    };
    const markers = deriveRoundMarkers(meta, MESSAGES);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ afterMessageId: 'm5', verdict: 'passed' });
  });

  it('maps status to verdict correctly', () => {
    const meta: ReviewerRoundMetadata = {
      roundCount: 5,
      latestRound: 5,
      history: [
        { round: 1, endedAt: '2026-04-26T10:02:00Z', status: 'passed' },
        { round: 2, endedAt: '2026-04-26T10:04:00Z', status: 'approved' },
        { round: 3, endedAt: '2026-04-26T10:06:00Z', status: 'blocked' },
        { round: 4, endedAt: '2026-04-26T10:08:00Z', status: 'running' },
        { round: 5, endedAt: '2026-04-26T10:10:00Z', status: 'unknown' },
      ],
    };
    const markers = deriveRoundMarkers(meta, MESSAGES);
    expect(markers[0]?.verdict).toBe('passed');
    expect(markers[1]?.verdict).toBe('passed');
    expect(markers[2]?.verdict).toBe('failed');
    expect(markers[3]?.verdict).toBe('running');
    expect(markers[4]?.verdict).toBe('pending');
  });
});
