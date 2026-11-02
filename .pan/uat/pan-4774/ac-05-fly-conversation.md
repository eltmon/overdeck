# PAN-4774 — AC-5: a conversation on a Fly VM, streamed at home, pulled home

- **Commit tested:** home dashboard at deployed integrated main (build `194adf91f96`, `pan` 0.72.0); the VM ran `registry.fly.io/pan-workspaces:pan-4774`, the `pan-workspace` image with this branch's packed `@overdeck/core` 0.72.0 (HEAD `566db45dc87` plus evidence-only commits; `194adf91f96` is an ancestor).
- **Date:** 2026-11-02, 22:08–22:12 UTC. Fly app `pan-workspaces`, region `iad`.
- **Project:** `pan4774-anywhere-smoke` (D-15 throwaway: a clone of `eltmon/prepack-webpack-plugin`, the smallest public repository no registered project names, at `/home/eltmon/Projects/pan4774-anywhere-smoke`).

## Deviations from the plan (D-6) and why

1. **Home needed `remote.enabled = true`.** `add-fly` first answered "Fly machines need remote.enabled: true in the Overdeck config." The switch is read from `~/.overdeck/config.toml` `[remote] enabled` (not `config.yaml`; a `config.yaml` attempt had no effect and was reverted at once). It was set to `true` for the Fly items, following the PAN-4696 live check (`docs/fly-provider.md`), and is restored to `false` after AC-4. No `[remote.fly] image` change was made.
2. **The default image cannot run integrated main yet.** The first `add-fly` (no `--image`) failed after 6 min: `pan serve on Fly machine 862e70fe5e6518 did not answer /api/health within 120 s … error: unknown option '--no-open'`. Provisioning pins the VM's `pan` to home's version, and the published `@overdeck/core` 0.72.0 predates PAN-4652's `serve --no-open` (`895b013cc77` is not an ancestor of `v0.72.0`). The failed machine rolled back cleanly (`fly machines list` empty). This resolves with the next release; it is not a code defect.
3. **Branch image through `--image`, not the peer dashboard.** D-6 names the peer-test-dashboard recipe for this case. Home already runs integrated main, and only the VM side was stale, so the run kept home and passed `--image registry.fly.io/pan-workspaces:pan-4774` per call (D-6 forbids only changing `[remote.fly] image` in home's config). Image: `FROM registry.fly.io/pan-workspaces:latest` plus `npm install -g overdeck-core-0.72.0.tgz` (`npm pack --ignore-scripts` of this tree); checked locally (`pan --version` 0.72.0, `pan serve --help` lists `--no-open`), pushed after `fly auth docker`, digest `sha256:3b086aaf7fbe3208642f69f489d05abc4ee21ab70007d4f93cd8f21e5f059433` (config `sha256:c007fbaf…` equal to the local image). This keeps home's deacon heartbeat and matches "shows online here" literally.

## Run

```
$ pan machines add-fly --project pan4774-anywhere-smoke --image registry.fly.io/pan-workspaces:pan-4774 \
    --model claude-sonnet-5-5 --message "Answer with one short line: hello from Fly." --json
# 22:08:11 → 22:09:53 UTC (1 min 42 s), exit 0
link:   label fly-683dd40ea5d268, environment f029895c-8812-4e6b-a4a7-6012416803e0,
        route wss://pan-workspaces.fly.dev/ws/link?fly-instance=683dd40ea5d268 (public, pairing), peerVersion 0.72.0
record: machine 683dd40ea5d268 (overdeck-machine-6257bdd2), app pan-workspaces, iad, project pan4774-anywhere-smoke
conversation: /conv/@f029895c-8812-4e6b-a4a7-6012416803e0/20261102-8794 (tmux conv-20261102-8794)

$ pan machines list --json   # on home
[('fly-683dd40ea5d268', 'online', 'wss://pan-workspaces.fly.dev/ws/link?fly-instance=683dd40ea5d268')]
```

| Check | Result |
| --- | --- |
| Online at home | `pan machines list --json` on home: `fly-683dd40ea5d268` `online` over the public pinned route. |
| Streams at home | Home's `GET /api/conversations/@f029895c…/20261102-8794/messages` returned `user: Answer with one short line: hello from Fly.` and `assistant: Hello from Fly.` within 10 s of the add. Screenshot [ac-05-fly-conversation.png](ac-05-fly-conversation.png) (home dashboard, isolated Playwright Chromium, `#overdeck_token` sign-in): the conversation with the `on fly-683dd40ea5d268` chip, `active`, and the reply. |
| Uncommitted change on the VM | `fly ssh console -a pan-workspaces --machine 683dd40ea5d268 -C "sh -c 'echo fly-4774 > /workspace/pan4774-anywhere-smoke/uncommitted.txt …'"` → `?? uncommitted.txt` on `0934c5c`. |
| Pull home | `pan conv pull @f029895c-8812-4e6b-a4a7-6012416803e0/20261102-8794 --stop-turn --json` → `{"step":"finish","state":"done","mode":"online","conversation":{"id":3509,"name":"20261102-955d"}}` in 6 s. Home row `20261102-955d` has cwd `/home/eltmon/Projects/pan4774-anywhere-smoke` (the throwaway clone, not a primary checkout), and that clone now holds `uncommitted.txt` = `fly-4774` (`git status`: `## master...origin/master`, `?? uncommitted.txt`). |
| VM refuses new turns | `POST /api/conversations/@f029895c…/20261102-8794/message` through home → HTTP 409 `{"error":"Continued on e91ffda1; this copy is read-only","code":"conversation-released","releasedTo":"e91ffda1-431a-483d-a6e4-a72079516ea4"}` (`e91ffda1…` is home). |
| Unlink destroys the VM | `pan machines unlink fly-683dd40ea5d268` → "Unlinked … Destroyed the Fly machine behind fly-683dd40ea5d268." Then `fly machines list -a pan-workspaces` → "No machines are available", and home's link list is empty. |

Cleanup: the continued conversation `20261102-955d` on home was stopped (`POST /api/conversations/20261102-955d/stop` → `{"success":true}`). The throwaway project stays registered for AC-4 (D-15); `remote.enabled` is restored after AC-4.

Status: passed
