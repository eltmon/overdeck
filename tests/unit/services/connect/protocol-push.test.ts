import { describe, expect, it } from 'vitest';
import { PUSH_SEALED_MAX_CHARS } from '../../../../packages/contracts/src/connect.ts';
import { decodeFrame, decodeMachineFrame } from '../../../../services/connect/src/protocol.ts';

const BAD = { ok: false, reason: 'bad_frame' } as const;
const PUSH = {
  type: 'push',
  requestId: '0123456789abcdef0123456789abcdef',
  to: '00000000-0000-4000-9000-000000000001',
  sealed: 'c2VhbGVkLWJsb2I=',
  urgency: 'high',
  collapseId: 'fedcba9876543210fedcba9876543210',
} as const;

const decode = (over: Record<string, unknown>) => decodeMachineFrame(JSON.stringify({ ...PUSH, ...over }));

describe('machine push frame decoding (PAN-4830 WI-7, D-6)', () => {
  it('decodes a valid push and drops an unlisted key', () => {
    expect(decode({ extra: 'dropped' })).toEqual({ ok: true, frame: PUSH });
    expect(decode({ urgency: 'normal' })).toEqual({ ok: true, frame: { ...PUSH, urgency: 'normal' } });
    expect(decode({ sealed: 'A'.repeat(PUSH_SEALED_MAX_CHARS) })).toMatchObject({ ok: true });
    expect(decode({ sealed: 'AA==' })).toMatchObject({ ok: true });
  });

  it.each([
    ['3,073 chars', 'A'.repeat(PUSH_SEALED_MAX_CHARS + 1)],
    ['a url-safe character', 'AA-A'],
    ['length 6', 'AAAAAA'],
    ['empty', ''],
    ['too much padding', 'A==='],
    ['a space', 'AA A'],
  ])('refuses a sealed blob with %s', (_name, sealed) => {
    expect(decode({ sealed })).toEqual(BAD);
  });

  it.each([
    ['urgency low', { urgency: 'low' }],
    ['an uppercase requestId', { requestId: PUSH.requestId.toUpperCase() }],
    ['a non-uuid to', { to: 'phone-1' }],
    ['a 31-char collapseId', { collapseId: 'a'.repeat(31) }],
    ['a missing collapseId', { collapseId: undefined }],
    ['a numeric sealed', { sealed: 4 }],
  ])('refuses %s', (_name, over) => {
    expect(decode(over)).toEqual(BAD);
  });

  it('refuses push from a phone socket', () => {
    expect(decodeFrame(JSON.stringify(PUSH), 'client')).toEqual(BAD);
    expect(decodeFrame(JSON.stringify(PUSH), 'machine')).toEqual({ ok: true, role: 'machine', frame: PUSH });
  });
});
