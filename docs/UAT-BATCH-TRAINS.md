# UAT Batch Trains

UAT batch trains keep **one assembled, testable batch of every merge-ready
feature available at all times**, so a human can exercise the combined result,
then land exactly what they tested with a single action. Shipped in
[PAN-1737](https://github.com/eltmon/overdeck/issues/1737); supersedes the
disjoint-only "UAT candidate" model from PAN-1691 (see
[`MERGE-TRAIN.md`](./MERGE-TRAIN.md) for that history) and absorbs the live
preview stack from PAN-1738.

Read this with:

- [`FLYWHEEL.md`](./FLYWHEEL.md) — the orchestrator that drives the ready-set the trains assemble from.
- [`MERGE-WORKFLOW.md`](./MERGE-WORKFLOW.md) — the per-issue merge state machine, which remains the escape hatch.
- [`drafts/PAN-1737.md` on `overdeck-state`](https://github.com/eltmon/overdeck/blob/overdeck-state/drafts/PAN-1737.md) — the originating PRD (full design rationale; on disk: `${OVERDECK_HOME}/state/overdeck/drafts/PAN-1737.md`).
- [`../docs/design/pan-1737-uat-batch-trains.html`](./design/pan-1737-uat-batch-trains.html) — the approved 3-state mockup.

## The problem it solves

When several features pass review at once, a human merging them one at a time
has to UAT each in isolation, and each merge restales the others. The operator's
founding complaint: *"I looked at the merge queue and I had no idea what it
meant, how I would UAT it, or a way to UAT it."* Agents now generate mergeable
code faster than a human can review-and-land it serially, so the bottleneck is
the last-mile UAT. Batch trains move that bottleneck by assembling the combined
tree once, continuously, and automatically.

## The model

| Term | Meaning |
| --- | --- |
| **Ready set** | **Per project**, every feature the review pipeline has cleared, in merge order. Sourced from that project's review-status records — `listEligibleCandidatesByProject` (review passed, tests passed/skipped, verification not failed, not deacon-ignored) ordered by `computeMergeQueueFromCandidates` in [`flywheel-merge-order.ts`](../src/lib/flywheel-merge-order.ts). **No flywheel run required.** Until [PAN-1696](https://github.com/eltmon/overdeck/issues/1696) this was derived from a live run's `activePipeline` filtered on pipeline verbs, so a ready issue whose verb the orchestrator reported differently vanished from the queue ([PAN-1736](https://github.com/eltmon/overdeck/issues/1736)) and nothing assembled without a run at all. |
| **Generation** | A throwaway `uat/<label>-<codename>-<MMDD>` branch off current main containing **as many ready features as possible, in merge order, with cross-feature conflicts resolved inside the batch**. |
| **Assembly agent** | A timeboxed headless `claude -p` run (acceptEdits, no shell) that resolves a merge conflict *on the branch* when one feature collides with an already-merged member. Verification, staging, and the merge commit happen in code — the agent only edits files. |
| **Held out** | A feature excluded from a generation because its conflict could not be resolved confidently (or the agent timed out). Shown on the card with the reason; retried in later generations once the conflicting predecessor merges or its branch changes. |
| **Generation chain** | Generations accumulate newest-first (`sea-monkey` → `brass-donkey` → `copper-fox`…). The newest **ready** generation is current; older ready/superseded ones stay testable and promotable. Append-only — lifecycle is status flips, never row deletion, so the chain is an audit trail. |
| **Promote** | The merge. Merging a generation lands its exact tree on main (one no-ff merge), so main receives precisely what was tested — conflict resolutions included. |
| **UAT stack** | A live dashboard stack serving a generation's branch at `uat-<label>-<codename>-<mmdd>.overdeck.localhost`, spun on demand from the generation's worktree. **Hard max 2 concurrent.** |

## Lifecycle

1. Two features pass review → the reconciler assembles `uat/pan-sea-monkey-0610`
   (both features, conflicts resolved in-branch). The card shows it **ready**,
   with **Open UAT frontend**, a per-member **What to UAT** checklist, and
   **Merge batch (2) to main**.
2. A third feature becomes ready → `uat/pan-brass-donkey-0610` (all three)
   assembles in the background. Sea-monkey stays fully testable the whole time;
   when brass-donkey reaches ready it becomes current and sea-monkey is marked
   superseded (still promotable).
3. The operator opens brass-donkey's frontend, runs the checklist, clicks
   **Merge batch (3) to main** → one merge lands the tested tree; the three
   member issues close out through the normal per-issue post-merge flow; the
   chain resets for the remaining ready set.
4. *Alternative:* the operator promotes the older sea-monkey instead (the third
   feature wasn't wanted yet) — it works as long as its base still matches main;
   the excluded feature reassembles into the next generation.
5. *Alternative:* the operator merges a single feature via the escape hatch — all
   live generations are invalidated and a fresh one reassembles automatically.

## Architecture

Pure orchestrators with injected dependencies (unit-tested), plus thin real-I/O
wiring (exercised live). All process exec is async (`execFile` argv arrays —
never `execSync`, never shell-string interpolation of branch names).

| Concern | Module |
| --- | --- |
| Generation store (schema v51 `uat_generations`, append-only chain) | [`src/lib/database/uat-generations-db.ts`](../src/lib/database/uat-generations-db.ts) |
| Assembly engine (ordered merges, held-out fallback, cleanup keep-newest-3) | [`src/lib/cloister/uat-generation-engine.ts`](../src/lib/cloister/uat-generation-engine.ts) |
| Real git wiring (worktree/merge/push, branch + path validation) | [`src/lib/cloister/uat-generation-deps.ts`](../src/lib/cloister/uat-generation-deps.ts) |
| Assembly-agent conflict resolution (timeboxed headless, allowlist) | [`src/lib/cloister/uat-conflict-agent.ts`](../src/lib/cloister/uat-conflict-agent.ts) |
| Union lint (Flyway migration version collisions) | [`src/lib/cloister/uat-union-lint.ts`](../src/lib/cloister/uat-union-lint.ts) |
| Reconciler (auto-assemble on ready-set change, invalidate stale) | [`src/lib/cloister/uat-reconciler.ts`](../src/lib/cloister/uat-reconciler.ts) |
| Batch promotion (merge tested branch to main, per-member post-merge once) | [`src/lib/cloister/uat-promote.ts`](../src/lib/cloister/uat-promote.ts) |
| Version propagation + verification | [`src/lib/cloister/version-ship.ts`](../src/lib/cloister/version-ship.ts) and [`version-ship-deps.ts`](../src/lib/cloister/version-ship-deps.ts) |
| Durable per-member ship verdict + deferred ship | [`src/lib/cloister/ship-record.ts`](../src/lib/cloister/ship-record.ts) |
| Live UAT stack lifecycle (max 2, mandatory teardown) | [`src/lib/cloister/uat-stack.ts`](../src/lib/cloister/uat-stack.ts) |
| Service wiring + reconciler interval + route payloads | [`src/dashboard/server/services/uat-train.ts`](../src/dashboard/server/services/uat-train.ts) |
| UAT batches card | [`src/dashboard/frontend/src/components/flywheel/MergeQueueCard.tsx`](../src/dashboard/frontend/src/components/flywheel/MergeQueueCard.tsx) |

### Reconciler — the heartbeat

A 60-second interval (`startUatTrainReconciler` in
[`main.ts`](../src/dashboard/server/main.ts)) keeps "always one batch ready"
true. Each tick is **single-flight per project** and:

1. **No-ops** unless `flywheel.merge_train_enabled` is on *and* a flywheel run is
   active (the ready set is `null` with no run → nothing to do).
2. **Invalidates** live generations that went stale — main advanced past their
   base, a member left the ready set, or a member branch gained commits.
   Invalidation tears down the generation's live stack. (A smaller *subset*
   generation off current main is **not** stale — it stays testable.)
3. **Un-wedges** assemblies stuck `assembling` for >30 min by marking them failed.
4. **Assembles** the next generation when nothing live answers the current
   desired set. A failed assembly for the *same* input backs off 10 min before
   retrying. The `POST /assemble-uat` route forces a rebuild, bypassing the
   match/backoff checks.

### Conflict resolution — division of labor

When merging a feature onto a generation branch conflicts, the engine hands the
mid-conflict worktree to the assembly agent with one mission: resolve *this*
merge's markers, changing nothing else. The agent only edits files (`claude -p
--permission-mode acceptEdits`, no shell). This module then verifies in code (no
leftover markers, no unmerged index entries), stages, and concludes the merge
commit (`uat-assembly: resolve A <-> B` in the body; git's standard `Merge
branch …` subject so it survives commitlint when promoted). Any failure — agent
missing, timebox (default 5 min), markers left, commit rejected — aborts the
merge and holds the feature out. **The assembly never wedges on a conflict.**

### Promotion — merge what you tested

`promoteUatGeneration` requires the generation's `baseSha` to still equal
`origin/main` (a stale base is rejected with reassemble guidance — promoting it
would silently drop commits landed since assembly). It merges the `uat/*` branch
into main with one no-ff merge in a **throwaway detached worktree** (never the
primary checkout), pushes, then runs each member issue's post-merge lifecycle
**exactly once** through the [PAN-328](https://github.com/eltmon/overdeck/issues/328)
in-flight guard (see CLAUDE.md "postMergeLifecycle Idempotency"). GitHub marks
the per-feature PRs merged automatically because their head commits become
reachable from main. Promotion also records `verificationStatus: passed` for
each member through the review-status write door with source `uat-promotion`,
the generation name, and the promote commit. Existing terminal `passed` or
`skipped` verdicts are preserved. During close-out, members of generations
promoted before this write path existed are healed from the stored generation
record, so the verification row uses recorded evidence instead of an operator
override. The promoted generation is reaped; all other live generations
invalidate (main moved) and the reconciler rebuilds.

When the project declares `version_sync`, promotion can also run **version
ship**: after the merge lands and its verification verdict is recorded, but
before member post-merge fan-out, the runner propagates the operator-supplied
version, verifies every declared target, commits only declared paths, and
pushes the configured repositories. Every member receives the same durable
`pipeline.ship` verdict. A ship failure never rolls back or blocks the already-
landed batch; it records a `partial` or `failed` verdict that must be settled
before close-out.

A polyrepo generation promotes through a two-phase variant of this — every repo
is trial-merged before anything is pushed — described under
[Polyrepo generations](#polyrepo-generations).

### Union lint — collisions git cannot see (PAN-3166)

Git merges by content, so two branches that each add a *differently named* file
never conflict — even when the union of those files is invalid. The canonical
case is Flyway: `V256__Kaia_session_task_binding.sql` (MIN-902) and
`V256__Add_author_type_to_task_comment.sql` (MIN-858) merge silently, each
branch's own CI is green because each alone has exactly one V256, and the
assembled api container then dies at startup with
`FlywayException: Found more than one migration with version 256`.

**Colliding is the normal case, not bad luck.** Sequential `V<n>` naming means
every branch cut from main takes the next free number, so any two concurrent
schema branches collide with certainty — MYN sat at V255 with three branches all
claiming V256. Holding a member out for that would cost throughput on every
batch carrying two schema changes and buy no safety, because those three
migrations touched three disjoint tables.

So the lint runs against the **assembled set** — the only place the collision
exists — and dispositions it by what the migrations actually touch:

| Case | Action |
| --- | --- |
| Provably independent | **Renumber.** The earlier member keeps `V256`; the later takes the next version unused anywhere in the union. Recorded as a resolution with `kind: 'migration-renumber'`. |
| Anything else | **Hold out**, with a reason naming both migration files and both issues. Assembly continues and the generation still reaches `ready` with the remainder. |

Renumbering is legitimate because the UAT branch content is exactly what
promotes to main — a rename in the union is what lands, the same category of
assembly-time resolution as a conflict the assembly agent fixes on the branch.

**Independence must be proven, and the proof is strict.** A distinct primary
table proves nothing: a child table's `REFERENCES` names a parent, a trigger or
view body reads other tables, and a data migration's `INSERT … SELECT` couples
two tables that appear in neither one's DDL. `analyzeMigration` therefore
collects *every* object a migration names — targets, foreign-key parents, and
DML sources — and **any** overlap holds out. These also hold out:

- **Unrecognized SQL.** A statement shape the extractor does not classify (a
  `$$ … $$` function body, a `GRANT`) is unknown coupling. Fail closed.
- **Non-integer versions.** `V1_1`/`V2.3` express deliberate ordering; they are
  detected and held out, never renumbered.
- **Any read failure.** Covered below.

**Two invariants that are easy to get wrong:**

- **The allocator reserves the whole union.** Blind `V256 → V257` is a bug: V257
  may already be on main, or a later member may hold it. The ledger seeds
  *owners* from the generation branch as cut from its target and *reservations*
  from every candidate branch, held out or not, then allocates the first
  integer free in both — and immediately reserves it, so two renames in one
  assembly can never land on the same number.
- **One repo is not one Flyway namespace.** A multi-service repo runs several
  independent histories, each restarting at V1. Every comparison, reservation,
  and allocation is keyed by the migration's own directory, so two services'
  `V1__init.sql` are not in conflict.

**The lint fails closed, never open.** A guard that disables itself on error is
worse than no guard, because it still reports success. Reading the generation
branch's migrations is unguarded — a failure marks the generation `failed`.
A failure reading one *candidate* branch holds only that member out, with a
typed reason, so one broken branch cannot cost the whole batch. Empty-because-
unread is never allowed to look like empty-because-no-migrations.

Ordering: detection is **pre-merge** (one `git ls-tree` per candidate), so a
hold-out never needs rollback. The rename is committed **post-merge**, when the
files exist on the generation branch. In a polyrepo generation the hold-out is
global like every other, the rename commit sits above the pre-feature snapshot
so a rollback removes it with everything else, and the ledger attributes a
member only once it has stuck in *every* repo it contributes to — a partial
success never leaves a half-recorded rename.

`listMigrationFiles` / `readMigrationFile` / `renameMigrations` on
`GenerationGitDeps` are all optional. Deps omitting the listing skip the lint
entirely (the pre-PAN-3166 behaviour); deps that can list but not rename can
only hold out.

### Live stacks — the hard cap

`ensureUatStack` renders the devcontainer on the generation worktree — the folder
name `uat-<label>-<codename>-<mmdd>` yields the Traefik host
`uat-<label>-<codename>-<mmdd>.overdeck.localhost` via the standard `FEATURE_FOLDER`
template — and runs `docker compose up`. **At most 2 UAT stacks run at once**:
Docker's default address pool fits ~31 bridge networks, and orphaned UAT stacks
would eventually block *all* workspace creation. Starting a third tears down the
oldest first (under a per-project mutation lock so concurrent starts cannot race
past the cap), and invalidation/promotion always tear a generation's stack down
(`compose down -v --remove-orphans`).

**`probeUatStack` reports three states, not two (PAN-3166).** Counting running
containers is not a health signal: a stack whose api died at startup still has
three healthy containers, so a count says `running` and the panel offers "Open
UAT frontend" for a gateway timeout. The probe compares what the compose file
**declares** (`docker compose config --services`, which respects active
profiles) against what is actually up (`docker compose ps --all`):

| Status | Meaning | Clears the stack record? |
| --- | --- | --- |
| `running` | Every declared long-running service is up and healthy. | no |
| `degraded` | Containers exist but at least one declared service is not serving — exited, never created, or running with an `unhealthy` Compose healthcheck. `downServices` names them and `serviceErrors` carries each one's last error line, pulled from `docker compose logs --tail 200` (a JVM `Caused by:` line wins over the wrapper exception above it). | **no** |
| `unknown` | The probe itself failed (`docker compose ps`/`config` errored). Not proof of absence. | **no** |
| `absent` | Zero containers for the project. | yes — the only status that self-heals a stale `stackStartedAt` |

**Only `absent` clears the record, and that split is the fix.** Clearing it
destroys the evidence: the min-quartz-0726 api died at Flyway startup, the probe
called the stack `running` because three containers survived, and once they all
stopped it silently healed to `absent` — which is why the Flyway error was
unreachable from the UI at all. A degraded or unprobeable stack keeps its record
so the failing service's logs stay reachable.

Init containers exit by design and are excluded, using the same name convention
as the workspace stack health check (`src/lib/workspace/stack-health.ts`) — a
one-shot counts as missing only when it exited non-zero. In the UI a degraded
generation gets an amber restart control instead of an open link, plus the
failing service's error line inline.

## API

| Route | Purpose |
| --- | --- |
PAN-1696 moved every route below out of the `/api/flywheel/*` namespace into the
aggregate `/api/merge-train/*` one, and each read now answers for **all tracked
projects** with no flywheel run involved. The old `/api/flywheel` merge-train
routes were deleted, not aliased.

| Route | Purpose |
| --- | --- |
| `GET /api/merge-train/generations` | One entry per tracked project — `{ projectKey, projectName, enabled, generations }` — where `generations` is that project's chain newest-first: per generation the members (with PR links and **per-member acceptance criteria** from the shared xBRIEF extractor `src/lib/xbrief/acceptance-criteria.ts` — the same source as the AwaitingMerge UAT plan, no second parser), held-out reasons, conflict resolutions, `versionSyncConfigured`, latest `shipStatus`, and live-stack `{status, frontendUrl, downServices?, serviceErrors?, probeError?}` (`status` is `running` \| `degraded` \| `unknown` \| `absent` — see [Live stacks](#live-stacks--the-hard-cap)). |
| `GET /api/merge-train/queues` | One entry per tracked project — `{ projectKey, projectName, enabled, queue }` — the ready set as reference data, each row carrying `branchName` and `prUrl`. A project with the merge train off reports `enabled: false` and an empty queue rather than being omitted, so "off" and "nothing ready" stay distinguishable. |
| `POST /api/merge-train/generations/:name/stack` | Ensure the generation's live stack (idempotent); returns the frontend URL and any evicted stacks. |
| `POST /api/merge-train/generations/:name/promote` | Promote (merge) the tested generation to main — into the generation's **own** project repo, resolved from its stored `projectRoot`. Optional body `{ shipVersion: "48.8.0" }` runs version ship after the merge. |
| `POST /api/merge-train/generations/:name/ship` | Run deferred version ship for an already-promoted generation. Body `{ version: "48.8.0" }`; returns 409 unless the generation is promoted and 422 when the project has no `version_sync`. |
| `POST /api/merge-train/assemble` | Force a reconcile/rebuild. Body `{ project }` rebuilds one project; an empty body reconciles every merge-train-enabled project and returns a per-project result. |
| `POST /api/merge-train/merge-next` | The single-feature escape hatch — body `{ n, project }` merges N of that project's ready set to main one at a time, stopping on first failure. An unknown project key is a 4xx, never a silent no-op. |

## The card — "UAT batches"

The Flywheel rail's first card ([`MergeQueueCard.tsx`](../src/dashboard/frontend/src/components/flywheel/MergeQueueCard.tsx),
matching [`design/pan-1737-uat-batch-trains.html`](./design/pan-1737-uat-batch-trains.html)):

- **Plain-language intro** — "N features passed review & tests. They're assembled into the test batches below…".
- **Batches, newest first** — ready (Open UAT frontend + Merge batch (N) to main + rebuild), assembling (live progress while the current batch stays actionable), superseded (still testable/promotable), held-out chips with reasons.
- **What to UAT** — the current batch's acceptance criteria grouped per member, with explicit "verify the touchpoint" items where the assembly agent resolved a conflict.
  Each member carries `planResolved` alongside its criteria (PAN-3165). When the
  server could not resolve or read the issue's xBRIEF at all, the panel says
  *"Plan not found for PAN-XXXX"* — it must never render a lookup miss as the
  factual claim *"No UAT steps in plan"*, which silently removes the operator's
  checklist. That claim is reserved for a plan that resolved and authored none.
- **Ready features (merge order)** — reference rows with monospace branch + PR link.
- **Escape hatch** — "Merge one feature to main…", which states it bypasses batch testing.

Every merge action confirms through `useConfirm()` naming the exact members and
consequences. The string "Ship batch" no longer appears anywhere in the frontend.

## Version ship (PAN-3358)

**Version ship** makes a promoted batch's declared version strings agree with an
operator-chosen `X.Y.Z` version. It sets configured JSON fields, optionally runs
a project command, verifies every expected file, commits only declared paths,
and pushes configured repositories. It does **not** publish npm packages,
submit App Store or Play builds, deploy production, generate release notes, or
create Git tags; those remain separate operator actions.

Ship never runs in the ambient project checkout. Promotion records the exact
merge SHA and target branch for every participating repository. Before each
attempt, ship fetches the target, proves the promoted SHA is its ancestor, and
creates a temporary detached worktree at the fetched target head. Rooting retries
at the current target recovers when an earlier attempt pushed before durable
settlement failed, while the ancestry check refuses an unrelated target. Commits
use hook-disabled trusted Git invocations, push with an explicit
`HEAD:<targetBranch>` ref, and the temporary worktrees are removed after the run.
Local Git and identity commands have a 30-second deadline, network fetch/push a
two-minute deadline, and cleanup commands a 15-second deadline; timeout kills
the Git process group and settles the batch with the existing safe failure code.
An operator's primary checkout remains untouched even when it is stale or dirty.

A project opts in through `version_sync` in `~/.overdeck/projects.yaml`. Mind
Your Now uses one canonical JSON field plus its existing propagation command:

```yaml
projects:
  mind-your-now:
    version_sync:
      set:
        - path: frontend/package.json
          json_field: version
      replace:
        - path: api/src/main/java/com/myn/config/Version.java
          pattern: 'String version = "(?<version>\d+\.\d+\.\d+)\.git "'
          value: '{version}'
        - path: frontend/ios/App/App/Info.plist
          pattern: 'CFBundleShortVersionString</key>\s*<string>(?<version>\d+\.\d+)</string>'
          value: '{majorMinor}'
        - path: frontend/android/app/build.gradle
          pattern: 'versionName "(?<version>\d+\.\d+)"'
          value: '{majorMinor}'
      command: pnpm vsync
      command_cwd: frontend
      command_image: myn-version-sync:latest
      expect:
        - path: frontend/package.json
          pattern: '"version": "{version}"'
        - path: api/src/main/java/com/myn/config/Version.java
          pattern: 'String version = "{version}\.git "'
        - path: frontend/ios/App/App/Info.plist
          pattern: 'CFBundleShortVersionString</key>\s*<string>{majorMinor}</string>'
        - path: frontend/android/app/build.gradle
          pattern: 'versionName "{majorMinor}"'
      push:
        - frontend
        - api
```

Overdeck needs no propagation command; it keeps three package manifests in
lockstep and verifies all three before committing:

```yaml
projects:
  panopticon-cli:
    version_sync:
      set:
        - path: package.json
          json_field: version
        - path: apps/desktop/package.json
          json_field: version
        - path: packages/contracts/package.json
          json_field: version
      expect:
        - path: package.json
          pattern: '"version": "{version}"'
        - path: apps/desktop/package.json
          pattern: '"version": "{version}"'
        - path: packages/contracts/package.json
          pattern: '"version": "{version}"'
      commit_message: "chore: bump version to {version}"
      push:
        - .
```

The fields are deliberately small. An active block must declare at least one
`expect` entry and one `push` repository; `{}`, empty arrays, and an expectation
without a push target are rejected. Removing `version_sync` is the only way to
select the explicit skip state.

- `set[].path` and `set[].json_field` identify top-level own JSON string fields
  written before the command runs. Ship parses the document, updates that exact
  top-level source range without reformatting the file, reparses it, and verifies
  the selected property. A same-named nested field is never a setter target.
- `replace[]` grants a command authority to change one exact version capture in
  a generated text file. Its `pattern` must contain exactly one named capture
  `(?<version>...)`; `value` selects `{version}` or `{majorMinor}`. The trusted
  parent applies each rule to the pre-command bytes in a time-bounded worker and
  computes the only acceptable complete output. A dependency, plugin, image, or
  other version outside the named capture therefore cannot change merely because
  it resembles a version string.
- `command` is optional; `command_cwd` is relative to the project root and
  `command_image` is required with it. A `replace` rule requires a command. The
  operator-owned image must already be present locally and provide `/bin/sh` plus
  `cp`. Commands are filesystem-only: Overdeck removes every `.git` entry from a
  read-only export, copies that export into a 1 GiB container tmpfs, and runs
  without host credentials, network, or capabilities under a five-minute hard
  timeout. After success, only declared `set` and `replace` regular files are
  copied back through no-follow validation, capped at 16 MiB per file and 64 MiB
  total. A configured JSON `set` file must remain byte-identical to the trusted
  setter's result, and each generated text file must byte-match the output derived
  from its declared captures. Added lines, unrelated version changes, formatting
  changes, scripts, and every other opaque edit fail before commit or push.
  Commands cannot inspect or commit Git metadata; the credentialed commit and push
  remain in hook-disabled trusted parent code after repository identity is
  revalidated.
- `expect[].pattern` verifies the final result but grants no mutation authority.
  It is a regular expression checked after propagation.
  `{version}` expands to the complete version such as `48.8.0`, while
  `{majorMinor}` expands to `48.8`. Patterns are limited to 512 characters,
  expectation files to 1 MiB, and matching runs in a worker with a 250 ms
  deadline so project configuration cannot block the dashboard event loop.
- `commit_message` defaults to `chore: bump version to {version}`. The trusted
  parent stages only paths declared by `set`, `replace`, or `expect`; sandbox
  commands never receive Git metadata and cannot self-commit.
- `push[]` lists repository paths relative to the project root; `.` means the
  project root itself. Every declared `set`, `replace`, and `expect` output must belong to
  exactly one selected push repository before any file is mutated, so a verified
  temporary change cannot disappear without a commit and push.

### Promotion and deferred ship

For a configured project, **Merge batch** first offers a version field. A valid
version is sent as `shipVersion` with promotion. Leaving it empty is allowed:
the batch still merges, but every member receives a `pending` ship verdict and
cannot pass close-out until the version is shipped. The promoted batch then
stays on the card with a **Ship version** action, which runs the same runner and
rewrites every member's verdict. Promoted `pending`, `partial`, and `failed`
batches remain visible with their current outcome and retry action; only a
conservative all-member `passed` aggregate removes the card. Promote-time and
deferred requests share one per-generation mutex, so concurrent requests cannot
interleave side effects or overwrite a successful settlement with a racing
failure. Terminal-only operators can call
`POST /api/merge-train/generations/:name/ship` with `{ "version": "48.8.0" }`;
there is no separate `pan ship` command.

The **ship row** in the Definition-of-Done gate is the close-out check that
resolves the member's promoted generation and reads the conservative aggregate
of every member's durable `pipeline.ship` record. One missing, pending, partial,
or failed member therefore blocks every member, even if another member's
terminal record persisted first:

| Recorded state | Ship row result |
| --- | --- |
| `passed` | Passes, naming the version, batch, and number of verified paths. |
| `pending` | Misses because the batch merged without a version; use **Ship version** on that promoted batch. |
| `partial` | Misses and names every declared path that did not report the requested version. |
| `failed` | Misses and shows the runner's fixed failure code and redacted operator-safe summary. |
| No `version_sync` | Skips explicitly because ship does not apply to that project. |
| No ship record, promoted batch member | Misses because durable settlement was lost or never written. |
| No ship record, direct merge | Skips explicitly because ship is batch-scoped. |

A `partial` verdict is the guard against silent propagation failures: the
command may exit successfully while an old regex edits nothing. The failing
paths appear in the ship row's observed text and in **Project settings →
Version ship**. A `pending` promoted batch also remains visible on the batch
card until the operator ships a version. Batch and settings API payloads omit
operational `error` and `reason` text; they expose the status, fixed failure
code, version, batch, timestamp, and path evidence needed by the UI, while raw
command and Git diagnostics are bounded before linear-time credential redaction
and stay only in local logs.

Configure the block by hand in `projects.yaml` or through **Project settings →
Version ship**. Both surfaces use that file as the single store; dashboard
saves preserve comments, quoting, formatting, and unrelated projects outside
the edited `version_sync` block, including standalone comments attached after the
block. If the block itself contains inline or standalone comments, the settings
save is rejected and directs the operator to edit `projects.yaml`; it never drops
comments whose association cannot be preserved. Every project-registry mutation
holds one shared lock across its read, transformation, and atomic write, so a
rename or policy update cannot overwrite a concurrent version configuration.
The writer flushes a same-directory temporary file, atomically renames it, and
flushes the directory. Lock files record the process ID plus process start time,
so a confirmed-dead owner is reclaimed after a crash while a live owner remains
exclusive. An unset project says plainly that it skips
ship rather than showing an empty form, and the section displays the latest
`passed`, `pending`, `partial`, or `failed` outcome.

Enabling this for Overdeck means the three `package.json` files on main can show
a version ahead of the most recent npm release. That is intentional and
harmless: version ship records what the merged batch belongs to, while
`pan release stable --version X.Y.Z` explicitly rewrites all release versions
when the operator later publishes.

## Operating it

Batch trains are gated **per tick, per project** on the effective merge-train
flag: the project's own `merge_train: enabled|disabled` override in
`projects.yaml` when set, otherwise the global `merge_train.enabled` setting
(which still falls back to the legacy `flywheel.merge_train_enabled` key so an
existing ON value survives the rename). The reconciler is a 60s dashboard-server
interval, independent of the deacon and — since PAN-1696 — independent of the
flywheel: **no run is required**, and batches assemble for every enabled project.
Turning the flag on is the whole setup. Nothing assembles or merges for a project
whose effective flag is off.

A project with a live generation but an empty ready set is still reconciled, so
invalidation runs when its last ready feature merges elsewhere. A project with
neither skips the tick before doing any git work, which is what keeps the sweep
from touching every tracked repo every 60 seconds.

### Polyrepo generations

A polyrepo project (`workspace.type: polyrepo`) has no git repo at its own path
— that path is a wrapper holding one real repo per configured member. A
generation there is not one branch off one main but an **N-tuple**: one
`uat/<label>-<codename>-<MMDD>` branch per member repo, each cut from that
repo's own target head. [PAN-1696](https://github.com/eltmon/overdeck/issues/1696)
shipped a guard that skipped these projects outright;
[PAN-3093](https://github.com/eltmon/overdeck/issues/3093) removed it by making
assembly work per repo.

**Only contributing repos get a branch.** The ready set resolves each
candidate's member repos through `resolveProjectReposFromResolvedIssueSync` and
probes each one origin-first for the issue's feature branch. Repos with no
branch contribute nothing and get no branch and no worktree; a candidate with no
branch in *any* repo is excluded from the ready set with a logged reason.
Conflict prediction runs over the union of each candidate's per-repo changed
files, namespaced `<repoKey>:` so the same path in two repos is not mistaken for
an overlap — hotspot globs apply per repo, before that prefix is added.

**Per-repo SHAs, one composite anchor.** Each repo's branch, base SHA, worktree,
and publish stamp live in `uat_generation_repos`; each `(member, repo)`
contribution lives in `uat_generation_member_repos`. The single-valued
`uat_generations.base_sha` holds the **composite anchor** `fe@aaa1111 api@bbb2222`
— the same tuple format the review pipeline already records. Member `headSha`
is likewise a composite over the repos that member touched. This matters because
the reconciler decides staleness by *string equality* between the anchor it
computes now and what assembly stored: both sides build anchors through the same
helpers, and member anchors order by `repoKey` because that is the only ordering
both sides can compute. Monorepo generations write no per-repo rows and read
back as a single synthesized entry, so consumers loop `repos` without branching
on project type.

**A hold-out is global, and applying a feature is atomic.** A feature that
cannot be merged and resolved in *any* repo is held out of the whole generation
— a tester must never see a feature half-applied across repos. Each feature is
applied to every repo it contributes to or to none: assembly captures each
target repo's head first, and if a later repo rejects the feature, the repos
that already took it are re-pointed at that captured head (`checkout -B`, never
`reset --hard`). Accepted features are never disturbed, so total git work stays
linear in repos × features rather than the quadratic cost of rebuilding and
replaying. A repo left carrying nothing after its features are held out gets no
published branch. The conflict hook runs per repo with `repoKey` in its context,
naming the repo in its prompt and logs.

**Read-only repos are never targets.** A member repo configured `readonly: true`
is excluded from the ready set before it is even probed, omitted from the git
and cleanup deps, and re-checked against current config at promote time — a repo
flipped read-only after assembly fails the promote closed rather than publishing
part of the batch.

**Promotion is two-phase and all-or-nothing.** Phase A validates and
trial-merges every repo *without pushing*: per-repo target head, the same
disjoint-movement stale-base rule applied per repo, then a no-ff merge committed
locally in a throwaway worktree. Any failure discards every prepared worktree
and returns with nothing published and the batch still promotable. Phase B
publishes in merge order, each repo into its own recorded `target_branch` —
a repo configured for `develop` is fetched, trial-merged, and published there.
A failure partway is **resumable, not rolled back** — undoing a landed merge
would mean force-pushing a member repo's main, a one-way door. Each landed repo
is stamped with `promoted_at` and its `merge_sha`, the failure names landed vs
pending repos, and a retry skips whatever already landed. A retry that finds
every repo already landed *finalizes* rather than erroring, which is what makes
a crash between the last push and finalization recoverable.

**Finalization requires complete evidence: every repo must carry both
`promoted_at` and `merge_sha`.** A row stamped without a merge SHA is repaired
first — the retry looks the merge up on the repo's target and records it — but
if no merge can be found there, the promote fails *retryably* instead of
finalizing. This matters because `promoted_at` alone is enough to keep a row out
of the pending set: finalizing on it would mark the generation `promoted` while
permanently unable to produce that repo's merge commit, so post-merge
verification would refuse every member forever and the terminal status would
block the only retry that could still recover the SHA. `finishPromote()`
enforces the invariant at the single point a generation turns terminal, so no
caller can bypass it. Post-merge
lifecycles fire only after *every* repo publishes, and receive the per-repo
merge commits as evidence — each verified inside its own repo against its own
target branch, since a composite anchor is not a git ref and the wrapper is not
a git repo.

**Teardown covers every repo.** Cleanup removes each member repo's worktree and
branch (local and remote), then the wrapper folder, and sweeps the generation
branch from every configured member repo — a hold-out can drop a repo after its
branch was created locally, and that branch is never pushed but would otherwise
linger. Every repo is attempted even after one fails, and `cleanedAt` stays
unset so the next patrol retries. The live stack is unchanged: the generation's
`worktreePath` is the wrapper folder, so the folder-name → Traefik host contract
and the 2-stack cap work exactly as for a monorepo.

### Multi-project shape

Batches are always **per project** — a generation contains one project's work and
nothing else; cross-project batches do not exist. Generation labels use the
project's issue prefix (`uat/pan-…`, `uat/min-…`), which is what keeps names
distinct in the globally-keyed `uat_generations` table. What spans projects is the
**view and control surface**: the merge-train view on the Awaiting Merge page
renders one section per project that has ready work or a switched-off train, with
a persisted project filter. Idle enabled projects are hidden instead of repeating
empty boilerplate, and a footer counts the hidden projects. The Flywheel rail card
is a second viewer of that same component. Per-project enablement lives
in the project cockpit's settings; the global default lives on Awaiting Merge and
in Settings → Roles → Flywheel.

The Flywheel orchestrator's `scope` (which projects it inventories) is a separate
axis and does **not** gate any of this — see [`FLYWHEEL.md`](./FLYWHEEL.md).

## Relationship to the per-issue merge path

[`MERGE-WORKFLOW.md`](./MERGE-WORKFLOW.md)'s four-state per-issue pipeline
(work-done → review-passed → rebased → merged) is unchanged and remains the
**escape hatch** — it's what the "Merge one feature to main…" button and the
SQLite per-project merge-serialization queue drive. Batch promotion is the
primary path while a flywheel run with the merge train enabled is active; the
per-issue path covers everything else (and merging a single feature out-of-band
invalidates the live batches and triggers reassembly).
