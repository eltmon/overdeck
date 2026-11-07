import { describe, expect, it } from 'vitest';
import { NO_LOSS_MATRIX } from '../lib/overdeck/no-loss-matrix.js';
import {
  TELEMETRY_PROPERTY_DOMAINS,
  bucketRecoveryMs,
  bucketRequestStatus,
  clientRouteOf,
} from '../../../packages/contracts/src/telemetry.js';

describe('clientRouteOf', () => {
  it('maps a bare api route to itself and its area', () => {
    expect(clientRouteOf('/api/conversations')).toEqual({ route: '/api/conversations', route_area: 'conversations' });
  });

  it('templates an id segment and ignores the query string', () => {
    expect(clientRouteOf('/api/conversations/abc-123?x=1')).toEqual({
      route: '/api/conversations/:id',
      route_area: 'conversations',
    });
  });

  it('prefers a literal template over the id template when both match', () => {
    expect(clientRouteOf('/api/conversations/pending-input')).toEqual({
      route: '/api/conversations/pending-input',
      route_area: 'conversations',
    });
  });

  it('reads an admin route as other with its area', () => {
    expect(clientRouteOf('/api/settings')).toEqual({ route: 'other', route_area: 'settings' });
  });

  it('reads an unknown area as other for both properties', () => {
    expect(clientRouteOf('/api/not-a-real-area/x')).toEqual({ route: 'other', route_area: 'other' });
  });

  it('reads an /events/ path as the events area', () => {
    expect(clientRouteOf('/events/stream')).toEqual({ route: '/events/stream', route_area: 'events' });
  });

  it('has every non-DELETE NO_LOSS_MATRIX /api/ surface in client_route_area', () => {
    const areas: readonly string[] = TELEMETRY_PROPERTY_DOMAINS.client_route_area;
    for (const entry of NO_LOSS_MATRIX) {
      if (entry.kind !== 'http') continue;
      if (entry.disposition === 'DELETE') continue;
      const pathPart = entry.surface.split(' ')[1];
      if (!pathPart || !pathPart.startsWith('/api/')) continue;
      const segment = pathPart.slice('/api/'.length).split('/')[0];
      if (!segment) continue;
      expect(areas, `${entry.surface} first segment "${segment}" missing from client_route_area`).toContain(segment);
    }
  });

  it('buckets a request status to its boundary value', () => {
    expect(bucketRequestStatus(400)).toBe('400');
    expect(bucketRequestStatus(429)).toBe('429');
    expect(bucketRequestStatus(431)).toBe('other_4xx');
    expect(bucketRequestStatus(499)).toBe('other_4xx');
    expect(bucketRequestStatus(500)).toBe('500');
    expect(bucketRequestStatus(504)).toBe('504');
    expect(bucketRequestStatus(599)).toBe('other_5xx');
  });

  it('buckets a recovery time to its boundary value', () => {
    expect(bucketRecoveryMs(null)).toBe('none');
    expect(bucketRecoveryMs(0)).toBe('under_1s');
    expect(bucketRecoveryMs(999)).toBe('under_1s');
    expect(bucketRecoveryMs(1_000)).toBe('1s-4s');
    expect(bucketRecoveryMs(4_999)).toBe('1s-4s');
    expect(bucketRecoveryMs(5_000)).toBe('5s-14s');
    expect(bucketRecoveryMs(14_999)).toBe('5s-14s');
    expect(bucketRecoveryMs(15_000)).toBe('15s-59s');
    expect(bucketRecoveryMs(59_999)).toBe('15s-59s');
    expect(bucketRecoveryMs(60_000)).toBe('60s+');
  });
});
