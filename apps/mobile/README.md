# Overdeck phone app (`apps/mobile`)

The native iOS and Android app for Overdeck Anywhere. It is a Capacitor 8 wrapper around the
dashboard's phone screens (`/m`, `src/dashboard/frontend/src/components/mobile/`). It reaches
machines through the overdeck.ai directory and an end-to-end encrypted channel, not through
Tailscale. Bundle id `ai.overdeck.app`, display name "Overdeck".

Design: [PAN-4837 PRD](../../.pan/drafts/PAN-4837.md) (this app) and the epic
[PAN-4823 PRD](../../.pan/drafts/pan-4823.md). User documentation is PAN-4842.

## Layout

| Path | What lives there |
| --- | --- |
| `src/main.tsx` | Entry. Sets `__OVERDECK_NATIVE__`, installs the channel shims, then loads the shell (D-3). |
| `src/shell/` | The app's own screens and logic: sign-in (`signIn.ts`), the directory and dial policy (`directory.ts`, `connection.ts`, `relayMeter.ts`), pairing (`pairing.ts`), the machine list, pair, settings, removed-machine and machine views, sign-out, and the foreground resume path (`lifecycle.ts`). |
| `src/native/` | The `OverdeckKeys` plugin bridge (`keys.ts`), its `localStorage` stand-in for a desktop browser (`keys-web.ts`), push registration (`push.ts`), and the `OverdeckLiveActivity` bridge (`liveActivity.ts`, PAN-4839). |
| `android/` | The Capacitor Android project. App code is in `app/src/main/java/ai/overdeck/app/` (`OverdeckKeysPlugin`, `SecureStore`). |
| `ios/` | The Capacitor iOS project (Swift Package Manager). App code is in `ios/App/App/` (`OverdeckKeysPlugin.swift`, `OverdeckLiveActivityPlugin.swift`, `MainViewController.swift`, `App.entitlements`). |
| `ios/OverdeckPush/` | A local Swift package used by the app and the extension: it opens the sealed push payload (swift-sodium), rewrites the notification content, and holds the Keychain code (`KeychainStore`, `PushKeys`). Tests: `swift test` on the rig. |
| `ios/App/NotificationService/` | The Notification Service Extension (`ai.overdeck.app.NotificationService`). It decrypts each needs-you notification before iOS shows it. |
| `ios/App/Shared/` | `OverdeckActivityAttributes.swift`: the Live Activity's two counts, compiled into both the app and the widget extension (PAN-4839). |
| `ios/App/OverdeckWidgets/` | The widget extension (`ai.overdeck.app.widgets`) that draws the Live Activity on the lock screen and in the Dynamic Island. `ios/scripts/add-widgets-target.rb` adds it to `App.xcodeproj` (already done; run it again only to repair the target). |

The app imports the dashboard frontend by relative path. `vite.config.ts` dedupes React and
React Query, maps `@overdeck/contracts` to its source, and gives the channel browser stand-ins for
`events` and `sodium-native`. The frontend's `public/` folder is shared, so the stylesheet's fonts
load inside the WebView.

## Build

```bash
bun install                                    # from the repo root
npm --prefix apps/mobile run build             # web bundle into apps/mobile/dist
npm --prefix apps/mobile run cap:sync -- android
npm --prefix apps/mobile run cap:sync -- ios
```

Use the package script for Capacitor commands. `npx cap` cannot find the workspace's Capacitor CLI
in bun's isolated layout ("could not determine executable to run"). `apps/mobile/node_modules/.bin/cap`
also works.

## Run on the Android emulator

Gradle 8.14 needs JDK 21. The default `java` on this host is 25, which it does not support.

```bash
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export ANDROID_HOME=$HOME/Android/Sdk
DISPLAY=:1 $ANDROID_HOME/emulator/emulator -avd galaxyA16 &
adb wait-for-device
adb shell cmd connectivity airplane-mode disable   # the galaxyA16 AVD boots in airplane mode
cd apps/mobile/android && ./gradlew installDebug
```

To inspect the WebView, find the app's process id and forward its DevTools socket:
`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`. Then attach with Playwright
`chromium.connectOverCDP('http://127.0.0.1:9222')` in its own browser instance.

To open a pair link without the camera, run
`adb shell am start -a android.intent.action.VIEW -d '<pair link>' ai.overdeck.app`.

## Run in the iOS Simulator

The iOS project is built on the Mac build rig (`ssh -i ~/.ssh/gauntlet_air eltmon@<rig-ip>`; the
address comes from DHCP). The rig needs no bun or Node.

1. On this host, build and sync: `npm --prefix apps/mobile run build` and
   `npm --prefix apps/mobile run cap:sync -- ios`.
2. Copy the project, and the local Swift packages that `ios/App/CapApp-SPM/Package.swift` names, with
   `rsync -aL` (it dereferences bun's symlinks). The packages are under the repository root's bun
   store, for example `node_modules/.bun/@capacitor+app@8.1.2/node_modules/@capacitor/app`. Copy each one
   to the same path under `~/overdeck-mobile/` on the rig, beside `~/overdeck-mobile/apps/mobile/ios/`.
   The whole `apps/mobile/ios/` folder includes `ios/OverdeckPush/`. Also copy
   `tests/fixtures/phone-push/` to `~/overdeck-mobile/tests/fixtures/phone-push/`; the Swift tests
   read it.
3. On the rig, create a Simulator for this work. Do not use `booted`, because other work may
   have Simulators booted. Then build with ad-hoc signing:

   ```bash
   U=$(xcrun simctl create overdeck-app 'iPhone 17 Pro'); xcrun simctl boot $U
   cd ~/overdeck-mobile/apps/mobile
   xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator \
     -destination "id=$U" -derivedDataPath ~/overdeck-mobile/DerivedData CODE_SIGN_IDENTITY=- build
   xcrun simctl install $U ~/overdeck-mobile/DerivedData/Build/Products/Debug-iphonesimulator/App.app
   xcrun simctl launch $U ai.overdeck.app
   ```

   Do not build with `CODE_SIGNING_ALLOWED=NO`. That build has no Keychain entitlement, so every
   `OverdeckKeys` call fails with OSStatus -34018 (`errSecMissingEntitlement`).

   For a build signed with a team, which the shared Keychain group needs on a device, add
   `DEVELOPMENT_TEAM=<team> -allowProvisioningUpdates` instead of `CODE_SIGN_IDENTITY=-`. A Debug
   build logs its push public key. Read it with
   `xcrun simctl spawn $U log show --last 2m --predicate 'eventMessage CONTAINS "OverdeckKeys"'`.

   To see the Live Activity without signing in, launch a Debug build with
   `xcrun simctl launch $U ai.overdeck.app -overdeckLiveActivityDemo 3,2`: it starts a local card with
   those counts, and iOS asks once whether to allow Live Activities from Overdeck. Release builds
   ignore the argument.
4. Run the Swift package tests with `cd ~/overdeck-mobile/apps/mobile/ios/OverdeckPush && swift test`.
5. To deliver a test notification, seal one to the logged key on this host:
   `node tests/fixtures/phone-push/seal-apns.mjs --key <hex> --title 'Agent asks: deploy now?' --body 'Test' > push.apns`.
   Copy it to the rig, then run `xcrun simctl push $U ai.overdeck.app push.apns`. The app asks for
   notification permission only after sign-in. Xcode 26.6 has no `simctl privacy` service for
   notifications. Also, `simctl push` on Xcode 26.6 does not run the Notification Service
   Extension, so the banner shows the placeholder. Decryption is checked by `swift test` and on a
   device (`ACCEPTANCE.md`, "PAN-4838 iOS notifications").
6. To read the app's link diagnostics (failed dials and secure opens, PAN-5018), launch it with its
   output in a file: `SIMCTL_CHILD_NSUnbufferedIO=YES xcrun simctl launch --terminate-running-process
   --stdout=$HOME/app-stdout.log $U ai.overdeck.app`, then `grep '\[overdeck\]' ~/app-stdout.log`.
   Capacitor prints the WebView's `console` lines (`⚡️  [warn] - [overdeck] link …`) to stdout, not to
   the unified log, so `log show` does not have them. Without `NSUnbufferedIO` the file stays empty
   until the buffer fills. Each launch truncates the file.
7. When you are done, run `xcrun simctl delete $U`.

`ios/scripts/add-widgets-target.rb` needs the `xcodeproj` gem 1.28 or later
(`gem install --user-install xcodeproj`): older versions cannot read the project's local Swift
package reference. It is idempotent and prints "already present" when nothing is missing.

## Environment variables

These are read at build time.

| Variable | Default | Use |
| --- | --- | --- |
| `VITE_OVERDECK_ACCOUNT_URL` | `https://account.overdeck.ai` | The account service for sign-in and device revocation. |
| `VITE_OVERDECK_DIRECTORY_URL` | `https://connect.overdeck.ai` | The directory socket. |
| `VITE_OVERDECK_REQUEST_LOG` | unset | `1` records every routed `/api/` request and RPC tag in `globalThis.__overdeckRequestLog` (FR-14). |
| `VITE_OVERDECK_DEBUG_ERRORS` | unset | `1` appends the error code to a failed link's text, for example "Could not open a secure channel to desk. (timeout)" (PAN-5018). |

## Keys and secrets

`OverdeckKeys` is the only native code on both platforms. It has a Swift version and a Java version.
iOS also has the Live Activity plugin and widget extension (PAN-4839). The widget extension needs its
own App ID, `ai.overdeck.app.widgets`, which PAN-4841 registers with the store setup.

- **Client id:** a lowercase UUID v4 per install. It is the directory `clientId`, the account
  `environment_id` and the machine `clientId`.
- **Push key pair:** one X25519 pair per install. iOS makes it with CryptoKit and Android with
  lazysodium. Only the public half reaches JavaScript. It is sent as `hello-client.publicKeyHex` and
  as `pushKeyHex` in the pairing exchange.
- **Secrets:** `account` holds the overdeck.ai device token, its id and its label. `machines` holds
  one record per paired machine: the machine key, the phone token, and this phone's own link key
  pair for that machine. A fresh link key is generated in JavaScript for every pairing
  (`generateStaticKeyPair`), because a machine refuses a link key that an active record already
  holds.
- **Storage:** on iOS, Keychain generic passwords under service `ai.overdeck.app`, readable
  after first unlock, this device only, never synchronized. The push key pair is in the shared
  access group `$(AppIdentifierPrefix)ai.overdeck.shared`, which the Notification Service
  Extension also lists. The client id, `account` and `machines` stay in the app's private group
  `$(AppIdentifierPrefix)ai.overdeck.app`, which the extension cannot read. A build without the
  shared-group entitlement stores the push key in the private group and logs
  `[OverdeckKeys] shared keychain group unavailable; notifications will show the placeholder`. The Keychain survives an uninstall, so
  the first `ensureKeys` after an install wipes it. On Android, `SharedPreferences` values are
  encrypted with an AndroidKeyStore AES-GCM key, and backup is off.
- **Reset:** `reset()` deletes everything, in both groups. Sign-out calls it.
- **`pushEnvironment()` (iOS):** `sandbox` in a Debug build and `production` in a Release build,
  so the directory sends each token to the matching APNs host. TestFlight and App Store builds are
  Release.

## Notifications (iOS)

- **Registration:** after sign-in, `src/native/push.ts` asks for notification permission once
  (while iOS reports `prompt`), calls `PushNotifications.register()` on each launch when it is
  granted, and keeps the APNs token in `localStorage` (`overdeck.pushToken`). It sends
  `push-register { platform: 'ios', token, apsEnvironment }` when the token is new and each time
  the directory socket comes online.
- **Settings switch:** Settings → Notifications turns needs-you alerts off and on
  (`overdeck.notifications`). Off sends `push-unregister`; on registers again. When iOS
  permission is denied, Settings says how to turn it on in iOS Settings.
- **Pause and types** (`src/shell/notificationPrefs.ts`, `notificationPrefsSync.ts`): a pause switch,
  two timed pauses and six notification-type switches, held in `localStorage` as
  `overdeck.notificationPrefs` (`{ revision, prefs }`). The exchange at pairing (`pairing.ts`) carries
  the current prefs in its `notificationPreferences` field; every later change syncs over
  `PUT /api/phones/self/notification-preferences` on a link channel, one machine at a time. Each
  paired machine's sync state (`synced` / `pending` / `outdated` / `failed`) tracks in
  `overdeck.notificationPrefsSynced`, surfaced in Settings as the lines under each unsynced machine.
- **Decryption:** the directory sends Apple only the placeholder **Overdeck · Something needs
  you** and the sealed payload `s`. The Notification Service Extension opens `s` with the push key
  and shows the real title and text. If it cannot, for example before the first unlock after a
  restart, the placeholder shows.
- **Tap:** tapping a decrypted notification opens its machine at the screen it names (`/m…`),
  also from a cold launch. A machine that is not paired opens the machine list. Only same-origin
  `/m` paths are followed. The cold-launch tap is not yet verified on a device; it is first
  checked on the PAN-4841 TestFlight install (`ACCEPTANCE.md`, "PAN-4838 iOS notifications").
- **Android:** push is gated to iOS (`pushSupported()`). Android needs Firebase first, which is
  PAN-4840.

## Tests

```bash
npm --prefix apps/mobile test        # Vitest, happy-dom
npm run typecheck:mobile
cd apps/mobile/android && ./gradlew testDebugUnitTest assembleDebug
```

The root `npm test` does not run these tests. The CI job `mobile-android` runs the app tests, the
web build, the Capacitor sync and `assembleDebug`, and uploads the `app-debug` APK. The `test`
check requires it.

## What it cannot do yet

- Push notifications on Android: PAN-4840.
- Store setup and release builds: PAN-4841.
- Reaching machines that are linked through the paired one: PAN-4887.
- Admin-only actions such as settings, the model picker, archive, share and voice. The phone token
  cannot call them, so the phone screens hide them in native shell mode.
