# CP-1: sodium in a browser engine

PAN-4833 WI-10, pan-4823 checkpoint CP-1 and AC-5 (second half). The web build of the secure
channel (`openSecureChannel`, web crypto port, `sodium-javascript` in place of `sodium-native`)
pairs with the server's real `acceptChannel` (Node port, `sodium-native`) over a browser
WebSocket (D-11) and sends 1 MiB; the responder answers `done` once 1,048,576 bytes have
arrived.

**Pass bar (D-12):** the handshake succeeds in every leg, and 1 MiB takes under 2 s on the
Android emulator.

**Result: PASS.** Every leg completed the handshake, and the Android emulator moved 1 MiB in
234 ms.

- **Date:** 2026-11-03
- **Commit:** `6594de01f28` (branch `feature/pan-4833`, harness as committed with this file)
- **Host:** Linux x86_64, KVM

| Leg | Engine (user agent) | handshakeMs | transferMs (1 MiB) | Result |
| --- | --- | --- | --- | --- |
| Playwright Chromium, CDP `Emulation.setCPUThrottlingRate` rate 4 | HeadlessChrome/153.0.8010.12 | 82 | 200 | pass |
| Playwright WebKit | Version/26.6 Safari/605.1.15 (WebKit 26.6) | 31 | 44 | pass |
| Android emulator `galaxyA16` (android-36 google_apis x86_64), Chrome | Chrome/133.0.0.0 Mobile Safari/537.36 (Android 10; K) | 155 | 234 | pass (under 2 s) |
| iOS Simulator `iPhone 17 Pro` (iOS 26.5 runtime), Mobile Safari, Mac rig (Xcode 26.6), 2026-11-03, PAN-4837 | Version/26.5 Mobile/15E148 Safari/604.1 (the UA says "iPhone OS 18_7") | 217 | 416 | pass (under 2 s) |

The iOS Simulator leg was run later, by PAN-4837 (W-APP1), against this harness on `feature/pan-4837`.

## How to reproduce

- Browsers: `VITEST_INCLUDE_SLOW=1 npx vitest run tests/integration/anywhere/cp1-browsers.slow.test.ts`
  (the test logs each leg's JSON result).
- Android: start the AVD (`~/Android/Sdk/emulator/emulator -avd galaxyA16 -no-window -no-audio
  -no-snapshot-save`), wait for `adb shell getprop sys.boot_completed` = `1`, run
  `npx tsx packages/anywhere-channel/cp1/serve.ts --host 0.0.0.0 --port <port>`, then
  `adb shell am start -a android.intent.action.VIEW -d "http://10.0.2.2:<port>/?ws=ws%3A%2F%2F10.0.2.2%3A<port>%2Fchannel&code=<code>" com.android.chrome`.
  The server prints the result and exits. Stop the emulator with `adb emu kill`.
- iOS Simulator (PAN-4837): on this host run `npx tsx packages/anywhere-channel/cp1/serve.ts --host 127.0.0.1 --port <port>`;
  open a reverse tunnel so the Mac reaches it (`ssh -f -N -o BatchMode=yes -i ~/.ssh/gauntlet_air -R <port>:127.0.0.1:<port> eltmon@<rig-ip>`;
  the Simulator shares the Mac's network); on the rig create and boot a dedicated Simulator
  (`xcrun simctl create cp1 'iPhone 17 Pro'`, `xcrun simctl boot <udid>`) and run
  `xcrun simctl openurl <udid> "<the page URL serve.ts prints>"`. Use the UDID, not `booted`: other work may
  have Simulators booted on the rig. Close the tunnel and delete the Simulator afterwards.

## Notes from the run

- The `galaxyA16` AVD boots with airplane mode on, so Chrome reports `ERR_INTERNET_DISCONNECTED`.
  Turn it off first: `adb shell cmd connectivity airplane-mode disable`.
- Chrome's first-run screen is skipped with
  `adb shell 'echo "_ --disable-fre --no-default-browser-check --no-first-run" > /data/local/tmp/chrome-command-line'`
  and `adb shell am set-debug-app --persistent com.android.chrome`. A "Chrome notifications"
  promo can still cover the page on first launch; dismiss it once.
- Port 8791 (the PRD's example) was taken on this host, so the Android leg used 8793.
- The pure-JS fallback in WI-10 step 7 (`libsodium-wrappers`) was not needed.
