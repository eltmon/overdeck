# PAN-4882 preflight — deployed build, fix SHAs, versions, clean state

Date: 2026-11-03T06:29Z. Host: eltmon-z790 (home, `http://localhost:3011`).

## Deployed build

```
$ curl -s localhost:3011/api/health | jq '{buildCommit, builtAt, deploymentCoherent}'
{
  "buildCommit": "b1d9d9dc554b479d4715932bdfc892e297fddd93",
  "builtAt": "2026-11-03T04:42:57.799Z",
  "deploymentCoherent": true
}
```

buildCommit: `b1d9d9dc554b479d4715932bdfc892e297fddd93`

## Fix SHAs (D-1)

```
$ for s in 04f8bccc9df 6ca4ae19e6e af764fb9907 054aea3e486; do git merge-base --is-ancestor $s b1d9d9dc554b479d4715932bdfc892e297fddd93 && echo "$s yes"; done
04f8bccc9df yes
6ca4ae19e6e yes
af764fb9907 yes
054aea3e486 yes
$ git merge-base --is-ancestor v0.73.1 b1d9d9dc554b479d4715932bdfc892e297fddd93 && echo "v0.73.1 yes" || echo "v0.73.1 no"
v0.73.1 no
```

All four fixes are in the deployed build, so D-1 says proceed. The build does not contain `v0.73.1`.

## Versions (D-2)

```
$ pan --version
0.73.0
$ npm view @overdeck/core version
0.73.1
$ npm view @overdeck/core dist-tags
{ 'pre-cut': '0.51.0', latest: '0.73.1' }
$ npm view @overdeck/core@0.73.0 version
0.73.0
$ npm view @overdeck/core time --json | jq '{"0.73.0": .["0.73.0"], "0.73.1": .["0.73.1"]}'
{
  "0.73.0": "2026-11-03T03:54:50.414Z",
  "0.73.1": "2026-11-03T06:16:43.590Z"
}
```

**Deviation from a literal reading of D-2.** Home's version (0.73.0) differs from npm `latest` (0.73.1, published
06:16Z, after planning). D-2's "unequal" branch exists for the case where home's version is not on npm, so
`npm install -g @overdeck/core@<home version>` has nothing to install. That trigger is false here: 0.73.0 is
published, and both `provisionFlyMachine` and the SSH-machine add pin the VM to home's exact version, not to
`latest`. Waiting 30 minutes cannot make 0.73.1 equal 0.73.0, and a branch image would solve a problem that does
not exist. So every VM uses `registry.fly.io/pan-workspaces:latest` plus `npm install -g @overdeck/core@0.73.0`
when its `pan --version` differs.

install path: published 0.73.0

**Hazard: a mid-run reload of home.** 0.73.1 is now on npm, and the Flywheel reloads home after green merges. A
reload would restart home, drop the test links, and make any VM already at 0.73.0 a `version-mismatch`. Each VM
item re-reads `/api/health` `buildCommit` and `pan --version` before provisioning and uses home's version at that
moment. The Flywheel was asked to hold reloads:

```
$ pan tell flywheel-orchestrator "work PAN-4882: starting live Anywhere re-run ..."
Error: Agent flywheel-orchestrator not running
$ pan tell conv-flywheel "work PAN-4882: starting live Anywhere re-run against home build b1d9d9dc554 (v0.73.0). Fly VMs install @overdeck/core@0.73.0 to match home. Please hold pan reload of home (e.g. to 0.73.1) until PAN-4882's live checks finish — a reload mid-run drops the test links and causes version-mismatch on VMs already provisioned. I will tell you when the VMs are torn down."
Message delivered to conv-flywheel's main agent
```

## Clean start state

```
$ fly auth whoami
<operator Fly account>
$ fly machines list -a pan-workspaces
No machines are available on this app pan-workspaces

$ pan account status
Signed in as eltmon (GitHub id 678719)
Account service: https://account.overdeck.ai
This device:     Linux device (<redacted>)
Access:          active

$ pan machines list
This machine: eltmon-z790 (da4f-8c0c-2c16-a4de-a128)

LABEL                       STATE  ROUTE  ACCESS  SSH  FINGERPRINT               LOAD                        TAGS
eltmon-z790 (this machine)  self   -      -       -    da4f-8c0c-2c16-a4de-a128  CPU 15% · 10 GB · 7 agents  docker, gpu, linux

No linked machines. Link one with `pan machines link <pairing-url>` using a `pan pair` link from the other machine.

Inbound: no machine links to this one.

$ pan machines directory --json | jq '{plan, machines: [.machines[].label]}'
{
  "plan": "tester",
  "machines": [
    "eltmon-z790"
  ]
}

$ test -e ~/.ssh/id_ed25519 && echo "id_ed25519 EXISTS" || echo "id_ed25519 absent"
id_ed25519 absent

$ command -v code codium code-insiders; echo "exit=$?"
exit=1

$ grep -n -A2 '^\[remote\]' ~/.overdeck/config.toml
26:[remote]
27-enabled = false
28-resiliency_tier = "ephemeral"
```

Consequences for later items:

- No Fly machine and no linked machine exist, so the run starts clean.
- `plan: tester` is relay-eligible, so the relay items run.
- `~/.ssh/id_ed25519` is absent, so WI-9 may install the throwaway key as the default identity.
- No VS Code, VSCodium or Insiders binary is on `PATH`, so AC-15 can click **Open in editor** → **VS Code**
  without opening a real editor window (D-11).
- `[remote] enabled = false` is the value to restore after AC-4.

Status: passed — deployed build b1d9d9dc554 contains all four fix SHAs; install path published 0.73.0
