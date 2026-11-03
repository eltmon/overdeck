import { describe, expect, it } from 'vitest';
import type { Env } from '../../../../../services/connect/src/env.ts';
import { parsePushConfig } from '../../../../../services/connect/src/push/config.ts';

const BASE = { DIRECTORY: {} as DurableObjectNamespace, ACCOUNT: { verifyDevice: async () => ({ ok: false }) } } as unknown as Env;
const ACCOUNT_JSON = JSON.stringify({ client_email: ' push@test.iam.gserviceaccount.com ', private_key: 'RSA-PEM' });

function envWith(over: Partial<Env>): Env {
  return { ...BASE, ...over };
}

const ALL: Partial<Env> = {
  APNS_KEY_P8: ' P8-PEM ',
  APNS_KEY_ID: ' KEYID12345 ',
  APNS_TEAM_ID: ' TEAMID1234 ',
  FCM_SERVICE_ACCOUNT_JSON: ACCOUNT_JSON,
  FCM_PROJECT_ID: ' overdeck-test ',
};

describe('parsePushConfig (PAN-4830 WI-2)', () => {
  it('parses both providers with trimmed values when all five secrets are set', () => {
    expect(parsePushConfig(envWith(ALL))).toEqual({
      apns: { keyP8: 'P8-PEM', keyId: 'KEYID12345', teamId: 'TEAMID1234' },
      fcm: { projectId: 'overdeck-test', clientEmail: 'push@test.iam.gserviceaccount.com', privateKey: 'RSA-PEM' },
    });
  });

  it('nulls both providers when nothing is set', () => {
    expect(parsePushConfig(envWith({}))).toEqual({ apns: null, fcm: null });
  });

  it.each(['APNS_KEY_P8', 'APNS_KEY_ID', 'APNS_TEAM_ID'] as const)('nulls APNs when %s is blank or missing', (key) => {
    expect(parsePushConfig(envWith({ ...ALL, [key]: '  ' })).apns).toBeNull();
    expect(parsePushConfig(envWith({ ...ALL, [key]: undefined })).apns).toBeNull();
    expect(parsePushConfig(envWith({ ...ALL, [key]: '  ' })).fcm).not.toBeNull();
  });

  it('nulls FCM when the project id is blank or the service account is not usable JSON', () => {
    expect(parsePushConfig(envWith({ ...ALL, FCM_PROJECT_ID: '' })).fcm).toBeNull();
    expect(parsePushConfig(envWith({ ...ALL, FCM_SERVICE_ACCOUNT_JSON: 'not json' })).fcm).toBeNull();
    expect(parsePushConfig(envWith({ ...ALL, FCM_SERVICE_ACCOUNT_JSON: '"a string"' })).fcm).toBeNull();
    expect(parsePushConfig(envWith({ ...ALL, FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'a@b' }) })).fcm).toBeNull();
    expect(parsePushConfig(envWith({ ...ALL, FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({ private_key: 'k' }) })).fcm).toBeNull();
    expect(parsePushConfig(envWith({ ...ALL, FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'a@b', private_key: 7 }) })).fcm).toBeNull();
    expect(parsePushConfig(envWith({ ...ALL, FCM_PROJECT_ID: '' })).apns).not.toBeNull();
  });

  it('turns literal \\n sequences in APNS_KEY_P8 into newlines', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\\nABCD\\n-----END PRIVATE KEY-----';
    expect(parsePushConfig(envWith({ ...ALL, APNS_KEY_P8: pem })).apns?.keyP8).toBe('-----BEGIN PRIVATE KEY-----\nABCD\n-----END PRIVATE KEY-----');
  });
});
