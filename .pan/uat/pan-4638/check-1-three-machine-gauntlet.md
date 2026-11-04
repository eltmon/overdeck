# PAN-4638 — live three-machine gauntlet (desktop, Fly VM, Mac laptop)

- **Date:** 2026-11-04, 10:25–10:42 UTC.
- **Home (desktop):** `eltmon-z790`, dashboard `http://localhost:3011`, deployed build `65e3b1adf86e0facfaffc2846e7d79fbf8ea6b55` (built 2026-11-04T09:01:30Z, `deploymentCoherent: true`), `pan` 0.73.1.
- **Laptop:** the Mac rig `Edwards-MacBook-Air.local`, `@overdeck/core` 0.73.1, linked from home over `tcp://192.168.1.83:3011` (already linked before the run; left linked).
- **Fly VM:** `fly-8d4101ae001028` (machine `8d4101ae001028`, app `pan-workspaces`, region `iad`), peer version 0.73.1, made with `pan machines add-fly` for this run and destroyed after it.
- **Harness for every lane:** Claude Code, `claude-sonnet-5-5`, effort `low`. Each lane was a real session that did the work and ran `pan lane report` itself.
- **Result:** passed. Two display bugs filed: #5005 and #5006.

No newer build than 0.73.1 was needed on the Mac: every step ran on the published 0.73.1.

## Setup

Demo repository (public, throwaway): `https://github.com/eltmon/anywhere-lanes-demo`, one `README.md` and a 6-line `greet.js`.

```
$ gh repo create eltmon/anywhere-lanes-demo --public ...      # GitHub answered 502/500 twice; the push succeeded on retry
$ pan project add /home/eltmon/Projects/anywhere-lanes-demo --name anywhere-lanes-demo
  github_repo: eltmon/anywhere-lanes-demo
  issue_prefix: ANYWHERELA                                      # letters only, so the #4860 fix holds
$ sed -i '27s/^enabled = false$/enabled = true/' ~/.overdeck/config.toml     # [remote] enabled; restored in cleanup

$ pan machines add-project eltmon-z790 anywhere-lanes-demo --to Edwards-MacBook-Air.local --json   # 10:29:13 → 10:29:16
Cloning anywhere-lanes-demo on Edwards-MacBook-Air.local…
{"step":"done","projectKey":"anywhere-lanes-demo","files":[]}

$ pan machines add-fly --project anywhere-lanes-demo --json                                     # 10:29:23 → 10:33:30, exit 0
link d61d497d-5209-4afe-b12b-50de89ca00de, label fly-8d4101ae001028, machine 8d4101ae001028, peerVersion 0.73.1
```

`pan machines list` before the lanes (full output: [machines-list.txt](machines-list.txt)):

```
LABEL                       STATE   ROUTE                                                             LOAD                        TAGS
eltmon-z790 (this machine)  self    -                                                                 CPU 1% · 38 GB · 10 agents  docker, gpu, linux
Edwards-MacBook-Air.local   online  tcp://192.168.1.83:3011                                           CPU n/a · 2 GB · 0 agents   ios-sim, macos
fly-8d4101ae001028          online  wss://pan-workspaces.fly.dev/ws/link?fly-instance=8d4101ae001028  CPU 8% · 1 GB · 0 agents    linux
```

Root (orchestrator) conversation on home, `POST /api/conversations` with the internal token and an `Origin` header:

```
{"id":3611,"name":"20261104-8868","status":"active","cwd":"/home/eltmon/Projects/anywhere-lanes-demo","harness":"claude-code","projectKey":"anywhere-lanes-demo"}
```

The Flywheel was asked at 10:26 UTC to hold `pan reload` of home for the run.

## The run

All commands ran from `/home/eltmon/Projects/anywhere-lanes-demo` with
`--run pan4638 --parent 20261104-8868 --project anywhere-lanes-demo --harness claude-code --model claude-sonnet-5-5 --effort low --no-wait --json`.

| Lane | Role | Command extras | Placed on | Started → report (UTC) | Report |
| --- | --- | --- | --- | --- | --- |
| `20261104-3094` | builder `farewell` | (none) | home | 10:33:49 → 10:35:05 | `builder on eltmon-z790: added farewell`; pushed `pan4638/farewell@0b9cc44` |
| `20261104-4962` | critic `farewell` | `--for farewell --machine fly-8d4101ae001028` | Fly VM | 10:35:26 → 10:35:55 | `critic on 8d4101ae001028 at 0b9cc44` … PASS, 0 defects |
| `20261104-3382` | builder `shout` | (none) | home | 10:35:40 → 10:37:01 | `builder on eltmon-z790: added shout`; pushed `pan4638/shout@df834a5` |
| `20261104-4727` | critic `shout` | `--for shout --machine Edwards-MacBook-Air.local` | Mac | 10:37:01 → 10:37:56 | `critic on Edwards-MacBook-Air.local at df834a5` … PASS, 0 defects |
| `20261104-6382` | builder `twice` | (none) | home | 10:38:13 → 10:40:07 | `builder on eltmon-z790: added twice`; pushed `pan4638/twice@f0b72ba` |
| `20261104-9652` | play `auto` | `--machine auto` | Fly VM (Auto) | 10:38:20 → 10:38:41 | `play lane auto on 8d4101ae001028` |
| `20261104-3234` | play `automac` | `--machine auto --needs macos` | Mac (Auto) | 10:38:27 → 10:39:21 | `play lane automac on Edwards-MacBook-Air.local` |
| `20261104-3996` | critic `twice` | `--for twice --machine auto --needs docker` | home (Auto) | 10:40:21 → 10:41:22 | `critic on eltmon-z790 at f0b72ba, docker server 29.3.0` … PASS, 0 defects |

Each critic's first report line is `hostname` and `git rev-parse --short HEAD` run inside the lane, so the
reports prove where each lane ran and that each remote critic checked out the builder's pushed head from `origin`.
`pan lane wait` returned exit 0 with the report for every lane.

### Auto placement

```
$ pan lane start --role play --key auto --machine auto ...
Auto → fly-8d4101ae001028 (CPU pressure 0%, 1 GB free, 0 agents)

$ pan lane start --role play --key automac --machine auto --needs macos ...
Auto → Edwards-MacBook-Air.local (CPU pressure n/a, 2 GB free, 0 agents)

$ pan lane start --role critic --for twice --machine auto --needs docker ...
{ ..., "machine": null }            # placed on this machine, but no "Auto →" line: #5006
```

- `--machine auto` with no tags chose the Fly VM: lowest CPU pressure (Fly 0%, home 1%; the Mac reports no PSI, so it ranks after any number), which is the documented rule (`src/lib/anywhere/placement.ts`).
- `--needs docker` could only land on home, the one machine tagged `docker`; the critic ran `docker version` there (server 29.3.0). The Fly VM carries only `linux` and the Mac `ios-sim, macos`, so a Docker critic on a Fly VM is not possible with the default image. PAN-4760's wording (`--machine fly-<id> --needs docker`) does not match the CLI either: `--needs` applies only with `--machine auto`.
- When Auto picks this machine, `pan lane start` prints no reason and returns `machine: null` (filed #5006).

### One critic per builder

`pan lane start --role critic --for farewell --machine Edwards-MacBook-Air.local` while the Fly critic for `farewell` was live answered
`lane pan4638/farewell critic is live as 20261104-4962 on fly-8d4101ae001028; pass --replace to stop it first` (exit 1),
and `--key farewell-fly` answered `a critic's --key is its builder's key (farewell)`. One live critic per builder is the
design, so the run used a second builder (`shout`) for the Mac critic.

### Listed under the orchestrator

`pan lane list --run pan4638` on home, while every lane was live (JSON: [lane-list.json](lane-list.json); every row has `parentName: 20261104-8868`):

```
ID             RUN/KEY           ROLE     MACHINE                    ITER  ACTIVITY  REPORT   FOR          VERDICT  BRANCH@SHA                AHEAD  DIRTY  MODEL              COST
3612           pan4638/farewell  builder  -                          1     idle      #1 done               PASS 0   pan4638/farewell@0b9cc44  0      no     claude-sonnet-5-5  $0.00
20261104-4962  pan4638/farewell  critic   fly-8d4101ae001028         1     idle      #1 done  farewell i1  PASS 0   detached@0b9cc44          -      no     claude-sonnet-5-5  $0.10
3613           pan4638/shout     builder  -                          1     idle      #1 done               PASS 0   pan4638/shout@df834a5     0      no     claude-sonnet-5-5  $0.00
20261104-4727  pan4638/shout     critic   Edwards-MacBook-Air.local  1     idle      #1 done  shout i1     PASS 0   detached@df834a5          -      no     claude-sonnet-5-5  $0.17
3614           pan4638/twice     builder  -                          1     idle      #1 done               PASS 0   pan4638/twice@f0b72ba     0      no     claude-sonnet-5-5  $0.00
20261104-9652  pan4638/auto      play     fly-8d4101ae001028         1     idle      #1 done                        -                         -      -      claude-sonnet-5-5  $0.06
20261104-3234  pan4638/automac   play     Edwards-MacBook-Air.local  1     idle      #1 done                        -                         -      -      claude-sonnet-5-5  $0.06
3615           pan4638/twice     critic   -                          1     working   #1 done  twice i1     PASS 0   detached@f0b72ba          -      no     claude-sonnet-5-5  $0.00
```

Dashboard: [lanes-under-root.png](lanes-under-root.png) — home dashboard in an isolated headless Playwright Chromium
profile (`#overdeck_token` sign-in), `/conv/3611`. The Command Deck tree shows the root conversation
"PAN-4638 three-machine gauntlet launch" with all 8 lanes nested under it, the Fly and Mac lanes carrying their
machine chips (`fly-8d4101ae001028`, `Edwards-MacBook-Air`). The Awareness rail run card reads
`PAN4638 · anywhere-lanes-demo — 3 builders · 3 critics · 2 plays · 8 idle`.

The tree's group line reads `8 lanes · 4 reported` and the remote lanes show no DONE/PASS badge, although all 8 had
reported: the tree's lane enrichment reads only home's lane rows and reports (filed #5005). The lanes are listed under
the orchestrator, which is what the done-when asks; the missing badges are a display defect.

### Stop and reap

```
$ pan lane stop <name>    # ×8
Stopped lane pan4638/farewell (conv 3612) · Stopped lane pan4638/farewell (20261104-4962) · Stopped lane pan4638/shout (conv 3613)
Stopped lane pan4638/shout (20261104-4727) · Stopped lane pan4638/twice (conv 3614) · Stopped lane pan4638/auto (20261104-9652)
Stopped lane pan4638/automac (20261104-3234) · Stopped lane pan4638/twice (conv 3615)
$ pan lane reap <name>    # ×8, each: "Reaped lane pan4638/<key> (…): directory removed, conversation archived"
```

The lanes directories on home and on the Mac were empty afterwards.

## Other observations

- PAN-4885 (secure channel did not open within 2500 ms) did not occur: all four remote lane starts and the Mac `add-project` succeeded on the first attempt.
- The Mac sees home as `offline: no routes` in its own `pan machines list` (home → Mac is the direction lanes use, and it worked). Nothing in the run needed the Mac to reach home.
- `pan lane list` shows `$0.00` for home lanes, and `GET /api/conversations/<name>` shows `totalCost: 0` for both the home lanes and the root conversation, while remote lanes show a cost from their mirror. This is the general local conversation cost field, not lane- or Anywhere-specific; not investigated further and not filed.

## PAN-4638 done-when

| Item | Result |
| --- | --- |
| One gauntlet run with builders on the desktop and critics on a Fly VM and the laptop completes | passed: 3 builders on home; critic on `fly-8d4101ae001028` and critic on `Edwards-MacBook-Air.local` each PASS on the builder's pushed head |
| All lanes listed under the orchestrator | passed: `pan lane list` (every row `parentName: 20261104-8868`) and the Command Deck tree (screenshot); report badges for remote lanes missing (#5005) |
| `pan lane start --machine auto` places a lane by load and capability | passed: no tags → Fly VM (lowest CPU pressure); `--needs macos` → Mac; reason missing when Auto picks home (#5006) |
| A critic with `--needs docker` lands on a Docker machine | passed: landed on home (the only `docker` machine), ran `docker version` (29.3.0) |

Status: passed — gauntlet across desktop, Fly VM and Mac laptop; all 8 lanes reported and listed under the orchestrator
