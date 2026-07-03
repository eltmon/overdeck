import { beforeEach, describe, expect, it } from 'vitest';

import {
  appendInternalEvents,
  parseInternalEventsBody,
  parseInternalEventsSince,
  validateInternalEventsHeaders,
} from '../../../src/dashboard/server/routes/internal-events.js';
import { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } from '../../../src/lib/internal-token.js';

describe('internal events route helpers', () => {
  beforeEach(() => {
    process.env.OVERDECK_INTERNAL_TOKEN = 'test-token';
    _resetInternalTokenCacheForTests();
  });

  it('rejects requests without or with an invalid internal token', () => {
    expect(validateInternalEventsHeaders({})).toEqual({ ok: false, status: 401, error: 'unauthorized' });
    expect(validateInternalEventsHeaders({ [INTERNAL_TOKEN_HEADER]: 'wrong' })).toEqual({ ok: false, status: 401, error: 'unauthorized' });
  });

  it('rejects non-loopback origins', () => {
    expect(validateInternalEventsHeaders({
      [INTERNAL_TOKEN_HEADER]: 'test-token',
      origin: 'https://evil.example',
    })).toEqual({ ok: false, status: 403, error: 'non-loopback origin rejected' });
  });

  it('accepts a valid token from a loopback origin', () => {
    expect(validateInternalEventsHeaders({
      [INTERNAL_TOKEN_HEADER]: 'test-token',
      origin: 'http://127.0.0.1:3011',
    })).toEqual({ ok: true });
  });

  it('parses and appends a batch of valid events', () => {
    const appended: unknown[] = [];
    const events = parseInternalEventsBody({
      events: [
        { type: 'activity.entry', timestamp: '2026-07-03T00:00:00.000Z', payload: { message: 'one' } },
        { type: 'activity.entry', timestamp: '2026-07-03T00:00:01.000Z', payload: { message: 'two' } },
        { type: 42, timestamp: 'bad', payload: {} },
      ],
    });

    const count = appendInternalEvents(events, (event) => appended.push(event));

    expect(count).toBe(2);
    expect(appended).toHaveLength(2);
  });

  it('parses an optional since cursor for internal event replay', () => {
    expect(parseInternalEventsSince(null)).toBeNull();
    expect(parseInternalEventsSince('')).toBeNull();
    expect(parseInternalEventsSince('12')).toBe(12);
    expect(parseInternalEventsSince('-1')).toBeNull();
    expect(parseInternalEventsSince('not-a-number')).toBeNull();
  });
});
