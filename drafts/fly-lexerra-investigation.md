# Offloading Lexerra Gauntlet Workloads to Fly.io — Investigation

**Status:** investigation only. Nothing deployed, nothing built, nothing spent. Every number
below is either a published Fly.io rate or an explicitly labeled estimate.

**Trigger:** the local machine hard-crashed 2026-08-23 ~04:10, likely from resource
exhaustion, while running RUN CHARLIE — 5+ Vite servers, headed-Chromium film rigs,
Playwright e2e, vitest suites, Postgres+Redis, several worktree builds, plus Overdeck
itself, aimed at 9+ concurrent gauntlet lanes.

---

## TL;DR ranking

| # | Option | Effort | $/hr while running | Est. monthly at likely duty cycle | Verdict |
|---|---|---|---|---|---|
| 1 | **Ephemeral CI job** (`flyctl machine run --rm`) for build + vitest + Playwright e2e | Low — a Dockerfile, a Postgres+Redis-in-image entrypoint, a shell script, no Overdeck changes | $0.03–$0.12/hr per lane (shared-cpu-4x to performance-2x) | **$15–$50/mo** for several lanes at moderate use | **Do this first** |
| 2 | **Persistent lane pool** — Fly volumes hold warm `node_modules` + Playwright browser cache + a sparse checkout, one machine per lane, mirrors the existing `docker-compose.*.yml` port-per-lane pattern | Medium — volume provisioning, a launcher script, teardown discipline | machine cost same as #1 + $0.15/GB/mo volumes | **$25–$70/mo** for 9 lanes | Do after #1 proves out |
| 3 | **Film rigs on a GPU machine** (A10/L40S) | N/A — **Fly.io deprecated all GPU machine types fleet-wide as of 2026-07-31**, three weeks before this investigation | n/a (no GPU pricing published any more) | n/a | **Dead end — do not spend money confirming it; keep film rigs local** |
| — | **Full agent worktrees via Overdeck's remote-workspace layer** | High — image was never built, config never turned on, default sizing is wrong for this stack, and the operator's own `RUN-CHARLIE.md` explicitly forbids Overdeck infrastructure for gauntlet runs | n/a | n/a | **Not for gauntlet lanes.** Bypass Overdeck; use raw `flyctl` with a purpose-built image if this is ever wanted |

The headline recommendation is **#1**: it needs zero new infrastructure decisions, costs
pennies, and directly relieves the crash-causing pressure (build/unit/e2e lanes are the
bulk of the concurrent-process count today). "Check, don't assume" from the brief bites on
film rigs, but the answer turns out to be simpler than a spike: **Fly no longer sells GPU
machines at all** — see §2b.

---

## 1. What Overdeck's Fly.io support does today

The `pan-fly` skill and `docs/fly-provider.md` describe a `pan remote status` /
`pan remote setup` / `pan workspace create --remote` workflow. On this machine, `pan remote
status` fails outright:

```
error: unknown command 'remote'
```

That's not a broken build — the command moved. `registerRemoteCommands()`
(`~/Projects/overdeck/src/cli/commands/remote/index.ts:16`) is wired into `pan admin`
(`~/Projects/overdeck/src/cli/commands/admin/index.ts:60`), not the top-level CLI. The
actual entry point is **`pan admin remote status`** / `pan admin remote setup` / `pan admin
remote init` / `pan admin remote resources` / `pan admin remote reap`. The skill and the doc
are both stale on this point — flag it separately if you want it fixed, it's a two-line skill
edit, not touched further here (investigation-only scope).

Running the real command:

```
$ pan admin remote status
- Checking remote status...
⚠ Remote not available
  Provider:       fly
  Enabled:        No
  Authenticated:  No
  Not authenticated with Fly.io. Set FLY_API_TOKEN or run: fly auth login
```

Two separate things are true at once here, and it's worth untangling them:

- **`fly auth whoami` (via `~/.fly/bin/flyctl`) already succeeds** — `edward.becker@gmail.com`,
  org `personal`. But `~/.fly/bin` is not on `$PATH` in this shell, and Overdeck's
  `isAuthenticated()` (`fly-provider.ts:127`) shells out to a bare `fly auth whoami`. It can't
  find the binary, so it reports unauthenticated even though the underlying Fly session is
  fine. **Trivial fix, operator action:** add `~/.fly/bin` to `PATH`, or export
  `FLY_API_TOKEN` (a personal access token from <https://fly.io/user/personal_access_tokens>) —
  Overdeck checks that env var first (`fly-provider.ts:117`) and would skip the CLI shell-out
  entirely.
- **`remote.enabled` is genuinely off.** `~/.overdeck/config.yaml:175-177` has only
  `resiliency_tier: ephemeral` and `max_concurrent_agents: 0` under `remote:` — no `enabled`
  key, no `[remote.fly]` block at all. The stale `~/.overdeck/config.toml` (last touched Jun
  19, superseded by `config.yaml`) has `enabled = false` explicitly. Nobody has ever run `pan
  admin remote setup` on this machine.

**The code underneath is real, not a stub.** `~/Projects/overdeck/src/lib/remote/fly-provider.ts`
(643 lines) implements `createVm`, `deleteVm`, `listVms`, `getStatus`, `startVm`, `stopVm`,
`ssh`, `copyToVm`, `copyFromVm`, `exposePort` against the Fly Machines REST API directly
(`https://api.machines.dev/v1`), with get-or-create semantics, a "durable" tier that attaches
a persistent `/workspace` volume, and restart-policy handling. It last got substantive work
2026-07-14 (a rebrand pass) — this is mature but not actively developed code, matching the
brief's "sort of limited" framing.

What's actually missing for this layer to do anything:

1. **`remote.enabled: true` + a `[remote.fly]` block** in config — never set.
2. **The workspace image was never built.** `docker/pan-workspace/Dockerfile` exists in the
   Overdeck repo (Ubuntu 24.04, Node 22, pnpm, Claude Code CLI, flyctl, git/tmux/build-essential),
   and `flyctl image show -a pan-workspaces` / `flyctl releases -a pan-workspaces` both come
   back empty. No image has ever been pushed to `registry.fly.io/pan-workspace`.
3. **Default sizing is wrong for this stack.** `fly-provider.ts:95-96` defaults to
   `vmSize: 'shared-cpu-2x'`, `vmMemory: 1024` (1 vCPU-class, 1 GB RAM) — sized for one
   lightweight Claude Code agent editing files, not for Postgres + Redis + Vite + a build +
   vitest + headed Chromium in the same box. Any use of this layer for Lexerra needs an
   explicit `--vm-size`/`--vm-memory` override — see the `performance-4x`+ sizing note in
   §2c/§4.
4. **The `pan-workspaces` Fly app exists but is empty** — `suspended`, zero machines, zero
   volumes. It's the right app name (`remote/index.ts:32` defaults `--app` to
   `pan-workspaces`, matching what's already registered), just unused.

Machine lifecycle model here is **one Fly Machine = one Overdeck-tracked issue workspace** —
create on `pan workspace create --remote <issue>`, identity keyed by issue ID in
`~/.overdeck/workspaces/<id>.yaml`, credential sync copies Claude Code OAuth + `gh`/`glab`
config onto the VM, stop/start hibernates by issue. That model is a reasonable fit for the
"whole agent worktree" workload class in the abstract — but see the next paragraph before
reading that as a recommendation.

**The operator has already ruled this out for gauntlet work.** `~/Projects/lexerra/gauntlet/RUN-CHARLIE.md:48`
states, verbatim, as an operator-authored standing decision: *"NO Overdeck infrastructure
— run as plain Claude Code... Behave exactly as you would outside an Overdeck environment...
Do not spawn `pan` agents, do not file work into the Overdeck pipeline, do not use `pan
tell`/`pan done`/workspaces."* Building gauntlet offload on `pan workspace migrate` /
`pan workspace create --remote` would directly contradict that. This report treats Overdeck's
remote-workspace layer as **out of scope for gauntlet lanes** and evaluates raw `flyctl`
instead everywhere below — which, conveniently, is also strictly less work: no config wiring,
no image rebuild-and-push cycle, no dependency on a subsystem nobody has run yet.

---

## 2. Lexerra's workload classes

### 2a. Headless CI-style — builds, vitest, Playwright e2e

This is the clean offload candidate, and the codebase is already shaped for it:

- **Self-contained stack.** `docker-compose.dev.yml` is two services (`postgres:16`,
  `redis:7`) on host ports 54329/63790, throwaway named volumes, healthchecks on both. No
  external dependency beyond those images.
- **Throwaway creds only.** `.env.example` ships `lexerra` / `lexerra_dev` / a placeholder
  `JWT_SECRET` — nothing that isn't meant to be regenerated per environment. No external API
  keys are needed to build, unit-test, or e2e-test.
- **Playwright is already isolated for parallel runs.** `playwright.config.ts` spins its own
  server + Vite dev client via `webServer[]`, uses `E2E_DATABASE_URL`/`E2E_REDIS_URL` env
  vars, and — critically — a comment at `playwright.config.ts:62-66` records a past incident
  (e2e-round1 finding 1) where the throwaway server defaulted to the live stack's Redis key
  prefix and collided with the shared dev game; the fix (`REDIS_KEY_PREFIX:
  'lexerra_e2e_pw'` at `playwright.config.ts:67`) is already in place. Whoever offloads this
  already paid the isolation tax once.
- **Headless by default.** `devices['Desktop Chrome']` / `devices['Desktop Firefox']` in the
  Playwright config are the stock headless presets — no GPU, no display server, no ANGLE
  flags. This class needs zero graphics work to run correctly.
- **The lane pattern already exists.** `docker-compose.kimi.yml`, `.maintest.yml`, `.run3.yml`,
  `.strike.yml` are the *same* two-service stack on distinct host ports (54331/63792,
  54338/63798, 54341/63801, 54339/63799) — i.e., the "N concurrent lanes on one box" pattern
  from the brief is already how this project runs locally. Offloading means giving each lane
  its own Fly machine instead of its own port pair on one box; the isolation discipline
  carries over unchanged.
- **Results already flow via git.** `gauntlet/notes/critique-*.json`, `gauntlet/shots/**/MANIFEST*.md`,
  and board state are committed and pushed as the native reporting mechanism — there's no
  separate results channel to build. A CI-lane offload just needs `git push` from the remote
  machine at the end of a run, same as today.

**Verdict: cleanly offloadable, no unresolved technical questions.**

### 2b. Film rigs — headed Chromium capture

The filming recipe (`gauntlet/notes/grok-2-RESUME-6.md:47-50`) is: **headed** Chromium under
`DISPLAY=:1`, launched with `--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist`,
fresh timestamped accounts, PIL-validated PNGs. `RUN-CHARLIE.md:46` states a **hard floor**:
*"60fps at 500+ hexes, headed, is a hard floor — every film carries a perf JSON"* and, more
pointedly, *"headless software-raster FPS is never the 60fps verdict."* The operator has
already pre-rejected the obvious cheap answer (run it headless with SwiftShader/llvmpipe and
call it done).

That constraint looked, at first pass, like a "spike a GPU machine and measure" question. It
isn't — a more basic fact closes it before the spike is even worth spending on:

- **Fly.io no longer sells GPU machines, full stop.** Fly's own community forum carries a
  thread titled *"GPU migration — Fly.io GPUs will be deprecated as of July 31, 2026"*
  (<https://community.fly.io/t/gpu-migration-fly-io-gpus-will-be-deprecated-as-of-july-31-2026/27110>),
  with Fly staff confirming the sunset and the original poster asking, pointedly, "will there be
  absolutely no GPU option after August 1?" Today is 2026-08-23 — three weeks past that date.
  Corroborating, checked live during this investigation: `fly.io/docs/gpus/` and
  `fly.io/docs/machines/gpus/` both now **404**, and the current pricing page
  (`fly.io/docs/about/pricing/`) contains **no GPU line items at all** (verified by fetching
  the raw page and confirming the only "a10"/"gpu"-looking substrings are SVG icon path data,
  not pricing text). One inconsistency worth flagging: `flyctl platform vm-sizes` (this
  machine's flyctl v0.4.78) **still lists** `a10`, `a100-40gb`, `a100-80gb`, `l40s` as platform
  sizes — that's almost certainly stale CLI metadata that hasn't been scrubbed post-sunset, not
  evidence they're actually provisionable. Attempting to create one to find out would mean
  spending money to test a path Fly's own docs and forum say is gone, which the brief's "do not
  spend money without listing the cost first" framing argues against — so this report does not
  recommend that spike.
- **Software rendering was never going to clear the bar anyway.** Even setting the GPU
  deprecation aside: Fly's CPU-only tiers (shared-cpu-\*, performance-\*) have no framebuffer
  GPU, so headed Chromium there falls back to SwiftShader/Mesa llvmpipe regardless of
  `--ignore-gpu-blocklist` — fine for pixel/crop comparisons, structurally incapable of a 60fps
  perf floor. `RUN-CHARLIE.md:46,70` states this as a hard floor and explicitly pre-rejects the
  headless-software-raster shortcut ("headless software-raster FPS is never the 60fps verdict").
  So there was never a CPU-tier path here either — GPU was the only theoretical route, and it's
  gone.

**Verdict: not offloadable to Fly, and not a "spike to find out" situation — Fly stopped
selling the hardware this would need three weeks before this investigation. Film rigs stay
local. If GPU-backed rendering-as-a-service is wanted later, the candidates are elsewhere
(Modal, RunPod, Lambda, GCP/AWS GPU instances — not evaluated here, out of scope for a
Fly-specific investigation) — not a thing to revisit on Fly unless Fly reverses this decision.**

### 2c. Full agent worktrees (whole builder agents)

A "whole Claude Code agent working against its own checkout + its own dev stack" is
architecturally what Overdeck's remote-workspace layer targets (§1) — but three things say
not to reach for it here:

1. It's unbuilt and unconfigured on this machine (image never pushed, `remote.enabled` never
   set) — using it means standing up a subsystem from zero, not flipping a switch.
2. Its default sizing (1 vCPU-class / 1GB RAM) doesn't fit a builder agent that also needs to
   run Postgres/Redis/Vite/build/tests locally on the same machine; every workload class here
   would need an explicit size override anyway.
3. `RUN-CHARLIE.md:48` explicitly forbids it for this run.

If a remote gauntlet-builder agent is wanted anyway, the right shape is a **purpose-built Fly
machine that raw `flyctl` provisions directly** — a persistent (not `--rm`) machine sized
`performance-4x` or larger, running an image with Claude Code CLI, git, tmux, Node 22, and a
sparse checkout of the repo, reached over `fly ssh console` / an SSH-backed tmux session so
the agent session survives disconnects (a one-shot `claude -p` exec on a remote box loses
lifecycle state the same way it would locally — that's a general agent-hygiene problem, not
an Overdeck-specific rule, and it applies here regardless of which orchestration layer is or
isn't in play). This is really "Option 2 from the TL;DR, but running an agent session instead
of a CI script" — same volume/checkout/teardown mechanics, different payload.

**Verdict: technically adjacent to what Overdeck already half-builds, but don't route through
`pan workspace migrate` for gauntlet work — build it raw, and only if the CI-lane and
film-rig questions above are settled first.**

---

## 3. Practicalities

### Repo size — the thing that will bite first if ignored

```
60G   total working tree (~/Projects/lexerra)
26G   .git
25G   gauntlet/        (committed screenshot/critique archive — RUN CHARLIE's own output)
2.3G  client/assets-src/  (KayKit/Quaternius/purchased asset packs, needed for client build)
414M  node_modules (root; per-workspace node_modules add ~26M more, mostly server/)
25M   refs/            (curated reference screenshots, mostly gitignored originals)
2.4G  ~/.cache/ms-playwright  (Chromium + Firefox browser binaries, separate from the repo)
```

A naive `git clone` on a remote machine pulls all 26GB of `.git` history *and* checks out the
full 34GB working tree, including the 25GB `gauntlet/` screenshot archive that CI/build/test
lanes never touch. `git clone --depth 1` does **not** fix this — a shallow clone still checks
out the entire current tree, `gauntlet/` included; depth only trims *history*, not the
working-copy content.

**What actually helps:** `git clone --filter=blob:none --sparse` + `git sparse-checkout set`
excluding `gauntlet/` (and excluding `client/assets-src/` too, for server-only/unit-test
lanes that never build the 3D client). That drops a CI-lane checkout to roughly **7–9GB** —
close to `node_modules` (414MB) + `assets-src` (2.3GB, only if building the client) + the rest
of the source tree, none of which include `gauntlet/`'s history. Combined with a
`registry.fly.io`-cached image (browsers + `node_modules` baked in, see below), a lane spin-up
doesn't need to touch the 26GB of git history at all.

### Image and volume strategy

- **Postgres and Redis need an explicit home — a Fly Machine is not a Docker host.** It runs
  one image directly; there's no Docker daemon inside it to `docker compose up` the way
  `docker-compose.dev.yml` does locally. Two workable routes:
  - **Bake `postgresql-16` and `redis-server` straight into the CI image** (both are one
    `apt-get install` on the Ubuntu/Debian base) and start them from the image's entrypoint —
    `pg_ctlcluster ... start && redis-server --daemonize yes` — before the build/test script
    runs. Playwright's own `globalSetup` (`e2e/environment.ts`, referenced in
    `playwright.config.ts:26`) already creates its throwaway database against whatever
    `DATABASE_URL` it's given, so once local Postgres is reachable on `localhost:5432` the
    rest of the pipeline needs no changes — just point `DATABASE_URL`/`REDIS_URL` at
    `localhost` instead of the compose service names.
  - **Or use Fly Machines' multi-container config** (`flyctl machine run --container ...`,
    confirmed present in `flyctl machine run --help`) to run `postgres:16` and `redis:7` as
    sibling containers alongside the app container in the same machine — closer to a 1:1 port
    of `docker-compose.dev.yml`'s service list, at the cost of a slightly more involved
    `fly.toml`/machine-config than a single baked image.
  Either way, this is a **required build step**, not a detail to defer — the first route is
  simpler and is what the launcher script in §4 assumes.
- **Bake Playwright's browsers into the CI image**, don't `npx playwright install` per run —
  that's the 2.4GB `~/.cache/ms-playwright` payload; baking it into a Docker layer means it's
  pulled once (Fly registry pulls are free — Fly egress billing only applies to *outbound*
  traffic leaving Fly, not image pulls) and reused by every ephemeral machine from that image.
- **For the persistent-lane-pool option (#2)**, attach a Fly volume per lane at `/workspace`
  holding the sparse checkout + `node_modules` — `$0.15/GB/month`; a 10GB volume per lane is
  **$1.50/month**, and 9 lanes' worth is **$13.50/month**. Cheap enough that volume cost is
  never the deciding factor here — clone/install *time* is the real cost, and volumes exist to
  amortize that, not to save on storage billing.
- **For the ephemeral option (#1)**, skip volumes entirely: `flyctl machine run --rm` with a
  pre-baked image, sparse-clone fresh each run (7-9GB over Fly's free inbound bandwidth), run,
  push results, exit — the machine deletes itself. Simpler, no orphan risk, costs a couple
  minutes of extra clone/npm-ci time per run instead of a few dollars a month in storage.

### Secrets

Confirmed nothing beyond throwaway local creds is needed for build/unit/e2e:
`DATABASE_URL`/`REDIS_URL` point at the lane's own `docker-compose`-equivalent Postgres/Redis,
`JWT_SECRET` is a placeholder meant to be regenerated per environment, and
`LEXERRA_PROTECTIONS=off` / `LEXERRA_TEST_HOOKS=1` are local dev/test toggles, not external
credentials. No API keys are read anywhere in the build/test/e2e path found in this
investigation. Generate a fresh random `JWT_SECRET` per lane at machine-create time
(`openssl rand -hex 32`, injected via `flyctl machine run -e`); never reuse a value across
lanes or persist it beyond the lane's lifetime.

### Teardown discipline

- **Ephemeral CI lanes:** `--rm` is the whole answer — Fly deletes the machine when the
  process exits, zero manual cleanup, zero orphan risk. This is the safest option in the whole
  report by construction.
- **Persistent lane pool:** needs an explicit stop/destroy step per lane (`flyctl machine stop`
  after a batch, `flyctl machine destroy` when a lane is retired) and periodic auditing
  (`flyctl machines list -a <app>`) — nothing automatic prevents an orphaned machine from
  billing quietly. Overdeck's own `pan admin remote reap` (`remote/reap.ts`) is a model for
  this kind of sweep, but it's wired to Overdeck's issue-tracked workspace metadata and isn't
  reusable as-is for gauntlet lanes that don't go through that layer.
- **GPU machines:** not applicable — Fly no longer offers GPU tiers to provision in the first
  place (§2b), so there's no GPU spend to guard against here.

---

## 4. Costed recommendation, in order

1. **Now — headless CI lanes (§2a).** Build one Dockerfile (Node 22 + Playwright browsers +
   `postgresql-16`/`redis-server` baked in, per §3, started from the entrypoint) plus one
   launcher script that does sparse-clone → `npm ci` → `npm run build` → `npm run
   test:unit:all` → `npm run test:e2e` (against `localhost` Postgres/Redis) → `git push`
   results, and run it via `flyctl machine run --rm -a <new-app> --vm-size performance-2x
   --vm-memory 8192 -e ... <image>`. At `performance-2x` (2 vCPU, 4GB base, bump to 8GB via
   `--vm-memory`) the published rate band is **$0.09–$0.12/hr**; a 15-minute run (build + unit +
   e2e — an estimate, not measured) costs roughly **$0.02–$0.03**. Even at 50 runs/day across
   several lanes, that's under **$50/month**, and it directly removes the workload class most
   likely responsible for the crash (concurrent Vite/build/Postgres/Redis/vitest/Playwright
   processes on one box).
2. **Next — persistent lane pool (§2a extended, §3).** Once the ephemeral path is proven, add
   volumes to cut clone/install time for lanes that run often, mirroring the existing
   `docker-compose.{kimi,maintest,run3,strike}.yml` port-per-lane pattern as one-Fly-machine-per-
   lane instead. Adds **~$1.50/month/lane** in volume cost; machine cost is unchanged from
   option 1 for however many hours it actually runs.
3. **Not viable — film rigs (§2b).** Fly deprecated all GPU machine types as of 2026-07-31, so
   there is no GPU tier left to spike-test, and the CPU-only tiers were never going to clear the
   operator's 60fps-headed hard floor via software rasterization. No spend is warranted here —
   spend $0 and keep filming local. Revisit only if Fly reverses the GPU deprecation, or
   evaluate a non-Fly GPU host (Modal, RunPod, Lambda, cloud-provider GPU VMs) as a separate
   investigation if remote filming is still wanted.
4. **Not now — full agent worktrees (§2c).** Skip Overdeck's remote-workspace layer for
   gauntlet work entirely (operator decision, `RUN-CHARLIE.md:48`). If a remote builder agent
   is wanted later, provision it with raw `flyctl` the same way as option 2, sized
   `performance-4x`+, reached over a persistent SSH/tmux session rather than one-shot execs.

**What NOT to offload right now:** film rigs — not "not yet," but genuinely not possible on
Fly today. The GPU hardware this would need was withdrawn from sale three weeks before this
investigation; there is nothing left to spike or spend money confirming.
