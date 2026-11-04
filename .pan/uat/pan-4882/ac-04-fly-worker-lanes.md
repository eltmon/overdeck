# PAN-4882 — AC-4: a remote worker on Fly and a three-machine gauntlet

- **Commit tested:** home deployed build `b1d9d9dc554` (`pan` 0.73.0); fix under test `6ca4ae19e6e` (#4864, the
  remote-worker follower's startup grace, first committed as `4f2c07a2e9d`). The follower runs on home, so home's
  build is the one that matters; both VMs run published 0.73.0 (`7de98491242`).
- **Date:** 2026-11-03. Fly app `pan-workspaces`, region `iad`.

## Setup

Throwaway project (D-14):

```
$ git clone -q https://github.com/eltmon/prepack-webpack-plugin /home/eltmon/Projects/pan4882-anywhere-smoke
$ pan project add /home/eltmon/Projects/pan4882-anywhere-smoke --name pan4882-anywhere-smoke
$ grep -n -A7 'pan4882-anywhere-smoke:' ~/.overdeck/projects.yaml
496:  pan4882-anywhere-smoke:
497-    name: pan4882-anywhere-smoke
498-    path: /home/eltmon/Projects/pan4882-anywhere-smoke
499-    tracker: github
500-    github_repo: eltmon/prepack-webpack-plugin
501-    issue_prefix: PANANYWHER
502-    workspace:
503-      default_branch: master
```

The proposed prefix `PANANYWHER` matches `^[A-Z]+$`, so the PAN-4860 fix holds and no regression issue is filed.
The worker issue id is `PANANYWHER-1`.

```
$ sed -i '27s/^enabled = false$/enabled = true/' ~/.overdeck/config.toml     # restored to false in teardown
26:[remote]
27-enabled = true
$ git -C /home/eltmon/Projects/pan4882-anywhere-smoke worktree add -q workspaces/feature-pananywher-1 -b feature/pananywher-1
$ curl -s localhost:3011/api/health | jq -r .buildCommit; pan --version     # re-read before provisioning
b1d9d9dc554b479d4715932bdfc892e297fddd93
0.73.0
```

Two VMs in parallel, default image (install path `published 0.73.0`, so no `--image`):

```
$ pan machines add-fly --project pan4882-anywhere-smoke --json   # ×2, started 06:34:23, exit 0 at 06:38:36 and 06:38:49
fly1: link 3ecdc2a3-130a-4da5-b48b-8fe4f888e77d, label fly-87477d7a911d28, machine 87477d7a911d28,
      peerVersion 0.73.0, route wss://pan-workspaces.fly.dev/ws/link?fly-instance=87477d7a911d28
fly2: link bef5dd60-1c25-44e8-8f44-da180db796f7, label fly-185770e4f99e38, machine 185770e4f99e38,
      peerVersion 0.73.0, route wss://pan-workspaces.fly.dev/ws/link?fly-instance=185770e4f99e38

$ pan machines list --json | jq -c '[.links[] | {label,state,currentRoute}]'
[{"label":"fly-87477d7a911d28","state":"online","currentRoute":"wss://pan-workspaces.fly.dev/ws/link?fly-instance=87477d7a911d28"},
 {"label":"fly-185770e4f99e38","state":"online","currentRoute":"wss://pan-workspaces.fly.dev/ws/link?fly-instance=185770e4f99e38"}]
```

**Deviation from NFR-3:** `fly machines list` shows both `add-fly` machines as `shared-cpu-2x:2048MB`. `add-fly`
chooses the size itself and takes no size flag; the hand-made VMs are `shared-cpu-1x:2048MB` as NFR-3 says.

On each VM (`fly ssh console`): `pan --version` → `0.73.0`; the provisioner registered the project at
`/workspace/pan4882-anywhere-smoke` with `issue_prefix: PANANYWHER` in `/.overdeck/projects.yaml`; the issue
workspace was prepared as the checklist's AC-4 says:

```
$ cd /workspace/pan4882-anywhere-smoke && git worktree add -q workspaces/feature-pananywher-1 -b feature/pananywher-1 && git worktree list
/workspace/pan4882-anywhere-smoke                                  0934c5c [master]
/workspace/pan4882-anywhere-smoke/workspaces/feature-pananywher-1  0934c5c [feature/pananywher-1]
$ command -v claude
/usr/bin/claude
```

(same output on both VMs). The workers and lanes are real Claude Code sessions, as in PAN-4774.

## Remote worker

Root conversation on home (`POST /api/conversations` with the internal token and an `Origin` header,
body `{"projectKey":"pan4882-anywhere-smoke","message":"Root for PAN-4882 lanes. Wait."}`):

```
{"id":3531,"name":"20261103-6766","status":"active","cwd":"/home/eltmon/Projects/pan4882-anywhere-smoke","harness":"claude-code","projectKey":"pan4882-anywhere-smoke"}
```

From `/home/eltmon/Projects/pan4882-anywhere-smoke`:

```
$ pan worker run --machine fly-87477d7a911d28 --issue PANANYWHER-1 --read-only --parent conv-20261103-6766 \
    --harness claude-code --model claude-sonnet-5-5 --ignore-unpushed --detach \
    --prompt "Read README.md in your working directory and write one sentence that says what this project does. Send that sentence as your report with pan worker report, then stop."
06:51:09  Could not start the worker on fly-87477d7a911d28: fly-87477d7a911d28: Secure channel to wss://pan-workspaces.fly.dev/ws/link?fly-instance=87477d7a911d28 did not open within 2500 ms
06:51:31  (same command) same error, rc=1
06:51:49  (same command) Started agent-pananywher-1-worker-1 on fly-87477d7a911d28        rc=0, returned 06:52:07
```

Between the attempts home's `pan machines list --json` showed fly1 `online` with a fresh heartbeat
(`lastHeartbeatAt: 06:51:13.455Z`, no incident). The CLI opens its own secure channel over the public Fly route
with a 2.5 s budget (`LINK_WAIT_MS`, `src/lib/anywhere/link-client.ts`), and two of three attempts missed it.
This is not the AC-4 pass condition, but it is a defect and is filed under WI-13.

Home's stand-in and the change log:

```
$ ls -la --time-style=full-iso ~/.overdeck/agents/agent-pananywher-1-worker-1/remote.json
-rw------- 1 eltmon eltmon 421 2026-11-03 01:52:20.793 (06:52:20.793Z)
{ "remoteId": "agent-pananywher-1-worker-1", "parentId": "conv-20261103-6766", "issueId": "PANANYWHER-1",
  "createdAt": "2026-11-03T06:52:06.587Z", "state": "running", "lastSeq": 1, "lastSeenAt": "2026-11-03T06:52:20.766Z",
  "unreachableSince": null, … }

# .tmp/pan-4882/remote-json-changes.log — jq -c '{state,lastSeq,lastSeenAt}' every 2 s, printed on change
06:52:23 {"state":"running","lastSeq":1,"lastSeenAt":"2026-11-03T06:52:20.766Z"}

$ pan worker wait agent-pananywher-1-worker-1 --timeout 600          # started 06:52:2x
This project is a webpack plugin that runs Prepack over matched JavaScript output files (configurable via `test` and `prepack` options) to optimize them during the build.
worker agent-pananywher-1-worker-1 report 1: done; next: pan worker wait agent-pananywher-1-worker-1 --after 1
wait-exit=0 06:52:26

# 60 s later, past the 60 s startup grace:
$ jq -c '{state,lastSeq,lastSeenAt,createdAt,unreachableSince}' ~/.overdeck/agents/agent-pananywher-1-worker-1/remote.json
{"state":"running","lastSeq":1,"lastSeenAt":"2026-11-03T06:53:32.870Z","createdAt":"2026-11-03T06:52:06.587Z","unreachableSince":null}
```

On fly1, `/.overdeck/agents/agent-pananywher-1-worker-1/reports/0001.json`:

```json
{ "seq": 1, "at": "2026-11-03T06:52:16.552Z", "status": "done",
  "body": "This project is a webpack plugin that runs Prepack over matched JavaScript output files (configurable via `test` and `prepack` options) to optimize them during the build.\n" }
```

**Gap in the change log.** The worker reported 10 s after the stand-in was created (06:52:16.552Z), and the
follower picked the report up at 06:52:20.766Z. The watcher started at 06:52:23, after the start command
returned, so its first line already shows `lastSeq: 1`; it has no line from the 14 s before the report. The
result still settles the check. In PAN-4774 the stand-in read `state: exited`, `lastSeq: 0` 0.3 s after it was
written, and a stand-in in `exited` is never followed again, so `lastSeq` could not have advanced. Here the
follower kept following until the report (`lastSeq: 1`, `state: running`), `pan worker wait` exited 0 with the
report, and the follower was still following 86 s after creation.

Result: passed.

## Gauntlet

```
$ pan lane start --role play --run pan4882 --key <home|fly1|fly2> --parent 20261103-6766 --project pan4882-anywhere-smoke \
    --harness claude-code --model claude-sonnet-5-5 [--machine fly-87477d7a911d28 | --machine fly-185770e4f99e38] --no-wait --json \
    --prompt "Write the single line 'lane <key> ok' to a file named report.md in your current directory, then run: pan lane report --file report.md --status done. Then stop."
home  20261103-8325  home                /home/eltmon/Projects/pan4882-anywhere-smoke-lanes/pan4882-home-play-i1   (06:55:34)
fly1  20261103-2283  fly-87477d7a911d28  /workspace/pan4882-anywhere-smoke-lanes/pan4882-fly1-play-i1              (06:55:40)
fly2  20261103-2177  fly-185770e4f99e38  /workspace/pan4882-anywhere-smoke-lanes/pan4882-fly2-play-i1              (06:55:43)

$ pan lane wait <name> --timeout 600          # all three in parallel from 06:56:01
== 20261103-2283 exit=0 06:56:19   lane fly1 ok — lane 20261103-2283 report 1: done
== 20261103-2177 exit=0 06:56:19   lane fly2 ok — lane 20261103-2177 report 1: done
== 20261103-8325 exit=0 06:56:33   lane home ok — lane 20261103-8325 report 1: done

$ pan lane list --run pan4882 --json | jq -r '.[] | "\(.name) \(.role) \(.key) \(.machine.label // "home") report=\(.report.status)"'
20261103-8325 play home home report=done
20261103-2283 play fly1 fly-87477d7a911d28 report=done      (machine.reachable: true)
20261103-2177 play fly2 fly-185770e4f99e38 report=done      (machine.reachable: true)

$ pan lane stop <name>
Stopped lane pan4882/home (conv 3532) · Stopped lane pan4882/fly1 (20261103-2283) · Stopped lane pan4882/fly2 (20261103-2177)
$ pan lane reap <name>
Reaped lane pan4882/<key> (…): directory removed, conversation archived        (all three)
```

All three secure-channel lane starts succeeded on the first attempt. Each lane was a real Claude Code (Sonnet 5.5)
session that wrote its report and ran `pan lane report` itself.

## Cleanup

```
$ curl -s -X POST -H "Origin: http://localhost:3011" -H "x-overdeck-internal-token: <redacted>" localhost:3011/api/conversations/20261103-6766/stop
{"success":true}
$ pan machines unlink fly-87477d7a911d28
Unlinked "fly-87477d7a911d28"; its token here was revoked. …
Destroyed the Fly machine behind fly-87477d7a911d28.
$ pan machines unlink fly-185770e4f99e38
Unlinked "fly-185770e4f99e38"; its token here was revoked. …
Destroyed the Fly machine behind fly-185770e4f99e38.
$ pan project remove pan4882-anywhere-smoke
✓ Removed project: pan4882-anywhere-smoke
$ rm -rf /home/eltmon/Projects/pan4882-anywhere-smoke /home/eltmon/Projects/pan4882-anywhere-smoke-lanes
$ sed -i '27s/^enabled = true$/enabled = false/' ~/.overdeck/config.toml; grep -n -A1 '^\[remote\]' ~/.overdeck/config.toml
26:[remote]
27-enabled = false
$ grep -c pan4882 ~/.overdeck/projects.yaml
0
$ pan projects list | grep -c pan4882          # run 07:5x, after teardown
0
$ pan machines list --json | jq -c '[.links[].label]'
[]
$ fly machines list -a pan-workspaces
 874235c0e259e8 │ pan4882-relay │ started │ … │ shared-cpu-1x:2048MB        # the relay VM only (AC-2/AC-3, still running)
```

Neither AC-4 VM is in `fly machines list`.

Status: passed — remote worker report returned by pan worker wait with the stand-in following; three lanes reported
