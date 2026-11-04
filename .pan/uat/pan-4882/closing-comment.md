# PAN-4882 — closing comment

Posted 2026-11-03 with `gh issue comment 4882 --repo eltmon/overdeck --body-file .tmp/pan-4882/comment.md`:
https://github.com/eltmon/overdeck/issues/4882#issuecomment-6598131991

Body as posted:

## PAN-4882 re-run results

The relay checks did not run again: the relay VM's three device codes (SHJC-RFDS, VSVP-NJXJ, LJVW-TZKT) all expired unapproved over 57 minutes during the operator's night, so AC-2 relay half and AC-3 relay are `not-run`. [#4886](https://github.com/eltmon/overdeck/issues/4886) now tracks the PAN-4862 live relay check, with the replay recipe. The other three fixes passed live.

| Check | Status | Evidence | Issue |
| --- | --- | --- | --- |
| AC-2 relay half | not-run | [ac-02-03-relay.md](https://github.com/eltmon/overdeck/blob/feature/pan-4882/.pan/uat/pan-4882/ac-02-03-relay.md) | [#4886](https://github.com/eltmon/overdeck/issues/4886) |
| AC-3 relay (UDP blocked) | not-run | [ac-02-03-relay.md](https://github.com/eltmon/overdeck/blob/feature/pan-4882/.pan/uat/pan-4882/ac-02-03-relay.md) | [#4886](https://github.com/eltmon/overdeck/issues/4886) |
| AC-3 relay (TCP 443 only) | not-run | [ac-02-03-relay.md](https://github.com/eltmon/overdeck/blob/feature/pan-4882/.pan/uat/pan-4882/ac-02-03-relay.md) | [#4886](https://github.com/eltmon/overdeck/issues/4886) |
| AC-4 remote worker + gauntlet | passed | [ac-04-fly-worker-lanes.md](https://github.com/eltmon/overdeck/blob/feature/pan-4882/.pan/uat/pan-4882/ac-04-fly-worker-lanes.md) | [#4885](https://github.com/eltmon/overdeck/issues/4885) (side finding) |
| AC-6 managed SSH removal | passed | [ac-06-ssh-host.md](https://github.com/eltmon/overdeck/blob/feature/pan-4882/.pan/uat/pan-4882/ac-06-ssh-host.md) | — |
| AC-15 Open in editor on SSH host | passed | [ac-15-open-in-editor.md](https://github.com/eltmon/overdeck/blob/feature/pan-4882/.pan/uat/pan-4882/ac-15-open-in-editor.md) | — |

- **AC-4:** `pan worker wait` exited 0 with the fly1 worker's report, and home's stand-in stayed `running` through the report (`lastSeq: 1`) and past the 60 s grace. All three lanes (home, fly1, fly2) reported. Two of three `pan worker run` starts first failed with `Secure channel … did not open within 2500 ms` against an online link, filed as [#4885](https://github.com/eltmon/overdeck/issues/4885).
- **AC-6:** after **Remove** in the browser, the SSH VM had no dashboard or supervisor process and `/api/health` answered `000` at 30, 90 and 180 s.
- **AC-15:** the route returned `code --remote ssh-remote+<hex> /root/ac15`; the hex decodes to `{"hostName":"127.0.0.1","user":"root","port":10022}`.

**Deployed build:** `b1d9d9dc554` (contains `04f8bccc9df`, `6ca4ae19e6e`, `af764fb9907`, `054aea3e486`; not `v0.73.1`). **Home version:** 0.73.0. VMs installed published `@overdeck/core@0.73.0` (npm `latest` had moved to 0.73.1; VMs pin to home's version, see [preflight.md](https://github.com/eltmon/overdeck/blob/feature/pan-4882/.pan/uat/pan-4882/preflight.md)). The checklist's re-run lines are in `docs/ANYWHERE-RELEASE-CHECKLIST.md`; cleanup is verified in [cleanup.md](https://github.com/eltmon/overdeck/blob/feature/pan-4882/.pan/uat/pan-4882/cleanup.md).

Final `fly machines list -a pan-workspaces`:

```
No machines are available on this app pan-workspaces
```
