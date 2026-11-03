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
