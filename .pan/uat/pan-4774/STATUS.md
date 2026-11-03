## PAN-4774 — Overdeck Anywhere release acceptance run (AC-1 to AC-15), 2026-11-02

Run on integrated main (`194adf91f96`, the deployed home dashboard) plus this branch (`feature/pan-4774`). Status terms:

- **passed** — every clause of the criterion was shown live, with evidence.
- **failed** — a clause did not hold; the row names the filed issue or the fix commit.
- **approximated** — the check ran in a reduced form; the row names what was not covered.

Summary: 7 passed, 5 failed, 3 approximated. Five defects were filed and one was fixed in this branch.

| AC | Status | Evidence | Fix or issue | Notes / not covered |
| --- | --- | --- | --- | --- |
| AC-1 | passed | [local-smoke.md](https://github.com/eltmon/overdeck/blob/feature/pan-4774/.pan/uat/pan-4774/local-smoke.md), [live-claude-smoke.md](https://github.com/eltmon/overdeck/blob/feature/pan-4774/.pan/uat/pan-4774/live-claude-smoke.md) | — | New CI test `tests/integration/anywhere/two-machine-ac1.slow.test.ts`: 7/7 locally. It runs in the `test-e2e` job of this branch's PR; the job URL follows in a comment when CI finishes. |
| AC-2 | failed | [ac-03-direct-relay.md](https://github.com/eltmon/overdeck/blob/feature/pan-4774/.pan/uat/pan-4774/ac-03-direct-relay.md) | [#4862](https://github.com/eltmon/overdeck/issues/4862) | Local half passed (`no-http`; `--inject-plain-http` exits 1). Relay half not shown: the relay never connected. |
| AC-3 | failed | [ac-03-direct-relay.md](https://github.com/eltmon/overdeck/blob/feature/pan-4774/.pan/uat/pan-4774/ac-03-direct-relay.md), [ac-03-tailscale.md](https://github.com/eltmon/overdeck/blob/feature/pan-4774/.pan/uat/pan-4774/ac-03-tailscale.md) | [#4862](https://github.com/eltmon/overdeck/issues/4862) | Direct route passed (`rtc://`, Tailscale on neither). With UDP blocked the relay cannot connect (werift uses only the UDP TURN URL). **Set up Tailscale** not run: blocked on an operator decision. |
| AC-4 | failed | [ac-04-fly-worker-lanes.md](https://github.com/eltmon/overdeck/blob/feature/pan-4774/.pan/uat/pan-4774/ac-04-fly-worker-lanes.md) | fix `4f2c07a2e9d`; [#4860](https://github.com/eltmon/overdeck/issues/4860) | Gauntlet on home + two Fly VMs passed. The remote worker reported on the VM, but home marked it exited 0.3 s after start; fixed in this branch, to re-check after deploy. |
| AC-5 | passed | [ac-05-fly-conversation.md](https://github.com/eltmon/overdeck/blob/feature/pan-4774/.pan/uat/pan-4774/ac-05-fly-conversation.md) | — | Ran with a branch-built image (`--image`), because the published 0.72.0 lacks `serve --no-open`. |
| AC-6 | failed | [ac-06-ssh-host.md](https://github.com/eltmon/overdeck/blob/feature/pan-4774/.pan/uat/pan-4774/ac-06-ssh-host.md) | [#4861](https://github.com/eltmon/overdeck/issues/4861) | Adding from the browser works and a hand-started server survives removal; removing a managed host does not stop its server (the `pan up` supervisor restarts it). |
| AC-7 | approximated | [ac-07-push.md](https://github.com/eltmon/overdeck/blob/feature/pan-4774/.pan/uat/pan-4774/ac-07-push.md) | — | Desktop Chrome, no phone. 615 / 1,093 / 1,806 ms; payload `aes128gcm`, title absent, decrypts only with the subscriber key. |
| AC-8 | passed | [ac-08-wdoc.md](https://github.com/eltmon/overdeck/blob/feature/pan-4774/.pan/uat/pan-4774/ac-08-wdoc.md) | fixed in this branch | Two doc gaps fixed (`pan tell @<label>/<conv>` in `cli/machines.mdx`; Fly work agents no longer "planned"). |
| AC-9 | passed | [local-smoke.md](https://github.com/eltmon/overdeck/blob/feature/pan-4774/.pan/uat/pan-4774/local-smoke.md) | — | Smoke `auto` and the new `needs-docker` step. |
| AC-10 | approximated | [ac-10-vps-connect.md](https://github.com/eltmon/overdeck/blob/feature/pan-4774/.pan/uat/pan-4774/ac-10-vps-connect.md) | [#4863](https://github.com/eltmon/overdeck/issues/4863) | Not covered: a systemd user service with lingering, the link, and surviving logout and reboot. Fly cannot run systemd; needs a real VPS after a release that ships `connect`. |
| AC-11 | passed | [ac-11-webhook-inbox.md](https://github.com/eltmon/overdeck/blob/feature/pan-4774/.pan/uat/pan-4774/ac-11-webhook-inbox.md) | — | Production inbox 202 while the peer was stopped; the conversation started on return and answered. Storage half from the Miniflare directory smoke. |
| AC-12 | approximated | [local-smoke.md](https://github.com/eltmon/overdeck/blob/feature/pan-4774/.pan/uat/pan-4774/local-smoke.md) | — | Not covered: the **Copy MCP URL** button and `POST /api/access-tokens`; the token came from `pan token create` (same mint function). Two machines, read, message and 403 were shown. |
| AC-13 | passed | [ac-13-open-preview.md](https://github.com/eltmon/overdeck/blob/feature/pan-4774/.pan/uat/pan-4774/ac-13-open-preview.md), [local-smoke.md](https://github.com/eltmon/overdeck/blob/feature/pan-4774/.pan/uat/pan-4774/local-smoke.md) | — | Browser preview showed `hello from b`; the dashboard port was refused. |
| AC-14 | passed | [local-smoke.md](https://github.com/eltmon/overdeck/blob/feature/pan-4774/.pan/uat/pan-4774/local-smoke.md) | — | 618,957 of 1,114,112 bytes for a 5,053,880-byte transcript (counted at the proxy). |
| AC-15 | failed | [ac-15-open-in-editor.md](https://github.com/eltmon/overdeck/blob/feature/pan-4774/.pan/uat/pan-4774/ac-15-open-in-editor.md), [local-smoke.md](https://github.com/eltmon/overdeck/blob/feature/pan-4774/.pan/uat/pan-4774/local-smoke.md) | [#4859](https://github.com/eltmon/overdeck/issues/4859) | W-CONV7, W-WORK7, W-WORK8 and W-LINK7 passed. W-CONV9: Open in editor needs a tailnet or SSH route (409 on a LAN link), and an SSH-host machine targets `ssh-remote+127.0.0.1`. |

The release checklist with every command is [docs/ANYWHERE-RELEASE-CHECKLIST.md](https://github.com/eltmon/overdeck/blob/feature/pan-4774/docs/ANYWHERE-RELEASE-CHECKLIST.md).

**Fly resources after the run** (the only app used was `pan-workspaces`):

```
$ fly machines list -a pan-workspaces
No machines are available on this app pan-workspaces
$ fly volumes list -a pan-workspaces
 ID │ STATE │ NAME │ SIZE │ REGION │ ZONE │ ENCRYPTED │ ATTACHED VM │ CREATED AT
```

The image tag `registry.fly.io/pan-workspaces:pan-4774` (this branch's packed `@overdeck/core`) stays in the registry for re-runs. Home's `[remote] enabled` is back to `false`; the directory lists only home; no throwaway project, peer dashboard or SSH identity remains.
