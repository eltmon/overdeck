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

  it('registers the OverdeckAppearance plugin and applies the stored style at launch (PAN-5041 WI-6)', () => {
    expect(read('ios/App/App.xcodeproj/project.pbxproj')).toContain('/* OverdeckAppearancePlugin.swift in Sources */,');
    expect(read('ios/App/App/MainViewController.swift')).toContain('registerPluginInstance(OverdeckAppearancePlugin())');
    expect(read('ios/App/App/SceneDelegate.swift')).toContain('OverdeckAppearancePlugin.storedStyle()');
  });

  it('registers the OverdeckAppearance plugin and sets night mode before super.onCreate on Android (PAN-5041 WI-7)', () => {
    const activity = read('android/app/src/main/java/ai/overdeck/app/MainActivity.java');
    expect(activity).toContain('registerPlugin(OverdeckAppearancePlugin.class)');
    const nightModeAt = activity.indexOf('AppCompatDelegate.setDefaultNightMode(');
    const superOnCreateAt = activity.indexOf('super.onCreate(savedInstanceState)');
    expect(nightModeAt).toBeGreaterThan(-1);
    expect(nightModeAt).toBeLessThan(superOnCreateAt);
    expect(read('android/app/src/main/AndroidManifest.xml')).toMatch(/android:configChanges="[^"]*\buiMode\b[^"]*"\s*\n\s*android:name="\.MainActivity"/);
  });

  it('signs the App with the push entitlement and the private then shared Keychain groups (PAN-4838 WI-3)', () => {
    const entitlements = read('ios/App/App/App.entitlements');
    expect(entitlements).toContain('<key>aps-environment</key>');
    const privateGroup = entitlements.indexOf('<string>$(AppIdentifierPrefix)ai.overdeck.app</string>');
    const sharedGroup = entitlements.indexOf('<string>$(AppIdentifierPrefix)ai.overdeck.shared</string>');
    expect(privateGroup).toBeGreaterThan(-1);
    expect(sharedGroup).toBeGreaterThan(privateGroup);

    expect(read('ios/App/App/Info.plist')).toMatch(
      /<key>OverdeckSharedKeychainGroup<\/key>\s*<string>\$\(AppIdentifierPrefix\)ai\.overdeck\.shared<\/string>/,
    );

    const pbxproj = read('ios/App/App.xcodeproj/project.pbxproj');
    expect(pbxproj.split('CODE_SIGN_ENTITLEMENTS = App/App.entitlements;')).toHaveLength(3);
    expect(pbxproj).toContain('relativePath = ../OverdeckPush;');
    expect(pbxproj).not.toContain('KeychainStore.swift in Sources');
  });

  it('embeds a NotificationService extension that reads only the shared Keychain group (PAN-4838 WI-5)', () => {
    const plist = read('ios/App/NotificationService/Info.plist');
    expect(plist).toContain('<string>com.apple.usernotifications.service</string>');
    expect(plist).toContain('<string>$(PRODUCT_MODULE_NAME).NotificationService</string>');

    const groups = [...read('ios/App/NotificationService/NotificationService.entitlements').matchAll(/<string>([^<]*)<\/string>/g)].map(
      (match) => match[1],
    );
    expect(groups).toEqual(['$(AppIdentifierPrefix)ai.overdeck.shared']);

    const pbxproj = read('ios/App/App.xcodeproj/project.pbxproj');
    expect(pbxproj).toContain('PRODUCT_BUNDLE_IDENTIFIER = ai.overdeck.app.NotificationService;');
    expect(pbxproj).toContain('productType = "com.apple.product-type.app-extension";');
    expect(pbxproj).toContain('dstSubfolderSpec = 13;');
    const marketing = new Set([...pbxproj.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((match) => match[1]));
    const build = new Set([...pbxproj.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)].map((match) => match[1]));
    expect([...marketing]).toEqual(['1.0']);
    expect([...build]).toEqual(['1']);
  });
});
