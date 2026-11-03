import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import capacitorConfig from '../../capacitor.config';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative: string) => readFileSync(path.join(appRoot, relative), 'utf8');

describe('native project config', () => {
  it('names the app ai.overdeck.app', () => {
    expect(capacitorConfig.appId).toBe('ai.overdeck.app');
    expect(capacitorConfig.appName).toBe('Overdeck');
    expect(capacitorConfig.webDir).toBe('dist');
  });

  it('opens ai.overdeck.app: URLs, disables backup and asks for the camera on Android', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).not.toContain('android:allowBackup="true"');
    expect(manifest).toContain('<data android:scheme="ai.overdeck.app" />');
    expect(manifest).toContain('<action android:name="android.intent.action.VIEW" />');
    expect(manifest).toContain('<category android:name="android.intent.category.BROWSABLE" />');
    expect(manifest).toContain('<uses-permission android:name="android.permission.CAMERA" />');
  });

  it('asks for notifications and binds FCM messages only to OverdeckMessagingService on Android', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    expect(manifest).toContain('<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />');
    expect(manifest).toContain(
      '<service android:name="com.capacitorjs.plugins.pushnotifications.MessagingService" tools:node="remove" />',
    );
    expect(manifest).toMatch(
      /<service android:name="\.OverdeckMessagingService" android:exported="false">\s*<intent-filter>\s*<action android:name="com\.google\.firebase\.MESSAGING_EVENT" \/>/,
    );
  });

  it('registers the URL scheme and the camera usage string on iOS', () => {
    const plist = read('ios/App/App/Info.plist');
    expect(plist).toMatch(/<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>ai\.overdeck\.app<\/string>/);
    expect(plist).toMatch(/<key>CFBundleURLName<\/key>\s*<string>ai\.overdeck\.app<\/string>/);
    expect(plist).toContain(
      '<key>NSCameraUsageDescription</key>\n\t<string>Overdeck uses the camera to scan the pairing code shown on your computer.</string>',
    );
  });

  it('roots the iOS scene in MainViewController, which is in the App target', () => {
    expect(read('ios/App/App/SceneDelegate.swift')).toContain('window?.rootViewController = MainViewController()');
    expect(read('ios/App/App.xcodeproj/project.pbxproj')).toContain('/* MainViewController.swift in Sources */,');
  });
});
