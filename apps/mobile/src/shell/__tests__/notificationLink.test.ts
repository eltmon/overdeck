import { describe, expect, it } from 'vitest';

import { parseNotificationLink } from '../notificationLink';

const E = 'e91ffda1-431a-483d-a6e4-a72079516ea4';
// The exact link PushNoticeTest expects PushNotice.openLink to build.
const LINK = `ai.overdeck.app:/open#v=1&e=${E}&p=%2Fm%3Fsubject%3Da+b%26x%3D1&t=2026-11-03T20%3A00%3A00.000Z`;
const link = (p: string, extra = '') => `ai.overdeck.app:/open#v=1&e=${E}&p=${encodeURIComponent(p)}&t=1${extra}`;

describe('parseNotificationLink', () => {
  it('parses the link Android builds', () => {
    expect(parseNotificationLink(LINK)).toEqual({ environmentId: E, path: '/m?subject=a%20b&x=1' });
  });

  it('accepts /m with no query', () => {
    expect(parseNotificationLink(link('/m'))).toEqual({ environmentId: E, path: '/m' });
  });

  it('rejects another version, a bad machine id, a missing timestamp and other prefixes', () => {
    expect(parseNotificationLink(LINK.replace('v=1', 'v=2'))).toBeNull();
    expect(parseNotificationLink(LINK.replace(E, 'not-a-uuid'))).toBeNull();
    expect(parseNotificationLink(LINK.replace(E, E.toUpperCase()))).toBeNull();
    expect(parseNotificationLink(LINK.replace(/&t=.*$/, ''))).toBeNull();
    expect(parseNotificationLink(LINK.replace('/open#', '/pair#'))).toBeNull();
  });

  it('rejects paths that leave /m', () => {
    expect(parseNotificationLink(link('https://evil.example/m'))).toBeNull();
    expect(parseNotificationLink(link('//evil.example/m'))).toBeNull();
    expect(parseNotificationLink(link('/settings'))).toBeNull();
    expect(parseNotificationLink(link('/m/../settings'))).toBeNull();
    expect(parseNotificationLink(link('/mx'))).toBeNull();
  });
});
