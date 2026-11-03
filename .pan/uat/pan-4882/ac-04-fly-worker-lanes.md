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
