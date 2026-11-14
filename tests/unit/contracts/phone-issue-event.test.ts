import { describe, expect, it } from 'vitest';
import {
  PHONE_ISSUE_EVENT_LABELS,
  parsePhoneIssueEvent,
  phoneIssueSheetPath,
  type PhoneIssueEvent,
} from '@overdeck/contracts';

describe('phoneIssueSheetPath', () => {
  it('includes event and at when given', () => {
    expect(phoneIssueSheetPath('PAN-5', { kind: 'stopped', at: '2026-11-13T19:43:00.000Z' })).toBe(
      '/m/pipeline?issue=PAN-5&event=stopped&at=2026-11-13T19%3A43%3A00.000Z',
    );
  });

  it('omits event and at without an event', () => {
    expect(phoneIssueSheetPath('PAN-5')).toBe('/m/pipeline?issue=PAN-5');
  });

  it('omits event and at when event is null', () => {
    expect(phoneIssueSheetPath('PAN-5', null)).toBe('/m/pipeline?issue=PAN-5');
  });

  it('encodes an issue id with a dot or space', () => {
    expect(phoneIssueSheetPath('PAN 5.1')).toBe('/m/pipeline?issue=PAN+5.1');
  });

  it('round-trips through URLSearchParams', () => {
    const path = phoneIssueSheetPath('PAN-5', { kind: 'merge.failed', at: '2026-11-13T19:43:00.000Z' });
    const params = new URLSearchParams(path.slice(path.indexOf('?') + 1));
    expect(params.get('issue')).toBe('PAN-5');
    expect(params.get('event')).toBe('merge.failed');
    expect(params.get('at')).toBe('2026-11-13T19:43:00.000Z');
  });
});

describe('parsePhoneIssueEvent', () => {
  const allEvents: readonly PhoneIssueEvent[] = [
    'stopped',
    'verification.started',
    'merge.completed',
    'merge.failed',
    'review.stall-escalated',
    'conflict.repair-escalated',
  ];

  it.each(allEvents.map((event) => [event]))('returns %s for itself', (event) => {
    expect(parsePhoneIssueEvent(event)).toBe(event);
  });

  it.each([['__proto__'], ['toString'], [''], [null], ['merge']])('returns null for %s', (value) => {
    expect(parsePhoneIssueEvent(value)).toBeNull();
  });
});

describe('PHONE_ISSUE_EVENT_LABELS', () => {
  it('labels stopped and merge.completed', () => {
    expect(PHONE_ISSUE_EVENT_LABELS.stopped).toBe('Agent stopped responding');
    expect(PHONE_ISSUE_EVENT_LABELS['merge.completed']).toBe('Merged');
  });
});
