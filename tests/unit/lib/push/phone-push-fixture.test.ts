import { readFileSync } from 'node:fs';

import { PUSH_SEALED_MAX_CHARS, type PhonePushPayload } from '@overdeck/contracts';
import { describe, expect, it } from 'vitest';

import type { MachineKeyPair } from '../../../../src/lib/anywhere/machine-key.js';
import { openSealed } from '../../../../src/lib/anywhere/sealed-box.js';
import { apnsFixture } from '../../../fixtures/phone-push/seal-apns.mjs';

interface SealedPushFixture {
  publicKeyHex: string;
  secretKeyHex: string;
  cases: { name: string; payload: PhonePushPayload; sealed: string }[];
  wrongKey: { sealed: string };
}

const fixture = JSON.parse(
  readFileSync(new URL('../../../fixtures/phone-push/sealed-push.json', import.meta.url), 'utf8'),
) as SealedPushFixture;

const keyPair: MachineKeyPair = {
  publicKey: Buffer.from(fixture.publicKeyHex, 'hex'),
  secretKey: Buffer.from(fixture.secretKeyHex, 'hex'),
};

describe('sealed phone push fixture (PAN-4838 WI-1)', () => {
  it('opens every case to its payload byte-for-byte, within the sealed size limit', () => {
    expect(fixture.cases.map((c) => c.name)).toEqual(['question', 'unicode']);
    for (const c of fixture.cases) {
      const opened = openSealed(Buffer.from(c.sealed, 'base64'), keyPair);
      expect(opened?.toString('utf8')).toBe(JSON.stringify(c.payload));
      expect(JSON.parse(opened?.toString('utf8') ?? 'null')).toEqual(c.payload);
      expect(c.sealed.length).toBeLessThanOrEqual(PUSH_SEALED_MAX_CHARS);
    }
    expect(fixture.cases.find((c) => c.name === 'unicode')?.payload.title).toBe('Überprüfung ✅ 完了');
  });

  it('does not open the box sealed to the other key pair', () => {
    expect(openSealed(Buffer.from(fixture.wrongKey.sealed, 'base64'), keyPair)).toBeNull();
  });

  it('builds a simctl payload with the placeholder alert and a sealed v1 payload', () => {
    const apns = apnsFixture({ publicKeyHex: fixture.publicKeyHex, title: 'Fixture title ✅', body: 'Fixture body' });
    expect(apns['Simulator Target Bundle']).toBe('ai.overdeck.app');
    expect(apns.aps.alert).toEqual({ title: 'Overdeck', body: 'Something needs you' });
    expect(apns.aps['mutable-content']).toBe(1);
    const opened = openSealed(Buffer.from(apns.s, 'base64'), keyPair);
    const payload = JSON.parse(opened?.toString('utf8') ?? 'null') as PhonePushPayload;
    expect(payload).toMatchObject({ v: 1, machine: 'env-fixture-1', title: 'Fixture title ✅', body: 'Fixture body', url: '/m' });
  });
});
