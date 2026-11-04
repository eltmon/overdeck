# Phone app acceptance (PAN-4837)

Evidence for epic AC-10 (PRD WI-21) and the checkpoints CP-3 and CP-4 (WI-22). Screenshots are in
[`acceptance/`](acceptance/). The request inventory from the same run is
[`request-log.json`](request-log.json).

## AC-10 on the Android emulator

**Result: PASS.** All five steps passed against the production overdeck.ai services.

- **Date:** 2026-11-03.
- **App commit:** `69fe8f6f6ba` (`feature/pan-4837`), a debug build with `VITE_OVERDECK_REQUEST_LOG=1`.
- **Emulator:** AVD `galaxyA16` (android-36 google_apis x86_64, Android 16), Android System
  WebView `Chrome/133.0.6943.137`, displayed on this host's desktop.
- **Services:** both deployed from `origin/main` `1d04723ef0c` before the run, with the operator's
  go-ahead. Account: version `6e6fdc23` (rollback `2d80b394`). Connect: version `6affbdff`
  (rollback `9fa2aecd`). `scripts/anywhere/smoke-hosted.mjs` passed. Before this deploy,
  production `/auth/start` refused the app's redirect (PRD hazard H-1).
- **Machine:** this host, `eltmon-z790` (environment `e91ffda1-431a-483d-a6e4-a72079516ea4`),
  dashboard built from main and reporting `serverVersion 0.73.1` with `capabilities.phoneApp: true`.
- **Tailscale:** not installed on this host. There is no `tailscale` binary, no `tailscaled`
  unit and no Tailscale interface, so `tailscale status` cannot run. Nothing had to be stopped,
  and the phone could reach the machine only through the overdeck.ai directory and the WebRTC
  channel.

| # | Step | Evidence | Result |
| --- | --- | --- | --- |
| 1 | Sign in | "Sign in" opened a Chrome Custom Tab on GitHub's OAuth page, "Sign in to GitHub to continue to Overdeck". The operator signed in, and the app came back to the machine list with `eltmon-z790` online. | [01](acceptance/01-sign-in-screen.png), [02](acceptance/02-github-sign-in.png), [03](acceptance/03-machine-list.png) — pass |
| 2 | Pair | A one-time code from `pan pair` went into an `ai.overdeck.app:/pair#…` link, opened with `adb shell am start -a android.intent.action.VIEW`. The pair screen opened with the link in its field. "Pair" ran the pairing channel and the exchange, and the app moved to the machine view at `/m`. | [04](acceptance/04-machine-view-after-pairing.png) — pass |
| 3 | Open Needs you | The machine view rendered Needs you ("Nothing needs you.") over the channel. Tap on the machine row to Needs you rendered: **727 ms, 529 ms, 508 ms** in three runs. Each includes the page reload, the dial and the RPC snapshot. | [04](acceptance/04-machine-view-after-pairing.png) — pass |
| 4 | Answer a question | A test conversation on this machine called AskUserQuestion ("Which color should the test pick?"). The question appeared on the phone live. "Blue" and "Send" on the phone posted the answer, and the conversation replied "The test picked Blue." | [05](acceptance/05-question-on-phone.png) — pass |
| 5 | Send a message | In that conversation, the phone composer sent "PAN-4837 phone message test: reply with the single word received." (`POST /api/conversations/<name>/message`, 200). The agent replied "received". | [06](acceptance/06-message-sent.png) — pass |

The test conversation (`20261103-3247`) was archived after the run.

### Notes from the run

- **Found and fixed during the run:** the machine list marked this machine "Update Overdeck… (pan
  0.74.0 or later)" and refused taps. Its dashboard is a main build that supports the phone app
  but still reports the last release, `0.73.1`. The version comparison is now an advisory hint on
  unpaired machines only; pairing still checks `capabilities.phoneApp` (commit `69fe8f6f6ba`). The
  hint still shows on the unpaired row in [03](acceptance/03-machine-list.png).
- **Route:** the run did not record whether the channel used `rtc://` or `rtc+turn://`.
- **Inspection:** Playwright `connectOverCDP` cannot attach to an Android WebView ("Browser context
  management is not supported"). The run used raw Chrome DevTools Protocol on the page target
  (`adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`), from its own process.
  Captures through `Page.captureScreenshot` can show a stale frame; device screenshots come from
  `adb exec-out screencap`.
- **Request inventory:** a page reload resets `__overdeckRequestLog`. `request-log.json` comes from
  one page session that answered a question ("B"), sent a message, opened a conversation, and
  visited Needs you, Conversations and Pipeline. Its only refused request is
  `GET /api/fleet/needs-you` (403), which the machine refuses to every channel caller until
  PAN-4887. The client treats that as an empty list.

## CP-3: back from the background

**Result: PASS (0.3 s, bar 5 s).** Same emulator, app build and machine as AC-10, on 2026-11-03.

1. With the machine view open, a test conversation raised "Which number should the test pick?",
   and the phone showed it ([07](acceptance/07-cp3-before-background.png), 18:28:49Z).
2. `adb shell input keyevent KEYCODE_HOME` sent the app to the background at 18:28:50Z.
3. During the wait, the question was answered on the desktop dashboard (before 18:29:48Z), so the
   machine's Needs you became empty.
4. At 18:33:51Z, 5 minutes and 1 second later, `am start` brought the app back. The first read of
   the page, 304 ms after the command, already showed no card, with the "Updating…" banner up while
   the connection was restored ([08](acceptance/08-cp3-after-resume.png)).

The fallback banner (WI-20) showed as designed. Two earlier attempts did not produce a valid
measurement. In the first, the agent picked an answer itself instead of asking. In the second,
the question was raised and answered on the desktop while the app was in the background, so the
phone never had a card to change. The run above changed Needs you by removing a card.

**Not measured: a card added during the wait.** The operator answers questions on the desktop
within seconds, so a question raised early in the wait was gone before the app returned. A
re-run planned to raise the question about 10 s before reopening could not start. After the
AC-10 run, the `galaxyA16` AVD boots into a locked user (`RUNNING_LOCKED`) that neither
`wm dismiss-keyguard` nor a swipe unlocks, so the app cannot launch. The spec criterion that asks
for this measurement (`cp3-cp4-checkpoints.ac1`) was cancelled, not marked done.

## CP-4: camera in the WebView

**Result: PASS on Android; iOS not testable in the Simulator.**

- **Android:** on the pair screen, "Scan QR code" made Android ask "Allow Overdeck to take pictures
  and record video?" ([09](acceptance/09-camera-permission.png)). The manifest's `CAMERA` permission
  and Capacitor's WebChromeClient request it. After "Only this time", `getUserMedia` opened
  `camera2 0, facing back` as a live 480×640 track, and the scanner showed the emulator's virtual
  scene with "Stop camera" ([10](acceptance/10-camera-scanning.png)). A real QR code was not put in
  front of the virtual camera. The `jsqr` decode path is the PWA scanner's, covered by the
  `MobileApp` scanner tests. The pair link path (AC-10 step 2) needs no camera. The
  `@capacitor/camera` fallback was not needed.
- **iOS:** not testable in the Simulator, which has no camera. Covered by the store build (PAN-4841).

## PAN-4838 iOS notifications

**Result: the build, key storage and registration code pass; on-device decryption is not yet
verified end to end. The real-APNs run (epic AC-11) moves to PAN-4841's first TestFlight install.**

Run on 2026-11-03 on the Mac rig: Xcode 26.6 (17F113), a dedicated iPhone 17 Pro Simulator on
iOS 26.5, deleted afterwards.

- **Swift package (`ios/OverdeckPush`):** `swift test` runs 7 tests, 0 failures. They open every
  case of `tests/fixtures/phone-push/sealed-push.json` (sealed by sodium-native, as the machine
  does), reject the wrong key, a changed base64 character, bad base64, a 31-byte key and a v2
  payload, open a box sealed to a CryptoKit key, and check the content rewrite. These tests do not
  touch the Keychain.
- **Builds:** the ad-hoc build (`CODE_SIGN_IDENTITY=-`) and the team build
  (`DEVELOPMENT_TEAM=KUU2VM9GB9 -allowProvisioningUpdates`) both exit 0, and
  `App.app/PlugIns/NotificationService.appex` is in both. Both launch to the sign-in screen and log
  `[OverdeckKeys] push public key <hex>` with no "shared keychain group unavailable" line, so the
  app wrote the push key to the shared group in both.
- **Notification permission (hazard H-7):** the app asks only after sign-in, and a GitHub sign-in
  cannot run unattended on the rig. `xcrun simctl privacy` has no notifications service on this
  Xcode. Clicking the iOS alert with UI scripting failed: SSH has no assistive access, and a
  Terminal `.command` stopped at the macOS automation consent prompt, which was not approved and
  was withdrawn by ending the process. What worked: Wix `applesimutils` 0.9.12 (Homebrew, only
  that formula trusted; uninstalled and untapped afterwards),
  `applesimutils --byId <udid> --bundle ai.overdeck.app --setPermissions notifications=YES`.
- **`simctl push` (CP-4):** the app was terminated and the output of
  `seal-apns.mjs --key <the logged key> --title 'Agent asks: deploy now?'` was pushed. The banner
  shows the placeholder **Overdeck · Something needs you**
  ([pan-4838-simctl](acceptance/pan-4838-simctl.png)). The Simulator log shows SpringBoard adding
  the request with no service-extension step, and no `NotificationService` process started.
  So `simctl push` on Xcode 26.6 does not run Notification Service Extensions, and the placeholder
  is what iOS shows without the extension (FR-6).
- **Wrong key (step 4): no screenshot recorded.** A push whose `s` was the fixture's
  `wrongKey.sealed` was sent 8 s later. Its screenshot, taken 3 s after the push, showed no banner;
  the cause was not determined. Because the extension does not run under `simctl push`, a
  wrong-key banner would only repeat the screenshot above. The wrong-key rejection itself is
  covered by the Swift test `testRejectsAnotherKeyTamperingBadBase64AndShortKeys`.
- **Cold-launch tap (CP-3): not run.** The rig has no way to tap a notification (see the
  permission bullet). The code uses the primary path: `installNotificationTap` runs after boot, and
  the plugin hands over the retained cold-launch action when the listener is added. The fallback
  path (installing before boot and queueing) was not needed by any test and is not built.
- **Not verified here:** the extension reading the push key from the shared Keychain group and
  rewriting a real notification, and the cold-launch tap. Both are first exercised by the
  TestFlight install in PAN-4841.
- **Real APNs (step 6):** `curl -s https://connect.overdeck.ai/healthz` returned
  `{"ok":true,"configured":true,"turn":true,"apns":false,"fcm":false}`, so the directory cannot
  reach APNs yet. PAN-4841 sets the APNs secrets; its first TestFlight install runs epic AC-11:
  pair the phone, terminate the app, raise a question on the desktop, and check that the
  notification shows the question's title within 10 s, that tapping it opens the Needs-you card,
  and that `npx wrangler tail overdeck-connect --format json` shows no title text. Those steps
  are in the [PAN-4841 comment](https://github.com/eltmon/overdeck/issues/4841#issuecomment-6615975677).

## Live Activity (PAN-4839)

Evidence for PRD WI-11. The Simulator run checks that the widget extension builds, embeds and draws
the counts. The device run (AC-12) needs the production APNs secrets and is handed to PAN-4841.

### Simulator run

**Result: card drawn on the lock screen; Dynamic Island not captured.**

- **Date:** 2026-11-03.
- **Rig:** Edwards-MacBook-Air, macOS 26.6.2, Xcode 26.6. Simulator `iPhone 17 Pro`, iOS 26.5,
  created for this run and deleted after it.
- **Build:** Debug, `-scheme App -sdk iphonesimulator CODE_SIGN_IDENTITY=-`: `** BUILD SUCCEEDED **`,
  with `OverdeckWidgets.appex` under `App.app/PlugIns/`. No compiler warnings in the new Swift files.
- **Launch:** `xcrun simctl launch $U ai.overdeck.app -overdeckLiveActivityDemo 3,2`, a local card with
  no push (D-15). Then Settings opened over it, and the Simulator was locked with `osascript`
  (Simulator → Device → Lock). Locking the Simulator can be scripted.

| Step | Evidence | Result |
| --- | --- | --- |
| Lock screen | The card reads "Overdeck · 3 need you · 2 running", under iOS's first-run prompt "Allow Live Activities from Overdeck?". | [12](acceptance/12-live-activity-lock.png) — pass |
| Dynamic Island | The island stayed empty with the app in the background. iOS shows a card in the island only after the user answers the first-run prompt with Allow. Two scripted clicks on Allow were tried: a System Events click, and a CGEvent click at the button's position in the Simulator's screen view. After the second, Device → Home unlocked the Simulator with Settings in front, and the island was still empty. Whether the click missed or the Simulator does not draw the card in the island is not known. | not captured |

Deviation from the PRD: `acceptance/11-live-activity-island.png` is not committed, because no screenshot
showed the card in the island. The `acceptance.ac1` plan item is cancelled for this reason; the device
run in PAN-4841 can capture the island. To capture it in the Simulator by hand, tap **Allow** on the lock screen in the Simulator
window, unlock, open another app, and run `xcrun simctl io $U screenshot 11-live-activity-island.png`.

### Device checkpoint (AC-12, D-16)

**Not run: APNs secrets unset (PAN-4841).** On 2026-11-03, `GET https://connect.overdeck.ai/healthz`
answered `{"ok":true,"configured":true,"turn":true,"apns":false,"fcm":false}`. The AC-12 timing,
the widget App ID `ai.overdeck.app.widgets` and the reuse of the existing APNs key are handed to
PAN-4841's TestFlight run:
https://github.com/eltmon/overdeck/issues/4841#issuecomment-6616154481

## PAN-5018 link after a long machine uptime

Evidence for PRD WI-8 (`.pan/drafts/pan-5018.md`). Run on 2026-11-04, 14:23–14:45 UTC.

**Result: the machine-side silence from the issue was not reproduced; two phone-side causes were.**
In about 17 minutes of uptime, the branch-built test machine answered every phone offer, including
after a 90 s freeze, and logged each one. The phone, however, showed a failure text after almost
every machine open and every resume, and the text stayed on screen after later dials succeeded.

### Deviations from the plan

- **Local overdeck.ai stack instead of the real one (D-7, D-8).** The Simulator cannot complete a
  GitHub sign-in unattended, and the operator could not sign in on it. The run used the real
  `services/connect` Worker in Miniflare (as `scripts/anywhere/directory-smoke.mjs` does), with an
  `AccountRpc` stub that puts the machine token and the phone token on one `tester` account, plus a
  stub account service whose `/auth/start` answers with the same `302` to
  `ai.overdeck.app:/oauth/callback` that the real one sends after GitHub. The Simulator reached both
  through an SSH reverse tunnel to the rig's loopback (`127.0.0.1:8790` and `:8791`). No STUN or TURN,
  so only the `direct` route can link; the relay dial always fails with "relay credentials are not
  available". The phone bundle was built with `VITE_OVERDECK_ACCOUNT_URL`, `VITE_OVERDECK_DIRECTORY_URL`
  pointing there and `VITE_OVERDECK_DEBUG_ERRORS=1`.
- **Version stamp.** The app hides machines older than `MIN_PAN_VERSION` (0.74.0); this branch's
  `package.json` says 0.73.1. The test dashboard ran from a copy of this branch's `dist/` beside a
  `package.json` stamped 0.74.0. No product code was changed for the run.
- **Shared terminal backend.** The test home's `~/.config` is a symlink to the real one, so the peer
  dashboard attached to the operator's Herdr session and seeded 31 agent snapshots. It ran with
  `OVERDECK_DISABLE_DEACON=1` and spawned nothing.
- **Shorter run.** About 17 minutes of machine uptime, not 30; the 2-hour rerun was not done. The
  rerun with the fixed build (below) adds more uptime.
- **Phone logs.** `log show` does not contain the app's `console` lines; the README command was
  corrected to launch with `SIMCTL_CHILD_NSUnbufferedIO=YES … --stdout=<file>`.

### Setup

- Machine: `pan5018-test` (`95b91f02…`), this branch, port 3061, `OVERDECK_DISABLE_DEACON=1`,
  `OVERDECK_ANYWHERE_SUPERVISOR=1`, `OVERDECK_ANYWHERE_DEBUG=1`, own `HOME` and `OVERDECK_HOME`.
- Phone: Debug build, Simulator `overdeck-5018` (iPhone 17 Pro, iOS 26.5) on the Mac rig, client id
  `ae6b5071…`. Taps with `idb ui tap`; pair link delivered through Safari from a stub page that
  redirects to `ai.overdeck.app:/pair#…` (`simctl openurl` rewrites `ai.overdeck.app:/x` to
  `ai.overdeck.app:///x`, which the app's prefix checks reject).

### Steps

Machine lines are `[anywhere] …` from the test dashboard log; phone lines are `[overdeck] …` from
the app's stdout. Ids are cut to 8 characters by the logs themselves.

| Time (UTC) | Step | Phone on screen | Machine | Phone log |
| --- | --- | --- | --- | --- |
| 14:27:26 | Sign in (stub) | Machine list, `pan5018-test` online | `directory online (plan tester, 1 machines)` | — |
| 14:29:26 | Pair (first) | Stayed on the Pair screen | `rtc offer from ae6b5071 session eecabc92 (link, direct)`, `answered`, `connected`; the machine created the phone's device record | — |
| 14:30:5x | Pair again, same code | "This pairing code expired or was already used. Create a new one on pan5018-test. (pairing-refused)" | `channel refused (pairing-refused, pairing): Unknown or expired pairing id …` | — |
| 14:32:16 | Relaunch | List shows `pan5018-test` **Paired** | — | — |
| 14:32:2x | Open machine | "Not connected to overdeck.ai." stays | `rtc offer … 1c222290 … answered`, `connected`; device `lastUsedAt` 14:37:38 (requests served) | none (this failure path logged nothing) |
| 14:38–14:40 | Close and open ×5 | "Not connected to overdeck.ai." after every open | each open: `rtc offer from ae6b5071 … (link, direct)`, `rtc closing session … a new offer replaced it`, `answered`, `connected` | none |
| 14:40–14:42 | Background/foreground ×3 | "Could not reach pan5018-test directly or through the relay." stays | `channel refused (closed, unknown): Peer closed the connection during the handshake`, then a new offer `answered`, `connected` | `direct dial failed: dialer closed`, `relay dial failed: Not connected to the overdeck.ai directory` |
| 14:42:18 | Machine `kill -STOP` 90 s, open machine | "Could not reach …" | nothing (frozen) | `direct dial failed: No direct connection to 95b91f02… within 8000 ms`, `relay dial failed: relay credentials are not available` (repeated per request) |
| 14:43:2x | `kill -CONT` | "Could not reach …" stays | `directory silent for 79 s; reconnecting`, `rtc session 63cf40e2 … failed`/`closed`, `directory online`, then `rtc offer … 4a939a5e … answered`, `connected` | direct dials fail until the new connection opens |
| 14:44:58 | Cold launch | Machine list | — | `dialer closed` lines from the previous process's resume |

### What the run shows

None of the PRD decision-table rows matched: no `dropped:`, no `failed at <step>`, no refusal other
than the expected `pairing-refused` and the debug-level `closed` refusals of channels cut by a resume,
and every offer forwarded by the directory reached `RtcTransport` (`directory signal …` then
`rtc offer from …`). So the machine-side cause in the issue (offers forwarded but never answered by a
long-running process) is **not reproduced**; the always-on lines now record it if it recurs.

Two phone-side causes were reproduced every time:

1. **The failure text never clears.** `session.ts` stores the last dial error and clears it only when
   the selected machine changes. One failed dial leaves its text over the machine view after later
   dials succeed (the machine shows `connected` and serves requests). From the operator's seat every
   later link "fails". This is how a single "Could not open a secure channel" stays on screen.
2. **Each machine open and each resume makes the first requests fail.** Opening a machine reloads
   the page, so the directory socket starts over, and `dialRaw` throws `directory-offline` at once
   instead of waiting for it. On resume, `forgetRoutes()` closes the dialer under in-flight dials
   ("dialer closed") and the relay fallback then fails because the directory socket is reconnecting.

Root-cause fixes and the rerun are in the next section.

### Fix and rerun (PAN-5018 WI-9)

- **Fix 1 (`session.ts`):** a dial that succeeds clears the stored dial error and notifies the shell,
  so a transient failure no longer stays over the machine view.
- **Fix 2 (`connection.ts`):** `dialRaw` waits up to `DIRECTORY_WAIT_MS` (10 s) for an off or
  connecting directory socket to come online before it reports `directory-offline`, gives up at once
  on `refused` or an abort, and logs `link <label>: directory not online after 10000 ms (<state>)`
  when it gives up (this failure path logged nothing before).
- **Regression tests:** `session.test.ts` "clears the dial error when a later dial succeeds" and
  `connection.test.ts` "waits for a connecting directory and dials once it is online", "refuses with
  directory-offline when the directory does not come online in time", "stops waiting when the dial is
  aborted". All four failed on the pre-fix code and pass after it.

Rerun on the same Simulator and the same test machine process (up since 14:28 UTC), fixed phone
build installed 14:48:39:

| Time (UTC) | Step | Phone on screen | Machine |
| --- | --- | --- | --- |
| 14:48:43–14:49:58 | Open the machine ×4 (each a page reload) | "Nothing needs you.", no failure text | each: `rtc offer from ae6b5071 … (link, direct)`, `connected` |
| 14:50:46–14:52:14 | Background/foreground ×3 | Machine view, no failure text | each resume: new offer, `connected`; no `dialer closed` on the phone |
| 14:52:3x–14:53:5x | Machine `kill -STOP` 75 s, then `kill -CONT` | "Nothing needs you.", no failure text | `directory silent for 85 s; reconnecting`, `directory online`, new offer `connected` |

The step that failed before (open the machine, and resume) now links every time.
