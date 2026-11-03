import { createHash } from 'node:crypto';

import { PUSH_PLAINTEXT_MAX_BYTES } from '@overdeck/contracts';
import { describe, expect, it } from 'vitest';

import {
  buildPhonePushPayload,
  fitPhonePushPayload,
  pushCollapseId,
} from '../../../../src/lib/push/native-provider.js';
import type { NeedsYouNotification } from '../../../../src/lib/push/types.js';

function notification(overrides: Partial<NeedsYouNotification> = {}): NeedsYouNotification {
  return {
    kind: 'question',
    tag: 'auq:toolu_01',
    title: 'PAN-1 work asks a question',
    publicTitle: 'PAN-1 needs you',
    body: 'Should I delete the staging database?',
    url: '/m?subject=agent-pan-1',
    issueId: 'PAN-1',
    ts: '2026-11-03T00:00:00.000Z',
    ...overrides,
  };
}

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

describe('phone push payload (PAN-4843)', () => {
  it('builds the D-3 payload with the full title', () => {
    expect(buildPhonePushPayload(notification(), 'env-1')).toEqual({
      v: 1,
      machine: 'env-1',
      kind: 'question',
      title: 'PAN-1 work asks a question',
      body: 'Should I delete the staging database?',
      url: '/m?subject=agent-pan-1',
      tag: 'auq:toolu_01',
      issueId: 'PAN-1',
      ts: '2026-11-03T00:00:00.000Z',
    });
  });

  it('trims a 5,000-byte body and keeps url, tag and machine', () => {
    const payload = buildPhonePushPayload(notification({ body: 'x'.repeat(5000) }), 'env-1');
    const fitted = fitPhonePushPayload(payload);
    expect(fitted).not.toBeNull();
    expect(bytes(fitted)).toBeLessThanOrEqual(PUSH_PLAINTEXT_MAX_BYTES);
    expect(fitted?.body.endsWith('…')).toBe(true);
    expect(fitted?.url).toBe(payload.url);
    expect(fitted?.tag).toBe(payload.tag);
    expect(fitted?.machine).toBe('env-1');
  });

  it('trims an emoji body on code-point boundaries', () => {
    const fitted = fitPhonePushPayload(buildPhonePushPayload(notification({ body: '😀'.repeat(3000) }), 'env-1'));
    expect(bytes(fitted)).toBeLessThanOrEqual(PUSH_PLAINTEXT_MAX_BYTES);
    const codePoints = Array.from(fitted?.body ?? '');
    expect(codePoints.at(-1)).toBe('…');
    for (const point of codePoints.slice(0, -1)) expect(point.codePointAt(0)).toBe(0x1f600);
  });

  it('counts JSON escapes when trimming a body of quotes', () => {
    const fitted = fitPhonePushPayload(buildPhonePushPayload(notification({ body: '"'.repeat(2000) }), 'env-1'));
    expect(fitted).not.toBeNull();
    expect(bytes(fitted)).toBeLessThanOrEqual(PUSH_PLAINTEXT_MAX_BYTES);
  });

  it('trims the title and keeps an empty body when the title alone is too long', () => {
    const fitted = fitPhonePushPayload(buildPhonePushPayload(notification({ title: 't'.repeat(3000), body: '' }), 'env-1'));
    expect(fitted?.body).toBe('');
    expect(fitted?.title.endsWith('…')).toBe(true);
    expect(bytes(fitted)).toBeLessThanOrEqual(PUSH_PLAINTEXT_MAX_BYTES);
  });

  it('returns null when the url alone does not fit', () => {
    expect(fitPhonePushPayload(buildPhonePushPayload(notification({ url: `/${'u'.repeat(3000)}` }), 'env-1'))).toBeNull();
  });

  it('returns a short payload unchanged', () => {
    const payload = buildPhonePushPayload(notification(), 'env-1');
    expect(fitPhonePushPayload(payload)).toEqual(payload);
  });

  it('derives the collapse id from the first 32 hex characters of sha256(tag)', () => {
    const id = pushCollapseId('auq:toolu_01');
    expect(id).toBe(createHash('sha256').update('auq:toolu_01').digest('hex').slice(0, 32));
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });
});
