# PAN-4774 — AC-11: a signed webhook through the directory inbox while the target is stopped

- **Commit tested:** `feature/pan-4774` built tree (peer dashboard and CLI from this branch's `dist/`); production services `account.overdeck.ai` and `connect.overdeck.ai`.
- **Date:** 2026-11-02, 23:18–23:33 UTC, host `eltmon-z790`.

## Peer test dashboard (D-11)

`dist/dashboard/server.js` started through a symlink (`.tmp/pan-4774/peer11/serve.js`), port 3943, its own `OVERDECK_HOME`, the real `HOME` and `PATH` (so the trigger's conversation runs a real Claude Code), `OVERDECK_DISABLE_DEACON=1`, `OVERDECK_ANYWHERE_SUPERVISOR=1` (without it the directory client stays `off`), tmux socket `pan4774-peer11`. One project `inboxsmoke` (a one-commit git repo). The home dashboard was not stopped (NFR-1).

Sign-in: the peer's `pan account login` printed `DQVX-KLFJ`; sent with `pan tell conv-flywheel "PAN-4774 device code DQVX-KLFJ https://account.overdeck.ai/activate?user_code=DQVXKLFJ …"`; the Flywheel approved it; "Signed in to https://account.overdeck.ai as eltmon (device Linux device, 7a9c88f7-…)". After a restart the peer's directory client read `online`, plan `tester`.

```
$ pan triggers add ac11-github --project inboxsmoke --prompt "A GitHub event arrived for the PAN-4774 AC-11 check. Reply with one line: inbox event received." \
    --verify github --inbox --model claude-sonnet-5-5 --json
trigger trg_8c165b41e239 ac11-github, inbox ib_75e74f533f97b8ff, generatedSigningSecret set,
inboxUrl https://connect.overdeck.ai/<redacted path>
```

## Production half — passed

| Step | Result |
| --- | --- |
| Stop the peer | port 3943 closed |
| `POST <inboxUrl>` with `X-GitHub-Event: ping`, `X-GitHub-Delivery: pan4774-ac11-2`, `X-Hub-Signature-256: sha256=<HMAC-SHA256 of the body with the generated secret>`, body carrying `pan4774-inbox-marker-2` | `202 {"queued":true}` |
| Wait 30 s, start the peer | peer log: `[triggers] trg_8c165b41e239 started 202` |
| Trigger's conversation | `20261102-2057`, `active`, created 23:29:54.99, within seconds of the peer start (the first attempt, below, measured 4 s from start to row). Its pane shows the event wrapped as external data (`<<<OVERDECK_EXTERNAL_EVENT … source=github event=ping delivery=pan4774-ac11-2 bytes=197 truncated=no>>>` with the marker body) and Claude Code's answer `● inbox event received.` |

**First attempt (setup hazard, not a product bug).** The same flow with event `pan4774-ac11-1` created conversation `20261102-4356` 4 s after the peer start, but its harness died: `pty-supervisor: ENOENT … chmod '…/.tmp/pan-4774/peer11/sockets/pty-conv-20261102-4356.sock'`, because that socket path exceeds the ~107-byte Unix socket limit (the PRD's known hazard). The second attempt ran the peer with `OVERDECK_HOME=/tmp/odk-p11`, a short symlink to the same directory, and passed. A deeper `OVERDECK_HOME` should not be used for peer checks.

## Storage half — passed (Miniflare, D-11)

Production Durable Object storage cannot be inspected, so the storage evidence is the directory smoke, which runs the same Worker code in Miniflare with storage on disk:

```
$ node scripts/anywhere/directory-smoke.mjs        # exit 0
[  21.4 s] step inbox
[  22.4 s] event held; marker absent from 12 storage files
[  24.2 s] B ran the held event through the trigger core ([triggers] trg_7a57261a6a19 target gone 410) and acknowledged it
[  24.6 s] OK: two dashboards found each other through the directory, linked by approval over rtc://, the free limit held, and the inbox held only a sealed event
```

## Cleanup

Both trigger conversations stopped (`{"success":true}` each). `pan triggers remove trg_8c165b41e239` → "Removed trigger … Its URL now answers 404." (an unsigned POST to the inbox URL then answered 403). `pan machines forget 2a777d3b-ece3-4c3e-a799-2350837e6a3e` on home → removed; `pan machines directory --json` → only home `e91ffda1`, no approvals or joins. Peer `pan account logout` → "Signed out. This machine's device token was revoked." Peer stopped, tmux server `pan4774-peer11` killed, port 3943 free, `/tmp/odk-p11` and `.tmp/pan-4774/peer11` removed. The two short Claude Code transcripts of the trigger conversations stay under `~/.claude/projects` (session files are never deleted).

Status: passed
