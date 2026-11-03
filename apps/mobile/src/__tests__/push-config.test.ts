import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import capacitorConfig from '../../capacitor.config';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('push notification plugin config (PAN-4838 WI-6)', () => {
  it('shows notifications with sound while the app is in the foreground', () => {
    expect(capacitorConfig.plugins?.PushNotifications).toEqual({ presentationOptions: ['alert', 'sound'] });
  });

  it('links the push plugin into the iOS app package', () => {
    expect(readFileSync(path.join(appRoot, 'ios/App/CapApp-SPM/Package.swift'), 'utf8')).toContain(
      'CapacitorPushNotifications',
    );
  });
});
