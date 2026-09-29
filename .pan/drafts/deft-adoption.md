# PRD: Deft Directive vs Overdeck comparison and adoption plan

**Status:** Approved for filing (2026-09-28). Every "adopt" recommendation below was approved; the 16 ready-to-file issues at the end are filed on eltmon/overdeck.
**Date:** 2026-09-28

## Deft Directive vs Overdeck: head-to-head comparison

**Anchors.** Deft Directive `deftai/directive` at `48e8cbf0e78` (2026-09-28, CHANGELOG head v0.119.10, read from a local bare clone). Overdeck `eltmon/overdeck` at `origin/main` `453e1e4bf36` (2026-09-28). Every "Deft does X" claim cites a path at that Deft commit; every "Overdeck does X" claim cites a path on that Overdeck commit. Research only: neither repo was edited.

**How to read this.** The two tools solve overlapping problems from opposite starting points. Deft is a framework that deposits rules, skills, hooks and a TypeScript CLI into a consumer repo and has to work inside whatever agent host the user runs (Cursor, Claude Code, Codex, Grok Build, OpenClaw, Warp), with no daemon. Overdeck is a local runtime (dashboard server, terminal backend, deacon) that launches and supervises the agents itself. Many differences below fall out of that one fact, so "keep both" is a common verdict, and it is not a dodge.

Both tools state the same threat model: aligned agents taking the cheap path, not a hostile local actor. Deft says so in `packages/core/src/authz/types.ts` ("aligned agent, not malice"; local-file forgery is out of scope), and Overdeck says so in `docs/REVIEW-AGENT-ARCHITECTURE.md` ("Verdict forgery is a non-threat in this deployment"). Every grant, deny and fence recommended here is cheap-path prevention, not a security boundary.

---

## Verdict

### What Overdeck should adopt (ranked by value)

1. **Gate integrity, enforced where the cheap path starts.** Deft's rule is one line: when a gate fails, the fix must not be an edit to the gate (`content/docs/gate-integrity.md`, `main.md` "Gate Integrity (#3156)"). Its scope fence reads the allow-list from the merge-base copy of the plan, never the head copy, so a PR cannot authorize itself by editing its own brief (`content/docs/scope-provenance.md`). Overdeck has the exact failure: #3308 (open) records that 2 of 3 agents raised the file-size ceiling instead of shrinking the file, because `scripts/lint-file-size.sh:171-174` prints a paste-ready allowlist line with the larger number; #3322 shows a temporary raise becoming permanent regrowth budget; #1728 (open) records a work agent committing edits to its own `.pan/specs/*.xbrief.json`. Fix the guard message, make ceiling raises operator-only, and fence `.pan/specs/<issue>` against the merge base (issues 1, 2 and 11 below).

2. **Deterministic branch and primary-checkout protection, including in managed projects.** Overdeck's own `sync-sources/rules/worktree-discipline.md` says "no part of the pipeline auto-checks it. Only the agent's own pre-edit self-check catches drift." The agent main-push guard (`scripts/guard-agent-main-push.sh`) runs only in the overdeck repo's husky hook; `installGitHooksInDir` (`src/lib/git-hooks.ts:49`) ships only `post-checkout` into registered projects; `validateCwdContainment` (`src/lib/overdeck/conversation-forks.ts:172`) checks absolute/under-home/exists but never refuses a project's primary checkout. Evidence: #3505 (agent code commits stranded on the primary `main` worktree), PAN-2204, and the 2026-07-01 handoff incident cited in `sync-sources/rules/handoff-isolate-cwd.md`. Deft closes the same class with a three-surface branch gate (`.githooks/pre-commit`, `.githooks/pre-push`, a `branch-gate` workflow; `main.md` "Decision Making") and refuses mutation claims on the primary checkout outside named exceptions (`PRIMARY_CLAIM_EXCEPTIONS`, `packages/core/src/session/occupancy.ts:126`). Issues 3, 4 and 10.

3. **Decorrelated criticism: an independent plan critic, and fresh eyes on re-review.** Overdeck's only pre-implementation critique is `pan plan --probe`, which is the planner attacking its own plan (`sync-sources/skills/pan-plan/SKILL.md:62`). Convoy reviewers resume their previous session by default (`src/lib/cloister/review-convoy.ts:190`, PAN-1862), which saves tokens but anchors each lane on its own prior findings. Deft's design-critique contract is far too heavy to copy (see below), but four of its principles are cheap and sound: decorrelation (agreement between correlated critics is not verification), method-reconciliation (reproduce a claimant's method before calling a number wrong), non-self-arbitration (an author does not clear its own finding), and "a reviewer would catch it" counts as a failed finding (`content/contracts/design-critique.md`, "Critic method" and "Stop 5", lines 158-165 and 504-506). Its Stop 4 says outright: "Dispatch a fresh critic against a disagreement map. Do not default to resume" (line 260). Issues 7 and 8.

4. **Parallel-work isolation that code enforces, not prose.** Overdeck's foreman protocol puts file ownership in the dispatch prompt only (`sync-sources/skills/pan-foreman/SKILL.md`: "concurrent workers in one worktree WILL clobber shared files"). `pan spawn` gives a worker its own worktree only when the item declares `files_scope` (`src/cli/commands/spawn.ts:95-98`), otherwise the worker shares the issue workspace. `claimItem` overwrites `claimedBy` unconditionally through a plain read-modify-write (`src/lib/xbrief/continue-state.ts:229-245, 290-309`), although `docs/XBRIEF.md:9` says "exactly one claim succeeds." Overdeck already computes the overlap matrix deterministically (`src/lib/xbrief/swarm-readiness.ts`, `analyzeSwarmReadiness`), it just does not consult it on the default path. Deft makes one-worktree-per-parallel-agent a hard gate, validates worktree maps and raises on collisions (`packages/core/src/swarm/worktrees.ts:199`, `resolveWorktreeMap`), and requires zero file overlap before setup (`content/skills/deft-directive-swarm/references/core-phase-1-2.md`, Step 2). Issues 5 and 6, plus 16 (a re-dispatch budget).

5. **Provenance on the operator grants Overdeck already has.** The `released` label is the operator's go for autonomous pickup (`src/lib/backlog/pickup.ts:31-32`), and `auto-merge` / `hold-for-uat` steer merges (`docs/MERGE-WORKFLOW.md`), but the code checks label presence only, and agents run `gh` with the operator's token, so an agent-applied label is indistinguishable from the operator's. Deft enumerates which evidence can never count as human approval (agent lifecycle, xBRIEF status, dispatch envelopes, allocation context, self-asserted; `packages/core/src/authz/types.ts` `REJECTED_ORIGIN_KINDS`, `authz/origin.ts`) and classifies kill-switch creation and policy flips as "settings" that need a human grant (`content/docs/deft-directive-disable.md`, "Agent self-serve ban under UAT"). Overdeck can take the shape without the grant store: refuse those label writes in the `gh` shim, and extend the shim to conversations, which today do not get it, since the Flywheel runs as one (`src/lib/launcher-generator.ts:381`). Issue 9.

Smaller adopts, still worth filing: a byte ratchet on the always-loaded rules bundle (Deft `packages/core/src/policy/agents-md-budget.ts`; Overdeck's rendered `$OVERDECK_HOME/context/claude-global.md` is 40,370 bytes on a reference install with no ceiling), carrying significant decisions past workspace close-out (Deft `content/docs/decision-log.md`; Overdeck's `decisions[]` live in gitignored `.overdeck/continue.json` and die with the workspace), warn-first scope-drift evidence in verification, and an agent-side REST-over-GraphQL rule until PAN-4302 migrates the unmetered `gh` sites (Deft `AGENTS.md` lines 122-124, #954; the shared failure mode is PAN-4291). Issues 12 to 15.

### What Overdeck does better and could offer upstream

1. **Derived liveness beats recorded leases.** Deft's worktree occupancy lease is 2,544 lines (`packages/core/src/session/occupancy.ts`), refreshes on writes, and its own docblock admits "a pure time cap cannot tell a stalled-but-live owner from a dead one" (line 116). Its proposed #3729 (`xbrief/proposed/2026-08-25-3729-...`) measures the lease as exclusion-only and self-disabling: a parent ran about 14 hours of mutation work without ever claiming, beside a 21-hour-old expired record, and six of seven subagent worktrees had no lease at all. `packages/core/src/hooks/owner-liveness.ts` exists because compound shell commands starved the heartbeat. `verify:orphan-active` exists because the `xbrief/active/` folder drifts from PR truth, and until #3767 a 12-hour-old cache hit beat reality there (`content/docs/orphan-active-verdict-basis.md`); `swarm/finalize-cohort.ts` is 2,348 lines of post-merge lifecycle reconciliation. Overdeck answers the same questions from the terminal backend and the process tree (`src/lib/agents/liveness.ts`) and computes merge readiness live on every ask (`docs/PIPELINE-GATES.md`, "The merge gate"), so there is nothing to reconcile. Deft cannot copy the implementation (no daemon, no pane inventory), but the principle transfers: prefer a liveness signal the host already has (Deft's own docblock names "refresh on non-write activity") and derive lifecycle from the PR instead of moving files.

2. **Orchestrator-injected context over agent-remembered rules.** Deft's #2143 is a rule ("fetch body + comments before requirements or dispatch") plus a verb (`deft issue:ingest`). Overdeck injects up to 50 issue comments into the planning prompt deterministically (`src/lib/planning/spawn-planning-session.ts:208-218`), assembles the workspace layer itself, and delivers launch context without touching native `AGENTS.md`/`CLAUDE.md` (`docs/CONTEXT-LAYERS.md`, "Respecting your existing context"). By Deft's own Rule Authority ladder (deterministic > Taskfile > xBRIEF > RFC2119 > prose; `main.md`), injection outranks a rule the agent must remember. Deft can apply this wherever it controls the dispatch envelope (`task swarm:launch` already emits a manifest).

3. **Head-bound approval with provenance.** Overdeck's merge gate accepts approval only for the exact PR head: a trusted App-authored review whose `commit.oid` is the head, or an `overdeck-verdict: APPROVED sha=<head>` marker (`docs/REVIEW-AGENT-ARCHITECTURE.md`, "How the verdict reaches the forge"; `approvalProvenAtHead`). The override door reads the caller from `/proc/<pid>/environ` ancestry so an agent cannot unset its own id to pass as the operator (`docs/PIPELINE-GATES.md`, "The override door is the operator's (#3853)"). Deft's human merge gate is a policy flag plus an env override (`AGENTS.md` "Human merge gate (#1193)"), and `pr:watch` SHA-matches the Greptile verdict but merge itself is not bound to an approval of the head. Also offerable: `pan task done` refuses completion unless a pushed commit carries the `Item:` trailer (`docs/XBRIEF.md`, "Task state and concurrency"), which is the deterministic form of Deft's prose "Thin DONE = failed leaf" rule.

---

## Area-by-area summary

| Area | Deft | Overdeck | Better when | Call |
|---|---|---|---|---|
| Planning and specs | Scope xBRIEFs move between `proposed/ pending/ active/ completed/ cancelled/` folders; WIP cap 20; completed briefs have zero authority over next build (#3383) | Status is a field, files never move; spec immutable after planning; continues file + `Item:` trailers hold progress | Overdeck for drift; Deft's "completed has no authority" line is a good rule | Keep both; converge field names in xBRIEF |
| Task/worktree ownership | Occupancy lease per tree, child grants, heartbeat files; exclusion-only, time-based | Workspace per issue; liveness from pane + process tree; claims advisory | Overdeck for liveness; Deft for "one worktree per parallel writer" as a hard gate | Offer liveness; adopt isolation (issues 5, 6) |
| Session start and context | `session:start` ritual, gated staleness, alignment echo, pinned skills; ~21 KB managed AGENTS section plus `main.md` | Launch-time injection of global/project/workspace layers; comments injected; bare mode | Overdeck for supervised agents; Deft for unsupervised hosts it does not launch | Keep both; offer injection; adopt byte ratchet |
| Review and critique | Pre-implementation design-critique arcs, sibling isolation, cross-family seats; PR review via Greptile + review-cycle skill | Four-lane convoy + synthesis on every full review, head-bound approval, convergence gate; no independent plan critic | Deft before code; Overdeck after code | Adopt critic principles (7, 8); offer head binding |
| Safety and authority | PreToolUse dispatcher denies foreign-repo writes, destructive git, fence violations, occupancy/ritual misses; UAT-scoped human grants | Auto-approve for agent classes; three narrow guards (git shim, tmux send-keys, AUQ); prose destructive rules; operator-only waiver and override door | Deft for closed-set denials; Overdeck for not hanging headless agents | Adopt narrow denies and label provenance (9) |
| Branch/merge discipline | Feature branches everywhere via hooks + CI; human merge by default | Merge gate computed live; agent main-push guard in overdeck repo only | Deft on coverage of consumer repos; Overdeck on merge proof | Adopt (3, 4, 10); offer head binding |
| State philosophy | Recorded state: occupancy.json, ritual-state, authz store, attempt ledgers, lifecycle folders | Stores nothing derivable; append-only journal that is never authority | Overdeck | Offer |
| Agent instructions | Managed AGENTS.md section with sha, RFC2119 glyphs, issue refs in rules, Rule Authority ladder | 33 terse bundled rules, context layers, skills; no size ceiling | Deft's ladder and budget; Overdeck's terseness | Adopt ladder note + ratchet (11, 12) |
| Install and upgrade | npm CLI deposits `.deft/core` into each repo; 118 KB UPGRADING.md; version skew checks | `pan install`/`pan sync` (auto every 60 s) render launch artifacts; native files untouched | Deft for cloud/CI hosts; Overdeck for one machine | Keep both |
| Observability/doctor | Doctor = deposit, skew, AGENTS drift, hook readiness; `eval:health`; process-cost events | Doctor = runtime infra (Herdr, hooks drift, inotify, quota, sync freshness); dashboard, God View, journal | Different jobs | Keep both |
| Swarms | Monitor agent, N stories, one worktree and PR each, zero overlap, heartbeats, attempt ledger | Cross-issue via Flywheel + workspaces; intra-issue foreman waves; dormant `pan swarm` slots | See the Swarms section | Adopt isolation; converge on xBRIEF parallel-safety |

---

## Details by area

### 1. Planning and specs

**Deft.** Scope xBRIEFs live in lifecycle folders and move as they progress (`main.md` "xBRIEF Persistence"; `xbrief/{proposed,pending,active,completed,cancelled}/`). `deft scope:promote` refuses at the WIP cap (`plan.policy.wipCap`, default 20; `AGENTS.md` "WIP cap"). Promotion, activation and completion are verbs (`scope:promote`, `scope:activate`, `scope:complete`), and `xbrief:preflight` must pass on an `active/` brief before code (`AGENTS.md` "Implementation Intent Gate"). Swarm-readiness fields sit at plan level under `plan.metadata.swarm`: `file_scope`, `verify_commands`, `expected_outputs`, `depends_on`, `conflict_group`, `size`, `file_scope_confidence`, `model_tier` (`packages/core/src/vbrief-validation/story-quality.ts:250`). One strong rule: "Completed xBRIEFs are record of *what is*, zero authority over *what to build next*" (#3383).

**Overdeck.** Status is a JSON field; "files never move between directories" (`docs/XBRIEF.md`, "Status Transitions"). PRD first, then planning promotes a v0.8 spec into `.pan/specs/` on the feature branch; progress lives in `.pan/continues/<issue>.xbrief.json` keyed by `Item:` trailers. Item metadata carries `files_scope`, `files_scope_confidence`, `verify_commands`, `expected_outputs`, `difficulty`, `readiness`, `traces`. A plan-freshness preflight refuses `pan start` when the plan names files a later commit deleted (`docs/PIPELINE-GATES.md`, "Plan-freshness preflight").

**Judgment.** Overdeck's field-based status avoids the reconciliation surface Deft pays for (`verify:orphan-active`, `swarm:finalize-cohort`, `verify:completed-tracked`). Deft's WIP cap as a count is a blunt instrument compared with Overdeck's resource governor plus order books, and is not worth adopting. Deft's "completed brief has no authority" is already Overdeck's instinct (the journal is "never authority"), so nothing to adopt there. The real gap is the one #1728 shows: Overdeck commits the spec on the feature branch, so an agent can rewrite its own plan and ride the merge. Deft reads the fence from the merge base for exactly this reason. **Adopt** the merge-base fence (issue 2). **Converge** the field vocabulary: Deft `file_scope` (plan level) vs Overdeck `files_scope` (item level) vs `filesScope` proposed in deftai/xBRIEF#40. See the Swarms section.

### 2. Task and worktree ownership

**Deft.** Occupancy is "who may mutate this tree right now," separate from ritual state (`packages/core/src/session/occupancy.ts` header). TTL 20 minutes (line 90), absolute cap 12 hours (line 122), owner-issued child grants capped at 32, primary-checkout claims refused outside named exceptions (line 126). The lease is a cooperative bearer id; on hosts where parent and child share one id, "a parent's `occupancy:release` removes a working child's lease mid-flight with no denial" (same header). Spawn reserves the destination tree before launch (`session/spawn-occupancy.ts`), and dispatch records child leases (`session/child-occupancy.ts`).

**Overdeck.** One git worktree per issue at `workspaces/feature-<issue>/`; one module answers liveness and idleness from session + live pane + harness process in the pane subtree (`src/lib/agents/liveness.ts`, `CLAUDE.md` "Key Invariants"). No tree lease exists. Claims are recorded in the continue file but not checked (see Verdict item 4).

**Judgment.** For "is this agent alive and working," Overdeck's derivation is strictly better and needs no heartbeat, TTL or reclaim logic. Deft is right about two narrower things: a second mutating actor in the same tree is the failure to prevent, and the primary checkout needs a hard refusal. **Offer** derived liveness; **adopt** primary-checkout refusal and worker isolation (issues 4 to 6) without adding a lease.

### 3. Session start, rituals and context loading

**Deft.** A read-only default until mutation intent; then `deft session:start` and `deft verify:session-ritual --tier=gated` before code or dispatch, with a staleness window and a one-shot `session:ready` recovery (`AGENTS.md` "Session routing (#2176)", "Session-start ritual (#1149)"). The agent must echo the USER.md addressing name to confirm alignment. Four skills are always pinned (`AGENTS.md` "Skill pin policy"). The managed AGENTS.md section alone is about 21 KB (measured: 20,908 bytes), and the session reads `main.md` (about 38 KB) plus USER.md and PROJECT-DEFINITION on top. Deft does ratchet it: a per-region line and byte ceiling that forbids growth (`packages/core/src/policy/agents-md-budget.ts`, 8 KB north star).

**Overdeck.** Context is composed at launch from global, project and workspace layers and delivered through each harness's system-prompt mechanism, never by editing native instruction files (`docs/CONTEXT-LAYERS.md`). Planning gets issue comments injected. A "No context" bare mode exists per conversation (PAN-4185). The rendered universal-plus-dev bundle on a reference install is 40,370 bytes, and nothing stops it growing.

**Judgment.** Deft needs a ritual because it does not launch the agent; Overdeck does, so its injection is the stronger mechanism for its own agents. Keep both. **Adopt** the byte ratchet (issue 12). Skip the alignment echo; it costs a turn and proves only that a file was read.

### 4. Review and critique

**Deft.** Two separate surfaces. Before code, a design-critique "arc" runs on the issue thread: a gate label, a charter (refutation or open critique), a spend (N critics), a critic envelope with a fixed GitHub-comment id ceiling that all same-round siblings share, so no sibling can read another's post (`content/contracts/design-critique.md`, "Envelope and ceiling"), N≥3 panels must name three model families (`design-critique/panel-seat-families.ts`), parent-side substantiation tokens, dual-stop post caps, and a verified-claims table with decorrelation, method-reconciliation and non-self-arbitration. After code, PR review is an external bot (Greptile) driven by the 124 KB `deft-directive-review-cycle` skill with `pr:watch` polling to a three-state verdict.

**Overdeck.** No design critique. After code, every full review launches four independent lanes (security, correctness, performance, requirements) plus a synthesis parent that posts one PR review; approval is bound to the head commit; a convergence gate stops auto re-drive when rounds reverse or stall (`docs/REVIEW-AGENT-ARCHITECTURE.md`, `docs/PIPELINE-GATES.md` "Review Convergence Gate (PAN-3151)").

**Judgment.** Overdeck's code review is self-contained, head-bound and cheaper to operate than a bot plus a 124 KB babysitting skill. Deft is ahead before code, and on decorrelation. Be honest about Deft's cost too: the contract is 102 KB, and it concedes that "panel completeness is behavioural ... no code observes them" (line 206, #3850), which sits oddly beside its own "Thin Fail-Closed Design" axiom (`main.md`). **Adopt** the principles, not the ceremony: one fresh-context, different-family critic before finalize on flagged plans (issue 7), and one fresh (non-resumed) lane per re-review round plus the critic-method lines in `roles/review.md` (issue 8).

### 5. Safety and authority

**Deft.** The PreToolUse dispatcher (`packages/core/src/hooks/dispatcher.ts`, `inspectMutationGates` at line 1478) denies, always on: writes whose targets resolve to a different repository or span worktrees, unclassifiable apply-patch bodies, destructive git outside fixtures (`decideGitDestructive`, line 2339, with an audit log), writes outside the runtime-authority path fence (project allow/deny intersected with the merge-base `file_scope`, `policy/write-fence.ts`), and occupancy and ritual misses. Human-origin grants bite only under an active UAT lease: `evaluateAuthzMutation` returns allow when UAT is inactive (`authz/evaluate.ts:293-305`). Grants require a TTY, controlling terminal, `--confirm` and a typed phrase. Hooks fail closed, which has its own failure mode: a missing `deft-hook` binary makes every mutation exit 127 (`content/docs/hook-runtime-unavailable.md`). The test kill-switch `.deft-directive-disable` requires a new session after removal (hysteresis) and agents may not create it under UAT.

**Overdeck.** The auto-approve hook allows every tool call for `agent-*`, `planning-*`, `flywheel-*`, `conv-*` and similar ids so headless agents never hang (`sync-sources/hooks/auto-approve-hook`, PAN-1024). Three narrow guards exist: the git shim blocks `rebase`, state-moving `stash` and `reset --hard` in the agent's own worktree and supports a read-only mode (`src/lib/launcher-git-guard.ts`), `tmux-send-keys-guard` blocks writes to another agent's session, and `ask-user-question-hook` denies AUQ so the dashboard can surface it. Destructive HTTP and deep-wipe rules are prose (`sync-sources/rules/no-destructive-requests.md`). The test-removal waiver is operator-conversation-only and the override door checks caller ancestry (`docs/PIPELINE-GATES.md`). Hooks fail open by design.

**Judgment.** Overdeck is right not to put a permission prompt in front of headless agents, and its guard refusals do not advertise their bypass (`OVERDECK_PAN_GIT_OP=1` is documented in the source, not printed), unlike the file-size guard. Deft is right that a small closed set of authority operations deserves a deterministic deny. **Adopt** narrow closed-set denials (label grants in the `gh` shim, branch drift in the git shim, primary cwd) rather than a general grant store. Keep fail-open vs fail-closed as a legitimate difference: Deft's failure is lockout, Overdeck's is a silent pass.

### 6. Branch and merge discipline

**Deft.** Feature branches only, enforced by hooks and a CI workflow in every consumer repo, with typed and audited overrides (`main.md`; `AGENTS.md` "Branch policy"). `requireHumanMerge` defaults on when `autoDeployOnMerge`. Destructive `gh` verbs go through `deft preflight-gh`.

**Overdeck.** One merge gate for every door, computed live from the forge, approval bound to the head, CI test job required on the head (`docs/PIPELINE-GATES.md`, "The merge gate"). Merge train and UAT batches. The agent main-push guard protects only the overdeck repo.

**Judgment.** Overdeck's merge proof is stronger; Deft's coverage of consumer repos is broader. **Adopt** shipping the push guard and the branch-drift check to registered projects (issues 3, 10). **Offer** head-bound approval.

### 7. State philosophy

Deft records liveness, ritual completion, approvals, attempt counts and lifecycle position in files (`.deft/occupancy.json`, ritual state, `.deft/authz/`, `.deft/delivery-attempts/`, lifecycle folders). Overdeck stores no status it can derive and keeps one append-only journal that is never authority (`docs/PIPELINE-GATES.md`, "The pipeline journal"). Overdeck does store operator decisions (pause, troubled, stoppedByUser in `$OVERDECK_HOME/agents/<id>/state.json`), which is consistent: those are facts, not derivations. The evidence favors Overdeck: several thousand lines of Deft exist to reconcile recorded state with reality. **Offer.** Every adopt item below is checked against this rule.

### 8. Agent instructions

**Deft.** A managed AGENTS.md section with a sha stamp, refreshed by `agents:refresh`, dense RFC2119 glyphs (`!`, `⊗`) and issue references in almost every line. The Rule Authority axiom says every rule must use the strongest applicable layer (`main.md`). "Self-improving, not self-editing": sessions propose changes to rules; PRs dispose (`main.md` #3164).

**Overdeck.** 33 bundled rules, most short and imperative with a one-line why (`sync-sources/rules/`), plus `rule-authoring.md` saying universal rules cost context everywhere. Skills are distributed by `pan sync`.

**Judgment.** Overdeck's rules read better; Deft's managed section is close to unreadable for a human and costly for a model. But Deft's ladder is the better authoring discipline: several Overdeck rules describe a failure that a shim or hook could prevent. **Adopt** a Rule Authority note in `rule-authoring.md` (issue 11) and the byte ratchet (issue 12).

### 9. Install and upgrade

Deft deposits `.deft/core` into every consumer repo via `npm i -g @deftai/directive` and `directive init`, checks pin skew in `doctor --full`, and documents migrations in a 118 KB `content/UPGRADING.md`. The deposit travels with the repo, so cloud agents and CI get the rules without any local daemon. Overdeck renders launch artifacts under `$OVERDECK_HOME/context/`, auto-syncs every 60 seconds, and never edits native instruction files. **Keep both**: Deft's model is the only one that works in hosts it does not control, and Overdeck's avoids consumer-repo churn and merge conflicts on managed sections.

### 10. Observability and doctor

Deft's doctor checks the install (quick-start resolves, skill paths, manifest agreement, legacy layout, version skew, AGENTS drift, hook readiness) and prints one "Next command" (`packages/core/src/doctor/checks.ts`); `eval:health` and `.deft-cache/events.jsonl` process-cost events cover framework health. Overdeck's doctor checks the runtime (Herdr, hooks drift, sync-source freshness, CLI generation, inotify, duplicate compose stacks, GitHub quota, plan-home ignore; `src/cli/commands/doctor*.ts`), and the dashboard, God View and pipeline journal carry live observability. Different jobs; **keep both**. Deft's "one fail-closed check, one remediation string" discipline is worth imitating in Overdeck doctor rows that currently print several options.

---

## Swarms

The two swarms differ a great deal. The first thing to get straight is what the word means on each side.

**Deft's swarm** is the `deft-directive-swarm` skill (`content/skills/deft-directive-swarm/`, about 250 KB across SKILL.md, six core references and seven host adapters) plus `packages/core/src/swarm/`. A monitor agent, inside the operator's host conversation, allocates a cohort of story-level xBRIEFs (roughly one issue each) and runs one agent per story, each with its own worktree, branch and PR.

**Overdeck has three things.** Cross-issue parallelism is the Flywheel (`docs/FLYWHEEL.md`) launching `pan start` per issue into its own workspace, with the full verification, review, test and merge pipeline per issue. Intra-issue parallelism is the foreman protocol (`docs/FOREMAN.md`, `sync-sources/skills/pan-foreman/SKILL.md`): the issue's work agent dispatches xBRIEF items in waves to in-harness subagents or `pan spawn` panes, integrates them onto the feature branch, and opens one PR. The older `pan swarm` slot machinery (`src/cli/commands/swarm.ts`, `src/lib/cloister/deacon-swarm*.ts`, dev skill `sync-sources/dev-skills/pan-swarm/SKILL.md`) has dispatch gates for DAG blockers, file-scope isolation, holds, capacity and duplicates, plus recovery counters, but it "stays dormant in-tree (D11)" after the Cut (`docs/THE-CUT.md`) and is not on the default path.

So Deft's swarm corresponds to Overdeck's Flywheel plus workspaces, not to the foreman.

| Dimension | Deft swarm | Overdeck (Flywheel + foreman) |
|---|---|---|
| Unit of parallelism | One story xBRIEF per agent; cohort of N stories | One issue per workspace (Flywheel); one xBRIEF item per worker inside an issue (foreman) |
| Who decomposes | Planner writes story briefs; monitor allocates from `deft triage:queue` / `plan-sequence`; Phase 0 approval or a pre-approved cohort token (#1378) | Planning agent writes items with `files_scope` and `blocks` edges; waves derived in `src/lib/xbrief/dag.ts`; foreman chooses at runtime; Flywheel picks issues from order books and the backlog sequence |
| Worktree isolation | Hard gate: one worktree per parallel agent under `.deft-scratch/worktrees/<story-id>`; `resolveWorktreeMap` raises on same-path collisions and base mismatches; spawn reserves the destination before launch | Per-issue workspace worktree always; per-item worktree `<workspace>/.swarm/<item>` only when the item has `files_scope`, else shared workspace (`spawn.ts:95-98`); subagents get worktrees by instruction |
| Coordination and locking | Occupancy lease per tree, child grants, heartbeat files in `.deft-scratch/subagent-status/`; nuclear-family messaging (#3155); WIP cap 20 | `pan task claim` (unchecked overwrite); liveness from the backend; foreman-only messaging enforced by the backend (FR-17); resource governor holds dispatch on memory/CPU saturation |
| Conflict prevention | `task swarm:readiness` overlap matrix; zero overlap required, transitive touches checked (Phase 1 Step 2); write fence from merge-base `file_scope` | `analyzeSwarmReadiness` overlap matrix exists but the foreman path relies on the prompt; legacy `pan swarm dispatch` enforced it |
| Merge back | Each story is its own PR: Greptile review cycle, `pr:wait-mergeable-and-merge`, `scope:complete`, then `swarm:finalize-cohort` moves briefs | Cross-issue: each PR through the Overdeck merge gate and merge train. Intra-issue: foreman cherry-picks worker commits onto the feature branch, one PR |
| Failure recovery | Delivery-attempt ledger with material-progress breaker (`content/docs/delivery-attempt.md`), dual stop (3 repair actions), takeover triggers, duplicate-agent failure mode, halt report with resume phrases | Deacon-lite routines, verification stuck pause after 3, troubled gate (3 failures in 10 minutes), convergence gate; foreman protocol has "no recovery ladder" by design |
| Human gates | Phase 0 Step 5 approval, allocation-context consent token, `requireHumanMerge`, UAT grants | `released` label, order books, `pan pause`, Merge button / UAT hold / `auto-merge` label |
| Scale limits | WIP cap; zero-overlap requirement; one parent context holds the whole cohort (the FC14 repetition hang, `parent-turn-shape`); shared GraphQL bucket (#954) | Memory/CPU governor; GitHub quota pause (PAN-4264); disk (`.swarm` worktrees, one install per workspace); one Flywheel conversation |

**Where each is stronger.** Deft's parent-in-a-conversation design is forced by its hosts, and it pays for that with heartbeat files, leases, a parent-turn-shape detector for a parent that repeats itself instead of calling tools, and a cohort finalizer. Overdeck's server-side orchestrator sees panes and processes directly, runs each issue through a full pipeline, and survives the orchestrator conversation dying. On isolation inside a unit of work, Deft is stricter: it never lets two writers share a tree, while Overdeck's foreman can put two `pan spawn` panes in the same workspace when items lack `files_scope`. Overdeck also has a doc/code drift here: `docs/FOREMAN.md` says a `pan spawn` pane "pushes the shared feature branch directly," but `spawn.ts` puts scoped items on a sibling branch `<feature>-<item>` (`src/lib/workspaces/item-worktree.ts`), which the foreman must integrate.

**Path forward.**

Adopt (issues 5, 6 and 16 below):
- Make `pan task claim` refuse an item already claimed by a different agent that is still alive (liveness from `isAlive`, no lease), and refuse an item whose `files_scope` overlaps another claimed, not-done item. This is Deft's zero-overlap gate moved to the one door every worker already passes through.
- Make every mutating `pan spawn` worker run in an item worktree, scoped or not, and fix FOREMAN.md and the skill to describe integration truthfully.
- Consider a foreman re-dispatch budget per item (issue 16, flagged against the state rule).

Converge (xBRIEF, via deftai/xBRIEF#40):
- Put `filesScope`, `filesScopeConfidence`, `verifyCommands` and `expectedOutputs` on PlanItem (already in #40), and let plan-level values act as defaults so a Deft story (one plan, parallel with other plans) and an Overdeck wave (items of one plan) use one vocabulary. Deft's `plan.metadata.swarm.file_scope` and Overdeck's `metadata.files_scope` both map onto it.
- Add optional `conflictGroup` (Deft `conflict_group`; Overdeck's `hotspots` option in `analyzeSwarmReadiness`) for shared files that globs miss.
- Specify the parallel-safety predicate normatively instead of a stored "wave" field: two items may run concurrently iff neither reaches the other through `blocks` edges, their `filesScope` sets do not intersect, they share no `conflictGroup`, and neither has low scope confidence. Waves are then derived, never stored, which fits both Overdeck's rule and Deft's merge-base fence. Ship conformance fixtures in the xBRIEF repo so both tools compute the same waves.
- Reconcile `difficulty` (#40) with Deft's `model_tier`. `depends_on` needs no new field: xBRIEF `edges` with type `blocks` already express it.

Stay different:
- Where the orchestrator lives (host conversation vs server) and therefore how liveness is known (heartbeats vs pane inventory).
- PR granularity (Deft: PR per story; Overdeck: PR per issue with intra-issue integration).
- Lifecycle bookkeeping (Deft moves files and finalizes cohorts; Overdeck derives from the PR).

---

## Shared failure modes

| Failure | Overdeck evidence | Deft mechanism that exists because of it |
|---|---|---|
| Agents relax a failing gate instead of fixing the work | #3308 (open), #3322 | Gate integrity #3156 (`content/docs/gate-integrity.md`) |
| A PR authorizes itself by editing its own plan | #1728 (open) | Merge-base fence #3145 / #4956 (`content/docs/scope-provenance.md`) |
| Agent commits land on the primary checkout / main | #3505, PAN-2204, handoff incident 2026-07-01 | Branch gate #746/#747; primary claim refusal #4066 (`occupancy.ts:126`) |
| GraphQL budget exhausted by the tool itself | PAN-4291, PAN-4264, PAN-4302 | Agent rules to prefer REST and probe `rate_limit` (#954, `AGENTS.md` 122-124) |
| Retry loops that never converge | PAN-3151 convergence gate, verification stuck pause, troubled gate | Dual Stop #2442, delivery-attempt ledger #3143 |
| Two writers in one tree | foreman prompt warning; `claimItem` overwrite | Occupancy #3433, one-worktree hard gate |
| Recorded state drifts from reality | Solved by design (PAN-3917 Cut) | `verify:orphan-active` #3767, `finalize-cohort` (the reverse case: Deft still pays) |

---

## Deliberately not adopting

- **The full design-critique ceremony.** Charters, spend tokens, panel deposits, audit markers and operator verbs are 102 KB of contract, and Deft admits the key obligations are unobserved. Take the four principles.
- **The session ritual and alignment echo.** Overdeck launches its agents and injects context; a ritual adds turns without adding facts.
- **Deposit-in-repo installation and a managed AGENTS.md section.** Overdeck's no-touch boundary on native files is a feature.
- **WIP cap as a count and lifecycle folders.** The resource governor and field-based status already cover these without drift.
- **A general human-grant store with UAT leases.** Overdeck's operator-only doors plus narrow denies give most of the value without a new stored-state surface.

**Other findings worth fixing regardless:** `docs/XBRIEF.md:9` claims exactly one claim wins, which the code does not enforce (issue 5); `docs/FOREMAN.md` misdescribes where `pan spawn` workers commit (issue 6). A prior March 2026 comparison led to PAN-327 (closed 2026-04-30); its PRD (`docs/prds/active/PAN-327-plan.md`) is the only trace on main apart from the stub-UI lint, so its locked-decisions idea never shipped. Issue 13 revives the useful half.

---

## Ready-to-file issues (ordered by value)

Each issue is sized for one work agent and ships independently. "State rule" notes check each design against "Overdeck stores no status it can derive."

### Issue 1: The file-size guard teaches agents to raise the ceiling; make raises operator-only

**Problem.** `scripts/lint-file-size.sh:171-174` prints two remedies as equals and pre-fills the ratchet-up line with the new, larger count. In #3308, 2 of 3 agents took it; #3322 shows a raise becoming permanent regrowth budget. Nothing distinguishes an agent's allowlist raise from the operator's.

**What Deft does.** `content/docs/gate-integrity.md` and `main.md` "Gate Integrity (#3156)": a failing gate is fixed by fixing the work; deliberate gate changes go through their own issue and PR. `packages/core/src/policy/agents-md-budget.ts` states the intended ratchet shape: lowering is always allowed, raising is "an explicit, reviewed diff ... that diff IS the checkpoint."

**Design.** (a) The failure message names only the shrink path and says that a ceiling raise is an operator decision recorded in its own commit; it prints no allowlist line. (b) The pre-push check refuses a push whose range raises any `scripts/file-size-allowlist.txt` entry, or adds one above the base line count, when the pusher is an agent, unless `OVERDECK_OPERATOR_PUSH=1`. Use the identity test from `scripts/guard-agent-main-push.sh` (agent id set, or a `[bot]` git identity), including its `conv-*` exemption, because operator conversations also commit under the App bot identity (`overdeck-agent[bot]`). Tighten that exemption in the same change: `conv-flywheel` is the unsupervised orchestrator the guard was written for (PAN-2194, `docs/FLYWHEEL.md`), so exclude it, or any conversation whose `startedBy` has the `flywheel:` prefix. Lowering stays free (`--lower`).

**Work items.**
1. Edit `scripts/lint-file-size.sh` failure text (lines 171-174).
2. Add `scripts/guard-allowlist-raise.sh` and call it from `.husky/pre-push` for the pushed range.
3. Update `docs/codebase-health/A3-file-size-guard.md`.

**Acceptance criteria.**
- Given an over-ceiling file, when the guard fails, then its output contains no line matching `^\s*\d+ \S+ # ` (test in `tests/unit/scripts/lint-file-size.test.ts`).
- Given a range that raises an allowlist entry and `OVERDECK_AGENT_ID=agent-pan-1`, when the pre-push guard runs, then it exits non-zero naming the entry; with `OVERDECK_AGENT_ID=conv-flywheel` it also refuses; with `OVERDECK_AGENT_ID=conv-123` or `OVERDECK_OPERATOR_PUSH=1` it exits 0; a range that only lowers entries exits 0 (new `tests/unit/scripts/guard-allowlist-raise.test.ts` against a temp repo).

**Docs item.** A3 doc section "Raising a ceiling is an operator decision."

**State rule.** Derived from the push range and caller identity; nothing stored.

### Issue 2: Work agents cannot rewrite their own plan: fence `.pan/specs/<issue>` against the merge base

**Problem.** Specs are committed on the feature branch (`docs/XBRIEF.md`), so a work agent can change its own acceptance criteria and the change rides the merge. #1728 (open) observed it. Planning's status transitions (`pan start` setting `active`/`running`) are legitimate writes to the same file.

**What Deft does.** `content/docs/scope-provenance.md`: the fence is the brief on the merge base; "A PR that adds production paths and edits its own active brief to include them still fails." `policy/write-fence.ts` loads it with `loadStoryWriteFenceFromMergeBase`.

**Design.** A new verification check `plan-integrity` in `src/lib/cloister/verification-runner.ts`. The reference copy of the spec is the newest commit on the branch whose message carries a `Plan-Finalized: <sha256>` trailer, which planning finalize (including active-plan repair, `docs/XBRIEF.md` step 4) writes when it promotes or rewrites the spec; with no such commit, the reference is the merge-base copy. Parse the reference and HEAD copies and fail if anything other than top-level `status`, `plan.status`, `xBRIEFInfo.updated`, `plan.updated` and `plan.sequence` changed. Legitimate re-plans therefore pass because they move the reference, and a work agent's edit fails because it does not. For polyrepo projects the check runs in the plan-home repo (`resolvePlanHome`), which may differ from the repo the code changed in.

**Work items.**
1. `src/lib/cloister/plan-integrity-gate.ts` (pure diff of two parsed documents).
2. Finalize writes the `Plan-Finalized:` trailer (`src/lib/overdeck/planning-promotion.ts`).
3. Wire the check into `verification-runner.ts` beside the test-skip gate; failures reuse `verification.failed { failedCheck: 'plan-integrity' }`.

**Acceptance criteria.**
- Given a branch that changes an item's `title` or an AC in its spec, when verification runs, then it fails `plan-integrity` naming the item id (unit test `tests/unit/lib/cloister/plan-integrity-gate.test.ts`).
- Given a branch whose only spec change is `status: proposed -> active` and `plan.status -> running`, then the check passes.
- Given no spec change, then the check passes.
- Given a later commit with a `Plan-Finalized:` trailer that changes an item, then the check passes against that new reference.

**Docs item.** `docs/PIPELINE-GATES.md` new subsection; `docs/XBRIEF.md` "The canonical spec is immutable after planning" gains "enforced by plan-integrity."

**State rule.** Derived from git; nothing stored.

### Issue 3: The git shim refuses commits and pushes off the workspace's feature branch

**Problem.** `sync-sources/rules/worktree-discipline.md` admits nothing checks branch drift; #3505 and PAN-2204 show drift onto `main`. The shim at `src/lib/launcher-git-guard.ts` already intercepts every agent git call in its worktree.

**What Deft does.** Branch gate on three surfaces (`main.md`; `.githooks/pre-commit`, `.githooks/pre-push`, `branch-gate` workflow) and `deft verify:branch`.

**Design.** In `default` mode, when the invocation targets `guardRoot` and the subcommand is `commit`, `push`, `merge` or `cherry-pick`, compare `git branch --show-current` to the expected branch, derived rather than stamped: when `git rev-parse --show-toplevel` is `<workspace>/.swarm/<item>`, expect `feature/<issue>-<item>`; when it is the issue workspace, expect `feature/<issue>`. (A launcher-exported variable would be wrong for in-harness subagents, which inherit the parent pane's environment while committing in an item worktree.) Refuse on mismatch or detached HEAD with a message that says to stop and report, not how to bypass.

**Work items.**
1. Shim branch check with toplevel-based expectation in `src/lib/launcher-git-guard.ts` (the shim already knows `guardRoot` and the issue id from the launcher).
2. Tests in `src/lib/__tests__/launcher-git-guard-behavior.test.ts`.

**Acceptance criteria.**
- Given an agent worktree checked out on `main`, when the agent runs `git commit`, then the shim exits non-zero and prints the expected branch.
- Given detached HEAD, `git commit` is refused.
- Given the expected branch, `git commit` and `git push` pass through; `git -C /tmp/fixture commit` (outside `guardRoot`) passes through.
- Given an item worktree `.swarm/w1` on `feature/pan-1-w1`, `git commit` passes; on `feature/pan-1`, it is refused.

**Docs item.** Replace the "Why" paragraph in `worktree-discipline.md` with a pointer to the shim.

**State rule.** Derived from git at call time.

### Issue 4: Handoffs, forks and workers refuse a project's primary checkout as cwd

**Problem.** `validateCwdContainment` (`src/lib/overdeck/conversation-forks.ts:172`, twin in `conversation-runtime.ts:224`) accepts any existing directory under home, including a registered project's primary checkout. `handoff-isolate-cwd.md` documents the resulting 2026-07-01 incident.

**What Deft does.** Primary-checkout mutation claims are refused except for named exceptions `release-cut`, `policy-restore`, `operator-default-branch` (`packages/core/src/session/occupancy.ts:126`, #4066); spawn fails closed when the destination tree is absent (`session/spawn-occupancy.ts`).

**Design.** After realpath, refuse when the path equals the root of any registered project repo (read from `projects.yaml` via the existing project resolver) or of a polyrepo member repo, unless the request carries `allowPrimary: true` from an operator. The dashboard UI is operator by construction, so the flag is honored on UI-originated requests; a CLI request is honored only when `src/lib/cloister/verdict-caller.ts` resolves the calling process as an operator shell (it reads process environment and ancestry, which an HTTP request does not carry on its own, so the CLI must resolve and send its caller kind as `pan review restart` already does); anything else is refused. Return `Invalid cwd: <path> is the primary checkout of <project>; use a worktree`. Apply the same check in `pan worker run` when not `--read-only`.

**Work items.**
1. Shared `isPrimaryCheckout(path)` in `src/lib/projects.ts`.
2. Call it from both `validateCwdContainment` copies (and consider collapsing them into one).
3. `pan worker run` guard in `src/lib/agents/worker/start.ts`.

**Acceptance criteria.**
- Given cwd equal to a registered project root, a fork or handoff request returns 400 with the primary-checkout message (tests in `src/lib/overdeck/__tests__/conversation-forks-handoff-placement.test.ts`).
- Given a worktree of that project, the request proceeds.
- Given `allowPrimary: true` from an agent caller, still 400; from an operator shell, proceeds.

**Docs item.** `handoff-isolate-cwd.md` notes the server now refuses the primary.

**State rule.** Derived from `projects.yaml` and the path.

### Issue 5: `pan task claim` refuses a live competing claim and overlapping scope

**Problem.** `claimItem` (`src/lib/xbrief/continue-state.ts:290-309`) overwrites `claimedBy` unconditionally, so `docs/XBRIEF.md:9` ("exactly one claim succeeds") is not true in code, and nothing stops two workers from claiming items with overlapping `files_scope` in the same wave.

**What Deft does.** Zero file overlap between parallel agents is a gate before setup (`content/skills/deft-directive-swarm/references/core-phase-1-2.md`, Step 2, starting from `task swarm:readiness`); `resolveWorktreeMap` raises on collisions (`packages/core/src/swarm/worktrees.ts:199`).

**Design.** Every worker already writes the same file: `resolveTaskContext` (`src/cli/commands/task.ts:50-59`) derives the plan home from the issue workspace path, not the caller's cwd, so workers in `.swarm/<item>` worktrees claim into the issue workspace's `.pan/continues/<issue>.xbrief.json`. The write itself is a plain `writeFileSync` (`continue-state.ts:229-233`) with no check. In `runTaskClaim`: (a) if the item has `claimedBy` set to a different agent id, not done, and `isAlive(claimedBy)` returns alive, refuse with the holder's id; indeterminate liveness refuses too, with a `--steal` flag for the foreman or operator. (b) Compute the set of items claimed, not done, and held by live agents; refuse when this item's `files_scope` overlaps any of them, using `hasFileOverlap` from `src/lib/xbrief/dag.ts`, or when either side has low scope confidence. Serialize the read-check-write and the following `commitContinue` with one lock file under the issue workspace (for example `<workspace>/.overdeck/task-claim.lock`), because concurrent workers also race on the git index when they commit the continue file.

**Work items.**
1. Claim-check logic in `src/lib/xbrief/continue-state.ts` (pure function over state + plan + liveness results).
2. One lock around claim read-check-write and `commitContinue`.
3. `task.ts` flag and messages.

**Acceptance criteria.**
- Given item A claimed by a live `agent-x`, when `agent-y` claims A, then exit non-zero naming `agent-x` (`src/cli/commands/__tests__/task.test.ts`, liveness injected).
- Given A claimed by a dead agent, the claim succeeds and records the new holder.
- Given A (scope `src/a/**`) claimed live and B with scope `src/a/x.ts`, claiming B is refused naming A; a disjoint C succeeds.
- Given two concurrent claim processes on the same item, exactly one succeeds (lock test with two child processes).

**Docs item.** Correct `docs/XBRIEF.md:9` and `docs/FOREMAN.md` "Per-item protocol."

**State rule.** Claims already live in the continue file, which is the sanctioned home for item claims. Liveness is derived at claim time, never written, so no lease or TTL is added.

### Issue 6: Every mutating `pan spawn` worker gets its own item worktree; docs match the code

**Problem.** Items without `files_scope` run in the shared issue workspace (`src/cli/commands/spawn.ts:95-98`), where the foreman skill itself warns that concurrent workers clobber files. `docs/FOREMAN.md` says `pan spawn` panes push the feature branch directly, but scoped workers commit on `<feature>-<item>` (`src/lib/workspaces/item-worktree.ts`).

**What Deft does.** "One isolated git worktree per parallel agent (Phase 2). Create worktrees or consume a worktree-map before dispatch" (`deft-directive-swarm/SKILL.md`, "Worktree isolation before parallel spawn"); spawn fails closed when the destination is absent (`session/spawn-occupancy.ts`).

**Design.** `pan spawn` always creates or reuses the item worktree for a worker; a `--shared` flag (foreman or operator only) keeps the old behavior for strictly serial use. Both dispatch kinds then use one protocol, the one the skill already gives in-harness subagents: the worker commits with the `Item:` trailer on its item branch and hands back; the foreman integrates onto the feature branch, pushes, and runs `pan task done` there. Workers no longer run `pan task done` themselves. Update the skill and doc to that single story.

**Work items.**
1. `spawn.ts` default to `createItemWorktree`.
2. `sync-sources/skills/pan-foreman/SKILL.md` and `docs/FOREMAN.md` integration section.
3. Tests in `tests/unit/cli/commands/spawn.test.ts`.

**Acceptance criteria.**
- Given an item with no `files_scope`, `pan spawn` launches the pane with cwd `<workspace>/.swarm/<item>` on branch `<feature>-<item>`.
- Given `--shared`, cwd is the workspace.
- FOREMAN.md and the skill describe one hand-back protocol for both dispatch kinds, and no longer state that `pan spawn` panes push the feature branch.

**Docs item.** Included above.

**State rule.** Worktree existence is the fact; nothing new stored.

### Issue 7: An independent, different-family plan critic before finalize for flagged plans

**Problem.** The only pre-code critique is `--probe`, the planner reviewing itself (`sync-sources/skills/pan-plan/SKILL.md:62`). Correlated review is not verification.

**What Deft does.** `content/contracts/design-critique.md`: critics re-verify line cites by running checks (line 158), inventory existing mechanisms before proposing new ones, classify findings as `blocks-the-design` / `sharpens-framing` / `footnote`, and treat "a reviewer would catch it" as a failed finding (line 165); synthesis rules for decorrelation, method-reconciliation and non-self-arbitration (lines 504-506); N≥3 panels need distinct families (`design-critique/panel-seat-families.ts`).

**Design.** `pan plan finalize --critic` (automatic when the issue carries `architecture`, `substrate-improvement` or `security` labels) runs one `pan worker run --read-only` critic on a harness family different from the planner's, with a fixed prompt (`roles/plan-critic.md`) containing only the PRD, the draft xBRIEF and repo access, never the planner's reasoning. The critic writes `.pan/drafts/<issue>-critique.md` whose first line records `plan-digest: <sha256 of the draft xBRIEF>`. The planner must answer every `blocks-the-design` finding in the PRD under `## Critique response`. Finalize refuses when a critique is required and the file is missing or its digest does not match the current draft. Answering a finding usually changes the draft and therefore the digest, so the critic loop carries its own dual stop: at most two critic rounds per plan (counted from the critique files in git history, `-critique.md` and `-critique-2.md`), after which finalize proceeds and the PRD lists unresolved `blocks-the-design` headings under `## Critique response` for the operator. `pan worker run` already accepts `--harness` (`src/cli/commands/worker.ts:439`); the dispatch test should still assert the harness actually launched, since `pan handoff` has ignored `--harness` before.

**State-rule flag.** No "critiqued" flag is stored; readiness is derived by matching the recorded digest to the current draft. The critique file is committed evidence, like the PRD.

**Work items.**
1. `roles/plan-critic.md` (critic method: the four principles above, three-token classification).
2. Critic dispatch in `src/lib/overdeck/planning-promotion.ts` / the finalize path.
3. Digest check in finalize.
4. Tests in `src/dashboard/server/routes/__tests__/complete-planning.test.ts`.

**Acceptance criteria.**
- Given a flagged issue with no critique file, finalize refuses with the reason.
- Given a critique file whose digest matches the draft and a PRD that answers each `blocks-the-design` heading, finalize proceeds.
- Given the draft changed after the critique, finalize refuses (digest mismatch).
- The critic worker's harness differs from the planner's (dispatch test).
- Given two critique rounds already in history and a digest mismatch, finalize proceeds and the PRD's `## Critique response` lists the unresolved headings.

**Docs item.** `docs/XBRIEF.md` PRD-to-spec lifecycle, `pan-plan` skill.

### Issue 8: Re-review gets one fresh lane per round, and reviewers follow Deft's critic method

**Problem.** All convoy lanes resume their prior session by default (`src/lib/cloister/review-convoy.ts:190`, PAN-1862), so on round 2+ every lane reads the diff through its own round-1 findings.

**What Deft does.** Stop 4: "Dispatch a fresh critic against a disagreement map. Do not default to resume" (`design-critique.md:260`); decorrelation rule (line 504).

**Design.** Config `roles.review.fresh_lanes` (default `[correctness]`): listed lanes always fresh-spawn on re-review; `reviewResumeDecision` (`src/lib/cloister/review-resume-decision.ts`) takes a `forceFresh` input. Add three lines to `roles/review.md`: re-run a cited check before relying on it; "a later reviewer would catch it" is not a disposition; reproduce the prior round's method before contradicting a count. The synthesis parent notes which lanes were fresh.

**Work items.** Config schema, `review-resume-decision.ts`, `review-convoy.ts`, `roles/review.md`, tests in `src/lib/cloister/__tests__/review-resume-decision.test.ts`.

**Acceptance criteria.** Given a saved correctness reviewer session and default config, the convoy fresh-spawns correctness and resumes the other three; with `fresh_lanes: []`, all four resume.

**Docs item.** `docs/REVIEW-AGENT-ARCHITECTURE.md` "Review modes."

**State rule.** Config only.

### Issue 9: Operator-grant labels (`released`, `auto-merge`, `hold-for-uat`) honored only from a non-agent actor

**Problem.** `pickup.ts` checks label presence only (`src/lib/backlog/pickup.ts:31-32`), and agents run `gh` with the operator's token, so an agent-applied `released` looks like the operator's go.

**What Deft does.** `packages/core/src/authz/types.ts` `REJECTED_ORIGIN_KINDS` and `authz/origin.ts`: agent-authored evidence never satisfies an approval gate; kill-switch and policy writes are classified as "settings" and denied to agents under UAT (`content/docs/deft-directive-disable.md`).

**Design.** The shim deny is the load-bearing layer. The count-only `gh` shim is installed beside the git guard for agent panes, but the launcher skips the guard directory for conversations (`src/lib/launcher-generator.ts:381`, `spawnMode !== 'conversation'`), and the Flywheel is a conversation (`conv-flywheel`), the caller most likely to self-release. So: (a) install a gh-only shim (count plus deny, no git guard) for conversations too; (b) the shim refuses `gh issue edit --add-label` / `gh pr edit --add-label` and `gh api` label writes naming a closed set of grant labels (`released`, `auto-merge`, `hold-for-uat`) when the caller is an agent pane or `conv-flywheel`, with a message to ask the operator; operator conversations (`conv-*` other than the flywheel) pass. An events-API actor check (`GET /repos/{o}/{r}/issues/{n}/events`) adds nothing today, because agents use the operator's `gh` token and the events API would name the operator either way; it becomes useful only if agent `gh` writes are later routed through the App installation token, which is a separate change.

**Work items.** gh-only shim for conversations in `src/lib/launcher-generator.ts`; deny list in the shim (`src/lib/launcher-git-guard.ts`); tests in `src/lib/__tests__/launcher-git-guard-gh-shim.test.ts` and `src/lib/overdeck/__tests__/conversation-runtime-launch.test.ts`.

**Acceptance criteria.** Given an agent pane or `conv-flywheel`, `gh issue edit 1 --add-label released` exits non-zero and `--add-label bug` passes; given `conv-42`, both pass; a conversation launcher script puts the gh shim on PATH.

**Docs item.** `docs/MERGE-WORKFLOW.md` and the `pan-flywheel` skill: grant labels are operator-only and enforced.

**State rule.** Stateless check at call time. Residual: like the git shim, an absolute `/usr/bin/gh` bypasses it; this is cheap-path prevention.

### Issue 10: Registered projects get the agent main-push guard

**Problem.** `installGitHooksInDir` (`src/lib/git-hooks.ts:49`) installs only `post-checkout` into registered projects; the main-push guard exists only in the overdeck repo.

**What Deft does.** Consumer repos receive pre-commit and pre-push branch hooks plus a CI branch gate (`main.md`; `task deft:setup`).

**Design.** Ship `sync-sources/hooks/git-hooks/pre-push` that refuses agent pushes to the default branch (reuse the identity test and `conv-*` exemption from `scripts/guard-agent-main-push.sh`, minus `conv-flywheel` as in issue 1; default branch from `origin/HEAD`). When a project sets `core.hooksPath` (husky), do not overwrite; `pan doctor` reports that the guard is not active there, with the one-line fix.

**Work items.** New hook; `git-hooks.ts` install; `doctor` row in `src/cli/commands/doctor.ts`; tests.

**Acceptance criteria.** Given a registered temp repo, an agent push to `main` is refused and a push to `feature/x` passes; given `core.hooksPath` set, install skips and doctor warns.

**Docs item.** `docs/WORKSPACES-AND-PROJECTS.md` "Creating a project" hooks note.

**State rule.** Stateless.

### Issue 11: A terse gate-integrity rule, and a Rule Authority note in rule authoring

**Problem.** No bundled rule says a red gate is fixed by fixing the work; `rule-authoring.md` does not tell authors to prefer a deterministic check over a prose rule.

**What Deft does.** `main.md` "Rule Authority [AXIOM]" and "Gate Integrity (#3156)"; `content/docs/gate-integrity.md` lists gate surfaces (checks, ratchets, allowlists, fixtures, policy flags, the plan's own scope).

**Design.** `sync-sources/rules/gate-integrity.md` (`scope: universal`, under 600 bytes): when a gate fails, fix the work; never edit an allowlist, ratchet, test config, verify command or your own spec to go green; a wrong gate gets its own issue. Add to `rule-authoring.md`: "If a shim, hook or gate can prevent the failure, file that instead of (or with) the rule."

**Acceptance criteria.** Rule renders into the launch artifacts after `pan sync`; a context-render test asserts its presence.

**Docs item.** `docs/CONTEXT-LAYERS.md` bundled-rules list if it enumerates rules.

**State rule.** Not applicable.

### Issue 12: Byte ratchet on the always-loaded rules bundle

**Problem.** The rendered bundle is 40,370 bytes on a reference install (universal + dev), with no ceiling; every universal rule costs every session.

**What Deft does.** `packages/core/src/policy/agents-md-budget.ts`: seeded at the current size, forbids growth, lowering always allowed.

**Design.** `scripts/lint-context-budget.sh` renders the universal-only and dev bundles from `sync-sources/rules/` (reusing `src/lib/context-layers/layers.ts`) and compares against `scripts/context-budget.txt`; runs in `npm run lint`. Raises follow issue 1's operator-only rule.

**Acceptance criteria.** Adding 1 KB to a universal rule fails the check with the new size and the ceiling; shrinking passes.

**Docs item.** `rule-authoring.md` step 3.

**State rule.** Static check.

### Issue 13: Significant decisions outlive the workspace

**Problem.** `decisions[]` sit in gitignored `.overdeck/continue.json` and are read only by `src/lib/cloister/handoff-context.ts:291`; close-out deletes them with the workspace.

**What Deft does.** `content/docs/decision-log.md`: committed decision records with alternatives, why the winner won, confidence and a revisit trigger.

**Design.** `pan done` appends a `## Decisions` section to the PR body from `continue.json` decisions (the PR is Overdeck's record of authority), adding `alternatives` and `revisitWhen` fields to the decision shape when present. No new directory.

**Acceptance criteria.** Given two decisions in `continue.json`, `pan done` produces a PR body containing both summaries; given none, no section.

**Docs item.** `docs/XBRIEF.md` "Workspace Continue State."

**State rule.** Decisions are facts, not derivable; the PR body is their durable home.

### Issue 14: Warn-first scope-drift evidence in verification

**Problem.** Nothing compares changed files to the plan's `files_scope`; scope creep reaches review unannounced.

**What Deft does.** `verify:scope-provenance` (`content/docs/scope-provenance.md`): changed production paths vs the merge-base brief's `file_scope`, test roots free, small allowance.

**Design.** Verification emits an evidence block listing changed non-test files matched by no item `files_scope` in the merge-base spec; never fails; the requirements lane prompt receives it.

**Acceptance criteria.** Given a diff touching `src/x.ts` outside all scopes, verification passes and its evidence names `src/x.ts`; the requirements lane prompt includes the block.

**Docs item.** `docs/PIPELINE-GATES.md`.

**State rule.** Derived from git and the merge-base spec.

### Issue 15: Agent-side GitHub reads prefer REST until PAN-4302 lands

**Problem.** PAN-4291 showed Overdeck exhausting its own GraphQL budget; about 35 `gh` sites are still unmetered (PAN-4302). Agents call `gh pr view --json` and `gh issue view --json`, which are GraphQL.

**What Deft does.** `AGENTS.md` lines 122-124 (#954): prefer REST (`gh api repos/.../pulls/N`) for reads, toggle draft state at most once, probe `gh api rate_limit` before GraphQL-heavy work.

**Design.** A universal rule (short) plus, better, the agent `gh` shim rewriting nothing but printing a one-line hint when it sees `view --json` during an active GraphQL pause (`$OVERDECK_HOME/github-quota/pause.json`).

**Acceptance criteria.** Rule renders; with a GraphQL pause present, `gh pr view 1 --json state` from an agent pane prints the REST hint to stderr and still runs.

**Docs item.** `docs/PIPELINE-GATES.md` "GitHub quota policy."

**State rule.** Reads the existing pause file.

### Issue 16: A re-dispatch budget for foreman items (flagged: needs reconciliation with the state rule)

**Problem.** A foreman can re-dispatch the same failing item indefinitely; the protocol has "no recovery ladder" by design, and the dormant `pan swarm recover` counter (fourth intervention refused) is not on the default path.

**What Deft does.** Dual Stop (`main.md` #2442): every multi-iteration loop has a failure stop (max iterations, no progress, budget); `packages/core/src/delivery-attempt/` records attempts and returns `BLOCK_NO_MATERIAL_PROGRESS` / `BLOCK_ATTEMPT_BUDGET` (`content/docs/delivery-attempt.md`).

**Design.** Count prior worker dispatches for `(issue, item)` from the append-only session index (`sessions.json`) if it carries the item token; if it does not, append `worker.dispatched { item }` to the pipeline journal at `pan spawn`. Each dispatch event records the item and the feature-branch head at that moment. From the fourth dispatch on, `pan spawn` prints a warning and raises a needs-you with the attempt history, and the item branch's commit count ahead of the feature branch (derived from git) is shown so the foreman sees whether earlier workers produced anything. It does not refuse.

**State-rule flag.** The attempt history is a set of events, not a status, so recording dispatch events is consistent with the rule; the pipeline journal and session index are both append-only fact stores. The conflict would be using them as a gate: the journal is "never authority." So this issue ships the budget as advisory only (warning plus needs-you). A hard refusal in Deft's style (`BLOCK_NO_MATERIAL_PROGRESS`) would need the recorded dispatch head as a gate input; that is an operator decision about the rule, and should be a separate issue if wanted.

**Work items.** Session-index read or journal append in `src/cli/commands/spawn.ts`; needs-you trip; tests in `tests/unit/cli/commands/spawn.test.ts`.

**Acceptance criteria.** Given three prior dispatches of item A, the fourth `pan spawn` spawns, prints the attempt history with each dispatch's head and the item branch's commits-ahead count, and raises one needs-you; given two prior dispatches, no warning.

**Docs item.** FOREMAN.md "Failure budget."


---

## Upstream convergence note

A draft comment for deftai/xBRIEF#40 (the parallel-safety vocabulary in the Swarms section) exists and is unposted; the Overdeck-side alignment is tracked in #3132.
