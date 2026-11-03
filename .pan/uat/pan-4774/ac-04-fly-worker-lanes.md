# PAN-4774 — AC-4 Fly half: a remote worker and a three-machine gauntlet

- **Commit tested:** home dashboard at deployed integrated main (build `194adf91f96`, `pan` 0.72.0); both Fly VMs ran `registry.fly.io/pan-workspaces:pan-4774` (this branch's packed `@overdeck/core`, see [ac-05-fly-conversation.md](ac-05-fly-conversation.md) for the image and the `remote.enabled` toggle). Fix commit: `4f2c07a2e9d`.
- **Date:** 2026-11-02, 22:13–22:24 UTC. Fly app `pan-workspaces`, region `iad`.
- **Machines (D-14):** home `eltmon-z790`, plus `fly-80ee65ec0672d8` (fly1) and `fly-8dd71efe052318` (fly2), both from `pan machines add-fly --project pan4774-anywhere-smoke --image registry.fly.io/pan-workspaces:pan-4774 --json` run in parallel (22:13:10 → 22:14:59, both `online`).
- **Root conversation:** `20261102-7200` on home (`POST /api/conversations` in the throwaway project; stopped at the end).

## Remote worker — failed, fixed in `4f2c07a2e9d`

```
$ pan worker run --machine fly-80ee65ec0672d8 --issue ODKSMOKE-1 --read-only --parent conv-20261102-7200 \
    --harness claude-code --model claude-sonnet-5-5 --ignore-unpushed --detach \
    --prompt "Read README.md in your working directory and write one sentence that says what this project does. Send that sentence as your report with pan worker report, then stop."
agent-odksmoke-1-worker-1
Started agent-odksmoke-1-worker-1 on fly-80ee65ec0672d8          # 22:16:55

$ pan worker wait agent-odksmoke-1-worker-1 --timeout 600         # exit 2 at 22:18:02
[no report — transcript: not found]
worker agent-odksmoke-1-worker-1 exited without a report
```

Home's stand-in (`~/.overdeck/agents/agent-odksmoke-1-worker-1/remote.json`) read `state: exited`, `lastSeq: 0`, `lastSeenAt: 2026-11-02T22:16:57.560Z`, 0.3 s after it was written. On fly1 the worker was alive and did the work: its pane showed "I sent the report with pan worker report, and it was recorded", and `/.overdeck/agents/agent-odksmoke-1-worker-1/reports/0001.json` held:

```json
{ "seq": 1, "at": "2026-11-02T22:17:09.357Z", "status": "done",
  "body": "prepack-webpack-plugin is a webpack plugin that runs the Prepack optimizer on the files in your webpack build (matched by a configurable regex) using configurable Prepack options.\n" }
```

A second `pan worker wait` gave the same answer, because a stand-in in `exited` is never followed again.

**Root cause.** `RemoteWorkerFollower.poll` (`src/dashboard/server/services/remote-worker-follower.ts`) polls the owner as soon as the stand-in is written and treats `liveness.confirmedDead` as final. Until the VM's launcher starts Claude Code in the new pane, the owner's verdict is `runtime-missing`, which `isConfirmedDead()` counts as dead. The local `pan worker wait` guards the same window (`WAIT_STARTUP_GRACE_MS`, 60 s, unless the worker was seen alive); the follower did not. The smoke never hit it because its fake harness starts at once.

**Fix (D-4).** `4f2c07a2e9d`: a confirmed-dead answer ends the follow only once the worker was seen alive or 60 s have passed since the stand-in was created. One source file, 10 lines; two new tests in `src/dashboard/server/__tests__/remote-worker-follower.test.ts` fail before the change and pass after (`npx vitest run …remote-worker-follower.test.ts …remote-lane-follower.test.ts`: 14 passed). Home runs the deployed build, so the live re-check of this half happens after this branch is merged and deployed.

**Also found:** `pan project add` proposed the issue prefix `PAN4774ANY` for the throwaway project, but `parseIssueId` (`src/lib/issue-id.ts`) accepts only a letters-only prefix, so `PAN4774ANY-1` resolved to no project ("PAN4774ANY-1's project has no github_repo or gitlab_repo here"). The run renamed the throwaway project's prefix to `ODKSMOKE` on home and on both VMs. Filed as [#4860](https://github.com/eltmon/overdeck/issues/4860).

## Three-machine gauntlet — passed

```
$ pan lane start --role play --run pan4774 --key <home|fly1|fly2> --parent 20261102-7200 --project pan4774-anywhere-smoke \
    --harness claude-code --model claude-sonnet-5-5 [--machine fly-80ee65ec0672d8 | --machine fly-8dd71efe052318] --no-wait --json \
    --prompt "Write the single line 'lane <key> ok' to a file named report.md in your current directory, then run: pan lane report --file report.md --status done. Then stop."
home  20261102-2143  home                /home/eltmon/Projects/pan4774-anywhere-smoke-lanes/pan4774-home-play-i1
fly1  20261102-9497  fly-80ee65ec0672d8  /workspace/pan4774-anywhere-smoke-lanes/pan4774-fly1-play-i1
fly2  20261102-1770  fly-8dd71efe052318  /workspace/pan4774-anywhere-smoke-lanes/pan4774-fly2-play-i1

$ pan lane wait <name> --timeout 600     # all three in parallel, 22:20:21 → 22:20:57, each exit 0
lane home ok   — lane 20261102-2143 report 1: done
lane fly1 ok   — lane 20261102-9497 report 1: done
lane fly2 ok   — lane 20261102-1770 report 1: done

$ pan lane list --run pan4774 --json
20261102-2143 play home home
20261102-9497 play fly1 fly-80ee65ec0672d8
20261102-1770 play fly2 fly-8dd71efe052318

$ pan lane stop <name>   → Stopped lane pan4774/home (conv 3511) · pan4774/fly1 (20261102-9497) · pan4774/fly2 (20261102-1770)
$ pan lane reap <name>   → Reaped lane pan4774/<key> (…): directory removed, conversation archived   (all three, exit 0)
```

Each lane was a real Claude Code (Sonnet 5.5) session that wrote its report and ran `pan lane report` itself.

## Cleanup

- `pan machines unlink fly-80ee65ec0672d8` and `pan machines unlink fly-8dd71efe052318` → "Destroyed the Fly machine behind …"; `fly machines list -a pan-workspaces` → "No machines are available"; `fly volumes list -a pan-workspaces` → empty; home's link list → `[]`.
- Root conversation `20261102-7200` stopped (`{"success":true}`).
- D-15 teardown: `pan project remove pan4774-anywhere-smoke` ("✓ Removed project"; no workspace record existed), then `/home/eltmon/Projects/pan4774-anywhere-smoke` and `/home/eltmon/Projects/pan4774-anywhere-smoke-lanes` deleted.
- `pan projects list` afterwards lists no `pan4774-anywhere-smoke` (`pan projects list | grep -ci pan4774` → `0`).
- `~/.overdeck/config.toml` `[remote] enabled` restored to `false`.
- The image tag `registry.fly.io/pan-workspaces:pan-4774` stays for the remaining Fly items.

## Filed

- [#4860](https://github.com/eltmon/overdeck/issues/4860) — `pan project add` proposes an issue prefix with digits, which `parseIssueId` rejects.
- The remote-worker startup race is fixed in this branch (`4f2c07a2e9d`), not filed.

Status: failed — remote worker half fixed in 4f2c07a2e9d (gauntlet half passed)
