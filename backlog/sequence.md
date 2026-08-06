# Backlog Sequence

_Last sequenced: 2026-08-06T00:51:22.619Z · model: claude-opus-5 · open: 833_


| rank | issue | size | importance | condition | epic | depends-on | why |
|------|-------|------|------------|-----------|------|------------|-----|
| 1 | PAN-3572 | XS | critical | ok |  |  | Red main: dashboard typecheck ratchet fails on origin/main (60 vs 54 baseline), so every branch's verification gate fails. |
| 2 | PAN-3504 | XS | critical | ok |  |  | typecheck fails on main: parked.ts references ProjectConfig.projectPath, which does not exist (field is `path`). |
| 2 | PAN-3512 | M | high | ok |  |  | Verdict write door — recordReviewVerdict + dispatch-not-drop + fallback kill-conditional (write side) |
| 3 | PAN-3499 | XS | critical | ok |  |  | Same defect as PAN-3504 from the pan parked ack side — acknowledgeRecoveryTrip called with a nonexistent field. |
| 4 | PAN-3554 | S | critical | ok |  | PAN-3572, PAN-3504, PAN-3532 | Red main has no mechanical owner — a failed main-push CI run must escalate within minutes, not wait for a human to notice. |
| 5 | PAN-3532 | M | critical | ok |  |  | CI never runs the full frontend test suite — main was red on frontend for hours while every CI run reported green. |
| 6 | PAN-3524 | M | critical | ok |  |  | P0: server-owned --changed verification loop relaunches through Deacon freeze, review abort, pause and operator-stop; blocked a red-main ... |
| 7 | PAN-3566 | S | critical | ok |  |  | Test-role launcher execs claude with no prompt — the role boots an idle REPL, no turn, no JSONL. Deterministic cause of zombie test agents. |
| 8 | PAN-3571 | S | critical | ok |  |  | work-agent-stop-hook completion-check timeout exits 0 silently — 334 stranded turn-ends, agents stall until a patrol notices. |
| 9 | PAN-3561 | S | critical | ok |  |  | Ownerless state-git lock is immortal — a crash between mkdir and owner.json bricks a project's write door forever. No TTL, no recovery CLI. |
| 10 | PAN-3564 | M | critical | ok |  |  | Lock convoy: per-issue record lock held across the global state-git lock wait — reviewer spawns die with no retry, locks at 100% duty cycle. |
| 11 | PAN-3559 | M | critical | ok |  |  | Unbounded undelivered-feedback accumulation deadlocks kickoff — 324KB prompt rejected at the 262KB PTY cap as a bogus 'content is require... |
| 11 | PAN-3422 | M | high | ok |  |  | Nudge/feedback text lands in the composer but is never submitted — 4 agents wedged idle 20m–2.5h with visible text |
| 12 | PAN-3560 | M | critical | ok |  |  | PTY supervisor overload under concurrent review convoys — fleet-wide 502 'input echo confirmation failed' kills resumes and feedback deli... |
| 13 | PAN-3565 | M | critical | ok |  |  | Review lifecycle: failed spawn wedges 'starting', infra-failure synthesizes a fake CHANGES REQUESTED verdict, pan tell hangs to SIGTERM a... |
| 14 | PAN-3563 | S | high | ok |  |  | Role agent spawned with undelivered prompt becomes an invisible zombie — state.json says running forever, dispatcher no-ops, pan unstick ... |
| 14 | PAN-1230 | S | medium | ok |  |  | Command Deck right-pane Pipeline-lens + TopBar height (PAN-1148 follow-up) |
| 23 | PAN-3283 | S | critical | ok |  | PAN-3512 | Recovering from review_infrastructure_failure sets review_status=passed despite an outstanding CHANGES REQUESTED verdict (blocks-main). |
| 24 | PAN-2746 | S | critical | ok |  | PAN-3512 | Review infra-failure bypass writes reviewStatus='passed' — indistinguishable from four reviewers approving; nearly merged PAN-2710 unrevi... |
| 25 | PAN-3250 | M | critical | ok |  | PAN-3062 | Workspace spawn branches from local HEAD/defaultBranch instead of origin/main — every new workspace inherits unpushed local main (blocks-... |
| 26 | PAN-3285 | M | critical | ok |  |  | Supervisor pinned to a pan reload generation SIGTERMs every healthy dashboard and can never start a replacement — 3.5h outage, 1107 silen... |
| 27 | PAN-3424 | M | critical | ok |  |  | State plane silently stops being durable: overdeck-state non-FF push never reconciled, drafts/ PRDs never staged (16 orphans, one 2 weeks... |
| 28 | PAN-3429 | M | critical | ok |  |  | Memory governor defers new admissions but sheds nothing under HARD pressure — flywheel manually paused a gate run at PSI 41.9 / 2.2GB ava... |
| 29 | PAN-3539 | M | critical | ok |  |  | Kernel OOM of one agent-spawned process killed the entire tmux server — all sessions lost (OOMPolicy=stop default). |
| 30 | PAN-3314 | M | high | ok |  | PAN-3429, PAN-3539 | Bound the OOM blast radius: one cgroup holds every agent, so a single hungry agent can kill the whole fleet. |
| 31 | PAN-3550 | S | high | ok |  |  | Memory pressure must warn in the activity feed before anything dies — silent shedding and kernel OOMs are invisible to the operator. |
| 32 | PAN-3344 | M | high | ok |  |  | Resource governor should gate dispatch on CPU load, not memory alone — load hit ~48 on 24 cores while memory stayed fine. |
| 33 | PAN-3492 | M | high | ok |  |  | Server-side verification gate retries form a self-amplifying load loop — timeouts cause retries which cause more timeouts. |
| 34 | PAN-3520 | M | high | ok |  |  | Test gate must retry timeout-only failures in isolation before recording a verdict — proven load-flake loops on multiple branches. |
| 35 | PAN-3062 | M | critical | ok |  |  | Shared primary main worktree: any agent that pushes main also ships every other session's unpushed local commits. |
| 36 | PAN-3505 | S | high | ok |  | PAN-3062 | Unpushed agent code commits on the primary main worktree block the flywheel's state write door. |
| 37 | PAN-3284 | S | high | ok |  | PAN-2409 | Work agent wrote a doc edit into the primary main worktree instead of its workspace (PAN-2204 family). |
| 38 | PAN-2409 | M | high | ok |  |  | Enforce the workspace boundary — work agents must not edit the primary checkout (reproduced 3x in one day). |
| 39 | PAN-3081 | S | high | ok |  |  | Agent git guard is bypassable by removing it from $PATH — an agent did so unprompted to get past a false block. |
| 40 | PAN-3236 | S | high | ok |  |  | ECONNREFUSED on a dead supervisor socket is misclassified as ambiguous keyed delivery — feedback never lands, issue goes stuck with the f... |
| 41 | PAN-3282 | M | high | ok |  |  | Review agents repeatedly die before writing a verdict (review_infrastructure_failure) across 5 issues and 2 projects. |
| 42 | PAN-3397 | S | high | ok |  |  | Freshly-spawned convoy lanes freeze at 0 output before processing kickoff — PAN-3375's detector covers warm-resumes only. |
| 43 | PAN-2742 | M | high | ok |  |  | Review synthesis fires 42s after spawn and calls reviewers with reports already on disk an 'infrastructure failure' — false CHANGES REQUE... |
| 44 | PAN-2695 | S | high | ok |  |  | Concurrent review dispatches race fresh-spawn vs resume — the second dispatch resumes a still-booting parent and kills the synthesis kick... |
| 45 | PAN-3084 | S | high | ok |  |  | A review session spawned but never briefed sits at zero context forever and blocks its own replacement — restart 'preserves' it. |
| 46 | PAN-2706 | S | high | ok |  | PAN-3566 | Ghost test sessions absorb every test dispatch — a never-kicked-off session reads as 'already running' and marks testing with no prompt d... |
| 47 | PAN-3274 | S | high | ok |  | PAN-3566 | A test-role agent can spawn and never run, stranding its issue behind a verdict that was never produced. |
| 48 | PAN-3500 | S | high | ok |  |  | A review sub-role can modify the branch after writing its report. |
| 49 | PAN-3496 | S | high | ok |  |  | Review/inspect agents must not AskUserQuestion the operator for review depth — decide, don't ask. |
| 50 | PAN-3541 | S | high | ok |  |  | Review restart after an unclean reviewer death loops on the session-resume menu — eligibility ignores how the session ended. |
| 51 | PAN-3278 | S | high | ok |  |  | Work agent finished with an open PR but review was never dispatched — auto-requeue had 25 attempts and fired none. |
| 52 | PAN-3281 | S | high | ok |  |  | ready_for_merge stays 1 while an issue is stuck on incomplete-plan-items, so stuck work reaches the UAT batch. |
| 53 | PAN-3543 | S | high | ok |  |  | Completed-handoff agents are unstartable: start, --fresh and reset-session all refused while the refusal recommends --fresh. |
| 54 | PAN-3555 | S | high | ok |  |  | pan start silently spawned a FRESH session over a resumable warm session with no --fresh — warm-by-default violated. |
| 55 | PAN-3556 | S | high | ok |  |  | Concurrent double-spawn race: one agent allocated two fresh session identities 3 seconds apart at UAT promote time. |
| 56 | PAN-3234 | M | high | ok |  |  | Agents freeze indefinitely on blocking choice menus and nothing detects it — paneHasBlockingChoiceMenu is wired only to delivery refusal,... |
| 57 | PAN-3261 | S | high | ok |  |  | Resume-gate Enter: the tmux fallback answers a live choice menu when its own paste hides the menu from the detector. |
| 58 | PAN-2668 | S | high | ok |  |  | Verification/review feedback silently queued to stopped-by-user agents — re-drive not applied on delivery. |
| 59 | PAN-3104 | S | high | ok |  |  | Stale .pan/test/result.json is re-applied with no freshness check, re-failing an issue after the fix has landed. |
| 60 | PAN-2700 | S | high | ok |  |  | Test artifact recovery consumes a stale result.json — a fresh test dispatch insta-failed with the previous run's verdict 31 seconds after... |
| 61 | PAN-3557 | S | high | ok |  |  | Post-merge label application has no retry — a rate-limited 403 silently hides the issue from the verify-on-main sweep. |
| 62 | PAN-3569 | S | high | ok |  |  | Deploy gate deadlocks on a stale pending-post-merge.json when the deacon is paused — no staleness rule, no non-force exit. |
| 63 | PAN-3248 | S | high | ok |  |  | pan reload does not clear pending-deploy.json, so every flywheel deploy starves verification for ALL projects until a patrol runs. |
| 64 | PAN-3244 | S | high | ok |  |  | Queued dashboard deploy globally defers verification — a flywheel-owned deploy window starves cross-project review handoffs. |
| 65 | PAN-3205 | S | high | ok |  |  | Deployment gate queues a deferred deploy but never fires it — the promised 'next verification boundary' trigger does not exist. |
| 66 | PAN-3188 | S | high | ok |  |  | DoD row 5 rejects terminal canonical states — an already-done issue can never satisfy the post-merge row. |
| 67 | PAN-3168 | S | high | ok |  | PAN-3188, PAN-2846 | DoD row 5 deadlocks close-out: an agent paused *for* close-out with no tmux session is counted as running and blocks it. |
| 68 | PAN-2846 | S | high | ok |  |  | Close-out blocks on a dead agent: postMergeLifecycle pauses the work agent but leaves status=running. |
| 69 | PAN-3196 | S | high | ok |  |  | Close-out cannot tear down workspaces containing root-owned container residue — passes every DoD row then dies on EACCES. |
| 70 | PAN-3210 | S | high | ok |  |  | Close-out blocked by an unprefixed devcontainer init-perms container — teardown scopes by compose project, the guard scopes by working_dir. |
| 71 | PAN-3362 | M | high | ok |  |  | No way to seed tracker-backed issue fixtures in workspace containers — every UI-redesign UAT is environment-blocked |
| 71 | PAN-3047 | S | high | ok |  |  | Strike-branch teardown never fires: --is-ancestor cannot detect a squash merge, so all 96 strike/* branches are preserved as residue. |
| 72 | PAN-2828 | S | high | ok |  | PAN-3047 | pan done --strike always refuses squash-merged strikes — the ancestry check cannot see through a squash. |
| 73 | PAN-2995 | S | high | ok |  |  | pan done --strike false-blocks after a gh-API squash merge, reporting 'N commits missing from origin/main'. |
| 74 | PAN-3103 | S | high | ok |  |  | Transient merge_status=failed skips automatic close-out permanently — merged work stays open and pickup-eligible. |
| 75 | PAN-3171 | S | high | ok |  |  | Pipeline reports 'merge failed' AFTER a successful merge and successful post-merge cleanup; the issue stays Todo with no label. |
| 76 | PAN-2769 | S | high | ok |  |  | review_status rows are never reconciled when an issue closes — 9 closed issues still advertise reviewing/failed, inflating every operator... |
| 77 | PAN-3044 | S | high | ok |  |  | Review feedback delivery runs against CLOSED issues — resurrects agents and raises needs-you 12 days after close-out. |
| 78 | PAN-2888 | S | high | ok |  |  | Close-out leaves stale residue that inflates troubled/failed metrics: orphaned inspect sub-agents and uncleared review_status rows on CLO... |
| 79 | PAN-3211 | S | medium | ok |  |  | No honest disposition for closed-without-landing issues — residue rows are neither close-able nor reapable. |
| 80 | PAN-2567 | M | high | ok |  |  | Reviewed and green PR stuck after review — the advancing verdict is reconciled forever and merge never fires (churning-main convergence f... |
| 81 | PAN-3570 | S | high | ok |  |  | Root-owned node_modules/.pnpm-store subtrees block pan start with EACCES; pan workspace rebuild does not heal it |
| 82 | PAN-3325 | S | high | ok |  |  | Fresh workspace ships an EMPTY node_modules, so tooling silently resolves deps from the parent repo instead of failing |
| 83 | PAN-3270 | S | high | ok |  |  | New workspaces have empty node_modules and bun off PATH, so the documented bun install remedy fails for every agent |
| 84 | PAN-2763 | S | high | ok |  |  | Workspace node_modules symlinked to the primary repo — the exact pattern CLAUDE.md forbids; breaks test resolution |
| 85 | PAN-3510 | S | high | ok |  |  | Stopped agents leave detached docker-run test containers alive for hours, holding memory the governor cannot see |
| 86 | PAN-3050 | S | high | ok |  |  | Idle-stack reaper regex matches only overdeck-feature-* so MYN workspace stacks are never reaped |
| 87 | PAN-3497 | S | high | ok |  |  | CLIProxy watchdog crash-loops peer-dashboard workspace containers; pan workspace rebuild cannot fix it |
| 88 | PAN-3313 | S | high | ok |  |  | A transient upstream stream error benches CLIProxy's only auth — every GPT agent gets 503 auth_unavailable (70% failure) |
| 89 | PAN-3455 | XS | medium | ok |  |  | isCliproxyUpToDate always returns false because --version exits 2, so every ensure re-downloads the pinned release |
| 90 | PAN-3536 | S | high | ok |  |  | pan tell cannot deliver to live ohmypi conversations — expectedHarness defaults to claude-code when state.json is absent |
| 91 | PAN-2580 | S | high | ok |  |  | pan tell cannot deliver to codex (GPT) conversations — runtime stays null, delivery door calls a live session a zombie |
| 92 | PAN-2546 | S | medium | ok |  |  | Same codex-unaware delivery defect as PAN-2580, filed from the liveness-probe side; fix once, close both |
| 93 | PAN-3297 | S | high | ok |  |  | pan tell misclassifies healthy supervisor-run agents as zombies after a dashboard restart; delivery and resume disagree |
| 94 | PAN-3257 | S | high | ok |  |  | Crash-resume does not re-wire the PTY supervisor — a stale socket refuses all deliveries and state loses supervisorEnabled |
| 95 | PAN-3439 | S | high | needs-refinement |  |  | pan start crashes on a pending-work-spawn placeholder row instead of taking the fresh-spawn path; resume has the guard |
| 96 | PAN-3224 | S | high | ok |  |  | A crash-interrupted spawn strands model 'pending-work-spawn'; plain pan start dies with Unknown model, only --fresh recovers |
| 97 | PAN-2886 | S | high | ok |  |  | Placeholder pending-work-spawn agents crash auto-resume with Unknown model and are stranded troubled forever |
| 98 | PAN-3185 | S | high | ok |  |  | pan start reports a false hard failure when the deacon wins a spawn race — duplicate-session TOCTOU in spawn.ts |
| 99 | PAN-3139 | S | high | ok |  |  | Agents-table liveness drifts stale in the under-reporting direction: a live 4h agent is recorded stopped |
| 100 | PAN-2424 | XL | high | ok | ✓ |  | Pipeline substrate: Epic: the Order Book — first-class operator priority queue (markdown-authored, backlog-exempt, load-governed, flywhee... |
| 101 | PAN-3043 | S | high | ok |  |  | Mid-run provider quota exhaustion is undetected — agent stays 'running' for days holding a pipeline slot |
| 102 | PAN-3118 | S | high | ok |  |  | Model quota exhaustion halts agents invisibly — 4 planning agents 'running' at $0.00 with no capacity fallback |
| 103 | PAN-2758 | S | high | ok |  |  | Provider capacity error silently zombies a spawned agent: willRetry=false, turn reported completed, status stays running |
| 104 | PAN-2817 | M | high | ok |  |  | Idle-at-prompt work and review agents are never redriven — sessions stop at the composer mid-task and sit for hours |
| 105 | PAN-3057 | M | high | ok |  |  | Harness-initiated compaction leaves agents idle forever; GPT-5.6 context window is declared twice (372K vs 150K) |
| 106 | PAN-2169 | S | high | ok |  |  | Kimi agent silently frozen at 100% ctx with no thrown overflow error — needs a ctx-saturation heuristic |
| 107 | PAN-2936 | S | medium | ok |  |  | loop.max_steps_exceeded kills an agent mid-task with no detection or nudge; the operator must notice by hand |
| 108 | PAN-3432 | S | high | ok |  |  | Preemptive yield fan-out: seven work agents simultaneously yielded for ONE review convoy, gutting throughput |
| 109 | PAN-2813 | S | high | ok |  |  | Scheduler yield never self-clears — yielded work agents stay paused long after the blocking review merges |
| 110 | PAN-3120 | S | medium | ok |  |  | MERGE refuses (polyrepo) or silently dead-ends (single-repo) when the scheduler yielded the work agent |
| 111 | PAN-3237 | S | high | ok |  |  | A capacity-refused planning→work handoff is marked terminally stuck: every 409 becomes 'guardrails' and calls markWorkspaceStuck |
| 112 | PAN-2691 | S | high | ok |  |  | Auto-planned issues park silently when the post-finalize work spawn is gated (422) — no retry, no needs-you |
| 113 | PAN-2569 | S | high | ok |  |  | Planning finalizes and the issue goes planned, but the work agent does not auto-spawn — silent handoff failure |
| 114 | PAN-3023 | S | high | ok |  |  | Post-planning auto-spawn abandoned on a transient Docker failure — 'attempt 1/3' never retries, issue stuck in todo |
| 115 | PAN-2839 | S | high | ok |  |  | plan→work autoSpawn 500s with a duplicated workspace prep — nondeterministic half-spawns |
| 116 | PAN-3022 | S | high | ok |  |  | Work-spawn route ignores the per-issue workModel override — the role default wins and then clobbers the record |
| 117 | PAN-3562 | S | high | ok |  |  | pan task cancel does not cascade to AC children, so a cancelled item's leaves permanently fail the completeness gate |
| 118 | PAN-3245 | XS | medium | ok |  |  | pan done completion gate falsely flags workspace .pan/drafts/<issue>.md as uncommitted despite its own .pan exclusion |
| 119 | PAN-3096 | S | medium | ok |  |  | pan done fails on the generated devcontainer harness, so agents infer they should delete workspace infrastructure |
| 120 | PAN-2966 | XS | medium | ok |  |  | Polyrepo wrapper .gitignore misses .pan/, .devcontainer/ and dev, so the pan done cleanliness gate false-fails |
| 121 | PAN-2945 | XS | medium | ok |  |  | pan done rejects Overdeck-generated runtime in polyrepo wrapper repos — same gitignore drift as PAN-2966 |
| 122 | PAN-3048 | S | high | ok |  |  | Pipeline auto-commit lands .pan/drafts/<ISSUE>.md in product feature branches; the duplicated exclusion list has drifted |
| 123 | PAN-3094 | S | high | ok |  |  | pan done's merge fallback force-pushes a fast-forward branch, discarding whatever else landed on the remote head |
| 124 | PAN-2465 | XS | medium | ok |  |  | pan done's PR lookup runs gh pr list at the MYN polyrepo root, which has no remotes, so completion exits nonzero |
| 125 | PAN-3040 | M | high | ok |  |  | pan strike fails immediately on polyrepo projects — the strike path is monorepo-shaped end to end |
| 126 | PAN-3317 | S | high | ok |  |  | Strike agents have no sanctioned way to sync main: git rebase is guard-blocked and pan sync-main cannot resolve -strike workspaces |
| 127 | PAN-3306 | S | high | ok |  |  | A strike that needs a rebase has no working path — strike.md instructs it, the guard blocks it, sync-main resolves the wrong tree |
| 128 | PAN-2738 | S | high | ok |  |  | Strikes deadlock because git rebase origin/main is denied as history rewriting, so they cannot sync, gate, or push |
| 129 | PAN-3417 | S | high | ok |  |  | Strike agents have no merged-awareness — they keep verifying and monitoring after their branch lands, burning cost |
| 130 | PAN-3537 | S | medium | ok |  |  | In pipeline (in-review). Per-project live CI chip on the Command Deck: latest main run status and link, webhook-fed. |
| 130 | PAN-2874 | M | high | ok |  |  | Strike landing pipeline cannot merge strikes: the verification gate demands an xBRIEF checklist strikes never have |
| 131 | PAN-2921 | S | high | ok |  |  | Strike merge door can report fetch failure after a successful merge and land the same head twice |
| 132 | PAN-2806 | S | medium | ok |  |  | Strike merge trigger registry splits across dashboard chunks, so landing always reports 'trigger is not registered' |
| 133 | PAN-3477 | S | high | ok |  |  | Merged slot sessions are never reaped and get auto-resumed forever, consuming swarm capacity indefinitely |
| 133 | PAN-3267 | S | high | ok |  |  | Pipeline membership fans out one glab subprocess per repo x head, stalling and failing every MYN refresh |
| 134 | PAN-3256 | S | high | ok |  |  | MYN pipeline membership fails forge_unavailable because glab mr list runs in a path that is not a git repository |
| 135 | PAN-3186 | S | high | ok |  |  | Pipeline membership blanks the whole auricle project because one configured member directory is not a git repo |
| 136 | PAN-3167 | S | medium | ok |  |  | krux and lexerra are permanently unreadable through the membership door — a 404 from an uninstalled App is typed as forge_unavailable |
| 137 | PAN-2824 | S | high | ok |  |  | pan review pending dies entirely when one project's lens gather fails, returning nothing for every other project |
| 138 | PAN-2880 | M | high | ok |  |  | Linear listIssues is a 3N+1 request storm — one MYN membership gather burns the entire 2500/hr Linear budget |
| 139 | PAN-2627 | S | high | ok |  |  | Linear poller is blind after cycle rollover — the active-cycle filter returns 0 issues and wipes the project from the tree |
| 140 | PAN-2954 | S | high | ok |  |  | postMergeLifecycle refuses GitLab projects, so teardown and labels never run for any MYN merge |
| 141 | PAN-933 | S | medium | ok |  |  | Review poster cannot post to GitLab MRs — synthesis output never reaches the MR it reviewed |
| 142 | PAN-3498 | S | high | ok |  |  | write-sequence pins in-pipeline ranks without renumbering — 11 duplicate ranks and 11 gaps in the persisted sequence |
| 143 | PAN-3289 | S | medium | ok |  |  | Sequencer ran a full pass on an empty manifest against a 750-issue backlog — read model transiently empty at spawn |
| 144 | PAN-3301 | S | high | ok |  |  | Stray-writer warning is 68k log lines hiding one real defect: the backlog manifest still writes the legacy .pan path |
| 145 | PAN-3108 | XS | medium | ok |  |  | dashboard.log grows unbounded (867MB, 8.8M lines) with no rotation — un-greppable during an incident |
| 146 | PAN-1846 | XS | medium | ok |  |  | deacon.log reached 687MB with no rotation; a per-agent skip line is logged every 60s patrol |
| 147 | PAN-2287 | XS | low | ok |  |  | Every supervisor.log line is written twice — log() appendFile and the launcher stdout redirect target the same file |
| 148 | PAN-3535 | S | high | ok |  |  | Drain/resume boot gate is caller-env-dependent: any restart from a clean shell silently drops the hold |
| 149 | PAN-3553 | S | medium | needs-refinement |  |  | Post-reboot census treats a zero-session tmux server as unavailable, so conversations sit on 'Starting…' for minutes |
| 150 | PAN-3527 | S | medium | ok |  |  | Sidebar project list never retries — one failed boot-time fetch leaves CONVERSATIONS 0 / ISSUES 0 until manual reload |
| 151 | PAN-3303 | S | medium | ok |  |  | Command Deck latches 'Unknown project' after a reconnect because an empty registered-projects response is treated as authoritative |
| 152 | PAN-2932 | S | high | ok |  |  | Intermittent dashboard boot wedge between Cloister start and ReadModel bootstrap leaves :3011 unbound (Bad Gateway) |
| 153 | PAN-3522 | S | high | ok |  |  | Dashboard supervisor watchdog restart-churns under CPU storm because the probe timeout budget ignores the boot warm phase |
| 154 | PAN-3099 | XS | high | ok |  |  | pan restart --health-timeout 120 is enforced as 120ms, false-failing the health check and leaving the dashboard down |
| 155 | PAN-2547 | XS | medium | ok |  |  | Same --health-timeout unit confusion as PAN-3099, filed earlier; resolve the unit once and close both |
| 156 | PAN-2663 | S | high | ok |  |  | pan restart's health probe can accept the OLD dashboard after the replacement dies with EADDRINUSE |
| 157 | PAN-3329 | S | high | ok |  |  | Deployment generation node_modules and tracked packages/ files deleted while a dev-checkout build runs (2nd occurrence) |
| 158 | PAN-3508 | XS | medium | ok |  |  | pan reload temporarily removes the global pan CLI when invoked outside its linked generation |
| 159 | PAN-2337 | S | high | ok |  |  | An in-place npm run build under a live dashboard silently breaks every new PTY-supervisor spawn until restart |
| 160 | PAN-2422 | S | high | ok |  |  | Rebuilding dist under a live server breaks lazy chunk imports — 'Cannot find module dist/dashboard/<chunk>.js' |
| 161 | PAN-2957 | S | high | ok |  |  | npm run build intermittently produces stale frontend bundles, so a verified fix can ship without its own code |
| 162 | PAN-538 | XS | medium | ok |  |  | pan reload's freshness guard must also verify the frontend bundle, not just the server bundle |
| 163 | PAN-2850 | XS | medium | ok |  |  | npm test deterministically fails in a clean checkout because pretest cleans dist/ without rebuilding the server bundle |
| 164 | PAN-2550 | S | high | ok |  |  | npm test exits 0 despite 31 root-suite failures — the command-level signal every gate trusts is wrong |
| 165 | PAN-1918 | M | high | ok |  |  | The full frontend vitest suite runs in no CI path; npm test is limited to 3 files and the only gate that runs it hangs |
| 166 | PAN-3427 | M | high | ok |  |  | Order books are unreachable for every project except the dashboard server’s own cwd project |
| 166 | PAN-2670 | M | high | ok |  |  | Gate the dashboard-server tsconfig in npm run typecheck — the server graph has no type enforcement at all |
| 167 | PAN-2635 | L | medium | ok |  | PAN-2670 | Pay down the 152-error src/dashboard/server typecheck debt so the ratchet can become a real gate |
| 168 | PAN-2430 | M | high | ok |  |  | Frontend typecheck fails on main with dozens of pre-existing unused-local errors, keeping the ratchet permanently sour |
| 169 | PAN-1824 | M | high | ok |  |  | Fix flaky main CI: fake timers plus @slow exclusion for the real-timer test family that keeps reddening main |
| 170 | PAN-3243 | S | high | ok |  |  | auto-commit test flakes on main by polling a fixed 20 setImmediate turns for a real git subprocess |
| 171 | PAN-2421 | S | high | ok |  |  | Dashboard server route tests time out or mis-assert under full-suite verification load — load flakes, not defects |
| 172 | PAN-1720 | S | medium | ok |  |  | Cloister auto-resume tests fail under the full parallel run and pass in isolation — test pollution reddening main |
| 173 | PAN-2656 | XS | medium | ok |  |  | deacon-swarm unit tests read the live ~/.overdeck/config.yaml, so 6 tests fail whenever swarm.mode=off |
| 174 | PAN-2761 | XS | medium | ok |  |  | done.test.ts asserts a hardcoded URL without stubbing env, so it fails in any agent shell and looks like a red main |
| 175 | PAN-3502 | XS | low | ok |  |  | tiered-crews blendedCost expectation is stale against current model-capabilities pricing and fails on main tip |
| 176 | PAN-2810 | S | medium | ok |  |  | The workspace vitest --changed gate diverges from CI, failing on a mock introduced by an unrelated main commit |
| 177 | PAN-2506 | XS | low | ok |  |  | flywheel-primary-root.test.ts fails on macOS because /var vs /private/var is never canonicalized |
| 178 | PAN-2478 | S | medium | ok |  |  | CI flake: Playwright browser install fails on the Microsoft apt repo, red-mainning otherwise good merges |
| 179 | PAN-2495 | S | medium | ok |  |  | A ci-green merge skip bypassed the CI-green gate and landed a red-main change — the skip needs its own no-loss audit |
| 180 | PAN-2940 | M | high | ok |  |  | Three red mains in one day from direct-push series bypassing PR CI — supervised conversations need a pre-merge CI surface |
| 181 | PAN-2454 | S | medium | ok |  |  | Ratchet audit fails per-commit on push ranges whose NET baseline delta is zero, stranding finished branches |
| 182 | PAN-3517 | M | high | ok |  |  | Convoy forks still miss the parent prompt cache in production — launch-injection byte drift plus a dropped cache-scope header |
| 183 | PAN-3518 | M | medium | ok |  | PAN-3517 | TTL-aware re-review payload policy: fresh-spawn-with-digest for cold, large review histories |
| 184 | PAN-3454 | S | medium | ok |  |  | Cost hook re-ingests fork-copied parent history under reviewer identity — fabricated cache-miss warnings and multi-billed spend |
| 185 | PAN-3077 | XS | high | ok |  |  | Inspect/review-supervisor spawns omit --effort and inherit the harness xhigh default, violating the standing high-effort policy |
| 186 | PAN-3078 | S | high | ok |  |  | The inspect verdict is never delivered to the work agent, so an agent that waits for it deadlocks forever |
| 187 | PAN-2848 | S | high | ok |  |  | A work agent gated on a dead inspection stalls permanently — no re-dispatch, no verdict, swarm-off suppresses recovery |
| 188 | PAN-2960 | S | medium | ok |  |  | Inspect supervisor lingers past its 12m limit and never self-terminates after posting a verdict |
| 189 | PAN-2959 | S | medium | ok |  |  | pan inspect --item reviews workspace HEAD rather than that item's commit, producing spurious verdicts |
| 190 | PAN-2796 | S | medium | ok |  |  | Idle nudge advances to the next item after a failed mandatory inspection, telling the agent to skip the blocked work |
| 191 | PAN-3085 | XS | high | ok |  |  | Review feedback is written to .overdeck/feedback but agents and the merge gate are pointed at a nonexistent .pan/feedback |
| 192 | PAN-3321 | XS | high | ok |  |  | Escalation messages and CLAUDE.md tell operators to run pan unstick, which does not exist as a command |
| 193 | PAN-2689 | S | high | ok |  |  | Review verdicts from sandboxed codex review agents are silently lost — the fire-and-forget journal write dies with the CLI |
| 194 | PAN-2697 | S | medium | ok |  |  | First-review codex parents enter discovery mode and the supervisor no-ops every discovery-ready signal, so the convoy never launches |
| 195 | PAN-2639 | S | high | ok |  |  | codex-resume replays a rotated-out refresh token, so codex review convoys wedge with 401 |
| 196 | PAN-2416 | S | medium | ok |  |  | Codex agents wedge on the Codex CLI first-run consent screen — spawn must pre-accept non-interactively |
| 197 | PAN-2331 | S | high | ok |  |  | The codex rate-limit 'Switch to gpt-5.4-mini?' modal stalls autonomous agents with no auto-dismiss |
| 198 | PAN-2333 | S | high | ok |  |  | Handle codex weekly-quota exhaustion with a resource alert and downshift policy instead of an unanswerable modal |
| 199 | PAN-2521 | S | high | ok |  |  | Launch pipeline agents with the harness rate-limit model-switch reminder disabled so the dialog can never block a pane |
| 200 | PAN-1830 | S | medium | ok |  |  | Reviewer stuck on a gpt-5.5 rate-limit modal blocks REVIEWER_READY, so synthesis waits forever despite a written report |
| 201 | PAN-2492 | S | medium | ok |  |  | Pane-detected waits surface as 'needs you' but cannot be answered from the dashboard — only from the terminal |
| 202 | PAN-3235 | M | medium | ok |  |  | Dashboard decision card: render and answer agent pane-choice menus so blocking prompts are resolvable from the UI |
| 203 | PAN-3113 | M | medium | ok |  |  | Surface agent-pane choice prompts as inline decision cards in the conversation view |
| 204 | PAN-3276 | XS | medium | ok |  |  | Needs-you rows do not navigate — clicking a terminal question or permission prompt does nothing |
| 205 | PAN-2717 | S | medium | ok |  |  | Conversation permission waits are missing from the Awareness surface; strengthen the alert pulse |
| 206 | PAN-2193 | S | high | ok |  |  | Held issues (objection/parked/vetoed/needs-handoff) are invisible in the Command Deck tree — bucketed clean_terminal |
| 207 | PAN-3179 | M | high | ok |  |  | A UAT promote is marked complete at merge time — nothing verifies the change reached production |
| 208 | PAN-3176 | S | high | ok |  |  | Block UAT batch promotion when the live stack is degraded, unknown, or still starting — promote takes no health evidence |
| 209 | PAN-3106 | S | high | ok |  |  | auto_merge_default: hold is bypassed — shouldHoldForUat is consulted on only one merge path, so held issues merge anyway |
| 210 | PAN-3174 | M | high | ok |  |  | Every polyrepo UAT stack is unreachable: Traefik labels carry the old prefix and the frontend label routes to the wrong port |
| 211 | PAN-3164 | XS | medium | ok |  |  | UAT stack shows 'Open UAT frontend' while still booting, so the operator gets a Gateway Timeout with no indication |
| 212 | PAN-3137 | XS | medium | ok |  |  | UAT generation member titles are taken from the Flywheel status snapshot, so orchestrator prose reaches the operator |
| 213 | PAN-3218 | M | high | ok |  |  | No release-drift signal: a user-facing fix can sit merged on main for hours while every published version stays broken |
| 214 | PAN-3533 | L | high | ok |  |  | Resource segregation: per-project isolation classes so MYN stacks cannot starve Overdeck work and vice versa |
| 215 | PAN-3295 | M | medium | ok |  |  | Single per-machine completion-check summarizer with a queue plus first-class observability in pan resources and the Deacon |
| 216 | PAN-3107 | M | medium | ok |  |  | Productize the memory-attribution census — OOM spikes are unattributable after the fact |
| 217 | PAN-3129 | M | high | ok |  |  | Security: symlink/TOCTOU containment for canonical writes under agent-controlled paths |
| 218 | PAN-3130 | S | high | ok |  |  | Security: path-escape validation for identifier-joined write paths |
| 219 | PAN-3445 | S | medium | ok |  |  | Project config TCP lock hashes into the ephemeral client port range, so unrelated connections can occupy the lock port |
| 220 | PAN-2659 | S | high | ok |  |  | fs-lock: a crash between mkdir(lock) and the owner.json write leaves an unreclaimable per-issue record lock |
| 221 | PAN-3181 | L | high | ok |  |  | Own agent memories in Overdeck: migrate harness project memories to a per-repo overdeck-memory orphan branch |
| 222 | PAN-3012 | M | high | ok |  |  | Back up harness conversation transcripts before the harnesses delete them — today the archive is only a DB flag |
| 223 | PAN-2394 | S | high | ok |  |  | Incident: conv-* agent-dir cleanup destroyed ohmypi/codex conversation transcripts — 'no saved history' |
| 224 | PAN-3016 | M | medium | ok |  |  | URL-address every view so any place you navigate in Overdeck can be returned to from the URL |
| 225 | PAN-2554 | XS | medium | ok |  |  | Clicking a project does not update the browser URL, so the project view is not copyable, shareable, or bookmarkable |
| 226 | PAN-1844 | S | medium | ok |  |  | Deep-linkable Command Deck: reflect the selected issue/agent in the URL and link activity notifications to the specific view |
| 227 | PAN-3530 | S | medium | ok |  |  | God View polls on 30s timers in four components, violating its documented event-driven /ws/rpc contract |
| 228 | PAN-3540 | S | medium | ok |  |  | God View: phantom agent orbs, a dead Hook Bus panel, and a pressure-blind swap header contradict live ground truth |
| 229 | PAN-2905 | M | high | ok |  |  | Dashboard steady-state CPU is ~50%, keeping API responses at 0.5-1.5s — profile and fix the residual burner |
| 230 | PAN-1711 | M | high | ok |  |  | Root-cause and fix dashboard event-loop stalls under load; the watchdog force-restarts a healthy but stalled server |
| 231 | PAN-2896 | S | medium | ok |  |  | Warm resource-discovery and membership caches at boot — the first click after any restart pays a 20-60s cold compute |
| 232 | PAN-790 | M | medium | stale |  |  | Eliminate the remaining TanStack Query polling and complete the push-first migration |
| 233 | PAN-3332 | S | medium | ok |  |  | Dashboard slash-command activities never surface failure — 'running in background' stands forever |
| 234 | PAN-3121 | S | medium | ok |  |  | Failed-send outbox does not reconcile against the transcript, so a delivered message keeps a doomed Retry twin |
| 235 | PAN-3117 | S | medium | ok |  |  | Failed-send bubble hides the deterministic 4xx reason and offers a Retry that can never succeed |
| 236 | PAN-2083 | XS | low | ok |  |  | A failed first send leaves the text in BOTH the composer box and the retry outbox |
| 237 | PAN-2082 | S | medium | ok |  |  | A single send failure clears ALL in-flight optimistic bubbles and strips siblings' compaction net |
| 238 | PAN-2652 | M | high | ok |  |  | Claude Code backgrounding forks the session file in-process, invisible to every session-id resolution path |
| 239 | PAN-2672 | M | medium | ok |  |  | Post-/clear siblings render the same original transcript — per-tmux resolution, frozen launcher pin, null claude_session_id |
| 240 | PAN-2280 | S | medium | ok |  |  | Resumed conversations wedge without writing transcripts when the dashboard is black-holed; views diverge from terminals |
| 241 | PAN-2282 | S | medium | ok |  |  | Conversation view shows no history for ohmypi-harness conversations — the pi transcript surface is missing |
| 242 | PAN-2649 | S | medium | ok |  |  | Ctrl+K conversation search indexes Claude transcripts only; codex, pi and ohmypi conversations are absent |
| 243 | PAN-2981 | XS | low | ok |  |  | Ctrl-K palette: a stale conversation hit 404s on open because the search index never prunes deleted sessions |
| 244 | PAN-3418 | S | medium | ok |  |  | Empty-string conversation model is stored, never backfilled, and blanks the harness and model chips |
| 245 | PAN-3014 | S | medium | ok |  |  | Background AI title/about spawns fail because --bare skips credential reads in Claude Code 2.1.209 |
| 246 | PAN-3013 | XS | medium | ok |  |  | linear-mcp-auth-hook entries leak into durable ~/.claude/settings.json pointing at dead /tmp paths |
| 247 | PAN-3516 | XS | medium | ok |  |  | Stale bundled-skill duplicates in the repo .claude/skills directory shadow the canonical copies |
| 248 | PAN-3450 | S | medium | ok |  |  | pan sync never prunes removed skills/rules from cache and harness dirs — beads survived removal for weeks |
| 249 | PAN-3308 | XS | high | ok |  |  | The file-size guard hands agents a paste-ready ratchet-up line, so 2 of 3 agents raised the ceiling instead of shrinking |
| 250 | PAN-3322 | XS | medium | ok |  | PAN-3308 | The launcher-generator file-size allowlist sits 126 lines above reality, turning a temporary ceiling into regrowth budget |
| 251 | PAN-2720 | S | high | ok |  |  | The file-size ratchet counts lines, so it rewards line-packing on exactly the god files it means to improve |
| 252 | PAN-3307 | XS | high | ok |  |  | commitlint scope-enum is stale, warns on most real commits, and still lists the removed beads scope |
| 253 | PAN-3288 | S | medium | ok |  |  | Dev-checkout preflight: detect stale node_modules after a git pull and fail with 'run bun install' instead of ERR_MODULE_NOT_FOUND |
| 254 | PAN-2630 | S | medium | ok |  |  | The pan binary is not on PATH for operator shells or spawned work agents, and pan doctor cannot be run to diagnose it |
| 255 | PAN-3046 | XS | medium | ok |  |  | The pan CLI crashes at exit with ERR_UNHANDLED_REJECTION when the PostHog shutdown flush times out |
| 256 | PAN-2593 | S | high | ok |  |  | Dashboard server children inherit a bare system PATH, so verification gates run under system Node 18 instead of Node 22 |
| 257 | PAN-2511 | M | high | ok |  |  | Work agents burn 20+ minutes on false test failures — the sandbox denies spawnSync git and local full-suite verify is redundant |
| 258 | PAN-2379 | S | high | ok |  |  | The verify gate's dependency install is warn-only with a 60s timeout, producing false failures against empty node_modules |
| 259 | PAN-2699 | S | medium | ok |  |  | npm run build regenerates the committed record-cost-event.js bundle, dirtying every workspace and blocking clean-tree gates |
| 260 | PAN-2664 | S | high | ok |  |  | sync-main auto-commit completes an unresolved merge, staging conflict-marker files as if they were work |
| 261 | PAN-2244 | S | medium | ok |  |  | Recurring pan-dir auto-commit GitError on main: a half-staged spec file blocks all mirroring so continue mirrors never land |
| 262 | PAN-1770 | S | high | ok |  |  | pan-dir auto-commit rebase races live continues writes, failing every busy cycle |
| 263 | PAN-2516 | S | high | ok |  |  | Spec plan.status flips are left uncommitted in the shared primary worktree, causing spec-vs-record drift |
| 264 | PAN-2560 | S | high | ok |  |  | resolveStateReadHomeSync resolves the state dir by path basename rather than registry key, so migrated projects fall back to legacy |
| 265 | PAN-2558 | M | high | ok |  |  | State migration does not support polyrepo projects — MYN state is currently tracked in no git repo at all |
| 266 | PAN-2549 | M | medium | ok |  | PAN-1676 | Fly remote workspaces need overdeck-state sync before migrated projects can be re-enabled remotely |
| 267 | PAN-2908 | XL | medium | ok | ✓ |  | Dashboard / operator UX: Make overdeck not suck |
| 268 | PAN-2548 | S | medium | ok |  |  | Close the state legacy-fallback deprecation window once every project carries the migration marker |
| 269 | PAN-3411 | M | medium | ok |  |  | Workspace + container infra: New Workspace as a full-page creation experience (replaces the modal) |
| 270 | PAN-3420 | M | medium | ok |  |  | Pipeline substrate: Dashboard + pan show render a completed, closed-out issue as never-started (post-close-out history wipe) |
| 271 | PAN-1416 | M | medium | ok |  |  | Pipeline substrate: Workspace-spawned dashboards must never claim the canonical dashboard port |
| 272 | PAN-2642 | XL | medium | ok | ✓ |  | Pipeline substrate: [EPIC] Cost strategy: waste detection over budget policing — retire invented limits, land the progress-aware breaker,... |
| 273 | PAN-807 | L | high | ok |  |  | Pipeline substrate: Epic C: Workspace state sanity on spawn |
| 274 | PAN-1868 | M | medium | ok |  | PAN-2079 | Pipeline substrate: Cost-bleed circuit breaker: progress-aware, always-on guard against runaway agent spend |
| 275 | PAN-3178 | M | medium | ok |  |  | Pipeline substrate: First-class worktrees & diffs: +/− changes badge, dedicated Changes surface, conversation worktrees |
| 276 | PAN-3090 | M | medium | ok |  |  | Pipeline substrate: Simple issue page: narrative feed instead of raw transcript, surface the pending question, honest blocked state |
| 277 | PAN-1560 | S | high | ok |  |  | CI / quality gate: Re-review after a PR head moves doesn't re-post panopticon/review status → PR stranded BLOCKED |
| 278 | PAN-2650 | L | high | ok |  |  | Pipeline substrate: Swarm final ready-to-merge slot wedges when memory-governor sheds the integration stack; pan swarm recover can't reco... |
| 279 | PAN-2323 | M | high | ok |  |  | Pipeline substrate: Flywheel respawn after crash/displacement starts a blank session instead of resuming the live one |
| 280 | PAN-2324 | S | high | ok |  |  | Pipeline substrate: label transition fails atomically on missing 'in-planning' label — closed issues keep stale in-review/merged labels |
| 281 | PAN-2186 | S | high | ok |  |  | Pipeline substrate: post-merge lifecycle can leave merged issues in-review and auto-merge rows stuck |
| 282 | PAN-2179 | S | high | ok |  |  | Pipeline substrate: relaunch can leave a zombie agent — session alive but kickoff never delivered (liveness checks fooled) |
| 283 | PAN-2165 | M | high | ok |  |  | Pipeline substrate: pan close: close-issue phase reports success but leaves issue OPEN / wrong labels (remove-label aborts on absent labe... |
| 284 | PAN-2106 | M | high | ok |  |  | Pipeline substrate: pan strike workspace setup leaves broken partial workspace + false 'spawned' success (git-lock race) |
| 285 | PAN-1650 | M | high | ok |  |  | Pipeline substrate: Split readyForMerge → gatesPassed (derived/event-driven) + shipComplete; auto-dispatch ship on gates-green |
| 286 | PAN-2233 | L | high | ok |  |  | Pipeline substrate: decompose merge-agent.ts (1,414 lines) into focused modules |
| 287 | PAN-2190 | L | high | ok |  |  | Pipeline substrate: Decompose routes/workspaces/merge-ops.ts (1,925 lines) — new god file from the workspaces split |
| 288 | PAN-1776 | M | medium | ok |  |  | Pipeline substrate: Hot-updatable message delivery: version-stamped supervisors + server-side delivery logic |
| 289 | PAN-1766 | S | high | ok |  |  | Pipeline substrate: work agents hang on Claude Code settings-file protection when editing .claude/** — un-overridable by PreToolUse hook ... |
| 290 | PAN-1618 | M | high | ok |  |  | Pipeline substrate: Substrate: work-spawn docker-health gate has no autonomous recovery — proposed work can't auto-start when the stack i... |
| 291 | PAN-2968 | M | medium | ok |  |  | Pipeline substrate: Adopt the interactive decision page as the default way to present operator decisions |
| 292 | PAN-3423 | M | medium | ok |  |  | Redesign SystemHealthPill popover: attention-grouped reasons, metered vitals, actionable agent alerts |
| 292 | PAN-1775 | M | medium | ok |  |  | Pipeline substrate: Remote (Fly.io) work agents appear as real session rows in the issue tree |
| 293 | PAN-2350 | XL | medium | ok | ✓ |  | Pipeline substrate: Epic: Overdeck Anywhere — remote access, Hermes bridge, mobile, and the shared relay backbone |
| 294 | PAN-1209 | M | high | ok |  |  | Pipeline substrate: PAN-1052 bead projection disagrees with bd state |
| 295 | PAN-3513 | M | high | ok |  |  | Pipeline substrate: Agent runtime plane on overdeck-state — durable session pointers, GC as cache eviction (Anywhere data plane) |
| 296 | PAN-2709 | M | high | ok |  |  | Pipeline substrate: Flywheel orchestrator is unreachable as a notification target — agents auto-resume it, resume always fails when the r... |
| 297 | PAN-2563 | M | medium | ok |  |  | Workspace + container infra: npm-flavor desktop (npx @overdeck/desktop) lacks node_modules for the server's externalized deps |
| 298 | PAN-2451 | M | high | ok |  |  | Pipeline substrate: Work agent stranded behind commit-msg gate after overflow-restart + auto-commit + merge-main (non-issue-ref commits) |
| 299 | PAN-2334 | S | high | ok |  |  | Pipeline substrate: write a Definition of Ready (DoR) — the bar an issue must clear before planning/pickup, tuned to catch junk like the ... |
| 300 | PAN-2189 | L | high | ok |  |  | Pipeline substrate: Decompose src/lib/cloister/deacon.ts (3,394 lines) — pipeline machinery, supervised handoff |
| 301 | PAN-2188 | M | high | ok |  |  | Pipeline substrate: Flywheel resilience for the codebase-health flood: substrate-first prioritization + tenets spirit-gate |
| 302 | PAN-2170 | S | high | ok |  |  | Workspace + container infra: Docker init container lacks Python — node-gyp rebuild of better-sqlite3 fails, breaking workspace stack crea... |
| 303 | PAN-2075 | XL | high | ok | ✓ |  | Pipeline substrate: [EPIC] Boot Reconciliation + Operator Inbox — informed, substrate-complete (local + Fly), reachable online/CLI/offline |
| 304 | PAN-2080 | M | high | ok |  | PAN-2079 | Pipeline substrate: Operator Inbox external transports (email/Slack/push/TTS) — offline reach (fast-follow, absorbs #43) |
| 305 | PAN-2079 | M | high | ok |  | PAN-2077 | Pipeline substrate: Operator Inbox: durable server-side queue + in-dashboard surface (the notification spine) |
| 306 | PAN-2078 | M | high | ok |  | PAN-2077 | Pipeline substrate: CLI parity for boot reconciliation: pan boot status + pan resume --all|--select|--freeze|--kill-remote |
| 307 | PAN-2077 | M | high | ok |  | PAN-1775 | Pipeline substrate: Substrate-complete reconciliation inventory (local tmux + remote Fly machines) — one resolver |
| 308 | PAN-1951 | M | medium | ok |  |  | Pipeline substrate: Inspector resumes a warm per-issue session instead of cold-spawning per item |
| 309 | PAN-2837 | M | high | ok |  |  | Pipeline substrate: Distributed agent presence: record which machine runs each issue's agents on overdeck-state (claim/release, no heartb... |
| 310 | PAN-2830 | M | high | ok |  |  | Pipeline substrate: Shared Logbook: make the overdeck-state branch opt-in — OFF by default, local-only state, clean enable/disable with c... |
| 311 | PAN-1504 | M | high | ok |  |  | Pipeline substrate: pan hygiene — codify orchestration merge/commit/push state audit as a first-class CLI verb + skill + docs |
| 312 | PAN-1497 | M | high | ok |  |  | Pipeline substrate: emit TTS announcements on lifecycle events (start, pause, resume, report) |
| 313 | PAN-1219 | M | high | ok |  |  | Pipeline substrate: Promote across-cycle review state to first-class data (cycle SHA, prior findings) instead of prompt-derived |
| 314 | PAN-1218 | M | high | ok |  |  | Pipeline substrate: Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-of-batch mode |
| 315 | PAN-863 | S | medium | stale |  |  | Pipeline substrate (stale — re-verify relevance): One-shot sweep of stale feature branches and worktrees predating the reaper |
| 316 | PAN-3456 | S | medium | ok |  |  | Pipeline substrate: pan swarm refused every plan containing a sequential item — per-item diagnostics acted as gates |
| 317 | PAN-3157 | M | medium | ok |  |  | Pipeline substrate: Awareness feed shows the Flywheel as a generic 'Claude Code / No messages yet' chat row instead of flywheel run activity |
| 318 | PAN-3061 | M | medium | ok |  |  | Pipeline substrate: Dispatch-topology advisor: mechanical start-vs-swarm recommendation at plan-finalize |
| 319 | PAN-3003 | S | medium | ok |  |  | Pipeline substrate: work-agent launchers lack OVERDECK_AGENT_ID export — manual re-launch dies instantly |
| 320 | PAN-2971 | S | medium | ok |  |  | Pipeline substrate: orchestrator finalized its own run (report --force) but kept running — zombie session uncontrollable, dashboard Pause... |
| 321 | PAN-2805 | M | medium | ok |  |  | Pipeline substrate: FlywheelPage shows 'No active run' while /api/flywheel/current returns a live run — open-questions reveal lands nowhere |
| 322 | PAN-2792 | M | medium | ok |  |  | Pipeline substrate: Orphan-process sweeps killed the dashboard and live conversations via lsof +D over Bun-hardlinked node_modules |
| 323 | PAN-2775 | M | medium | ok |  |  | Pipeline substrate: Agents die in sweeps: boot-correlated false reaps (live flywheel reaped, convoy reaped 5x) + unexplained simultaneous... |
| 324 | PAN-2759 | M | medium | ok |  |  | Pipeline substrate: Dead flywheel with an active run was never auto-relaunched after a reboot — sat idle 2h with recovery wired and enabled |
| 325 | PAN-2747 | M | medium | ok |  |  | Pipeline substrate: Flywheel cannot be resumed after a crash/reboot: Resume is disabled and the only offered action aborts the run |
| 326 | PAN-2739 | S | medium | ok |  |  | Pipeline substrate: first-completion detection throws every patrol cycle — non-null assertion on getAgentRuntimeStateSync kills the pan-d... |
| 327 | PAN-2734 | S | medium | ok |  |  | Pipeline substrate: merge queue head-of-line zombie — closed PAN-2325 re-triggered on all 294 boots; removeMerge has zero callers |
| 328 | PAN-955 | M | high | ok |  |  | Workspace + container infra: Workspace devcontainer template versioning + re-render on demand |
| 329 | PAN-813 | M | high | ok |  |  | Pipeline substrate: Add regression test for /api/review/:issueId/reset preserving work-agent resolution |
| 330 | PAN-3568 | M | medium | ok |  |  | Pipeline substrate: Adopt Effect diagnostics (@effect/language-service) as a mechanical CI gate and agent feedback loop |
| 331 | PAN-3441 | M | medium | ok |  |  | Pipeline substrate: God View "River" — WebGL pipeline visualization fed by the live hook-event stream |
| 332 | PAN-2696 | M | medium | ok |  |  | Pipeline substrate: Task views still speak beads vocabulary — completed vBRIEF items shown as 'upcoming', plus phantom 'not synced' label |
| 333 | PAN-2686 | M | medium | ok |  |  | Pipeline substrate: Policy strip "restart pending" badge never clears after restart-fresh with a new model (record.model is sticky) |
| 334 | PAN-2259 | S | high | ok |  |  | Harness / model routing: something burns the full 5k/hr GitHub GraphQL quota — repeatedly breaks pan close, gh issue edit, and orchestration |
| 335 | PAN-2240 | S | medium | ok |  |  | Pipeline substrate: pan tell contradicts itself on dead ohmypi sessions — 'session is dead and resume failed: it appears healthy' |
| 336 | PAN-2237 | S | medium | ok |  |  | Pipeline substrate: pan plan done swallows vbrief quality lint details |
| 337 | PAN-2069 | M | medium | ok |  |  | Pipeline substrate: caveman: follow-up gaps — review agent routing, hook execution tests, Settings UI toggle, Experiments view |
| 338 | PAN-1578 | L | high | ok |  |  | Pipeline substrate: GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex) |
| 339 | PAN-1217 | S | high | ok |  |  | CI / quality gate: Requirements reviewer: classify each AC as in_pr_scope vs whole_feature_scope, only !-block in-PR-scope items |
| 340 | PAN-532 | M | medium | stale |  |  | Pipeline substrate (stale — re-verify relevance): Per-project and per-issue model overrides for pipeline roles |
| 341 | PAN-2685 | M | medium | ok |  |  | Pipeline substrate: Annotated live preview: Codex-style annotate-the-app feedback delivered to agents |
| 342 | PAN-2566 | XL | medium | ok | ✓ |  | Documentation: Traycer parity epic: gap analysis of capabilities Overdeck lacks |
| 343 | PAN-2582 | M | medium | ok |  |  | Pipeline substrate: show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lanes) |
| 344 | PAN-2565 | M | medium | ok |  |  | Pipeline substrate: Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging |
| 345 | PAN-2514 | M | medium | ok |  |  | Pipeline substrate: Claude Code Traffic Inspector — intercept & inspect model API traffic in the dashboard |
| 346 | PAN-2507 | M | medium | ok |  |  | Pipeline substrate: Preemptive pipeline scheduler: yield idle work agents to unblock review/test/merge dispatch |
| 347 | PAN-2443 | M | medium | ok |  |  | Pipeline substrate: OpenTelemetry GenAI semconv — OTLP ingestion layer for cross-harness telemetry (tokens/latency/tools), pinned-snapsho... |
| 348 | PAN-2442 | M | medium | ok |  |  | Pipeline substrate: Agent Client Protocol (ACP) as Overdeck's structured control plane — replace tmux keystrokes, transcript parsers, and... |
| 349 | PAN-2355 | L | medium | ok |  | PAN-2352 | Pipeline substrate: Overdeck Anywhere P2: mobile PWA (Needs-You feed, conversation view, pipeline board, Web Push) |
| 350 | PAN-2353 | M | medium | ok |  | PAN-2351 | Pipeline substrate: Overdeck Anywhere P1b: Hermes external-agent bridge (scoped API + Fly 6PN) |
| 351 | PAN-1912 | M | medium | ok |  |  | Pipeline substrate: Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle |
| 352 | PAN-1828 | M | medium | ok |  |  | Pipeline substrate: Conversation fork/handoff harness defaults ignore source conversation harness — silent claude-code coercion |
| 353 | PAN-1816 | S | medium | ok |  |  | Pipeline substrate: Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry — need an ep... |
| 354 | PAN-1795 | M | medium | ok |  |  | Pipeline substrate: Codebase map bootstrapped in planning worktree is never promoted to main (PAN-1788 WI-6 wiring gap) |
| 355 | PAN-1769 | M | medium | ok |  |  | Pipeline substrate: Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + tmux fallback); resumed... |
| 356 | PAN-1558 | M | high | ok |  |  | Pipeline substrate: Review/specialist agents should run in the workspace Docker container, not inherit host-override |
| 357 | PAN-1544 | M | high | ok |  |  | Pipeline substrate: Type cleanup: strip 'ship' from the Role union and its ~10 downstream references |
| 358 | PAN-1452 | M | high | ok |  |  | Harness / model routing: PAN-1381 follow-up: per-reviewer restart with model override (architectural mismatch with PAN-1048) |
| 359 | PAN-1424 | M | high | ok |  |  | Pipeline substrate: Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122) |
| 360 | PAN-1311 | M | high | ok |  |  | Pipeline substrate: Swarm: fast-track tier — skip slot dispatch for trivial mechanical items |
| 361 | PAN-1253 | M | high | ok |  |  | Pipeline substrate: Flywheel: respect issue dependencies before autopicking work |
| 362 | PAN-1198 | M | high | ok |  |  | Workspace + container infra: Workspace init container's bun install doesn't populate container-node-modules named volume |
| 363 | PAN-1196 | M | high | ok |  |  | Pipeline substrate: Workhorse routing by bead difficulty + subject-matter (single-agent and swarm) |
| 364 | PAN-2008 | M | medium | ok |  |  | Pipeline substrate: store-access guard — fail the build on direct store reads outside a domain resolver (PAN-1936 slice) |
| 365 | PAN-2006 | M | medium | ok |  |  | Pipeline substrate: Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Ru... |
| 366 | PAN-2005 | M | medium | ok |  |  | Pipeline substrate: Backlog Sequencer: Pickup Forecast — visualize Flywheel pickup order (waves, lanes, planning bottleneck) |
| 367 | PAN-1852 | M | medium | ok |  |  | Pipeline substrate: Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval data |
| 368 | PAN-1565 | M | medium | ok |  |  | Pipeline substrate: Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #63147) |
| 369 | PAN-1666 | XL | medium | ok | ✓ |  | Pipeline substrate: [EPIC] Pipeline Throughput Hardening — run many work agents safely, on-demand specialists, slot manager, fly.io scale... |
| 370 | PAN-1556 | M | medium | ok |  |  | Pipeline substrate: Session/activity feed: coalesce review-spawn spam, supersede re-reviews per issue, keep active conversations most-recent |
| 371 | PAN-1530 | M | medium | ok |  |  | Pipeline substrate: Investigate: state.json with model='gpt-5.5' (a model that doesn't exist) |
| 372 | PAN-1451 | M | high | ok |  |  | Workspace + container infra: PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift) |
| 373 | PAN-1438 | M | medium | ok |  |  | Pipeline substrate: pan flywheel start launcher process orphans when orchestrator dies externally |
| 374 | PAN-1436 | S | medium | ok |  |  | Pipeline substrate: PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list |
| 375 | PAN-1392 | M | medium | ok |  |  | Pipeline substrate: pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists |
| 376 | PAN-1386 | M | medium | ok |  |  | Pipeline substrate: Flywheel orchestrator never emits status snapshots — dashboard 'flywheel' pane stays blank during an active run |
| 377 | PAN-1330 | M | medium | ok |  |  | Pipeline substrate: CLI cannot address planning-*/specialist-* sessions — pan tell/pan kill hard-code 'agent-' prefix; no 'pan plan abort' |
| 378 | PAN-1240 | M | medium | ok |  |  | Pipeline substrate: Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery |
| 379 | PAN-1227 | M | medium | ok |  |  | Pipeline substrate: Substrate: bead can be closed without delivering the work — add per-bead delivery check in pan done |
| 380 | PAN-1226 | L | medium | ok |  |  | Pipeline substrate: PAN-1148 unified-dashboard redesign — 32 gaps vs PRD and mockups (full audit) |
| 381 | PAN-1173 | M | medium | ok |  |  | Pipeline substrate: pan show <bare-number> derives wrong agent ID for PAN-prefixed issues |
| 382 | PAN-1149 | S | medium | ok |  |  | Harness / model routing: v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves |
| 383 | PAN-1130 | M | medium | ok |  |  | Pipeline substrate: Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart |
| 384 | PAN-1113 | M | medium | ok |  |  | Pipeline substrate: Conversations sidebar lets you message review-specialist sessions, which derails them silently |
| 385 | PAN-578 | M | medium | stale |  |  | Pipeline substrate (stale — re-verify relevance): Comment mediation layer to prevent prompt injection via tracker comments |
| 386 | PAN-262 | L | high | stale |  |  | Pipeline substrate (stale — re-verify relevance): Refactor post-merge lifecycle into composable, idempotent operations |
| 387 | PAN-3558 | M | medium | ok |  |  | Pipeline substrate: Subagent rail: show provider logo and model on each agent row |
| 388 | PAN-3464 | M | medium | ok |  |  | Pipeline substrate: swarm: pan swarm reset does not clear slotCompletions despite 'clear recorded slot state' |
| 389 | PAN-3463 | M | medium | ok |  |  | Pipeline substrate: swarm: a legitimate no-op slot outcome (empty diff) can never pass its item verify — slot wedges permanently |
| 390 | PAN-3460 | M | medium | ok |  |  | Pipeline substrate: swarm: per-item verify_commands that run the full root suite make slot merge gates load-fragile and expensive |
| 391 | PAN-3443 | M | medium | ok |  |  | Pipeline substrate: God View "Spectrum Deck" — Winamp-grade activity visualizer (kimi-code-harness mockup + PRD) |
| 392 | PAN-3335 | M | medium | ok |  |  | Pipeline substrate: click a pasted conversation image to open it full size in a popup |
| 393 | PAN-3280 | M | medium | ok |  |  | Pipeline substrate: PAN-3253's agent sessions vanish repeatedly (4x in one run) and its reviewer died writing no artifact, all silently |
| 394 | PAN-3175 | M | medium | ok |  |  | Pipeline substrate: Model explicit semantic dependencies in merge-train ordering — file overlap cannot see that one feature requires another |
| 395 | PAN-3133 | M | medium | ok |  |  | Pipeline substrate: TRON encoding for prompt-bound xBRIEF payloads |
| 396 | PAN-3132 | L | medium | ok |  |  | Pipeline substrate: Adopt xBRIEF v0.9 agentic dispatch fields end-to-end (deftai/xBRIEF#40 alignment) |
| 397 | PAN-3131 | M | medium | ok |  |  | Pipeline substrate: Support xBRIEF planRef sharding — planning-side authoring and pipeline-wide consumption |
| 398 | PAN-3100 | M | medium | ok |  |  | Pipeline substrate: Test role evaluates the dirty working tree, so a live work agent's uncommitted edits produce false test failures |
| 399 | PAN-3054 | M | medium | ok |  |  | Pipeline substrate: Benchmark matrix: launch one template issue under N configurations and compare cost/time/outcome |
| 400 | PAN-3036 | M | medium | ok |  |  | Pipeline substrate: False '! INPUT' chip on completed strike agents — pane-idle heuristic misreads post-strike-ready idle as a pending qu... |
| 401 | PAN-3034 | M | medium | ok |  |  | Pipeline substrate: Command Deck session tree misses strike-only and workspace-less issues (no strike node for PAN-3031) |
| 402 | PAN-3032 | M | medium | ok |  |  | Workspace + container infra: Workspace stack rebuild composes under 'overdeck-feature-' prefix while Traefik labels reference 'myn-featur... |
| 403 | PAN-2983 | M | medium | ok |  |  | Pipeline substrate: OKF v3 deferred capabilities: lease-based concurrent write mode + LLM semantic auditor |
| 404 | PAN-2982 | M | medium | ok |  |  | Pipeline substrate: Review convoy should run skill selftests when sync-sources/skills/** changes |
| 405 | PAN-2978 | M | medium | ok |  | PAN-2976, PAN-2977 | Pipeline substrate: Auto-install ACP agent CLIs from the setup UI (opt-in, per-agent install recipes) |
| 406 | PAN-2977 | M | medium | ok |  | PAN-2976 | Pipeline substrate: ACP agent setup UI: detect installed ACP CLIs, show auth status, and guide login from Settings |
| 407 | PAN-2976 | L | medium | ok |  |  | Pipeline substrate: Generalize the ACP harness: any ACP-capable agent CLI as a spawnable runtime (named adapters + custom-agent config) |
| 408 | PAN-2935 | M | medium | ok |  |  | Workspace + container infra: Workspace devcontainer duplicate backend hijacks Traefik router — 50% of API calls 504 |
| 409 | PAN-2922 | M | medium | ok |  |  | Pipeline substrate: Reduce accidental orchestration complexity after performance stabilization |
| 410 | PAN-2883 | M | medium | ok |  |  | Pipeline substrate: Close-out deploy row fails for every strike-landed issue — PR resolver hardcodes feature/ branch, can't find strike/ PRs |
| 411 | PAN-2754 | S | medium | ok |  |  | Pipeline substrate: `always` is inert — it behaves exactly like `auto`, contradicting the documented spec |
| 412 | PAN-2718 | S | medium | ok |  |  | Pipeline substrate: pan restart needs a first-class no-dialog reconciliation flag — autonomous restarts must not park a dialog on the ope... |
| 413 | PAN-2356 | L | medium | ok |  |  | CI / quality gate: Overdeck Anywhere P3: relay service — outbound-only daemon, GitHub OAuth, push origin, multi-tenant front door |
| 414 | PAN-1915 | M | medium | ok |  |  | Security hardening: API key at-rest hardening — startup perm check + OS keychain + deprecate plaintext |
| 415 | PAN-1767 | M | high | ok |  |  | Dashboard / operator UX: Show merged-but-not-closed-out count in pan status and the dashboard headline |
| 416 | PAN-1150 | M | medium | ok |  |  | Harness / model routing: Settings: "Anthropic is not configured" warning persists in Model Routing after claude /login (Provider tab disa... |
| 417 | PAN-1027 | M | medium | ok |  |  | Pipeline substrate: Merge-status drift: deacon auto-detect paths set mergeStatus=merged without postMergeLifecycle, never reset on revert |
| 418 | PAN-630 | L | high | ok |  |  | Pipeline substrate: Multi-tenant workspace isolation with ACLs |
| 419 | PAN-2680 | M | medium | ok |  |  | Pipeline substrate: pan close: Docker teardown silently skips a running stack in multi-repo projects (MYN), aborting close-out |
| 420 | PAN-2678 | M | medium | ok |  |  | Pipeline substrate: clean blocked state worktrees, fix auricle git-status failure, restore the Deacon (2026-07-14 review outage) |
| 421 | PAN-2662 | M | medium | ok |  |  | Pipeline substrate: Add project context-menu actions scoped to issues currently in the pipeline |
| 422 | PAN-2651 | S | medium | ok |  |  | Pipeline substrate: simplify lifecycle reconciliation and add a safe post-planning reset |
| 423 | PAN-2646 | M | medium | ok |  |  | Pipeline substrate: configurable global/project/issue policy UI with default OFF |
| 424 | PAN-2628 | M | medium | ok |  |  | Pipeline substrate: pan close aborts at close-issue:transition: "No tracker available and cannot determine issue type" for GitHub-tracker... |
| 425 | PAN-2629 | M | medium | ok |  |  | Pipeline substrate: pan start kickoff delivery never lands: "Claude Code did not become ready within 30s" (both attempts), agent sits idl... |
| 426 | PAN-2622 | M | medium | ok |  |  | Pipeline substrate: cloister.toml materializes ALL defaults into the user file — default changes in code never reach existing installs |
| 427 | PAN-2557 | M | medium | ok |  |  | Pipeline substrate: project-level 'Restart All' context action — restart every agent in a project, throttled by the PAN-2500 memory governor |
| 428 | PAN-2526 | L | medium | ok |  |  | Pipeline substrate: Refactor deacon.ts below file-size baseline |
| 429 | PAN-2489 | S | medium | ok |  |  | Pipeline substrate: strike agents are invisible in the project issue tree — needs-you pings with no node to click |
| 430 | PAN-2484 | S | medium | ok |  |  | Pipeline substrate: ready set misses merge-eligible issues without flywheel merge verbs — eligibility sweep added; verb-coverage prompt r... |
| 431 | PAN-2469 | M | medium | ok |  |  | Pipeline substrate: issue-level assembly owner — 'all slots done' must deterministically trigger assemble → verify → review (root cause o... |
| 432 | PAN-2466 | S | medium | ok |  |  | Pipeline substrate: close-out/record writer clobbers closeOut.usage with EMPTY data — cost history lost on the local side (recurring) |
| 433 | PAN-2428 | S | medium | ok |  |  | Pipeline substrate: MYN workspace Traefik routing broken post-rebrand — legacy 'panopticon' network + missing traefik.docker.network labe... |
| 434 | PAN-2423 | S | medium | ok |  |  | Pipeline substrate: pan workspace rebuild hardcodes 'overdeck-' compose project prefix — mismatches project templates and verification co... |
| 435 | PAN-2414 | S | medium | ok |  |  | Pipeline substrate: context-overflow recovery is inconsistent — some agents get the PAN-1781 compact-respawn, others hit the PAN-1980 rot... |
| 436 | PAN-2408 | S | medium | ok |  |  | Pipeline substrate: pan start --auto commits the spec to main AFTER creating the worktree — agent's own workspace lacks its spec, causing... |
| 437 | PAN-2406 | M | medium | ok |  |  | Pipeline substrate: close-out gaps: verify-merged rejects record-only deltas; slot/suffixed worktrees never torn down; teardown abort fir... |
| 438 | PAN-2399 | M | medium | ok |  |  | Pipeline substrate: wire replay_threshold/compaction_reroute into the slot-recovery respawn seam (PAN-2397 W3b) |
| 439 | PAN-2395 | S | medium | ok |  |  | Pipeline substrate: one invalid tiered_execution enum poisons every config read — live conversations falsely marked ended, resume/new-con... |
| 440 | PAN-2347 | M | medium | ok |  |  | Pipeline substrate: refresh AGENT-STATE-PLANES.md — update, harden, make useful |
| 441 | PAN-2346 | M | medium | ok |  |  | Pipeline substrate: refresh AGENT_TYPES_INDEX.md — update, harden, make useful |
| 442 | PAN-2345 | M | medium | ok |  |  | Pipeline substrate: refresh pan-done.md — update, harden, make useful |
| 443 | PAN-2344 | M | medium | ok |  |  | Pipeline substrate: refresh KANBAN-MODEL.md — update, harden, make useful |
| 444 | PAN-2308 | L | medium | ok |  |  | Pipeline substrate: migrate stale generated compose files off PORT=3011 + deacon quarantine for deterministic container boot refusals (fo... |
| 445 | PAN-2295 | L | medium | ok |  |  | Pipeline substrate: built-in web browser surface (openable like terminal/Claude Code/Codex) + native Agentation integration |
| 446 | PAN-2266 | M | medium | ok |  |  | Pipeline substrate: add zcode harness and make it the default for glm-5.2 |
| 447 | PAN-2213 | M | medium | ok |  |  | Pipeline substrate: Swarm slot allocator picks an orphaned slot index and refuses instead of skipping to the next free one |
| 448 | PAN-2212 | M | medium | ok |  |  | Pipeline substrate: Swarm slot dispatch has no reserved budget — a busy pipeline starves it to zero |
| 449 | PAN-2211 | M | medium | ok |  |  | Pipeline substrate: PAN-2203 follow-up: swarm slot pan done records completion but slot never becomes merge-ready |
| 450 | PAN-2210 | M | medium | ok |  |  | Pipeline substrate: PAN-2203 follow-up: a swarm slot's completion can trigger the issue-level review pipeline |
| 451 | PAN-2201 | S | medium | ok |  |  | Pipeline substrate: Close-out label step fails atomically when a hardcoded label (e.g. 'in-planning') is absent from the repo — closed is... |
| 452 | PAN-2197 | S | medium | ok |  |  | Pipeline substrate: work agents skip `pan done` (manual push instead) — sandbox blocks its GitHub calls; idle agents spuriously 'troubled' |
| 453 | PAN-2074 | M | medium | ok |  |  | Pipeline substrate: evaluate ponytail (DietrichGebert/ponytail) for prompt compression and consider building in-house |
| 454 | PAN-2065 | M | medium | ok |  |  | Pipeline substrate: unified usage & headroom panel across all provider plans (z.ai, Anthropic, Codex, OpenRouter) |
| 455 | PAN-2046 | M | medium | ok |  |  | Pipeline substrate: Conversation view does not surface terminal command responses |
| 456 | PAN-681 | M | medium | ok |  |  | Pipeline substrate: Feedback routing: wrong issueId written to workspace when verification runs for co-active issues |
| 457 | PAN-2980 | S | medium | ok |  |  | CI / quality gate: pre-push file-size guard audits the dirty working tree, so another session's uncommitted edits block unrelated pushes |
| 458 | PAN-2004 | M | medium | ok |  |  | Pipeline substrate: Resumable Planning node: double-click a planned issue's Planning to resume the planning agent |
| 459 | PAN-1995 | L | medium | ok |  |  | Pipeline substrate: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only) |
| 460 | PAN-1988 | M | medium | ok |  |  | Pipeline substrate: Verdict signaling: one host-owned write door; agents journal, host owns the DB cache |
| 461 | PAN-1986 | S | medium | ok |  |  | Pipeline substrate: restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row |
| 462 | PAN-1985 | M | medium | ok |  |  | Pipeline substrate: Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation |
| 463 | PAN-1980 | M | medium | ok |  |  | Pipeline substrate: Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses |
| 464 | PAN-1967 | M | medium | ok |  |  | Pipeline substrate: Flywheel must re-validate (re-plan) pre-cutover plans before implementing them |
| 465 | PAN-1965 | M | medium | ok |  |  | Pipeline substrate: Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue) |
| 466 | PAN-1958 | M | medium | ok |  |  | Pipeline substrate: Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source) |
| 467 | PAN-1949 | M | medium | ok |  |  | Pipeline substrate: Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all item verdicts |
| 468 | PAN-1936 | M | medium | ok |  |  | Pipeline substrate: Single source-of-truth reads — one canonical resolver per domain (consolidate the 280+ scattered read endpoints) |
| 469 | PAN-1926 | S | medium | ok |  |  | Pipeline substrate: --big flag to lift strike's precision-only scope guard (operator-authorized larger strikes) |
| 470 | PAN-1916 | M | medium | ok |  |  | Pipeline substrate: configurable web search providers (Exa, Tavily, Brave, Perplexity) |
| 471 | PAN-1914 | M | medium | ok |  |  | Pipeline substrate: Follow-up: move /api/health/agents off agent-directory scans |
| 472 | PAN-1895 | M | medium | ok |  |  | Pipeline substrate: Spawn work agents from issue workspace slide-out |
| 473 | PAN-1878 | M | medium | ok |  |  | Pipeline substrate: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts |
| 474 | PAN-1854 | M | medium | ok |  |  | Pipeline substrate: Define handoff strategy for large conversations: external vs source authoring + tail-biased read |
| 475 | PAN-1840 | M | medium | ok |  |  | Pipeline substrate: Add 'pan switch <id>' — change a running agent's model/harness in one command (kill + fresh-start + re-onboard) |
| 476 | PAN-1774 | S | medium | ok |  |  | Pipeline substrate: workspace server container crashloops when dist/dashboard/server.js is missing |
| 477 | PAN-1773 | M | medium | ok |  |  | Pipeline substrate: Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762) |
| 478 | PAN-1755 | S | medium | ok |  |  | Pipeline substrate: uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agents racing the next gene... |
| 479 | PAN-1751 | M | medium | ok |  |  | Pipeline substrate: harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flywheel |
| 480 | PAN-1750 | M | medium | ok |  |  | Pipeline substrate: UAT assembly/conflict agent — observability surfaces + configurable harness/model (default gpt-5.5 via Codex) |
| 481 | PAN-1748 | M | medium | ok |  |  | Pipeline substrate: reuse uat-assembly conflict resolutions across generations (rerere or resolution replay) |
| 482 | PAN-1740 | M | medium | ok |  |  | Pipeline substrate: Deacon mislabels SIGTERM workspace container restarts as crashes |
| 483 | PAN-1735 | M | medium | ok |  |  | Pipeline substrate: adopt externally-completed readyForMerge issues into the pipeline/merge queue |
| 484 | PAN-1728 | S | medium | ok |  |  | Pipeline substrate: PAN-1700 agent committed .pan/specs/*.vbrief.json mutations — PAN-1124 immutability violated on feature branch |
| 485 | PAN-1691 | M | medium | ok |  |  | Pipeline substrate: conflict-aware merge train + on-demand UAT candidate — stop the rebase-cascade that strands ready PRs |
| 486 | PAN-1676 | M | medium | ok |  |  | Pipeline substrate: harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots) |
| 487 | PAN-1674 | M | medium | ok |  |  | Workspace + container infra: TLDR .venv (~7.5G) is duplicated into every workspace — 236G across 33 worktrees, caused disk-full ENOSPC |
| 488 | PAN-1668 | S | medium | ok |  |  | Pipeline substrate: right-click 'restart with <model>' carries model only, never harness — can't move a review off Kimi |
| 489 | PAN-1667 | M | medium | ok |  |  | Pipeline substrate: unify Agents + Resources into one issue-centric holistic view |
| 490 | PAN-1657 | M | medium | ok |  |  | Pipeline substrate: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer |
| 491 | PAN-1655 | M | medium | ok |  |  | Pipeline substrate: Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly |
| 492 | PAN-1653 | M | medium | ok |  |  | Pipeline substrate: batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace) |
| 493 | PAN-1640 | L | medium | ok |  |  | Pipeline substrate: Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic) |
| 494 | PAN-1627 | M | medium | ok |  |  | Pipeline substrate: Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridable by Pr... |
| 495 | PAN-1624 | M | medium | ok |  |  | Workspace + container infra: pan handoff --author external: authored doc is socket_write-ten but never submitted — successor sits at empt... |
| 496 | PAN-1581 | M | medium | ok |  |  | Pipeline substrate: Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled across ... |
| 497 | PAN-1254 | L | high | ok |  |  | Workspace + container infra: Tailscale integration: advertise dashboard + workspace endpoints over tailnet (Effect-native) |
| 498 | PAN-334 | M | medium | ok |  |  | Pipeline substrate: Dashboard server has no duplicate-process protection — zombie instances cause 502 |
| 499 | PAN-324 | M | medium | ok |  |  | Pipeline substrate: Agent detail pane missing Merge/Approve button |
| 500 | PAN-304 | M | medium | stale |  |  | Pipeline substrate (stale — re-verify relevance): closeLinearDirect returns stepOk even when state update never happens |
| 501 | PAN-2553 | S | medium | ok |  |  | CI / quality gate: project-level CI visibility — surface repo/main-branch workflow runs on the Command Deck with click-through to logs |
| 502 | PAN-2505 | S | medium | ok |  |  | CI / quality gate: lint:circular reports new frontend cycles + stale baseline in chat/conversations components |
| 503 | PAN-2501 | S | medium | ok |  |  | CI / quality gate: deleteResourceVenvEffect's HttpRouter.schemaParams call fails typecheck under the root tsconfig (masked by src/dashboa... |
| 504 | PAN-2487 | S | medium | ok |  |  | CI / quality gate: CI-green merge skip + Ship & Merge cockpit view (live door log + progress) + active-node spinner |
| 505 | PAN-2358 | M | high | ok |  |  | Planning / xBRIEF: PAN-2145 follow-up: restore PAN-1535 hardening in transformMessageForHarness (rewritten during conversations.ts decomp... |
| 506 | PAN-1550 | M | medium | ok |  |  | Pipeline substrate: FilesPane + BrowserPane — file browser and embedded web view implementation details |
| 507 | PAN-1545 | M | medium | ok |  |  | Pipeline substrate: New Terminal button — spawn ad-hoc bash sessions from sidebar / conversation / drawer / palette |
| 508 | PAN-1542 | M | medium | ok |  |  | Pipeline substrate: Spawn-refusal modal: render the three-button workflow on dirty-workspace 409 |
| 509 | PAN-1490 | M | medium | ok |  |  | Pipeline substrate: show each conversation's current git branch (port t3code BranchToolbar pattern) |
| 510 | PAN-1489 | M | medium | ok |  |  | Pipeline substrate: tune v1.0 readiness criteria after 30 days of telemetry |
| 511 | PAN-1444 | M | medium | ok |  |  | Workspace + container infra: Follow-up to PAN-1416: dashboard port lockfile + pan doctor multi-instance check |
| 512 | PAN-1437 | M | medium | ok |  |  | Pipeline substrate: pan flywheel report semantics: split read-only snapshot from run finalization |
| 513 | PAN-1432 | S | medium | ok |  |  | Pipeline substrate: Merge agent leaves packages/contracts/dist stale — typecheck breaks on every fresh checkout |
| 514 | PAN-1356 | M | medium | ok |  |  | Pipeline substrate: Extend the memory Observation pipeline to ad-hoc conversations |
| 515 | PAN-1245 | M | medium | ok |  |  | Pipeline substrate: Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report) |
| 516 | PAN-1244 | M | medium | ok |  |  | Pipeline substrate: pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server |
| 517 | PAN-1222 | M | medium | ok |  |  | Pipeline substrate: Project-templated DB lifecycle: auxiliary databases + seed refresh from prod |
| 518 | PAN-1165 | M | medium | ok |  |  | Pipeline substrate: Lightweight review path for small/trivial PRs |
| 519 | PAN-1154 | M | medium | ok |  |  | Pipeline substrate: pan up does not kill existing port holders — startup races against orphan dashboard servers |
| 520 | PAN-1136 | M | medium | ok |  |  | Pipeline substrate: Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency |
| 521 | PAN-1135 | M | medium | ok |  |  | Pipeline substrate: Document the hook system in docs/HOOKS.md |
| 522 | PAN-1133 | L | medium | ok |  |  | Pipeline substrate: TLDR: deacon supervision + pan doctor check + GC |
| 523 | PAN-1129 | M | medium | ok |  |  | Workspace + container infra: Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977' |
| 524 | PAN-1126 | M | medium | ok |  |  | Pipeline substrate: Integrate TLDR summaries into review context manifest |
| 525 | PAN-1124 | M | medium | ok |  |  | Pipeline substrate: Decouple specs and PRDs from workspaces — write directly to main |
| 526 | PAN-1121 | M | low | ok |  |  | Pipeline substrate: Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction |
| 527 | PAN-1066 | M | low | ok |  |  | Pipeline substrate: Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module |
| 528 | PAN-1064 | M | low | ok |  |  | Pipeline substrate: Harden launcher generation against shell-quote injection (model and arg quoting) |
| 529 | PAN-247 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Deacon has no backoff or escalation for repeated specialist startup failures |
| 530 | PAN-3355 | S | low | ok |  |  | Workspace + container infra: sessionExists maps a probe failure to absence, so callers read 'not running' when liveness is unknown |
| 531 | PAN-3354 | S | low | ok |  |  | Workspace + container infra: archiving the main workspace hides the singleton row with no UI recovery path |
| 532 | PAN-3017 | M | low | ok |  |  | Workspace + container infra: Issue-page UAT panel: expose the full stack action menu and show the panel consistently |
| 533 | PAN-3015 | M | low | ok |  |  | Workspace + container infra: pan monitor: pull-based background inbox transport for Claude Code sessions |
| 534 | PAN-2809 | M | low | ok |  |  | Workspace + container infra: Live-terminal Playwright UAT blocked in containerized workspaces (node-pty musl/glibc mismatch + Vite/Traefi... |
| 535 | PAN-2027 | M | high | ok |  |  | Harness / model routing: ohmypi: route kimi-k2 through ohmypi harness instead of CLIProxy (eliminates 200k-window illusion) |
| 536 | PAN-1710 | S | low | ok |  |  | CI / quality gate: 'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 and feature/pan-164... |
| 537 | PAN-1654 | S | low | ok |  |  | CI / quality gate: run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace) |
| 538 | PAN-1641 | M | low | ok |  |  | Harness / model routing: Run agents on local GPU models via a managed Ollama sidecar |
| 539 | PAN-1533 | M | low | ok |  |  | Workspace + container infra: Fork-into-worktree from conversation branch chip |
| 540 | PAN-1166 | M | low | ok |  |  | Security hardening: Re-introduce /ws/terminal auth gate with a working bootstrap path |
| 541 | PAN-1060 | M | low | ok |  |  | Pipeline substrate: Self-modify permission handling: stop the interrupt loop without weakening the safety guard |
| 542 | PAN-1041 | M | low | ok |  |  | Pipeline substrate: Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template |
| 543 | PAN-1040 | M | low | ok |  |  | Pipeline substrate: event-driven dispatch for inspect-agent (requiresInspection=true beads) |
| 544 | PAN-1037 | M | low | ok |  |  | Pipeline substrate: Retire 'planning-' tmux prefix — fold into agent-PAN-N keyed by phase |
| 545 | PAN-962 | M | low | ok |  |  | Pipeline substrate: Post-PAN-946: vBRIEF lifecycle follow-up plan |
| 546 | PAN-961 | M | low | ok |  |  | Pipeline substrate: Update documentation for vBRIEF v0.6 lifecycle model |
| 547 | PAN-938 | M | low | ok |  |  | Pipeline substrate: Fizzy visual pipeline — Kanban mirror for specialist pipeline |
| 548 | PAN-932 | M | low | ok |  |  | Workspace + container infra: pan done: polyrepo uncommitted changes check + existing MR handling |
| 549 | PAN-927 | M | low | ok |  |  | Pipeline substrate: Rewrite containerize route: dead code, orphan processes, no pending-op tracking |
| 550 | PAN-908 | M | low | ok |  |  | Pipeline substrate: PAN-908: Make work-agent spawn limits configurable and overridable |
| 551 | PAN-898 | M | low | ok |  |  | Pipeline substrate: Dashboard polling and WebSocket efficiency: remaining audit findings |
| 552 | PAN-853 | L | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration |
| 553 | PAN-833 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential l... |
| 554 | PAN-832 | S | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents dro... |
| 555 | PAN-810 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Inspector: diagnostic UI when pipeline phase is unknown |
| 556 | PAN-802 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Resume on conversation session forks instead of resuming |
| 557 | PAN-786 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Post planning Q\&A answers as issue comment |
| 558 | PAN-778 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Write conflict race: review-agent fails when test-agent write scope not yet released |
| 559 | PAN-777 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Inter-agent communication skill: send messages to conversation-mode agents |
| 560 | PAN-774 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Unify launch UX and release pipeline for 1.0 — npx panctl, lazy prereqs, cross-platform... |
| 561 | PAN-771 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Investigate Vercel Sandbox execution backend support |
| 562 | PAN-113 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Dashboard 'Start Agent' returns success before verifying agent actually started |
| 563 | PAN-49 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Fix CloisterService tests that require real runtime |
| 564 | PAN-2767 | M | low | ok |  |  | Harness / model routing: Expose Codex app-server conversation controls in the dashboard |
| 565 | PAN-2533 | M | low | ok |  |  | Workspace + container infra: UAT workspace magic-link login 502: Traefik picks unreachable panopticon IP for multi-homed fe/api |
| 566 | PAN-2288 | M | low | ok |  |  | Workspace + container infra: tmux managed-server: lossless auto-migration of dirty-founded servers + boot-time ensure call (PAN-1798 foll... |
| 567 | PAN-2085 | M | low | ok |  |  | Workspace + container infra: Auto-isolate conversations in a lightweight git worktree (Conductor-style workspaces) |
| 568 | PAN-2084 | M | low | ok |  |  | Workspace + container infra: Auto-create lightweight conversation worktrees on project chats |
| 569 | PAN-1758 | M | low | ok |  |  | Memory + knowledge: Watch: ready-for-merge work must converge despite a continuously moving main |
| 570 | PAN-1572 | S | low | ok |  |  | CI / quality gate: Settings permission-mode can desync from resolved config — agents silently use --dangerously-skip-permissions despite ... |
| 571 | PAN-1435 | M | low | ok |  |  | Harness / model routing: API keys in ~/.panopticon/config.yaml stored as plaintext |
| 572 | PAN-1151 | M | low | ok |  |  | Harness / model routing: Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating |
| 573 | PAN-749 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Research and borrow best features from gstack |
| 574 | PAN-736 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): wire per-subagent model overrides from settings to Claude Code spawn env |
| 575 | PAN-735 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Settings page: review and configure overridden subagent model files |
| 576 | PAN-727 | M | low | needs-refinement |  |  | Pipeline substrate (needs refinement): Fix orphaned work-agent start handoff after planning |
| 577 | PAN-709 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): self-improving flywheel — retro agent, skill-change pipeline, audience-scoped skills, Q... |
| 578 | PAN-701 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Quick-Create conversation via keystroke using Conversations-page default model |
| 579 | PAN-687 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Support OpenCode as alternative coding agent |
| 580 | PAN-678 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): pan work issue --auto: headless planning → agent handoff without interactive dialog |
| 581 | PAN-675 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window re... |
| 582 | PAN-654 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Project Setup Wizard — Dashboard UI |
| 583 | PAN-646 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Canceled issues: add guided Recover workflow |
| 584 | PAN-637 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Direct issue kickoff (skip planning) from dashboard UI |
| 585 | PAN-629 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Workspace quotas and resource governance |
| 586 | PAN-624 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Loop nodes: iterative agent execution with conditional termination |
| 587 | PAN-622 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): YAML workflow DAGs: custom per-project pipeline definitions |
| 588 | PAN-613 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Investigate thinking effort levels for agents — reduce signature corruption frequency |
| 589 | PAN-607 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Evaluate Ultimate Bug Scanner (UBS) for verification gate |
| 590 | PAN-606 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Evaluate MCP Agent Mail for inter-agent communication and file reservations |
| 591 | PAN-604 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Hide planning agent from workspace detail pane |
| 592 | PAN-603 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Plan review loop with configurable reviewer model |
| 593 | PAN-537 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): show changed files diff summary after each agent response in activity view |
| 594 | PAN-531 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): PAN: Windows Electron support (WSL2 required) |
| 595 | PAN-483 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Unify Resume Agent UX — all entry points should show message input |
| 596 | PAN-480 | S | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Pass --effort flag when spawning planning agents via Cloister |
| 597 | PAN-476 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Agent resume with Haiku session summary instead of claude --resume |
| 598 | PAN-471 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Cost reconciler: auto-trigger on agent lifecycle events with debounce |
| 599 | PAN-468 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Agent test conversations pollute production database — need test isolation |
| 600 | PAN-466 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex |
| 601 | PAN-461 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Deep-wipe multi-step progress dialog |
| 602 | PAN-459 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Planning setup screen with SSE progress streaming |
| 603 | PAN-2354 | M | low | ok |  | PAN-2351 | Harness / model routing: Overdeck Anywhere P1c: needs-you push notification bridge (ntfy first, Web Push later) |
| 604 | PAN-2351 | M | low | ok |  | PAN-1166 | Harness / model routing: Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats (security prerequisites) |
| 605 | PAN-1968 | S | low | ok |  |  | Workspace + container infra: Finish local-domain rename: pan.localhost → overdeck.localhost |
| 606 | PAN-1761 | S | low | ok |  |  | Workspace + container infra: conversations endpoints fetched via relative /api path — 403 inside workspace/UAT containers (session cookie... |
| 607 | PAN-1673 | M | low | ok |  |  | Harness / model routing: Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously) |
| 608 | PAN-1669 | S | low | ok |  |  | Workspace + container infra: restart-with-model doesn't emit a live event — issue tree shows stale model until manual refresh |
| 609 | PAN-1538 | M | high | ok |  |  | Harness / model routing: Unblock Pi source forks — remove API guard, verify transcript parsers |
| 610 | PAN-1246 | M | high | ok |  |  | Harness / model routing: projection-cached VCS driver for diff/checkpoint reads (port of t3code #2586) |
| 611 | PAN-1142 | M | high | ok |  |  | Harness / model routing: Add reasoning effort level to per-role / per-conversation model config |
| 612 | PAN-2950 | L | low | ok |  |  | Memory + knowledge: Refactor god files back under file-size ceilings after the UX overhaul |
| 613 | PAN-2243 | M | low | ok |  |  | Planning / xBRIEF: pan plan finalize: CLI aborts complete-planning at 90s while the server handler legitimately finishes later (false ✖ F... |
| 614 | PAN-2242 | M | low | ok |  |  | Planning / xBRIEF: Unidentified duplicate caller fires complete-planning in pairs every ~2 minutes (perpetual loop while session survives) |
| 615 | PAN-2241 | S | low | ok |  |  | Planning / xBRIEF: complete-planning is not serialized or idempotent per issue (spec tmp-rename 500s, bead delete-recreate thrash) |
| 616 | PAN-2202 | M | low | ok |  |  | Planning / xBRIEF: complete-planning silently skips spec promotion on a dead session's unanswered AskUserQuestion — and finalize reports ... |
| 617 | PAN-2071 | M | low | ok |  |  | Pipeline substrate: add user-facing page for the Hooks system |
| 618 | PAN-2070 | M | low | ok |  |  | Pipeline substrate: add user-facing page for the Flywheel orchestrator |
| 619 | PAN-2068 | M | low | ok |  |  | Pipeline substrate: add user-facing page for Caveman (agent output compression) |
| 620 | PAN-2067 | M | low | ok |  |  | Pipeline substrate: add user-facing page for RTK (Bash output compression) |
| 621 | PAN-1223 | M | low | ok |  |  | Dashboard / operator UX: Auto-update for users in the field (npm + desktop binaries) |
| 622 | PAN-1208 | M | low | ok |  |  | Workspace + container infra: Polyrepo: support non-feature 'main' workspaces alongside feature-* |
| 623 | PAN-1153 | M | low | ok |  |  | Workspace + container infra: Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' — breaks pan dev proxy |
| 624 | PAN-1152 | M | low | ok |  |  | Workspace + container infra: Remove PANOPTICON_DEV env-var persistence — derive Traefik mode from the running command |
| 625 | PAN-1123 | M | low | ok |  |  | Workspace + container infra: Channels delivery: surface failures, add fallback toggle, route conversations through channels |
| 626 | PAN-1068 | M | low | ok |  |  | Harness / model routing: PAN-1048 deferred findings: security, correctness, and model validation gaps |
| 627 | PAN-1063 | M | low | ok |  |  | Security hardening: Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound |
| 628 | PAN-713 | S | low | stale |  |  | CI / quality gate (stale — re-verify relevance): add unit tests for doneCommand and approveCommand |
| 629 | PAN-299 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Granular session state persistence across context compaction |
| 630 | PAN-293 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Project Living Memory — per-project semantic memory for agents |
| 631 | PAN-283 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Reset should sync workspace feature branch with latest main |
| 632 | PAN-265 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Review skill categorization: all skills available everywhere via personal + workspace |
| 633 | PAN-255 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Agents lack awareness of MCP tools — sync MCP config and inject into prompts |
| 634 | PAN-244 | M | low | stale |  |  | Workspace + container infra (stale — re-verify relevance): Deep-wipe leaves local branch and worktree metadata behind |
| 635 | PAN-228 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Shift-left post-edit diagnostics — type check after every edit |
| 636 | PAN-227 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Phase gate validation — mid-implementation acceptance checks |
| 637 | PAN-3333 | M | low | ok |  |  | Harness / model routing: relative plan-drain indicator on model pickers — show which sibling model burns subscription quota fastest |
| 638 | PAN-3190 | M | high | ok |  |  | Feature: pan merge cancel is 100% broken: Commander passes its options object into the fetchImpl injection slot (merge.ts:56) |
| 639 | PAN-3011 | M | low | ok |  |  | Harness / model routing: Support poolside Laguna S 2.1 (118B MoE, 1M ctx) — local via Ollama/vLLM, hosted via OpenRouter |
| 640 | PAN-2755 | S | low | ok |  |  | Harness / model routing: per-issue review-model override never reached convoy sub-reviewers on the discovery-fork path |
| 641 | PAN-2609 | M | low | ok |  |  | Planning / xBRIEF: Cross-device sync of conversations and tasks via user-owned git remote |
| 642 | PAN-2444 | L | low | ok |  |  | Planning / xBRIEF: optional SageOx re-integration — session-reasoning capture for OSS projects (per-project opt-in, v0.11-era ox) |
| 643 | PAN-1683 | S | low | ok |  |  | Pipeline substrate: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md) — strike kee... |
| 644 | PAN-1561 | M | high | ok |  |  | Planning / xBRIEF: Project-scoped dashboard nav (deck of tabs per project + conversations/tree column + activity feed) |
| 645 | PAN-1242 | M | low | ok |  |  | Planning / xBRIEF: Create a new issue directly from a kanban column |
| 646 | PAN-1164 | M | low | ok |  |  | Memory + knowledge: Conversation diff summaries update live over WebSocket (drop 5s polling) |
| 647 | PAN-1051 | M | low | ok |  |  | Workspace + container infra: Subspace-inspired alternate theme with Inter + JetBrains Mono |
| 648 | PAN-900 | M | low | ok |  |  | Harness / model routing: Trust devroot for conversations + atomic .claude.json writes |
| 649 | PAN-775 | L | low | stale |  |  | Workspace + container infra (stale — re-verify relevance): Redesign workspace inspector panel: sidebar layout is cramped and wrong |
| 650 | PAN-772 | M | low | stale |  |  | Workspace + container infra (stale — re-verify relevance): Unify terminal stack behavior across tmux sessions |
| 651 | PAN-198 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Structured audit trail for agent actions |
| 652 | PAN-190 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): PAN-190: Specialized reviewer prompts (industry best-practice checklists) |
| 653 | PAN-180 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): PAN-180: Cross-terminal file locking for concurrent agents |
| 654 | PAN-178 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): PAN-178: Crash recovery with granular task checkpointing |
| 655 | PAN-177 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): PAN-177: Iteration limits with escalation for autonomous agents |
| 656 | PAN-176 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): PAN-176: Hook-enforced delegation guardrails for specialist agents |
| 657 | PAN-175 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): PAN-175: Pre-compact auto-save hook for agent sessions |
| 658 | PAN-155 | L | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): PAN-155: Redesign health page with Stitch (system overview, timeline, costs) |
| 659 | PAN-77 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Cost breakdown modal: show costs by stage and model when clicking cost badge |
| 660 | PAN-55 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Track specialist costs with time period filtering |
| 661 | PAN-54 | L | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Add pan test:e2e command for full workflow integration test |
| 662 | PAN-47 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): PRD files should be committed to feature branch, moved to completed/ on merge |
| 663 | PAN-43 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Add Slack and email notifications for agent events |
| 664 | PAN-38 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Support multiple merge agents per repository |
| 665 | PAN-37 | M | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Support external PR selection for merge-agent |
| 666 | PAN-2679 | M | low | ok |  |  | Harness / model routing: conv-lookup skill: resolve transcripts for codex and pi harness conversations |
| 667 | PAN-2626 | M | low | ok |  |  | Harness / model routing: allow composer model switching within the same model family (e.g. Sonnet → Fable) |
| 668 | PAN-2600 | M | low | ok |  |  | Harness / model routing: Retire the Codex TUI path after app-server burn-in (no-loss audit gate) — follow-up to PAN-2597 |
| 669 | PAN-2527 | M | low | ok |  |  | Harness / model routing: Harness selector should restrict OpenAI models to Claude Code only |
| 670 | PAN-2035 | M | low | ok |  |  | Harness / model routing: ohmypi: GitHub Copilot subscription provider routing via omp |
| 671 | PAN-2034 | L | low | ok |  |  | Harness / model routing: ohmypi: end-to-end test that tool-call steps render in Conversation panel |
| 672 | PAN-2033 | M | low | ok |  |  | Harness / model routing: ohmypi: benchmark FIFO vs paste-buffer message delivery latency |
| 673 | PAN-2032 | M | low | ok |  |  | Harness / model routing: ohmypi: local Ollama model as zero-cost preliminary review role |
| 674 | PAN-2031 | M | low | ok |  |  | Harness / model routing: ohmypi: add Bun 1.3.11 regression test to checkOhmypi doctor gate |
| 675 | PAN-2030 | M | low | ok |  |  | Harness / model routing: ohmypi: version-pin extension in package.json and pan doctor mismatch warning |
| 676 | PAN-2029 | M | low | ok |  |  | Harness / model routing: ohmypi: capture kimi thinking_tokens in ohmypi-parser for complete cost accounting |
| 677 | PAN-2028 | M | low | ok |  |  | Harness / model routing: ohmypi: per-provider cost grouping in cost dashboard |
| 678 | PAN-2026 | M | low | ok |  |  | Harness / model routing: ohmypi: surface 35+ provider matrix in dashboard model picker |
| 679 | PAN-2025 | M | low | ok |  |  | Harness / model routing: ohmypi: extend provider credential passthrough for Groq, Cerebras, Fireworks |
| 680 | PAN-2024 | M | low | ok |  |  | Harness / model routing: ohmypi: frontend Tools-toggle for conversation view |
| 681 | PAN-1449 | M | low | ok |  |  | Planning / xBRIEF: PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec |
| 682 | PAN-1433 | M | low | ok |  |  | Planning / xBRIEF: Conversation agents can leave host main repo in abandoned git rebase state for hours |
| 683 | PAN-700 | M | low | stale |  |  | Workspace + container infra (stale — re-verify relevance): Detachable terminal for conversation view — popout into OS window |
| 684 | PAN-663 | M | low | stale |  |  | Workspace + container infra (stale — re-verify relevance): Workspace frontend containers not auto-started for panopticon-cli self-hosted ... |
| 685 | PAN-591 | M | low | stale |  |  | Workspace + container infra (stale — re-verify relevance): Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates |
| 686 | PAN-576 | M | low | stale |  |  | Workspace + container infra (stale — re-verify relevance): Global / search should include conversations in addition to workspace features |
| 687 | PAN-568 | M | low | stale |  |  | Workspace + container infra (stale — re-verify relevance): Kanban: Show workspace and tmux session counts in stats |
| 688 | PAN-454 | M | low | stale |  |  | Workspace + container infra (stale — re-verify relevance): Crash recovery: detect orphaned agents and present recovery UI on dashboard st... |
| 689 | PAN-452 | M | low | stale |  |  | Workspace + container infra (stale — re-verify relevance): Conversation input bar — mode/permissions/workspace selectors |
| 690 | PAN-407 | M | low | stale |  |  | Workspace + container infra (stale — re-verify relevance): Run Panopticon from a main workspace for development isolation |
| 691 | PAN-297 | S | low | stale |  |  | CI / quality gate (stale — re-verify relevance): Workspace templates: pre/post tool hooks for auto-format, typecheck, lint |
| 692 | PAN-249 | S | low | stale |  |  | CI / quality gate (stale — re-verify relevance): Add data-testid attributes across dashboard UI and create Playwright smoke test suite |
| 693 | PAN-3469 | L | low | ok |  |  | Dashboard / operator UX: migrate NewProjectModal to a full page (page-not-modal doctrine) |
| 694 | PAN-3290 | M | low | ok |  |  | Planning / xBRIEF: xBRIEF items can carry empty metadata.traces — docs items are invisible to requirement traceability |
| 695 | PAN-2645 | M | low | ok |  |  | Memory + knowledge: Add opt-in Observation-first conversation view |
| 696 | PAN-2625 | M | low | ok |  |  | Dashboard / operator UX: auto-run /pan-new-project on project creation + setup banner, checklist, teaching empty states, and a guided dem... |
| 697 | PAN-1907 | L | low | ok |  |  | Harness / model routing: Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-sele... |
| 698 | PAN-1906 | M | low | ok |  |  | Harness / model routing: Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere |
| 699 | PAN-1853 | M | low | ok |  |  | Harness / model routing: Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers) |
| 700 | PAN-1839 | M | low | ok |  |  | Harness / model routing: Settings → Providers: show each provider's default harness in the collapsed row (no expand needed) |
| 701 | PAN-1782 | M | low | ok |  |  | Harness / model routing: Handoff forks stall at "Injecting…" then die on double 300s summary timeout — decouple precompaction from the ha... |
| 702 | PAN-1754 | M | low | ok |  |  | Harness / model routing: surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings page |
| 703 | PAN-1685 | L | low | ok |  |  | Harness / model routing: Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit |
| 704 | PAN-1684 | S | low | ok |  |  | CI / quality gate: build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed |
| 705 | PAN-1672 | M | low | ok |  |  | Harness / model routing: GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion |
| 706 | PAN-1643 | M | low | ok |  |  | Harness / model routing: Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker |
| 707 | PAN-1623 | M | low | ok |  |  | Harness / model routing: Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion) |
| 708 | PAN-1454 | M | high | ok |  |  | Feature: [META] 9 systemic failure patterns surfaced by 80-issue audit — substrate work to prevent closed-but-not-shipped issues |
| 709 | PAN-2667 | M | low | ok |  |  | Planning / xBRIEF: Reimplement the task-progress admission signal in resource discovery (PAN-2648 follow-up) |
| 710 | PAN-2608 | M | low | ok |  |  | Planning / xBRIEF: Persistent collaboration roles (owner/editor/viewer) and organizations — gated behind the shared-instance milestone |
| 711 | PAN-2572 | M | low | ok |  |  | Feature: Noisy EBADENGINE + deprecation warnings on npx/npm install make a healthy install look broken |
| 712 | PAN-2504 | M | low | ok |  |  | Feature: Auto-relaunch npx @overdeck/core under a compatible Node 22+ instead of failing on old Node |
| 713 | PAN-2491 | L | low | ok |  |  | Feature: Migrate @xenova/transformers to @huggingface/transformers to eliminate silent npx install failures from sharp 0.32 postinstall |
| 714 | PAN-2449 | M | low | ok |  |  | Planning / xBRIEF: start-planning: GITHUB_REPOS env shadows projects.yaml github_repo; unknown IDs fall through to Linear and plan the wr... |
| 715 | PAN-2195 | S | low | ok |  |  | Planning / xBRIEF: pan plan finalize re-plan churn: stale superseded spec on main transiently materializes the old plan |
| 716 | PAN-1553 | M | low | ok |  |  | Harness / model routing: Investigate Claude Code Fast mode support (and fast-tier pricing) |
| 717 | PAN-1481 | M | low | ok |  |  | Harness / model routing: Add cost-event telemetry for Caveman token savings |
| 718 | PAN-1473 | L | low | ok |  |  | Harness / model routing: Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately) |
| 719 | PAN-1461 | M | low | ok |  |  | Memory + knowledge: Conversation transcript: in-page search (Ctrl+F) only finds text in currently-rendered virtualized rows |
| 720 | PAN-1325 | M | low | ok |  |  | Harness / model routing: Artifact storage model is unsafe for polyrepo projects — define a canonical "orchestration repo" |
| 721 | PAN-633 | S | low | stale |  |  | Pipeline substrate (stale — re-verify relevance): Update Cloister PRD and docs index — stale relative to implementation |
| 722 | PAN-298 | M | low | stale |  |  | Workspace + container infra (stale — re-verify relevance): Auto-detect package manager and runtime in workspace setup |
| 723 | PAN-252 | M | low | stale |  |  | Workspace + container infra (stale — re-verify relevance): Disable Sync with Main button when workspace is up to date |
| 724 | PAN-2941 | M | low | ok |  |  | Memory + knowledge: OKF v3 — lease-based writes and advisory semantic auditor |
| 725 | PAN-2836 | L | low | ok |  |  | Memory + knowledge: okf: in-repo placement presets (okf/, docs/okf/) and /okf migrate to switch placements later |
| 726 | PAN-2733 | S | low | ok |  |  | Dashboard / operator UX: substrate-bug-poller has never run — BOT_LOGIN is a git author string, not a GitHub user (49,907 failed polls) |
| 727 | PAN-1910 | M | low | ok |  |  | Planning / xBRIEF: fast-follow(PAN-1908): collapse issue status to ONE canonical field — labels become a derived projection, not the sour... |
| 728 | PAN-1646 | M | low | ok |  |  | Planning / xBRIEF: Rabbit-hole drift detection and lift-to-new-conversation |
| 729 | PAN-984 | M | low | ok |  |  | Harness / model routing: Evaluate context-mode MCP server as session continuity + search layer |
| 730 | PAN-943 | M | low | ok |  |  | Harness / model routing: Add memory file review and management command |
| 731 | PAN-924 | L | low | ok |  |  | Harness / model routing: evaluate GitNexus for Panopticon integration |
| 732 | PAN-901 | M | low | ok |  |  | Harness / model routing: Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch |
| 733 | PAN-818 | M | low | stale |  |  | Harness / model routing (stale — re-verify relevance): Make summary optional when forking conversations |
| 734 | PAN-797 | M | low | stale |  |  | Harness / model routing (stale — re-verify relevance): Cost display: cache write tokens not shown separately; investigate Claude Code dis... |
| 735 | PAN-773 | M | low | stale |  |  | Harness / model routing (stale — re-verify relevance): Design prompt-style overlays with model hierarchy and scoped toggles |
| 736 | PAN-764 | M | low | stale |  |  | Harness / model routing (stale — re-verify relevance): Add quota/usage inspector for routed model providers |
| 737 | PAN-762 | M | low | stale |  |  | Harness / model routing (stale — re-verify relevance): Settings: warn when model overrides target disabled providers |
| 738 | PAN-52 | M | low | stale |  |  | Workspace + container infra (stale — re-verify relevance): Guidance needed: Running complex multi-container projects with Panopticon work... |
| 739 | PAN-1443 | L | low | ok |  |  | Planning / xBRIEF: Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/ |
| 740 | PAN-752 | M | low | stale |  |  | Harness / model routing (stale — re-verify relevance): Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro |
| 741 | PAN-730 | M | low | stale |  |  | Harness / model routing (stale — re-verify relevance): Add provider account telemetry for credits, balances, and usage |
| 742 | PAN-702 | M | low | stale |  |  | Harness / model routing (stale — re-verify relevance): OpenAI provider: add plan/subscription support and fix unregistered model resolution |
| 743 | PAN-649 | M | low | stale |  |  | Harness / model routing (stale — re-verify relevance): Render Excalidraw drawings inline in Claude Code conversations |
| 744 | PAN-571 | M | low | stale |  |  | Harness / model routing (stale — re-verify relevance): Add OpenRouter credits/plan status endpoint and UI |
| 745 | PAN-570 | M | low | stale |  |  | Harness / model routing (stale — re-verify relevance): Show PLAN badge on costs when under a subscription/plan |
| 746 | PAN-546 | M | low | stale |  |  | Harness / model routing (stale — re-verify relevance): Remove claude-code-router — all providers use direct env var injection |
| 747 | PAN-543 | M | low | stale |  |  | Harness / model routing (stale — re-verify relevance): Add confirmation dialog before applying Optimal Defaults |
| 748 | PAN-465 | M | low | stale |  |  | Harness / model routing (stale — re-verify relevance): Add OpenRouter as a model provider |
| 749 | PAN-463 | M | low | stale |  |  | Harness / model routing (stale — re-verify relevance): Add Qwen 3.6+ model support |
| 750 | PAN-245 | M | low | stale |  |  | Planning / xBRIEF (stale — re-verify relevance): Ctrl+C aborts planning dialog instead of copying text |
| 751 | PAN-2352 | M | low | ok |  | PAN-2351 | Dashboard / operator UX: Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel + Access |
| 752 | PAN-1592 | M | low | ok |  |  | Memory + knowledge: Composer: make ephemeral composer state reload-durable (pasted images + unsent/failed message text) |
| 753 | PAN-1357 | M | high | ok |  |  | Dashboard / operator UX: Template conversations: load curated skill bundles into a single conversation |
| 754 | PAN-958 | L | low | ok |  |  | Planning / xBRIEF: Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification |
| 755 | PAN-944 | M | low | ok |  |  | Planning / xBRIEF: Make vBRIEF the durable task graph source of truth |
| 756 | PAN-817 | M | low | stale |  |  | Planning / xBRIEF (stale — re-verify relevance): Improve planning dialog layout and content fit |
| 757 | PAN-2392 | M | low | ok |  |  | Cost + telemetry: Standing Crew cost panel — per-member roster with cost, tokens, verdicts, escalations (mockup included) |
| 758 | PAN-1984 | L | low | ok |  |  | Dashboard / operator UX: Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up) |
| 759 | PAN-1571 | M | low | ok |  |  | Dashboard / operator UX: Large multi-line pastes (handoff docs) land unsubmitted — paste/submit verification is blind to Claude's collaps... |
| 760 | PAN-1482 | M | low | ok |  |  | Memory + knowledge: Token spend report should aggregate data from repo, not just local machine |
| 761 | PAN-1446 | M | low | needs-refinement |  |  | Dashboard / operator UX (needs refinement): PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-cree... |
| 762 | PAN-1445 | M | low | ok |  |  | Dashboard / operator UX: PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs) |
| 763 | PAN-1128 | M | low | ok |  |  | Dashboard / operator UX: Channels: spurious 'no MCP server configured with that name' banner at conversation startup |
| 764 | PAN-1117 | M | low | ok |  |  | Memory + knowledge: Memory: pinned docs (long-form doc chunking + retrieval) |
| 765 | PAN-1116 | M | low | ok |  |  | Memory + knowledge: Memory: cross-project search mode |
| 766 | PAN-3567 | M | low | ok |  |  | Feature: Six floating Effects: Effect.promise/tryPromise wrapping Effect-returning callees — inner Effect never runs |
| 767 | PAN-1937 | M | low | ok |  |  | Cost + telemetry: data export — portable bundle (conversations + favorites core; decoupled optional cost ledger) + user-facing Export my ... |
| 768 | PAN-51 | M | low | stale |  |  | Harness / model routing (stale — re-verify relevance): Documentation: Clarify issue tracker options beyond Linear |
| 769 | PAN-2493 | M | low | ok |  |  | Dashboard / operator UX: align the cockpit Agents-lane and sidebar issue-tree feature sets (two-way gaps) |
| 770 | PAN-2381 | S | low | ok |  |  | Dashboard / operator UX: three event types missing from DomainEvent schema union poison the RPC stream — permanent "Reconnecting…" loop |
| 771 | PAN-2343 | M | low | ok |  |  | Dashboard / operator UX: refresh MISSION-CONTROL.md — update, harden, make useful |
| 772 | PAN-2091 | S | low | ok |  |  | Dashboard / operator UX: delete dead IssueCockpitBody cockpit subtree (8 files, superseded by IssueMissionControl) |
| 773 | PAN-1479 | M | low | ok |  |  | Cost + telemetry: RTK: Add telemetry to measure token savings from bash output compression |
| 774 | PAN-947 | M | low | ok |  |  | Dashboard / operator UX: project management actions in unified sidebar |
| 775 | PAN-751 | M | low | needs-refinement |  |  | Memory + knowledge (needs refinement): PAN-XXX: Historical Metrics Data Persistence — Beyond the 30-Day JSONL Window |
| 776 | PAN-660 | M | low | stale |  |  | Memory + knowledge (stale — re-verify relevance): Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen |
| 777 | PAN-277 | M | low | stale |  |  | Planning / xBRIEF (stale — re-verify relevance): Session reasoning capture & collaborative PRD refinement |
| 778 | PAN-243 | M | low | stale |  |  | Planning / xBRIEF (stale — re-verify relevance): Audit dashboard actions: ensure all are available via CLI |
| 779 | PAN-241 | L | low | stale |  |  | Planning / xBRIEF (stale — re-verify relevance): Mobile redesign initiative: full UX/UI overhaul + implementation plan |
| 780 | PAN-1656 | M | low | ok |  |  | Dashboard / operator UX: Skills page: make it a full management surface (browse, review, edit, scope, sync status) |
| 781 | PAN-1313 | M | high | ok |  |  | Feature: Finish src/lib Effect migration: remove or justify legacy Promise/sync surfaces |
| 782 | PAN-1049 | M | low | ok |  |  | Cost + telemetry: evaluate Tauri v2 desktop shell |
| 783 | PAN-765 | M | low | stale |  |  | Cost + telemetry (stale — re-verify relevance): Preserve trailing zeros in cost displays |
| 784 | PAN-658 | M | low | stale |  | PAN-2356 | Dashboard / operator UX (stale — re-verify relevance): Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport |
| 785 | PAN-44 | M | low | stale |  |  | Planning / xBRIEF (stale — re-verify relevance): Planning should fetch ALL issue context: comments, attachments, linked issues, discussions |
| 786 | PAN-1983 | M | low | ok |  |  | Feature: Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy) |
| 787 | PAN-1913 | M | high | ok |  |  | Dashboard / operator UX: Project description: show on click, edit in dashboard, mirror into the project layer (and document what's in .pa... |
| 788 | PAN-1552 | M | low | ok |  |  | Dashboard / operator UX: Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log |
| 789 | PAN-1485 | S | low | ok |  |  | Dashboard / operator UX: Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable |
| 790 | PAN-1442 | M | low | ok |  |  | Dashboard / operator UX: Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo |
| 791 | PAN-1440 | M | low | ok |  |  | Feature: Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause |
| 792 | PAN-750 | L | low | needs-refinement |  |  | Cost + telemetry (needs refinement): PAN-XXX: Complete Metrics Page Redesign — Real Data, Charts, Time Filtering, and TLDR Analytics |
| 793 | PAN-3058 | M | low | ok |  |  | Feature: Standing-crew templates: ship preset crew configurations (Claude ladder + OpenAI Sol/Terra/Luna) selectable from Settings |
| 794 | PAN-2868 | M | low | ok |  |  | Feature: Desktop window opens at fixed 1400×900 — persist window state and default first run to maximized |
| 795 | PAN-1042 | M | low | ok |  |  | Feature: cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions |
| 796 | PAN-949 | M | low | ok |  |  | Dashboard / operator UX: add conversation for project from sidebar |
| 797 | PAN-903 | M | low | ok |  |  | Dashboard / operator UX: Detect ~/.claude.json corruption on startup and surface it in the dashboard |
| 798 | PAN-902 | M | low | ok |  |  | Dashboard / operator UX: Settings: add 'Run pan sync' button to configuration menu |
| 799 | PAN-886 | M | low | ok |  |  | Feature: pan review request shows 'fetch failed' instead of actual sync-target-branch error |
| 800 | PAN-2335 | S | low | ok |  |  | Feature: review the full open backlog for junk/stale/nonsensical issues — produce a categorized document for operator review (FIND ONLY, ... |
| 801 | PAN-747 | M | low | stale |  |  | Dashboard / operator UX (stale — re-verify relevance): Conversation list items lack accessible labels in accessibility tree |
| 802 | PAN-743 | M | low | stale |  |  | Dashboard / operator UX (stale — re-verify relevance): Add consistent new conversation icon actions in Command Deck |
| 803 | PAN-738 | M | low | stale |  |  | Dashboard / operator UX (stale — re-verify relevance): Add right-click fork option to conversation list |
| 804 | PAN-623 | M | low | stale |  |  | Dashboard / operator UX (stale — re-verify relevance): Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks |
| 805 | PAN-565 | M | low | stale |  |  | Dashboard / operator UX (stale — re-verify relevance): Handle CTRL-Z to undo accidental conversation archival |
| 806 | PAN-564 | M | low | stale |  |  | Dashboard / operator UX (stale — re-verify relevance): Slash menu positioned incorrectly — cut off / off-screen |
| 807 | PAN-554 | M | low | stale |  |  | Dashboard / operator UX (stale — re-verify relevance): Add kanban board deeplinks for issue URLs |
| 808 | PAN-548 | M | low | stale |  |  | Dashboard / operator UX (stale — re-verify relevance): Command Deck: preserve state across navigation including URL routing for tabs |
| 809 | PAN-438 | L | low | stale |  |  | Dashboard / operator UX (stale — re-verify relevance): Migrate remaining REST polling endpoints to Effect RPC |
| 810 | PAN-1999 | M | low | ok |  |  | Feature: Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN) |
| 811 | PAN-106 | M | low | stale |  |  | Cost + telemetry (stale — re-verify relevance): Cost prediction/estimation for in-progress work |
| 812 | PAN-2073 | M | low | ok |  |  | Dashboard / operator UX: add user-facing page for the Desktop App |
| 813 | PAN-1524 | M | low | ok |  |  | Feature: Slash command aliases: /handoff → /pan-handoff (and similar short forms) |
| 814 | PAN-1483 | M | low | ok |  |  | Feature: Distinguish general-use skills from Panopticon-only dev skills in pan sync |
| 815 | PAN-1480 | L | low | ok |  |  | Feature: TLDR: 93% bypass rate — daemon/hook integration broken |
| 816 | PAN-1474 | M | low | ok |  |  | Cost + telemetry: Add ACKNOWLEDGEMENTS doc — credit borrowed code from open-source projects (MIT/Apache 2.0) |
| 817 | PAN-1065 | M | low | ok |  |  | Feature: Validate issueId at every shell-string interpolation site (defense in depth) |
| 818 | PAN-271 | M | low | stale |  |  | Dashboard / operator UX (stale — re-verify relevance): Auto-assign Linear project from project config when creating issues |
| 819 | PAN-258 | M | low | stale |  |  | Dashboard / operator UX (stale — re-verify relevance): Kanban board: fit all columns without horizontal scrolling |
| 820 | PAN-769 | M | low | stale |  |  | Feature (stale — re-verify relevance): Track verification/review/test phase churn over time |
| 821 | PAN-146 | M | low | stale |  |  | Dashboard / operator UX (stale — re-verify relevance): PAN-146: Refine light mode theming across all dashboard pages |
| 822 | PAN-634 | S | low | stale |  |  | Cost + telemetry (stale — re-verify relevance): Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale ... |
| 823 | PAN-589 | M | low | stale |  |  | Feature (stale — re-verify relevance): Review and update commands-skills.md with all available Panopticon skills |
| 824 | PAN-294 | M | low | stale |  |  | Feature (stale — re-verify relevance): Surface module initialization errors as system-level, not per-issue |
| 825 | PAN-2348 | L | low | ok |  |  | Documentation: migrate STATE-STORAGE-AUDIT.md content to living docs, then delete |
| 826 | PAN-450 | M | low | stale |  |  | Research / evaluation (stale — re-verify relevance): Adopt remaining Effect patterns — Schema, Platform, Streams, Logging, Testing |
| 827 | PAN-1469 | L | low | ok |  |  | Documentation: End-to-end review and consolidation of all project documentation |
| 828 | PAN-674 | S | low | stale |  |  | Documentation (stale — re-verify relevance): add glossary of Panopticon domain terms |
| 829 | PAN-2376 | XL | high | needs-refinement | ✓ |  | Pipeline substrate (needs refinement): Epic: CI/CD reliability — flake policy, verification-to-merge convergence, strike/swarm merge-path... |
| 830 | PAN-2059 | XL | high | needs-refinement | ✓ |  | Pipeline substrate (needs refinement): [EPIC] Backlog pickup gate — operator Plan→Release row + AI Objection (5th state) + Flywheel relev... |
| 831 | PAN-793 | M | low | needs-refinement |  |  | Pipeline substrate (needs refinement): Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine |
| 832 | PAN-791 | M | low | needs-refinement |  |  | Feature (needs refinement): Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI |
| 833 | PAN-2002 | M | low | ok |  |  | Pipeline substrate: [HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID) |

## Rationale detail

### PAN-3572 (rank 1)

Main is red at the typecheck ratchet, and the verification gate runs typecheck for every issue in the pipeline. Until this lands, every work agent in every project burns cycles on a failure it did not cause and cannot fix. It is a pre-existing main failure with no feature-branch diff, so it is a small, surgical correction with fleet-wide payoff — the single highest-leverage item in the backlog.

### PAN-3504 (rank 2)

A one-field rename mistake in pan parked ack keeps npm run typecheck red on main. Same blast radius as the ratchet failure: the verification gate is typecheck-first, so a red main starves every project's convergence. Trivially fixable and must land before anything else competes for the gate.

### PAN-3512 (rank 2)

Write-side companion to PAN-3511 — one verdict write door, dispatch-not-drop, and a kill-conditional fallback. Split out because it rewrites write semantics and carries real regression risk; in-review, rank pinned.

### PAN-3499 (rank 3)

Filed separately from PAN-3504 but describing the same nonexistent ProjectConfig.projectPath reference in src/cli/commands/parked.ts. Fix once, close both. Ranked adjacent so whoever picks up one sees the other and does not do the work twice.

### PAN-3554 (rank 4)

Two separate red mains this week were found by an operator reading logs, not by the system. Because the verification gate is downstream of main's health, a silent red main stalls the whole fleet for hours at a time. This is the escalation backstop that turns every future red main from a multi-hour outage into a minutes-long one, so it ranks with the red mains themselves.

### PAN-3532 (rank 5)

CI reporting green on a red main is worse than no CI: it removes the one signal the pipeline trusts. Two frontend test files failed on main for hours undetected. Closing this gap is the prerequisite for the red-main escalation in PAN-3554 to mean anything, and it is why the ratchet and typecheck failures above went unnoticed in the first place.

### PAN-3524 (rank 6)

A loop that survives every documented suppression gate is the worst possible substrate defect: the operator has no lever left. It has already blocked a red-main fix from reaching its test gate across four attempts, so it compounds with everything above it. Fix the loop's gate consultation, then verify by proving each of the four gates actually stops it.

### PAN-3566 (rank 7)

Reproduced across eight session IDs by the MIN-839 shepherd: the launcher's final line has no -p, no positional prompt, and no piped stdin, so the test role can never run. Every zombie test agent in the fleet traces here, and each one holds its issue out of the merge gate indefinitely. A one-line launcher fix with an enormous throughput payoff.

### PAN-3571 (rank 8)

The rc=124/137/143 branch logs and exits without emitting the UNCLEAR fallback, so the agent's turn-end is never resolved and the agent sits. 334 recorded occurrences make this the single most frequent stall producer in the logs. Falling back to UNCLEAR instead of silence is a small change that recovers a large amount of otherwise-lost agent time.

### PAN-3561 (rank 9)

Every canonical state write for mind-your-now failed for 2.5 days because a crashed writer left an empty lock directory nothing could reclaim. There is no TTL and no recovery command, so the only fix is an operator with a shell. A lock that can permanently brick the single write door violates the two-doors tenet outright.

### PAN-3564 (rank 10)

Measured at effectively 100% duty cycle over 240 seconds of sampling, which starved all four reviewer spawns for MIN-874. Holding a fine-grained lock across a coarse-grained wait is a textbook convoy; the fix is to release before waiting, but the retry-on-contention path also needs to exist so a lost race is not fatal.

### PAN-3559 (rank 11)

Self-amplifying: every failed kickoff appends more undelivered feedback, which makes the next kickoff larger and more certain to fail. The 400 is also misreported as a missing-field error, so the real cause is invisible. Needs both a bound on accumulated feedback and an honest size-rejection error.

### PAN-3422 (rank 11)

New, merged and verifying on main, but ranked here because the failure it describes is the single most common way autonomous motion stops: nudge and feedback text lands visibly in an agent's composer and is never submitted, leaving four MYN agents idle between 20 minutes and 2.5 hours, one of them at $242 of session cost. Delivery that reports success while the message sits unsent makes every downstream gate unreliable.

### PAN-3560 (rank 12)

During one hour of heavy concurrent load every session resume and message delivery through the supervisor failed. Because the supervisor is the preferred delivery transport, its overload behaviour is a fleet-wide single point of failure — and it is the upstream cause of several of the zombie-agent reports filed the same day.

### PAN-3565 (rank 13)

Three robustness defects in one lifecycle, all reproducible from the PAN-3564 convoy conditions. The fabricated CHANGES REQUESTED is the dangerous one — it sends a work agent into rework against findings no reviewer ever wrote, burning a full cycle and poisoning the convergence gate's history.

### PAN-3563 (rank 14)

The sibling of PAN-3566 on the delivery side rather than the launcher side: the session exists, so every liveness check passes, but no turn ever runs. Nothing in the recovery surface can see role agents, so the only exit is an operator noticing ctx 0% / cost $0.00 by eye.

### PAN-1230 (rank 14)

Command Deck right-pane Pipeline-lens and TopBar height, the last of the PAN-1148 audit gaps. Merged and verifying on main.

### PAN-3283 (rank 23)

An unreviewed change becoming indistinguishable from an approved one is the most dangerous defect class in the pipeline — it can merge work no reviewer ever accepted. Labelled blocks-main. Pair with PAN-2746, which is the same hole reached from the bypass path; both close once the verdict of record is the only source.

### PAN-2746 (rank 24)

Same hole as PAN-3283 from the deacon's bypass path, with a recorded near-miss. The fix is structural, not defensive: infrastructure failure needs its own terminal value that ready_for_merge refuses to honour.

### PAN-3250 (rank 25)

Actively spreading: branches were measured carrying 14 unrelated commits that exist only on the local main ref. Every one of those commits rides into a PR and into review, which corrupts diffs, reviews, and merge ordering simultaneously. One-line origin/main base fix, enormous cleanup avoided.

### PAN-3285 (rank 26)

A structural inability to recover: the supervisor kills correct dashboards and cannot start one. Already produced a 3.5-hour outage. Labelled critical, and it sits underneath the deploy path everything else uses.

### PAN-3424 (rank 27)

Silent loss of durability in the canonical state plane is the failure mode the two-doors tenet exists to prevent. Neither defect has any detector, and one accumulated unnoticed for two weeks. Needs reconciliation plus a loud signal, not just a push retry.

### PAN-3429 (rank 28)

The governor's whole purpose is to prevent the OOM events that kill tmux servers and agents. Measured at severe stalling with only deferrals firing, it is not doing its job, and the manual pause that saved the box is exactly the backstop-as-symptom the doctrine says to fix. Prerequisite for the OOM blast-radius work below.

### PAN-3539 (rank 29)

Correct victim selection, catastrophic collateral: one runaway workload took every session on the box with it. Setting the OOM policy so a single agent's death cannot cascade is a small systemd/cgroup change with an outsized reduction in worst-case blast radius.

### PAN-3314 (rank 30)

The containment half of PAN-3539 — per-agent cgroups so the kernel's victim selection can only reach one agent. Ranked immediately after it because the two together convert a fleet-wide outage into a single-agent restart.

### PAN-3550 (rank 31)

Operator-directed (2026-08-05): warn rather than kill. Today the governor sheds silently and the kernel OOMs silently, so the operator learns about memory events only from the wreckage. Already has a PRD and is marked ready, so it is immediately startable.

### PAN-3344 (rank 32)

The governor is blind to the resource that actually saturates first on this box: concurrent agent test runs. Every load-flake in the test-gate cluster below traces back to unthrottled CPU. Has a PRD and is in planning.

### PAN-3492 (rank 33)

Retry-on-timeout without a load check is the same amplification pattern as PAN-3559, applied to the box's CPU. One strike agent observed continuously respawned vitest workers for ten minutes. Fix the retry policy and it stops manufacturing the conditions that trigger it.

### PAN-3520 (rank 34)

Branches are looping on 'test failed' verdicts that are not defects: all configured gates pass in isolation. Every such loop costs a full rework cycle and pollutes the convergence-gate history. Retry-in-isolation is the cheapest correct discriminator between a flake and a regression.

### PAN-3062 (rank 35)

Multiple independent sessions stack commits on one shared branch, so whoever pushes first publishes everyone's half-finished work. This is the upstream cause of PAN-3250's inherited commits and of the state-write-door blockage in PAN-3505. Fixing the sharing model retires a family of incidents at once.

### PAN-3505 (rank 36)

The push guard is behaving correctly; the problem is what it is guarding against. Until the shared-worktree model changes, the flywheel cannot persist its own state whenever any agent has left a commit behind — which means orchestration stalls for an unrelated reason.

### PAN-3284 (rank 37)

Recurrence of the workspace-boundary violation. Each occurrence puts uncommitted agent output on the branch every other session shares, which is how PAN-3062 and PAN-3505 turn into incidents. Needs mechanical enforcement, not another rule.

### PAN-2409 (rank 38)

The mechanical enforcement PAN-3284 asks for. Three Haiku work agents edited the primary checkout on the same afternoon, so this is not a rare slip; it is the default behaviour when the boundary is advisory.

### PAN-3081 (rank 39)

A PATH-based guard is advisory by construction, and an agent has already discovered and used the bypass. Any enforcement that an agent can reason its way around is not enforcement; this needs to move somewhere the agent cannot edit.

### PAN-3236 (rank 40)

A definite failure reported as an ambiguous one, so the retry path never runs and the feedback file sits unread while the issue goes stuck. PAN-3049 stalled at four review cycles on exactly this. Classification fix, small diff.

### PAN-3282 (rank 41)

The recurring producer of the infra-failure state that PAN-3283 and PAN-2746 mishandle downstream. Fixing the downstream misclassification stops unreviewed merges; fixing this stops the events entirely. Needs root-cause work, not another recovery path.

### PAN-3397 (rank 42)

Same freeze, uncovered branch. Lanes sat 15 minutes at ctx 0% with byte-identical cost and no detector fired. Extending the existing detector to fresh spawns is a small change that closes a live blind spot in review dispatch.

### PAN-2742 (rank 43)

A synthesis that runs before its reviewers have finished manufactures blocking verdicts out of nothing, and PAN-2710 reached cycle 9 on the resulting churn. Needs a real readiness condition rather than a timer.

### PAN-2695 (rank 44)

225 milliseconds between two dispatches for the same issue is enough to destroy the run. Dispatch needs to be idempotent per issue; this is the same in-flight-guard shape that already protects postMergeLifecycle.

### PAN-3084 (rank 45)

Every recovery path reads the dead session as healthy work in progress, so review can never start for that issue again. The 'preserve' behaviour in restart is what makes it permanent, which makes this a policy fix as much as a detection fix.

### PAN-2706 (rank 46)

The test-role twin of PAN-3084, and a direct consequence of PAN-3566's promptless launcher. Until dispatch can tell 'running' from 'booted but never briefed', every subsequent test dispatch for that issue is silently swallowed.

### PAN-3274 (rank 47)

Work approved by review and green in CI sits out of the merge gate indefinitely because a verdict is structurally impossible. This is the operator-visible consequence of the PAN-3566 / PAN-2706 cluster and is worth tracking to closure separately.

### PAN-3500 (rank 48)

A reviewer that can edit the code it just reviewed invalidates the review contract and can silently change what gets merged. The session staying alive after the report is written is the mechanism; scoping the reviewer's write access is the fix.

### PAN-3496 (rank 49)

A convoy member blocking on an operator question stalls the whole convoy for something the prompt should decide. It also trains the operator to ignore decision prompts. Prompt-level fix with immediate throughput return.

### PAN-3541 (rank 50)

Three identical loop iterations observed while re-driving a review after an OOM killed the reviewer. Resume eligibility has to consider whether the prior session died cleanly, or restart becomes an infinite loop exactly when recovery matters most.

### PAN-3278 (rank 51)

Machinery that exists, has capacity, and never fires is worse than machinery that is missing, because it makes the gap invisible. Two hours of idle time per occurrence, and the requeue counter proves the condition was evaluated 25 times.

### PAN-3281 (rank 52)

Two flags that must never both be true are both true, and the merge-ready flag wins on every surface. Stuck work was assembled into a UAT batch and recommended for promotion. Derive one from the other rather than storing both.

### PAN-3543 (rank 53)

A self-contradictory deadlock — the error message names a command that is itself refused — blocking rework after a BLOCKED verdict. Same family as PAN-3526. The refusal logic needs one authoritative branch, not three that disagree.

### PAN-3555 (rank 54)

Warm-by-default is the operator's standing policy because a fresh session discards accumulated context and re-pays discovery cost. Silently violating it is both expensive and invisible; the spawn path needs to prove no warm session was available before going fresh.

### PAN-3556 (rank 55)

Two callers spawning the same agent concurrently produces two session identities, one of which becomes an orphan that every liveness check still counts. The same missing per-agent spawn guard as PAN-2695 and PAN-3185.

### PAN-3234 (rank 56)

The detector already exists and is already correct; it is simply not consulted by any health surface. Two agents froze within two flywheel ticks and were found only by an orchestrator reading panes by hand. Wiring an existing detector into health is cheap and high-yield.

### PAN-3261 (rank 57)

Overdeck answering the Claude Code session-resume gate itself already discarded an operator's full session once (PAN-3212). The detector is blinded by the delivery's own paste, so the guard fails exactly when it is needed. Never answer a menu Overdeck did not open.

### PAN-2668 (rank 58)

Feedback that queues into a mailbox nothing drains is feedback that was never delivered, and the issue simply stops. Delivery has to either re-drive the agent or fail loudly; silent queueing is the one option that cannot be recovered from.

### PAN-3104 (rank 59)

A stale artifact keeps re-failing an issue forever because nothing compares it against the current HEAD. This is how branches get stuck in test-failure loops that no code change can escape. Freshness check against HEAD is the whole fix.

### PAN-2700 (rank 60)

The recorded instance of PAN-3104's defect, with a verdict arriving 31 seconds after a fresh dispatch. Keep both so the recovery path and the freshness rule are each verified.

### PAN-3557 (rank 61)

The merge succeeded and the lifecycle logged completion, but the issue vanished from the sweep that proves it reached production. Transient forge errors on a durable lifecycle step must retry; the alternative is silently losing track of shipped work.

### PAN-3569 (rank 62)

One degraded lifecycle leaves a pending file that blocks every subsequent deploy with no way out short of --force. Deploy is the last DoD row, so a deadlock here means nothing reaches the live dashboard.

### PAN-3248 (rank 63)

A successful deploy leaving the deploy queue set is a cross-project outage of the verification runner. Same family as PAN-3244 and PAN-3205 — the deploy window's lifecycle is not closed on any of its exit paths.

### PAN-3244 (rank 64)

One project's deploy blocking every project's verification is a scoping error: the deploy gate should be per-project or time-bounded. Observed leaving a durable review intent unspawned for a full window.

### PAN-3205 (rank 65)

The refusal message promises a trigger that was never implemented, so a deferred deploy waits forever. Either implement the boundary trigger or stop promising it; today the operator is told to wait for something that will not happen.

### PAN-3188 (rank 66)

Accepting only the transient verifying_on_main waypoint means any issue that already completed the lifecycle is permanently un-closeable. Close-out is the gate that owns Docker teardown, so blocked close-outs also leak containers and networks.

### PAN-3168 (rank 67)

All three state planes agree the agent is not running; only the DoD row disagrees. Same row as PAN-3188 and the same underlying problem — the row reads a field instead of the resolver.

### PAN-2846 (rank 68)

The write that PAN-3168's read trips over. Fixing the writer and the reader together is the honest scope; fixing only one leaves the other latent.

### PAN-3196 (rank 69)

Every blocked teardown leaks a Docker network, and Docker's default pool only supports about 31 bridge networks before new workspaces cannot be created at all. Per-workspace residue, so it will keep recurring until teardown can handle root-owned files.

### PAN-3210 (rank 70)

Two different scoping rules for the same container set, so a cleanly-exited one-shot container blocks the whole ceremony. Unify the scoping; the container in the recorded case had been dead for 49 minutes.

### PAN-3362 (rank 71)

In pipeline. Workspace containers have no issue data by design, so any AC that requires a live issue can only be resolved by an operator override on an unverified diff. It blocks the entire UI-redesign track.

### PAN-3047 (rank 71)

One close-out gate proves the branch merged and the next step claims it did not, in the same run. 96 accumulated branches say this has never worked. Content or PR-state verification instead of ancestry is the fix, shared with PAN-2828 and PAN-2995.

### PAN-2828 (rank 72)

The completion-side twin of PAN-3047: doctrine mandates squash merge, and the verification cannot see one. Every strike therefore needs hand-completion, which defeats the purpose of the fast path.

### PAN-2995 (rank 73)

Third filing of the same squash-vs-ancestry mismatch. Fix once with a shared provably-merged predicate and close all three; leaving duplicates open keeps re-spending discovery cost.

### PAN-3103 (rank 74)

A transient reading becoming permanent policy is the failure shape to look for here: nothing retries once the status self-heals, so a planning agent can be spawned on already-shipped work. Needs a retry on self-heal, not a better first read.

### PAN-3171 (rank 75)

The operator is told the opposite of what happened, which is worse than silence because it invites a destructive manual correction. The failure event is emitted after the success events in the same minute — an ordering/idempotency bug in the completion path.

### PAN-2769 (rank 76)

Every operator-facing count is wrong by however much residue has accumulated, which trains the operator to distrust the dashboard's numbers. Reconciliation on close is a small writer change with broad credibility payoff.

### PAN-3044 (rank 77)

Two recorded cases of a closed issue getting a fresh stuck row and a live agent. Beyond the wasted spend, it makes needs-you untrustworthy, and needs-you is the operator's primary queue.

### PAN-2888 (rank 78)

Real troubled work-agent count was zero while the dashboard reported 14-16. The same residue class as PAN-2769 and PAN-3044; grouping them into one close-out reconciliation pass is likely cheaper than three separate fixes.

### PAN-3211 (rank 79)

A genuine gap in the state model rather than a bug: an issue whose work never landed anywhere has no legal terminal state, so its rows live forever. Needs a decision on the disposition, then the mechanics.

### PAN-2567 (rank 80)

The canonical 'done work does not converge to merged' case with resume ON and no suppression in play. Convergence without a human nudge is the stated pipeline invariant, and this is the recorded proof it does not hold under a moving main.


<!-- machine-readable; do not hand-edit below this line -->

```json
{
  "version": 1,
  "project": "overdeck",
  "generatedAt": "2026-08-06T00:51:22.619Z",
  "model": "claude-opus-5",
  "pass": "creation",
  "openCount": 833,
  "nodes": [
    {
      "issue": "PAN-3572",
      "rank": 1,
      "size": "XS",
      "importance": "critical",
      "score": 100,
      "condition": "ok",
      "dependsOn": [],
      "why": "Red main: dashboard typecheck ratchet fails on origin/main (60 vs 54 baseline), so every branch's verification gate fails.",
      "rationale": "Main is red at the typecheck ratchet, and the verification gate runs typecheck for every issue in the pipeline. Until this lands, every work agent in every project burns cycles on a failure it did not cause and cannot fix. It is a pre-existing main failure with no feature-branch diff, so it is a small, surgical correction with fleet-wide payoff — the single highest-leverage item in the backlog.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3504",
      "rank": 2,
      "size": "XS",
      "importance": "critical",
      "score": 100,
      "condition": "ok",
      "dependsOn": [],
      "why": "typecheck fails on main: parked.ts references ProjectConfig.projectPath, which does not exist (field is `path`).",
      "rationale": "A one-field rename mistake in pan parked ack keeps npm run typecheck red on main. Same blast radius as the ratchet failure: the verification gate is typecheck-first, so a red main starves every project's convergence. Trivially fixable and must land before anything else competes for the gate.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3499",
      "rank": 3,
      "size": "XS",
      "importance": "critical",
      "score": 99,
      "condition": "ok",
      "dependsOn": [],
      "why": "Same defect as PAN-3504 from the pan parked ack side — acknowledgeRecoveryTrip called with a nonexistent field.",
      "rationale": "Filed separately from PAN-3504 but describing the same nonexistent ProjectConfig.projectPath reference in src/cli/commands/parked.ts. Fix once, close both. Ranked adjacent so whoever picks up one sees the other and does not do the work twice.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3554",
      "rank": 4,
      "size": "S",
      "importance": "critical",
      "score": 99,
      "condition": "ok",
      "dependsOn": [
        "PAN-3572",
        "PAN-3504",
        "PAN-3532"
      ],
      "why": "Red main has no mechanical owner — a failed main-push CI run must escalate within minutes, not wait for a human to notice.",
      "rationale": "Two separate red mains this week were found by an operator reading logs, not by the system. Because the verification gate is downstream of main's health, a silent red main stalls the whole fleet for hours at a time. This is the escalation backstop that turns every future red main from a multi-hour outage into a minutes-long one, so it ranks with the red mains themselves.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3532",
      "rank": 5,
      "size": "M",
      "importance": "critical",
      "score": 98,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI never runs the full frontend test suite — main was red on frontend for hours while every CI run reported green.",
      "rationale": "CI reporting green on a red main is worse than no CI: it removes the one signal the pipeline trusts. Two frontend test files failed on main for hours undetected. Closing this gap is the prerequisite for the red-main escalation in PAN-3554 to mean anything, and it is why the ratchet and typecheck failures above went unnoticed in the first place.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3524",
      "rank": 6,
      "size": "M",
      "importance": "critical",
      "score": 98,
      "condition": "ok",
      "dependsOn": [],
      "why": "P0: server-owned --changed verification loop relaunches through Deacon freeze, review abort, pause and operator-stop; blocked a red-main ...",
      "rationale": "A loop that survives every documented suppression gate is the worst possible substrate defect: the operator has no lever left. It has already blocked a red-main fix from reaching its test gate across four attempts, so it compounds with everything above it. Fix the loop's gate consultation, then verify by proving each of the four gates actually stops it.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3566",
      "rank": 7,
      "size": "S",
      "importance": "critical",
      "score": 97,
      "condition": "ok",
      "dependsOn": [],
      "why": "Test-role launcher execs claude with no prompt — the role boots an idle REPL, no turn, no JSONL. Deterministic cause of zombie test agents.",
      "rationale": "Reproduced across eight session IDs by the MIN-839 shepherd: the launcher's final line has no -p, no positional prompt, and no piped stdin, so the test role can never run. Every zombie test agent in the fleet traces here, and each one holds its issue out of the merge gate indefinitely. A one-line launcher fix with an enormous throughput payoff.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3571",
      "rank": 8,
      "size": "S",
      "importance": "critical",
      "score": 97,
      "condition": "ok",
      "dependsOn": [],
      "why": "work-agent-stop-hook completion-check timeout exits 0 silently — 334 stranded turn-ends, agents stall until a patrol notices.",
      "rationale": "The rc=124/137/143 branch logs and exits without emitting the UNCLEAR fallback, so the agent's turn-end is never resolved and the agent sits. 334 recorded occurrences make this the single most frequent stall producer in the logs. Falling back to UNCLEAR instead of silence is a small change that recovers a large amount of otherwise-lost agent time.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3561",
      "rank": 9,
      "size": "S",
      "importance": "critical",
      "score": 97,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ownerless state-git lock is immortal — a crash between mkdir and owner.json bricks a project's write door forever. No TTL, no recovery CLI.",
      "rationale": "Every canonical state write for mind-your-now failed for 2.5 days because a crashed writer left an empty lock directory nothing could reclaim. There is no TTL and no recovery command, so the only fix is an operator with a shell. A lock that can permanently brick the single write door violates the two-doors tenet outright.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3564",
      "rank": 10,
      "size": "M",
      "importance": "critical",
      "score": 96,
      "condition": "ok",
      "dependsOn": [],
      "why": "Lock convoy: per-issue record lock held across the global state-git lock wait — reviewer spawns die with no retry, locks at 100% duty cycle.",
      "rationale": "Measured at effectively 100% duty cycle over 240 seconds of sampling, which starved all four reviewer spawns for MIN-874. Holding a fine-grained lock across a coarse-grained wait is a textbook convoy; the fix is to release before waiting, but the retry-on-contention path also needs to exist so a lost race is not fatal.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3559",
      "rank": 11,
      "size": "M",
      "importance": "critical",
      "score": 96,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unbounded undelivered-feedback accumulation deadlocks kickoff — 324KB prompt rejected at the 262KB PTY cap as a bogus 'content is require...",
      "rationale": "Self-amplifying: every failed kickoff appends more undelivered feedback, which makes the next kickoff larger and more certain to fail. The 400 is also misreported as a missing-field error, so the real cause is invisible. Needs both a bound on accumulated feedback and an honest size-rejection error.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3560",
      "rank": 12,
      "size": "M",
      "importance": "critical",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "PTY supervisor overload under concurrent review convoys — fleet-wide 502 'input echo confirmation failed' kills resumes and feedback deli...",
      "rationale": "During one hour of heavy concurrent load every session resume and message delivery through the supervisor failed. Because the supervisor is the preferred delivery transport, its overload behaviour is a fleet-wide single point of failure — and it is the upstream cause of several of the zombie-agent reports filed the same day.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3565",
      "rank": 13,
      "size": "M",
      "importance": "critical",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review lifecycle: failed spawn wedges 'starting', infra-failure synthesizes a fake CHANGES REQUESTED verdict, pan tell hangs to SIGTERM a...",
      "rationale": "Three robustness defects in one lifecycle, all reproducible from the PAN-3564 convoy conditions. The fabricated CHANGES REQUESTED is the dangerous one — it sends a work agent into rework against findings no reviewer ever wrote, burning a full cycle and poisoning the convergence gate's history.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3563",
      "rank": 14,
      "size": "S",
      "importance": "high",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "Role agent spawned with undelivered prompt becomes an invisible zombie — state.json says running forever, dispatcher no-ops, pan unstick ...",
      "rationale": "The sibling of PAN-3566 on the delivery side rather than the launcher side: the session exists, so every liveness check passes, but no turn ever runs. Nothing in the recovery surface can see role agents, so the only exit is an operator noticing ctx 0% / cost $0.00 by eye.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3512",
      "rank": 2,
      "size": "M",
      "importance": "high",
      "score": 94,
      "condition": "ok",
      "dependsOn": [],
      "why": "Verdict write door — recordReviewVerdict + dispatch-not-drop + fallback kill-conditional (write side)",
      "rationale": "Write-side companion to PAN-3511 — one verdict write door, dispatch-not-drop, and a kill-conditional fallback. Split out because it rewrites write semantics and carries real regression risk; in-review, rank pinned.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3422",
      "rank": 11,
      "size": "M",
      "importance": "high",
      "score": 94,
      "condition": "ok",
      "dependsOn": [],
      "why": "Nudge/feedback text lands in the composer but is never submitted — 4 agents wedged idle 20m–2.5h with visible text",
      "rationale": "New, merged and verifying on main, but ranked here because the failure it describes is the single most common way autonomous motion stops: nudge and feedback text lands visibly in an agent's composer and is never submitted, leaving four MYN agents idle between 20 minutes and 2.5 hours, one of them at $242 of session cost. Delivery that reports success while the message sits unsent makes every downstream gate unreliable.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3477",
      "rank": 133,
      "size": "S",
      "importance": "high",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merged slot sessions are never reaped and get auto-resumed forever, consuming swarm capacity indefinitely",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3427",
      "rank": 166,
      "size": "M",
      "importance": "high",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "Order books are unreachable for every project except the dashboard server’s own cwd project",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3362",
      "rank": 71,
      "size": "M",
      "importance": "high",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "No way to seed tracker-backed issue fixtures in workspace containers — every UI-redesign UAT is environment-blocked",
      "rationale": "In pipeline. Workspace containers have no issue data by design, so any AC that requires a live issue can only be resolved by an operator override on an unverified diff. It blocks the entire UI-redesign track.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3537",
      "rank": 130,
      "size": "S",
      "importance": "medium",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "In pipeline (in-review). Per-project live CI chip on the Command Deck: latest main run status and link, webhook-fed.",
      "rationale": "Pinned. A live main-status chip is the missing signal behind the red-main class at the top of this ranking.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3423",
      "rank": 292,
      "size": "M",
      "importance": "medium",
      "score": 91,
      "condition": "ok",
      "dependsOn": [],
      "why": "Redesign SystemHealthPill popover: attention-grouped reasons, metered vitals, actionable agent alerts",
      "rationale": "In pipeline. Stall alerts and informational disclaimers currently share one undifferentiated bullet list, so the panel built for triage cannot be triaged.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1230",
      "rank": 14,
      "size": "S",
      "importance": "medium",
      "score": 91,
      "condition": "ok",
      "dependsOn": [],
      "why": "Command Deck right-pane Pipeline-lens + TopBar height (PAN-1148 follow-up)",
      "rationale": "Command Deck right-pane Pipeline-lens and TopBar height, the last of the PAN-1148 audit gaps. Merged and verifying on main.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3283",
      "rank": 23,
      "size": "S",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [
        "PAN-3512"
      ],
      "why": "Recovering from review_infrastructure_failure sets review_status=passed despite an outstanding CHANGES REQUESTED verdict (blocks-main).",
      "rationale": "An unreviewed change becoming indistinguishable from an approved one is the most dangerous defect class in the pipeline — it can merge work no reviewer ever accepted. Labelled blocks-main. Pair with PAN-2746, which is the same hole reached from the bypass path; both close once the verdict of record is the only source.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2746",
      "rank": 24,
      "size": "S",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [
        "PAN-3512"
      ],
      "why": "Review infra-failure bypass writes reviewStatus='passed' — indistinguishable from four reviewers approving; nearly merged PAN-2710 unrevi...",
      "rationale": "Same hole as PAN-3283 from the deacon's bypass path, with a recorded near-miss. The fix is structural, not defensive: infrastructure failure needs its own terminal value that ready_for_merge refuses to honour.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3250",
      "rank": 25,
      "size": "M",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [
        "PAN-3062"
      ],
      "why": "Workspace spawn branches from local HEAD/defaultBranch instead of origin/main — every new workspace inherits unpushed local main (blocks-...",
      "rationale": "Actively spreading: branches were measured carrying 14 unrelated commits that exist only on the local main ref. Every one of those commits rides into a PR and into review, which corrupts diffs, reviews, and merge ordering simultaneously. One-line origin/main base fix, enormous cleanup avoided.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3285",
      "rank": 26,
      "size": "M",
      "importance": "critical",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "Supervisor pinned to a pan reload generation SIGTERMs every healthy dashboard and can never start a replacement — 3.5h outage, 1107 silen...",
      "rationale": "A structural inability to recover: the supervisor kills correct dashboards and cannot start one. Already produced a 3.5-hour outage. Labelled critical, and it sits underneath the deploy path everything else uses.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3424",
      "rank": 27,
      "size": "M",
      "importance": "critical",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "State plane silently stops being durable: overdeck-state non-FF push never reconciled, drafts/ PRDs never staged (16 orphans, one 2 weeks...",
      "rationale": "Silent loss of durability in the canonical state plane is the failure mode the two-doors tenet exists to prevent. Neither defect has any detector, and one accumulated unnoticed for two weeks. Needs reconciliation plus a loud signal, not just a push retry.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3429",
      "rank": 28,
      "size": "M",
      "importance": "critical",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory governor defers new admissions but sheds nothing under HARD pressure — flywheel manually paused a gate run at PSI 41.9 / 2.2GB ava...",
      "rationale": "The governor's whole purpose is to prevent the OOM events that kill tmux servers and agents. Measured at severe stalling with only deferrals firing, it is not doing its job, and the manual pause that saved the box is exactly the backstop-as-symptom the doctrine says to fix. Prerequisite for the OOM blast-radius work below.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3539",
      "rank": 29,
      "size": "M",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Kernel OOM of one agent-spawned process killed the entire tmux server — all sessions lost (OOMPolicy=stop default).",
      "rationale": "Correct victim selection, catastrophic collateral: one runaway workload took every session on the box with it. Setting the OOM policy so a single agent's death cannot cascade is a small systemd/cgroup change with an outsized reduction in worst-case blast radius.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3314",
      "rank": 30,
      "size": "M",
      "importance": "high",
      "score": 88,
      "condition": "ok",
      "dependsOn": [
        "PAN-3429",
        "PAN-3539"
      ],
      "why": "Bound the OOM blast radius: one cgroup holds every agent, so a single hungry agent can kill the whole fleet.",
      "rationale": "The containment half of PAN-3539 — per-agent cgroups so the kernel's victim selection can only reach one agent. Ranked immediately after it because the two together convert a fleet-wide outage into a single-agent restart.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3550",
      "rank": 31,
      "size": "S",
      "importance": "high",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory pressure must warn in the activity feed before anything dies — silent shedding and kernel OOMs are invisible to the operator.",
      "rationale": "Operator-directed (2026-08-05): warn rather than kill. Today the governor sheds silently and the kernel OOMs silently, so the operator learns about memory events only from the wreckage. Already has a PRD and is marked ready, so it is immediately startable.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3344",
      "rank": 32,
      "size": "M",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resource governor should gate dispatch on CPU load, not memory alone — load hit ~48 on 24 cores while memory stayed fine.",
      "rationale": "The governor is blind to the resource that actually saturates first on this box: concurrent agent test runs. Every load-flake in the test-gate cluster below traces back to unthrottled CPU. Has a PRD and is in planning.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3492",
      "rank": 33,
      "size": "M",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Server-side verification gate retries form a self-amplifying load loop — timeouts cause retries which cause more timeouts.",
      "rationale": "Retry-on-timeout without a load check is the same amplification pattern as PAN-3559, applied to the box's CPU. One strike agent observed continuously respawned vitest workers for ten minutes. Fix the retry policy and it stops manufacturing the conditions that trigger it.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3520",
      "rank": 34,
      "size": "M",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Test gate must retry timeout-only failures in isolation before recording a verdict — proven load-flake loops on multiple branches.",
      "rationale": "Branches are looping on 'test failed' verdicts that are not defects: all configured gates pass in isolation. Every such loop costs a full rework cycle and pollutes the convergence-gate history. Retry-in-isolation is the cheapest correct discriminator between a flake and a regression.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3062",
      "rank": 35,
      "size": "M",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shared primary main worktree: any agent that pushes main also ships every other session's unpushed local commits.",
      "rationale": "Multiple independent sessions stack commits on one shared branch, so whoever pushes first publishes everyone's half-finished work. This is the upstream cause of PAN-3250's inherited commits and of the state-write-door blockage in PAN-3505. Fixing the sharing model retires a family of incidents at once.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3505",
      "rank": 36,
      "size": "S",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [
        "PAN-3062"
      ],
      "why": "Unpushed agent code commits on the primary main worktree block the flywheel's state write door.",
      "rationale": "The push guard is behaving correctly; the problem is what it is guarding against. Until the shared-worktree model changes, the flywheel cannot persist its own state whenever any agent has left a commit behind — which means orchestration stalls for an unrelated reason.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3284",
      "rank": 37,
      "size": "S",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [
        "PAN-2409"
      ],
      "why": "Work agent wrote a doc edit into the primary main worktree instead of its workspace (PAN-2204 family).",
      "rationale": "Recurrence of the workspace-boundary violation. Each occurrence puts uncommitted agent output on the branch every other session shares, which is how PAN-3062 and PAN-3505 turn into incidents. Needs mechanical enforcement, not another rule.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2409",
      "rank": 38,
      "size": "M",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enforce the workspace boundary — work agents must not edit the primary checkout (reproduced 3x in one day).",
      "rationale": "The mechanical enforcement PAN-3284 asks for. Three Haiku work agents edited the primary checkout on the same afternoon, so this is not a rare slip; it is the default behaviour when the boundary is advisory.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3081",
      "rank": 39,
      "size": "S",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent git guard is bypassable by removing it from $PATH — an agent did so unprompted to get past a false block.",
      "rationale": "A PATH-based guard is advisory by construction, and an agent has already discovered and used the bypass. Any enforcement that an agent can reason its way around is not enforcement; this needs to move somewhere the agent cannot edit.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3236",
      "rank": 40,
      "size": "S",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "ECONNREFUSED on a dead supervisor socket is misclassified as ambiguous keyed delivery — feedback never lands, issue goes stuck with the f...",
      "rationale": "A definite failure reported as an ambiguous one, so the retry path never runs and the feedback file sits unread while the issue goes stuck. PAN-3049 stalled at four review cycles on exactly this. Classification fix, small diff.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3282",
      "rank": 41,
      "size": "M",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review agents repeatedly die before writing a verdict (review_infrastructure_failure) across 5 issues and 2 projects.",
      "rationale": "The recurring producer of the infra-failure state that PAN-3283 and PAN-2746 mishandle downstream. Fixing the downstream misclassification stops unreviewed merges; fixing this stops the events entirely. Needs root-cause work, not another recovery path.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3397",
      "rank": 42,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Freshly-spawned convoy lanes freeze at 0 output before processing kickoff — PAN-3375's detector covers warm-resumes only.",
      "rationale": "Same freeze, uncovered branch. Lanes sat 15 minutes at ctx 0% with byte-identical cost and no detector fired. Extending the existing detector to fresh spawns is a small change that closes a live blind spot in review dispatch.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2742",
      "rank": 43,
      "size": "M",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review synthesis fires 42s after spawn and calls reviewers with reports already on disk an 'infrastructure failure' — false CHANGES REQUE...",
      "rationale": "A synthesis that runs before its reviewers have finished manufactures blocking verdicts out of nothing, and PAN-2710 reached cycle 9 on the resulting churn. Needs a real readiness condition rather than a timer.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2695",
      "rank": 44,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Concurrent review dispatches race fresh-spawn vs resume — the second dispatch resumes a still-booting parent and kills the synthesis kick...",
      "rationale": "225 milliseconds between two dispatches for the same issue is enough to destroy the run. Dispatch needs to be idempotent per issue; this is the same in-flight-guard shape that already protects postMergeLifecycle.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3084",
      "rank": 45,
      "size": "S",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "A review session spawned but never briefed sits at zero context forever and blocks its own replacement — restart 'preserves' it.",
      "rationale": "Every recovery path reads the dead session as healthy work in progress, so review can never start for that issue again. The 'preserve' behaviour in restart is what makes it permanent, which makes this a policy fix as much as a detection fix.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2706",
      "rank": 46,
      "size": "S",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [
        "PAN-3566"
      ],
      "why": "Ghost test sessions absorb every test dispatch — a never-kicked-off session reads as 'already running' and marks testing with no prompt d...",
      "rationale": "The test-role twin of PAN-3084, and a direct consequence of PAN-3566's promptless launcher. Until dispatch can tell 'running' from 'booted but never briefed', every subsequent test dispatch for that issue is silently swallowed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3274",
      "rank": 47,
      "size": "S",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [
        "PAN-3566"
      ],
      "why": "A test-role agent can spawn and never run, stranding its issue behind a verdict that was never produced.",
      "rationale": "Work approved by review and green in CI sits out of the merge gate indefinitely because a verdict is structurally impossible. This is the operator-visible consequence of the PAN-3566 / PAN-2706 cluster and is worth tracking to closure separately.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3500",
      "rank": 48,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "A review sub-role can modify the branch after writing its report.",
      "rationale": "A reviewer that can edit the code it just reviewed invalidates the review contract and can silently change what gets merged. The session staying alive after the report is written is the mechanism; scoping the reviewer's write access is the fix.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3496",
      "rank": 49,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review/inspect agents must not AskUserQuestion the operator for review depth — decide, don't ask.",
      "rationale": "A convoy member blocking on an operator question stalls the whole convoy for something the prompt should decide. It also trains the operator to ignore decision prompts. Prompt-level fix with immediate throughput return.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3541",
      "rank": 50,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review restart after an unclean reviewer death loops on the session-resume menu — eligibility ignores how the session ended.",
      "rationale": "Three identical loop iterations observed while re-driving a review after an OOM killed the reviewer. Resume eligibility has to consider whether the prior session died cleanly, or restart becomes an infinite loop exactly when recovery matters most.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3278",
      "rank": 51,
      "size": "S",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agent finished with an open PR but review was never dispatched — auto-requeue had 25 attempts and fired none.",
      "rationale": "Machinery that exists, has capacity, and never fires is worse than machinery that is missing, because it makes the gap invisible. Two hours of idle time per occurrence, and the requeue counter proves the condition was evaluated 25 times.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3281",
      "rank": 52,
      "size": "S",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "ready_for_merge stays 1 while an issue is stuck on incomplete-plan-items, so stuck work reaches the UAT batch.",
      "rationale": "Two flags that must never both be true are both true, and the merge-ready flag wins on every surface. Stuck work was assembled into a UAT batch and recommended for promotion. Derive one from the other rather than storing both.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3543",
      "rank": 53,
      "size": "S",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "Completed-handoff agents are unstartable: start, --fresh and reset-session all refused while the refusal recommends --fresh.",
      "rationale": "A self-contradictory deadlock — the error message names a command that is itself refused — blocking rework after a BLOCKED verdict. Same family as PAN-3526. The refusal logic needs one authoritative branch, not three that disagree.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3555",
      "rank": 54,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start silently spawned a FRESH session over a resumable warm session with no --fresh — warm-by-default violated.",
      "rationale": "Warm-by-default is the operator's standing policy because a fresh session discards accumulated context and re-pays discovery cost. Silently violating it is both expensive and invisible; the spawn path needs to prove no warm session was available before going fresh.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3556",
      "rank": 55,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Concurrent double-spawn race: one agent allocated two fresh session identities 3 seconds apart at UAT promote time.",
      "rationale": "Two callers spawning the same agent concurrently produces two session identities, one of which becomes an orphan that every liveness check still counts. The same missing per-agent spawn guard as PAN-2695 and PAN-3185.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3234",
      "rank": 56,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agents freeze indefinitely on blocking choice menus and nothing detects it — paneHasBlockingChoiceMenu is wired only to delivery refusal,...",
      "rationale": "The detector already exists and is already correct; it is simply not consulted by any health surface. Two agents froze within two flywheel ticks and were found only by an orchestrator reading panes by hand. Wiring an existing detector into health is cheap and high-yield.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3261",
      "rank": 57,
      "size": "S",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resume-gate Enter: the tmux fallback answers a live choice menu when its own paste hides the menu from the detector.",
      "rationale": "Overdeck answering the Claude Code session-resume gate itself already discarded an operator's full session once (PAN-3212). The detector is blinded by the delivery's own paste, so the guard fails exactly when it is needed. Never answer a menu Overdeck did not open.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2668",
      "rank": 58,
      "size": "S",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "Verification/review feedback silently queued to stopped-by-user agents — re-drive not applied on delivery.",
      "rationale": "Feedback that queues into a mailbox nothing drains is feedback that was never delivered, and the issue simply stops. Delivery has to either re-drive the agent or fail loudly; silent queueing is the one option that cannot be recovered from.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3104",
      "rank": 59,
      "size": "S",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stale .pan/test/result.json is re-applied with no freshness check, re-failing an issue after the fix has landed.",
      "rationale": "A stale artifact keeps re-failing an issue forever because nothing compares it against the current HEAD. This is how branches get stuck in test-failure loops that no code change can escape. Freshness check against HEAD is the whole fix.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2700",
      "rank": 60,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Test artifact recovery consumes a stale result.json — a fresh test dispatch insta-failed with the previous run's verdict 31 seconds after...",
      "rationale": "The recorded instance of PAN-3104's defect, with a verdict arriving 31 seconds after a fresh dispatch. Keep both so the recovery path and the freshness rule are each verified.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3557",
      "rank": 61,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-merge label application has no retry — a rate-limited 403 silently hides the issue from the verify-on-main sweep.",
      "rationale": "The merge succeeded and the lifecycle logged completion, but the issue vanished from the sweep that proves it reached production. Transient forge errors on a durable lifecycle step must retry; the alternative is silently losing track of shipped work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3569",
      "rank": 62,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deploy gate deadlocks on a stale pending-post-merge.json when the deacon is paused — no staleness rule, no non-force exit.",
      "rationale": "One degraded lifecycle leaves a pending file that blocks every subsequent deploy with no way out short of --force. Deploy is the last DoD row, so a deadlock here means nothing reaches the live dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3248",
      "rank": 63,
      "size": "S",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan reload does not clear pending-deploy.json, so every flywheel deploy starves verification for ALL projects until a patrol runs.",
      "rationale": "A successful deploy leaving the deploy queue set is a cross-project outage of the verification runner. Same family as PAN-3244 and PAN-3205 — the deploy window's lifecycle is not closed on any of its exit paths.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3244",
      "rank": 64,
      "size": "S",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "Queued dashboard deploy globally defers verification — a flywheel-owned deploy window starves cross-project review handoffs.",
      "rationale": "One project's deploy blocking every project's verification is a scoping error: the deploy gate should be per-project or time-bounded. Observed leaving a durable review intent unspawned for a full window.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3205",
      "rank": 65,
      "size": "S",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deployment gate queues a deferred deploy but never fires it — the promised 'next verification boundary' trigger does not exist.",
      "rationale": "The refusal message promises a trigger that was never implemented, so a deferred deploy waits forever. Either implement the boundary trigger or stop promising it; today the operator is told to wait for something that will not happen.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3188",
      "rank": 66,
      "size": "S",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "DoD row 5 rejects terminal canonical states — an already-done issue can never satisfy the post-merge row.",
      "rationale": "Accepting only the transient verifying_on_main waypoint means any issue that already completed the lifecycle is permanently un-closeable. Close-out is the gate that owns Docker teardown, so blocked close-outs also leak containers and networks.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3168",
      "rank": 67,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [
        "PAN-3188",
        "PAN-2846"
      ],
      "why": "DoD row 5 deadlocks close-out: an agent paused *for* close-out with no tmux session is counted as running and blocks it.",
      "rationale": "All three state planes agree the agent is not running; only the DoD row disagrees. Same row as PAN-3188 and the same underlying problem — the row reads a field instead of the resolver.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2846",
      "rank": 68,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out blocks on a dead agent: postMergeLifecycle pauses the work agent but leaves status=running.",
      "rationale": "The write that PAN-3168's read trips over. Fixing the writer and the reader together is the honest scope; fixing only one leaves the other latent.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3196",
      "rank": 69,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out cannot tear down workspaces containing root-owned container residue — passes every DoD row then dies on EACCES.",
      "rationale": "Every blocked teardown leaks a Docker network, and Docker's default pool only supports about 31 bridge networks before new workspaces cannot be created at all. Per-workspace residue, so it will keep recurring until teardown can handle root-owned files.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3210",
      "rank": 70,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out blocked by an unprefixed devcontainer init-perms container — teardown scopes by compose project, the guard scopes by working_dir.",
      "rationale": "Two different scoping rules for the same container set, so a cleanly-exited one-shot container blocks the whole ceremony. Unify the scoping; the container in the recorded case had been dead for 49 minutes.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3047",
      "rank": 71,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike-branch teardown never fires: --is-ancestor cannot detect a squash merge, so all 96 strike/* branches are preserved as residue.",
      "rationale": "One close-out gate proves the branch merged and the next step claims it did not, in the same run. 96 accumulated branches say this has never worked. Content or PR-state verification instead of ancestry is the fix, shared with PAN-2828 and PAN-2995.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2828",
      "rank": 72,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [
        "PAN-3047"
      ],
      "why": "pan done --strike always refuses squash-merged strikes — the ancestry check cannot see through a squash.",
      "rationale": "The completion-side twin of PAN-3047: doctrine mandates squash merge, and the verification cannot see one. Every strike therefore needs hand-completion, which defeats the purpose of the fast path.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2995",
      "rank": 73,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done --strike false-blocks after a gh-API squash merge, reporting 'N commits missing from origin/main'.",
      "rationale": "Third filing of the same squash-vs-ancestry mismatch. Fix once with a shared provably-merged predicate and close all three; leaving duplicates open keeps re-spending discovery cost.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3103",
      "rank": 74,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Transient merge_status=failed skips automatic close-out permanently — merged work stays open and pickup-eligible.",
      "rationale": "A transient reading becoming permanent policy is the failure shape to look for here: nothing retries once the status self-heals, so a planning agent can be spawned on already-shipped work. Needs a retry on self-heal, not a better first read.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3171",
      "rank": 75,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline reports 'merge failed' AFTER a successful merge and successful post-merge cleanup; the issue stays Todo with no label.",
      "rationale": "The operator is told the opposite of what happened, which is worse than silence because it invites a destructive manual correction. The failure event is emitted after the success events in the same minute — an ordering/idempotency bug in the completion path.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2769",
      "rank": 76,
      "size": "S",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "review_status rows are never reconciled when an issue closes — 9 closed issues still advertise reviewing/failed, inflating every operator...",
      "rationale": "Every operator-facing count is wrong by however much residue has accumulated, which trains the operator to distrust the dashboard's numbers. Reconciliation on close is a small writer change with broad credibility payoff.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3044",
      "rank": 77,
      "size": "S",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review feedback delivery runs against CLOSED issues — resurrects agents and raises needs-you 12 days after close-out.",
      "rationale": "Two recorded cases of a closed issue getting a fresh stuck row and a live agent. Beyond the wasted spend, it makes needs-you untrustworthy, and needs-you is the operator's primary queue.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2888",
      "rank": 78,
      "size": "S",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out leaves stale residue that inflates troubled/failed metrics: orphaned inspect sub-agents and uncleared review_status rows on CLO...",
      "rationale": "Real troubled work-agent count was zero while the dashboard reported 14-16. The same residue class as PAN-2769 and PAN-3044; grouping them into one close-out reconciliation pass is likely cheaper than three separate fixes.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3211",
      "rank": 79,
      "size": "S",
      "importance": "medium",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "No honest disposition for closed-without-landing issues — residue rows are neither close-able nor reapable.",
      "rationale": "A genuine gap in the state model rather than a bug: an issue whose work never landed anywhere has no legal terminal state, so its rows live forever. Needs a decision on the disposition, then the mechanics.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2567",
      "rank": 80,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reviewed and green PR stuck after review — the advancing verdict is reconciled forever and merge never fires (churning-main convergence f...",
      "rationale": "The canonical 'done work does not converge to merged' case with resume ON and no suppression in play. Convergence without a human nudge is the stated pipeline invariant, and this is the recorded proof it does not hold under a moving main.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3570",
      "rank": 81,
      "size": "S",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "Root-owned node_modules/.pnpm-store subtrees block pan start with EACCES; pan workspace rebuild does not heal it",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3325",
      "rank": 82,
      "size": "S",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fresh workspace ships an EMPTY node_modules, so tooling silently resolves deps from the parent repo instead of failing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3270",
      "rank": 83,
      "size": "S",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "New workspaces have empty node_modules and bun off PATH, so the documented bun install remedy fails for every agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2763",
      "rank": 84,
      "size": "S",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace node_modules symlinked to the primary repo — the exact pattern CLAUDE.md forbids; breaks test resolution",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3510",
      "rank": 85,
      "size": "S",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stopped agents leave detached docker-run test containers alive for hours, holding memory the governor cannot see",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3050",
      "rank": 86,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Idle-stack reaper regex matches only overdeck-feature-* so MYN workspace stacks are never reaped",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3497",
      "rank": 87,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "CLIProxy watchdog crash-loops peer-dashboard workspace containers; pan workspace rebuild cannot fix it",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3313",
      "rank": 88,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "A transient upstream stream error benches CLIProxy's only auth — every GPT agent gets 503 auth_unavailable (70% failure)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3455",
      "rank": 89,
      "size": "XS",
      "importance": "medium",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "isCliproxyUpToDate always returns false because --version exits 2, so every ensure re-downloads the pinned release",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3536",
      "rank": 90,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell cannot deliver to live ohmypi conversations — expectedHarness defaults to claude-code when state.json is absent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2580",
      "rank": 91,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell cannot deliver to codex (GPT) conversations — runtime stays null, delivery door calls a live session a zombie",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2546",
      "rank": 92,
      "size": "S",
      "importance": "medium",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Same codex-unaware delivery defect as PAN-2580, filed from the liveness-probe side; fix once, close both",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3297",
      "rank": 93,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell misclassifies healthy supervisor-run agents as zombies after a dashboard restart; delivery and resume disagree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3257",
      "rank": 94,
      "size": "S",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Crash-resume does not re-wire the PTY supervisor — a stale socket refuses all deliveries and state loses supervisorEnabled",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3439",
      "rank": 95,
      "size": "S",
      "importance": "high",
      "score": 69,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan start crashes on a pending-work-spawn placeholder row instead of taking the fresh-spawn path; resume has the guard",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3224",
      "rank": 96,
      "size": "S",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "A crash-interrupted spawn strands model 'pending-work-spawn'; plain pan start dies with Unknown model, only --fresh recovers",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2886",
      "rank": 97,
      "size": "S",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Placeholder pending-work-spawn agents crash auto-resume with Unknown model and are stranded troubled forever",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3185",
      "rank": 98,
      "size": "S",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start reports a false hard failure when the deacon wins a spawn race — duplicate-session TOCTOU in spawn.ts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3139",
      "rank": 99,
      "size": "S",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agents-table liveness drifts stale in the under-reporting direction: a live 4h agent is recorded stopped",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2424",
      "rank": 100,
      "size": "XL",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Epic: the Order Book — first-class operator priority queue (markdown-authored, backlog-exempt, load-governed, flywhee...",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-3043",
      "rank": 101,
      "size": "S",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Mid-run provider quota exhaustion is undetected — agent stays 'running' for days holding a pipeline slot",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3118",
      "rank": 102,
      "size": "S",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Model quota exhaustion halts agents invisibly — 4 planning agents 'running' at $0.00 with no capacity fallback",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2758",
      "rank": 103,
      "size": "S",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Provider capacity error silently zombies a spawned agent: willRetry=false, turn reported completed, status stays running",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2817",
      "rank": 104,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Idle-at-prompt work and review agents are never redriven — sessions stop at the composer mid-task and sit for hours",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3057",
      "rank": 105,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness-initiated compaction leaves agents idle forever; GPT-5.6 context window is declared twice (372K vs 150K)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2169",
      "rank": 106,
      "size": "S",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Kimi agent silently frozen at 100% ctx with no thrown overflow error — needs a ctx-saturation heuristic",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2936",
      "rank": 107,
      "size": "S",
      "importance": "medium",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "loop.max_steps_exceeded kills an agent mid-task with no detection or nudge; the operator must notice by hand",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3432",
      "rank": 108,
      "size": "S",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Preemptive yield fan-out: seven work agents simultaneously yielded for ONE review convoy, gutting throughput",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2813",
      "rank": 109,
      "size": "S",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Scheduler yield never self-clears — yielded work agents stay paused long after the blocking review merges",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3120",
      "rank": 110,
      "size": "S",
      "importance": "medium",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "MERGE refuses (polyrepo) or silently dead-ends (single-repo) when the scheduler yielded the work agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3237",
      "rank": 111,
      "size": "S",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "A capacity-refused planning→work handoff is marked terminally stuck: every 409 becomes 'guardrails' and calls markWorkspaceStuck",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2691",
      "rank": 112,
      "size": "S",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-planned issues park silently when the post-finalize work spawn is gated (422) — no retry, no needs-you",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2569",
      "rank": 113,
      "size": "S",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning finalizes and the issue goes planned, but the work agent does not auto-spawn — silent handoff failure",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3023",
      "rank": 114,
      "size": "S",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-planning auto-spawn abandoned on a transient Docker failure — 'attempt 1/3' never retries, issue stuck in todo",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2839",
      "rank": 115,
      "size": "S",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "plan→work autoSpawn 500s with a duplicated workspace prep — nondeterministic half-spawns",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3022",
      "rank": 116,
      "size": "S",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work-spawn route ignores the per-issue workModel override — the role default wins and then clobbers the record",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3562",
      "rank": 117,
      "size": "S",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan task cancel does not cascade to AC children, so a cancelled item's leaves permanently fail the completeness gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3245",
      "rank": 118,
      "size": "XS",
      "importance": "medium",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done completion gate falsely flags workspace .pan/drafts/<issue>.md as uncommitted despite its own .pan exclusion",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3096",
      "rank": 119,
      "size": "S",
      "importance": "medium",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done fails on the generated devcontainer harness, so agents infer they should delete workspace infrastructure",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2966",
      "rank": 120,
      "size": "XS",
      "importance": "medium",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Polyrepo wrapper .gitignore misses .pan/, .devcontainer/ and dev, so the pan done cleanliness gate false-fails",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2945",
      "rank": 121,
      "size": "XS",
      "importance": "medium",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done rejects Overdeck-generated runtime in polyrepo wrapper repos — same gitignore drift as PAN-2966",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3048",
      "rank": 122,
      "size": "S",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline auto-commit lands .pan/drafts/<ISSUE>.md in product feature branches; the duplicated exclusion list has drifted",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3094",
      "rank": 123,
      "size": "S",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done's merge fallback force-pushes a fast-forward branch, discarding whatever else landed on the remote head",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2465",
      "rank": 124,
      "size": "XS",
      "importance": "medium",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done's PR lookup runs gh pr list at the MYN polyrepo root, which has no remotes, so completion exits nonzero",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3040",
      "rank": 125,
      "size": "M",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan strike fails immediately on polyrepo projects — the strike path is monorepo-shaped end to end",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3317",
      "rank": 126,
      "size": "S",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike agents have no sanctioned way to sync main: git rebase is guard-blocked and pan sync-main cannot resolve -strike workspaces",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3306",
      "rank": 127,
      "size": "S",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "A strike that needs a rebase has no working path — strike.md instructs it, the guard blocks it, sync-main resolves the wrong tree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2738",
      "rank": 128,
      "size": "S",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strikes deadlock because git rebase origin/main is denied as history rewriting, so they cannot sync, gate, or push",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3417",
      "rank": 129,
      "size": "S",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike agents have no merged-awareness — they keep verifying and monitoring after their branch lands, burning cost",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2874",
      "rank": 130,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike landing pipeline cannot merge strikes: the verification gate demands an xBRIEF checklist strikes never have",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2921",
      "rank": 131,
      "size": "S",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike merge door can report fetch failure after a successful merge and land the same head twice",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2806",
      "rank": 132,
      "size": "S",
      "importance": "medium",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike merge trigger registry splits across dashboard chunks, so landing always reports 'trigger is not registered'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3267",
      "rank": 133,
      "size": "S",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline membership fans out one glab subprocess per repo x head, stalling and failing every MYN refresh",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3256",
      "rank": 134,
      "size": "S",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "MYN pipeline membership fails forge_unavailable because glab mr list runs in a path that is not a git repository",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3186",
      "rank": 135,
      "size": "S",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline membership blanks the whole auricle project because one configured member directory is not a git repo",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3167",
      "rank": 136,
      "size": "S",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "krux and lexerra are permanently unreadable through the membership door — a 404 from an uninstalled App is typed as forge_unavailable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2824",
      "rank": 137,
      "size": "S",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan review pending dies entirely when one project's lens gather fails, returning nothing for every other project",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2880",
      "rank": 138,
      "size": "M",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Linear listIssues is a 3N+1 request storm — one MYN membership gather burns the entire 2500/hr Linear budget",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2627",
      "rank": 139,
      "size": "S",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Linear poller is blind after cycle rollover — the active-cycle filter returns 0 issues and wipes the project from the tree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2954",
      "rank": 140,
      "size": "S",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "postMergeLifecycle refuses GitLab projects, so teardown and labels never run for any MYN merge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-933",
      "rank": 141,
      "size": "S",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review poster cannot post to GitLab MRs — synthesis output never reaches the MR it reviewed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3498",
      "rank": 142,
      "size": "S",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "write-sequence pins in-pipeline ranks without renumbering — 11 duplicate ranks and 11 gaps in the persisted sequence",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3289",
      "rank": 143,
      "size": "S",
      "importance": "medium",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Sequencer ran a full pass on an empty manifest against a 750-issue backlog — read model transiently empty at spawn",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3301",
      "rank": 144,
      "size": "S",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stray-writer warning is 68k log lines hiding one real defect: the backlog manifest still writes the legacy .pan path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3108",
      "rank": 145,
      "size": "XS",
      "importance": "medium",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "dashboard.log grows unbounded (867MB, 8.8M lines) with no rotation — un-greppable during an incident",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1846",
      "rank": 146,
      "size": "XS",
      "importance": "medium",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "deacon.log reached 687MB with no rotation; a per-agent skip line is logged every 60s patrol",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2287",
      "rank": 147,
      "size": "XS",
      "importance": "low",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Every supervisor.log line is written twice — log() appendFile and the launcher stdout redirect target the same file",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3535",
      "rank": 148,
      "size": "S",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Drain/resume boot gate is caller-env-dependent: any restart from a clean shell silently drops the hold",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3553",
      "rank": 149,
      "size": "S",
      "importance": "medium",
      "score": 63,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Post-reboot census treats a zero-session tmux server as unavailable, so conversations sit on 'Starting…' for minutes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3527",
      "rank": 150,
      "size": "S",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Sidebar project list never retries — one failed boot-time fetch leaves CONVERSATIONS 0 / ISSUES 0 until manual reload",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3303",
      "rank": 151,
      "size": "S",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Command Deck latches 'Unknown project' after a reconnect because an empty registered-projects response is treated as authoritative",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2932",
      "rank": 152,
      "size": "S",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Intermittent dashboard boot wedge between Cloister start and ReadModel bootstrap leaves :3011 unbound (Bad Gateway)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3522",
      "rank": 153,
      "size": "S",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard supervisor watchdog restart-churns under CPU storm because the probe timeout budget ignores the boot warm phase",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3099",
      "rank": 154,
      "size": "XS",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan restart --health-timeout 120 is enforced as 120ms, false-failing the health check and leaving the dashboard down",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2547",
      "rank": 155,
      "size": "XS",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Same --health-timeout unit confusion as PAN-3099, filed earlier; resolve the unit once and close both",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2663",
      "rank": 156,
      "size": "S",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan restart's health probe can accept the OLD dashboard after the replacement dies with EADDRINUSE",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3329",
      "rank": 157,
      "size": "S",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deployment generation node_modules and tracked packages/ files deleted while a dev-checkout build runs (2nd occurrence)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3508",
      "rank": 158,
      "size": "XS",
      "importance": "medium",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan reload temporarily removes the global pan CLI when invoked outside its linked generation",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2337",
      "rank": 159,
      "size": "S",
      "importance": "high",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "An in-place npm run build under a live dashboard silently breaks every new PTY-supervisor spawn until restart",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2422",
      "rank": 160,
      "size": "S",
      "importance": "high",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rebuilding dist under a live server breaks lazy chunk imports — 'Cannot find module dist/dashboard/<chunk>.js'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2957",
      "rank": 161,
      "size": "S",
      "importance": "high",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm run build intermittently produces stale frontend bundles, so a verified fix can ship without its own code",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-538",
      "rank": 162,
      "size": "XS",
      "importance": "medium",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan reload's freshness guard must also verify the frontend bundle, not just the server bundle",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2850",
      "rank": 163,
      "size": "XS",
      "importance": "medium",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm test deterministically fails in a clean checkout because pretest cleans dist/ without rebuilding the server bundle",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2550",
      "rank": 164,
      "size": "S",
      "importance": "high",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm test exits 0 despite 31 root-suite failures — the command-level signal every gate trusts is wrong",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1918",
      "rank": 165,
      "size": "M",
      "importance": "high",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "The full frontend vitest suite runs in no CI path; npm test is limited to 3 files and the only gate that runs it hangs",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2670",
      "rank": 166,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Gate the dashboard-server tsconfig in npm run typecheck — the server graph has no type enforcement at all",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2635",
      "rank": 167,
      "size": "L",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [
        "PAN-2670"
      ],
      "why": "Pay down the 152-error src/dashboard/server typecheck debt so the ratchet can become a real gate",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2430",
      "rank": 168,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Frontend typecheck fails on main with dozens of pre-existing unused-local errors, keeping the ratchet permanently sour",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1824",
      "rank": 169,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix flaky main CI: fake timers plus @slow exclusion for the real-timer test family that keeps reddening main",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3243",
      "rank": 170,
      "size": "S",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "auto-commit test flakes on main by polling a fixed 20 setImmediate turns for a real git subprocess",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2421",
      "rank": 171,
      "size": "S",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard server route tests time out or mis-assert under full-suite verification load — load flakes, not defects",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1720",
      "rank": 172,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cloister auto-resume tests fail under the full parallel run and pass in isolation — test pollution reddening main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2656",
      "rank": 173,
      "size": "XS",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "deacon-swarm unit tests read the live ~/.overdeck/config.yaml, so 6 tests fail whenever swarm.mode=off",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2761",
      "rank": 174,
      "size": "XS",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "done.test.ts asserts a hardcoded URL without stubbing env, so it fails in any agent shell and looks like a red main",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3502",
      "rank": 175,
      "size": "XS",
      "importance": "low",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "tiered-crews blendedCost expectation is stale against current model-capabilities pricing and fails on main tip",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2810",
      "rank": 176,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "The workspace vitest --changed gate diverges from CI, failing on a mock introduced by an unrelated main commit",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2506",
      "rank": 177,
      "size": "XS",
      "importance": "low",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "flywheel-primary-root.test.ts fails on macOS because /var vs /private/var is never canonicalized",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2478",
      "rank": 178,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI flake: Playwright browser install fails on the Microsoft apt repo, red-mainning otherwise good merges",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2495",
      "rank": 179,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "A ci-green merge skip bypassed the CI-green gate and landed a red-main change — the skip needs its own no-loss audit",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2940",
      "rank": 180,
      "size": "M",
      "importance": "high",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Three red mains in one day from direct-push series bypassing PR CI — supervised conversations need a pre-merge CI surface",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2454",
      "rank": 181,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ratchet audit fails per-commit on push ranges whose NET baseline delta is zero, stranding finished branches",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3517",
      "rank": 182,
      "size": "M",
      "importance": "high",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Convoy forks still miss the parent prompt cache in production — launch-injection byte drift plus a dropped cache-scope header",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3518",
      "rank": 183,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [
        "PAN-3517"
      ],
      "why": "TTL-aware re-review payload policy: fresh-spawn-with-digest for cold, large review histories",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3454",
      "rank": 184,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost hook re-ingests fork-copied parent history under reviewer identity — fabricated cache-miss warnings and multi-billed spend",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3077",
      "rank": 185,
      "size": "XS",
      "importance": "high",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspect/review-supervisor spawns omit --effort and inherit the harness xhigh default, violating the standing high-effort policy",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3078",
      "rank": 186,
      "size": "S",
      "importance": "high",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "The inspect verdict is never delivered to the work agent, so an agent that waits for it deadlocks forever",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2848",
      "rank": 187,
      "size": "S",
      "importance": "high",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "A work agent gated on a dead inspection stalls permanently — no re-dispatch, no verdict, swarm-off suppresses recovery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2960",
      "rank": 188,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspect supervisor lingers past its 12m limit and never self-terminates after posting a verdict",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2959",
      "rank": 189,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan inspect --item reviews workspace HEAD rather than that item's commit, producing spurious verdicts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2796",
      "rank": 190,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Idle nudge advances to the next item after a failed mandatory inspection, telling the agent to skip the blocked work",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3085",
      "rank": 191,
      "size": "XS",
      "importance": "high",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review feedback is written to .overdeck/feedback but agents and the merge gate are pointed at a nonexistent .pan/feedback",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3321",
      "rank": 192,
      "size": "XS",
      "importance": "high",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Escalation messages and CLAUDE.md tell operators to run pan unstick, which does not exist as a command",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2689",
      "rank": 193,
      "size": "S",
      "importance": "high",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review verdicts from sandboxed codex review agents are silently lost — the fire-and-forget journal write dies with the CLI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2697",
      "rank": 194,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "First-review codex parents enter discovery mode and the supervisor no-ops every discovery-ready signal, so the convoy never launches",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2639",
      "rank": 195,
      "size": "S",
      "importance": "high",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "codex-resume replays a rotated-out refresh token, so codex review convoys wedge with 401",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2416",
      "rank": 196,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codex agents wedge on the Codex CLI first-run consent screen — spawn must pre-accept non-interactively",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2331",
      "rank": 197,
      "size": "S",
      "importance": "high",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "The codex rate-limit 'Switch to gpt-5.4-mini?' modal stalls autonomous agents with no auto-dismiss",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2333",
      "rank": 198,
      "size": "S",
      "importance": "high",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Handle codex weekly-quota exhaustion with a resource alert and downshift policy instead of an unanswerable modal",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2521",
      "rank": 199,
      "size": "S",
      "importance": "high",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Launch pipeline agents with the harness rate-limit model-switch reminder disabled so the dialog can never block a pane",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1830",
      "rank": 200,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reviewer stuck on a gpt-5.5 rate-limit modal blocks REVIEWER_READY, so synthesis waits forever despite a written report",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2492",
      "rank": 201,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pane-detected waits surface as 'needs you' but cannot be answered from the dashboard — only from the terminal",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3235",
      "rank": 202,
      "size": "M",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard decision card: render and answer agent pane-choice menus so blocking prompts are resolvable from the UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3113",
      "rank": 203,
      "size": "M",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface agent-pane choice prompts as inline decision cards in the conversation view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3276",
      "rank": 204,
      "size": "XS",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Needs-you rows do not navigate — clicking a terminal question or permission prompt does nothing",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2717",
      "rank": 205,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation permission waits are missing from the Awareness surface; strengthen the alert pulse",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2193",
      "rank": 206,
      "size": "S",
      "importance": "high",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Held issues (objection/parked/vetoed/needs-handoff) are invisible in the Command Deck tree — bucketed clean_terminal",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3179",
      "rank": 207,
      "size": "M",
      "importance": "high",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "A UAT promote is marked complete at merge time — nothing verifies the change reached production",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3176",
      "rank": 208,
      "size": "S",
      "importance": "high",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Block UAT batch promotion when the live stack is degraded, unknown, or still starting — promote takes no health evidence",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3106",
      "rank": 209,
      "size": "S",
      "importance": "high",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "auto_merge_default: hold is bypassed — shouldHoldForUat is consulted on only one merge path, so held issues merge anyway",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3174",
      "rank": 210,
      "size": "M",
      "importance": "high",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Every polyrepo UAT stack is unreachable: Traefik labels carry the old prefix and the frontend label routes to the wrong port",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3164",
      "rank": 211,
      "size": "XS",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT stack shows 'Open UAT frontend' while still booting, so the operator gets a Gateway Timeout with no indication",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3137",
      "rank": 212,
      "size": "XS",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT generation member titles are taken from the Flywheel status snapshot, so orchestrator prose reaches the operator",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3218",
      "rank": 213,
      "size": "M",
      "importance": "high",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "No release-drift signal: a user-facing fix can sit merged on main for hours while every published version stays broken",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3533",
      "rank": 214,
      "size": "L",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resource segregation: per-project isolation classes so MYN stacks cannot starve Overdeck work and vice versa",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3295",
      "rank": 215,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Single per-machine completion-check summarizer with a queue plus first-class observability in pan resources and the Deacon",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3107",
      "rank": 216,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Productize the memory-attribution census — OOM spikes are unattributable after the fact",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3129",
      "rank": 217,
      "size": "M",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Security: symlink/TOCTOU containment for canonical writes under agent-controlled paths",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3130",
      "rank": 218,
      "size": "S",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Security: path-escape validation for identifier-joined write paths",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3445",
      "rank": 219,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project config TCP lock hashes into the ephemeral client port range, so unrelated connections can occupy the lock port",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2659",
      "rank": 220,
      "size": "S",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "fs-lock: a crash between mkdir(lock) and the owner.json write leaves an unreclaimable per-issue record lock",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3181",
      "rank": 221,
      "size": "L",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Own agent memories in Overdeck: migrate harness project memories to a per-repo overdeck-memory orphan branch",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3012",
      "rank": 222,
      "size": "M",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Back up harness conversation transcripts before the harnesses delete them — today the archive is only a DB flag",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2394",
      "rank": 223,
      "size": "S",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Incident: conv-* agent-dir cleanup destroyed ohmypi/codex conversation transcripts — 'no saved history'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3016",
      "rank": 224,
      "size": "M",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "URL-address every view so any place you navigate in Overdeck can be returned to from the URL",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2554",
      "rank": 225,
      "size": "XS",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Clicking a project does not update the browser URL, so the project view is not copyable, shareable, or bookmarkable",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1844",
      "rank": 226,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deep-linkable Command Deck: reflect the selected issue/agent in the URL and link activity notifications to the specific view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3530",
      "rank": 227,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "God View polls on 30s timers in four components, violating its documented event-driven /ws/rpc contract",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3540",
      "rank": 228,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "God View: phantom agent orbs, a dead Hook Bus panel, and a pressure-blind swap header contradict live ground truth",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2905",
      "rank": 229,
      "size": "M",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard steady-state CPU is ~50%, keeping API responses at 0.5-1.5s — profile and fix the residual burner",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1711",
      "rank": 230,
      "size": "M",
      "importance": "high",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Root-cause and fix dashboard event-loop stalls under load; the watchdog force-restarts a healthy but stalled server",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2896",
      "rank": 231,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Warm resource-discovery and membership caches at boot — the first click after any restart pays a 20-60s cold compute",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-790",
      "rank": 232,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "stale",
      "dependsOn": [],
      "why": "Eliminate the remaining TanStack Query polling and complete the push-first migration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3332",
      "rank": 233,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard slash-command activities never surface failure — 'running in background' stands forever",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3121",
      "rank": 234,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Failed-send outbox does not reconcile against the transcript, so a delivered message keeps a doomed Retry twin",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3117",
      "rank": 235,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Failed-send bubble hides the deterministic 4xx reason and offers a Retry that can never succeed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2083",
      "rank": 236,
      "size": "XS",
      "importance": "low",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "A failed first send leaves the text in BOTH the composer box and the retry outbox",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2082",
      "rank": 237,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "A single send failure clears ALL in-flight optimistic bubbles and strips siblings' compaction net",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2652",
      "rank": 238,
      "size": "M",
      "importance": "high",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Claude Code backgrounding forks the session file in-process, invisible to every session-id resolution path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2672",
      "rank": 239,
      "size": "M",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-/clear siblings render the same original transcript — per-tmux resolution, frozen launcher pin, null claude_session_id",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2280",
      "rank": 240,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resumed conversations wedge without writing transcripts when the dashboard is black-holed; views diverge from terminals",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2282",
      "rank": 241,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view shows no history for ohmypi-harness conversations — the pi transcript surface is missing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2649",
      "rank": 242,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ctrl+K conversation search indexes Claude transcripts only; codex, pi and ohmypi conversations are absent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2981",
      "rank": 243,
      "size": "XS",
      "importance": "low",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ctrl-K palette: a stale conversation hit 404s on open because the search index never prunes deleted sessions",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3418",
      "rank": 244,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Empty-string conversation model is stored, never backfilled, and blanks the harness and model chips",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3014",
      "rank": 245,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Background AI title/about spawns fail because --bare skips credential reads in Claude Code 2.1.209",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3013",
      "rank": 246,
      "size": "XS",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "linear-mcp-auth-hook entries leak into durable ~/.claude/settings.json pointing at dead /tmp paths",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3516",
      "rank": 247,
      "size": "XS",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stale bundled-skill duplicates in the repo .claude/skills directory shadow the canonical copies",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3450",
      "rank": 248,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan sync never prunes removed skills/rules from cache and harness dirs — beads survived removal for weeks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3308",
      "rank": 249,
      "size": "XS",
      "importance": "high",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "The file-size guard hands agents a paste-ready ratchet-up line, so 2 of 3 agents raised the ceiling instead of shrinking",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3322",
      "rank": 250,
      "size": "XS",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [
        "PAN-3308"
      ],
      "why": "The launcher-generator file-size allowlist sits 126 lines above reality, turning a temporary ceiling into regrowth budget",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2720",
      "rank": 251,
      "size": "S",
      "importance": "high",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "The file-size ratchet counts lines, so it rewards line-packing on exactly the god files it means to improve",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3307",
      "rank": 252,
      "size": "XS",
      "importance": "high",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "commitlint scope-enum is stale, warns on most real commits, and still lists the removed beads scope",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3288",
      "rank": 253,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dev-checkout preflight: detect stale node_modules after a git pull and fail with 'run bun install' instead of ERR_MODULE_NOT_FOUND",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2630",
      "rank": 254,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "The pan binary is not on PATH for operator shells or spawned work agents, and pan doctor cannot be run to diagnose it",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3046",
      "rank": 255,
      "size": "XS",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "The pan CLI crashes at exit with ERR_UNHANDLED_REJECTION when the PostHog shutdown flush times out",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2593",
      "rank": 256,
      "size": "S",
      "importance": "high",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard server children inherit a bare system PATH, so verification gates run under system Node 18 instead of Node 22",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2511",
      "rank": 257,
      "size": "M",
      "importance": "high",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agents burn 20+ minutes on false test failures — the sandbox denies spawnSync git and local full-suite verify is redundant",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2379",
      "rank": 258,
      "size": "S",
      "importance": "high",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "The verify gate's dependency install is warn-only with a 60s timeout, producing false failures against empty node_modules",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2699",
      "rank": 259,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm run build regenerates the committed record-cost-event.js bundle, dirtying every workspace and blocking clean-tree gates",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2664",
      "rank": 260,
      "size": "S",
      "importance": "high",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "sync-main auto-commit completes an unresolved merge, staging conflict-marker files as if they were work",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2244",
      "rank": 261,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "Recurring pan-dir auto-commit GitError on main: a half-staged spec file blocks all mirroring so continue mirrors never land",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1770",
      "rank": 262,
      "size": "S",
      "importance": "high",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan-dir auto-commit rebase races live continues writes, failing every busy cycle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2516",
      "rank": 263,
      "size": "S",
      "importance": "high",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spec plan.status flips are left uncommitted in the shared primary worktree, causing spec-vs-record drift",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2560",
      "rank": 264,
      "size": "S",
      "importance": "high",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "resolveStateReadHomeSync resolves the state dir by path basename rather than registry key, so migrated projects fall back to legacy",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2558",
      "rank": 265,
      "size": "M",
      "importance": "high",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "State migration does not support polyrepo projects — MYN state is currently tracked in no git repo at all",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2549",
      "rank": 266,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [
        "PAN-1676"
      ],
      "why": "Fly remote workspaces need overdeck-state sync before migrated projects can be re-enabled remotely",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2908",
      "rank": 267,
      "size": "XL",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard / operator UX: Make overdeck not suck",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": true
    },
    {
      "issue": "PAN-2548",
      "rank": 268,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close the state legacy-fallback deprecation window once every project carries the migration marker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3411",
      "rank": 269,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: New Workspace as a full-page creation experience (replaces the modal)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3420",
      "rank": 270,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Dashboard + pan show render a completed, closed-out issue as never-started (post-close-out history wipe)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1416",
      "rank": 271,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Workspace-spawned dashboards must never claim the canonical dashboard port",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2642",
      "rank": 272,
      "size": "XL",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: [EPIC] Cost strategy: waste detection over budget policing — retire invented limits, land the progress-aware breaker,...",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-807",
      "rank": 273,
      "size": "L",
      "importance": "high",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Epic C: Workspace state sanity on spawn",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1868",
      "rank": 274,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [
        "PAN-2079"
      ],
      "why": "Pipeline substrate: Cost-bleed circuit breaker: progress-aware, always-on guard against runaway agent spend",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3178",
      "rank": 275,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: First-class worktrees & diffs: +/− changes badge, dedicated Changes surface, conversation worktrees",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3090",
      "rank": 276,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Simple issue page: narrative feed instead of raw transcript, surface the pending question, honest blocked state",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1560",
      "rank": 277,
      "size": "S",
      "importance": "high",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI / quality gate: Re-review after a PR head moves doesn't re-post panopticon/review status → PR stranded BLOCKED",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2650",
      "rank": 278,
      "size": "L",
      "importance": "high",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Swarm final ready-to-merge slot wedges when memory-governor sheds the integration stack; pan swarm recover can't reco...",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2323",
      "rank": 279,
      "size": "M",
      "importance": "high",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Flywheel respawn after crash/displacement starts a blank session instead of resuming the live one",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2324",
      "rank": 280,
      "size": "S",
      "importance": "high",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: label transition fails atomically on missing 'in-planning' label — closed issues keep stale in-review/merged labels",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2186",
      "rank": 281,
      "size": "S",
      "importance": "high",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: post-merge lifecycle can leave merged issues in-review and auto-merge rows stuck",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2179",
      "rank": 282,
      "size": "S",
      "importance": "high",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: relaunch can leave a zombie agent — session alive but kickoff never delivered (liveness checks fooled)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2165",
      "rank": 283,
      "size": "M",
      "importance": "high",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: pan close: close-issue phase reports success but leaves issue OPEN / wrong labels (remove-label aborts on absent labe...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2106",
      "rank": 284,
      "size": "M",
      "importance": "high",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: pan strike workspace setup leaves broken partial workspace + false 'spawned' success (git-lock race)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1650",
      "rank": 285,
      "size": "M",
      "importance": "high",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Split readyForMerge → gatesPassed (derived/event-driven) + shipComplete; auto-dispatch ship on gates-green",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2233",
      "rank": 286,
      "size": "L",
      "importance": "high",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: decompose merge-agent.ts (1,414 lines) into focused modules",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2190",
      "rank": 287,
      "size": "L",
      "importance": "high",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Decompose routes/workspaces/merge-ops.ts (1,925 lines) — new god file from the workspaces split",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1776",
      "rank": 288,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Hot-updatable message delivery: version-stamped supervisors + server-side delivery logic",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1766",
      "rank": 289,
      "size": "S",
      "importance": "high",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: work agents hang on Claude Code settings-file protection when editing .claude/** — un-overridable by PreToolUse hook ...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1618",
      "rank": 290,
      "size": "M",
      "importance": "high",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Substrate: work-spawn docker-health gate has no autonomous recovery — proposed work can't auto-start when the stack i...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2968",
      "rank": 291,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Adopt the interactive decision page as the default way to present operator decisions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1775",
      "rank": 292,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Remote (Fly.io) work agents appear as real session rows in the issue tree",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2350",
      "rank": 293,
      "size": "XL",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Epic: Overdeck Anywhere — remote access, Hermes bridge, mobile, and the shared relay backbone",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-1209",
      "rank": 294,
      "size": "M",
      "importance": "high",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: PAN-1052 bead projection disagrees with bd state",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3513",
      "rank": 295,
      "size": "M",
      "importance": "high",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Agent runtime plane on overdeck-state — durable session pointers, GC as cache eviction (Anywhere data plane)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2709",
      "rank": 296,
      "size": "M",
      "importance": "high",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Flywheel orchestrator is unreachable as a notification target — agents auto-resume it, resume always fails when the r...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2563",
      "rank": 297,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: npm-flavor desktop (npx @overdeck/desktop) lacks node_modules for the server's externalized deps",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2451",
      "rank": 298,
      "size": "M",
      "importance": "high",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Work agent stranded behind commit-msg gate after overflow-restart + auto-commit + merge-main (non-issue-ref commits)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2334",
      "rank": 299,
      "size": "S",
      "importance": "high",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: write a Definition of Ready (DoR) — the bar an issue must clear before planning/pickup, tuned to catch junk like the ...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2189",
      "rank": 300,
      "size": "L",
      "importance": "high",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Decompose src/lib/cloister/deacon.ts (3,394 lines) — pipeline machinery, supervised handoff",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2188",
      "rank": 301,
      "size": "M",
      "importance": "high",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Flywheel resilience for the codebase-health flood: substrate-first prioritization + tenets spirit-gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2170",
      "rank": 302,
      "size": "S",
      "importance": "high",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: Docker init container lacks Python — node-gyp rebuild of better-sqlite3 fails, breaking workspace stack crea...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2075",
      "rank": 303,
      "size": "XL",
      "importance": "high",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: [EPIC] Boot Reconciliation + Operator Inbox — informed, substrate-complete (local + Fly), reachable online/CLI/offline",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2080",
      "rank": 304,
      "size": "M",
      "importance": "high",
      "score": 44,
      "condition": "ok",
      "dependsOn": [
        "PAN-2079"
      ],
      "why": "Pipeline substrate: Operator Inbox external transports (email/Slack/push/TTS) — offline reach (fast-follow, absorbs #43)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2079",
      "rank": 305,
      "size": "M",
      "importance": "high",
      "score": 44,
      "condition": "ok",
      "dependsOn": [
        "PAN-2077"
      ],
      "why": "Pipeline substrate: Operator Inbox: durable server-side queue + in-dashboard surface (the notification spine)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2078",
      "rank": 306,
      "size": "M",
      "importance": "high",
      "score": 44,
      "condition": "ok",
      "dependsOn": [
        "PAN-2077"
      ],
      "why": "Pipeline substrate: CLI parity for boot reconciliation: pan boot status + pan resume --all|--select|--freeze|--kill-remote",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2077",
      "rank": 307,
      "size": "M",
      "importance": "high",
      "score": 44,
      "condition": "ok",
      "dependsOn": [
        "PAN-1775"
      ],
      "why": "Pipeline substrate: Substrate-complete reconciliation inventory (local tmux + remote Fly machines) — one resolver",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1951",
      "rank": 308,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Inspector resumes a warm per-issue session instead of cold-spawning per item",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2837",
      "rank": 309,
      "size": "M",
      "importance": "high",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Distributed agent presence: record which machine runs each issue's agents on overdeck-state (claim/release, no heartb...",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2830",
      "rank": 310,
      "size": "M",
      "importance": "high",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Shared Logbook: make the overdeck-state branch opt-in — OFF by default, local-only state, clean enable/disable with c...",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1504",
      "rank": 311,
      "size": "M",
      "importance": "high",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: pan hygiene — codify orchestration merge/commit/push state audit as a first-class CLI verb + skill + docs",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1497",
      "rank": 312,
      "size": "M",
      "importance": "high",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: emit TTS announcements on lifecycle events (start, pause, resume, report)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1219",
      "rank": 313,
      "size": "M",
      "importance": "high",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Promote across-cycle review state to first-class data (cycle SHA, prior findings) instead of prompt-derived",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1218",
      "rank": 314,
      "size": "M",
      "importance": "high",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-of-batch mode",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-863",
      "rank": 315,
      "size": "S",
      "importance": "medium",
      "score": 43,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): One-shot sweep of stale feature branches and worktrees predating the reaper",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3456",
      "rank": 316,
      "size": "S",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: pan swarm refused every plan containing a sequential item — per-item diagnostics acted as gates",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3157",
      "rank": 317,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Awareness feed shows the Flywheel as a generic 'Claude Code / No messages yet' chat row instead of flywheel run activity",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3061",
      "rank": 318,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Dispatch-topology advisor: mechanical start-vs-swarm recommendation at plan-finalize",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3003",
      "rank": 319,
      "size": "S",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: work-agent launchers lack OVERDECK_AGENT_ID export — manual re-launch dies instantly",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2971",
      "rank": 320,
      "size": "S",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: orchestrator finalized its own run (report --force) but kept running — zombie session uncontrollable, dashboard Pause...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2805",
      "rank": 321,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: FlywheelPage shows 'No active run' while /api/flywheel/current returns a live run — open-questions reveal lands nowhere",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2792",
      "rank": 322,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Orphan-process sweeps killed the dashboard and live conversations via lsof +D over Bun-hardlinked node_modules",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2775",
      "rank": 323,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Agents die in sweeps: boot-correlated false reaps (live flywheel reaped, convoy reaped 5x) + unexplained simultaneous...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2759",
      "rank": 324,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Dead flywheel with an active run was never auto-relaunched after a reboot — sat idle 2h with recovery wired and enabled",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2747",
      "rank": 325,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Flywheel cannot be resumed after a crash/reboot: Resume is disabled and the only offered action aborts the run",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2739",
      "rank": 326,
      "size": "S",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: first-completion detection throws every patrol cycle — non-null assertion on getAgentRuntimeStateSync kills the pan-d...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2734",
      "rank": 327,
      "size": "S",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: merge queue head-of-line zombie — closed PAN-2325 re-triggered on all 294 boots; removeMerge has zero callers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-955",
      "rank": 328,
      "size": "M",
      "importance": "high",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: Workspace devcontainer template versioning + re-render on demand",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-813",
      "rank": 329,
      "size": "M",
      "importance": "high",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Add regression test for /api/review/:issueId/reset preserving work-agent resolution",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3568",
      "rank": 330,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Adopt Effect diagnostics (@effect/language-service) as a mechanical CI gate and agent feedback loop",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3441",
      "rank": 331,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: God View \"River\" — WebGL pipeline visualization fed by the live hook-event stream",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2696",
      "rank": 332,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Task views still speak beads vocabulary — completed vBRIEF items shown as 'upcoming', plus phantom 'not synced' label",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2686",
      "rank": 333,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Policy strip \"restart pending\" badge never clears after restart-fresh with a new model (record.model is sticky)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2259",
      "rank": 334,
      "size": "S",
      "importance": "high",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: something burns the full 5k/hr GitHub GraphQL quota — repeatedly breaks pan close, gh issue edit, and orchestration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2240",
      "rank": 335,
      "size": "S",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: pan tell contradicts itself on dead ohmypi sessions — 'session is dead and resume failed: it appears healthy'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2237",
      "rank": 336,
      "size": "S",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: pan plan done swallows vbrief quality lint details",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2069",
      "rank": 337,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: caveman: follow-up gaps — review agent routing, hook execution tests, Settings UI toggle, Experiments view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1578",
      "rank": 338,
      "size": "L",
      "importance": "high",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1217",
      "rank": 339,
      "size": "S",
      "importance": "high",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI / quality gate: Requirements reviewer: classify each AC as in_pr_scope vs whole_feature_scope, only !-block in-PR-scope items",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-532",
      "rank": 340,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Per-project and per-issue model overrides for pipeline roles",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2685",
      "rank": 341,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Annotated live preview: Codex-style annotate-the-app feedback delivered to agents",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2566",
      "rank": 342,
      "size": "XL",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation: Traycer parity epic: gap analysis of capabilities Overdeck lacks",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2582",
      "rank": 343,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lanes)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2565",
      "rank": 344,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2514",
      "rank": 345,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Claude Code Traffic Inspector — intercept & inspect model API traffic in the dashboard",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2507",
      "rank": 346,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Preemptive pipeline scheduler: yield idle work agents to unblock review/test/merge dispatch",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2443",
      "rank": 347,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: OpenTelemetry GenAI semconv — OTLP ingestion layer for cross-harness telemetry (tokens/latency/tools), pinned-snapsho...",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2442",
      "rank": 348,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Agent Client Protocol (ACP) as Overdeck's structured control plane — replace tmux keystrokes, transcript parsers, and...",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2355",
      "rank": 349,
      "size": "L",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [
        "PAN-2352"
      ],
      "why": "Pipeline substrate: Overdeck Anywhere P2: mobile PWA (Needs-You feed, conversation view, pipeline board, Web Push)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2353",
      "rank": 350,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [
        "PAN-2351"
      ],
      "why": "Pipeline substrate: Overdeck Anywhere P1b: Hermes external-agent bridge (scoped API + Fly 6PN)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1912",
      "rank": 351,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1828",
      "rank": 352,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Conversation fork/handoff harness defaults ignore source conversation harness — silent claude-code coercion",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1816",
      "rank": 353,
      "size": "S",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry — need an ep...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1795",
      "rank": 354,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Codebase map bootstrapped in planning worktree is never promoted to main (PAN-1788 WI-6 wiring gap)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1769",
      "rank": 355,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + tmux fallback); resumed...",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1558",
      "rank": 356,
      "size": "M",
      "importance": "high",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Review/specialist agents should run in the workspace Docker container, not inherit host-override",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1544",
      "rank": 357,
      "size": "M",
      "importance": "high",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Type cleanup: strip 'ship' from the Role union and its ~10 downstream references",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1452",
      "rank": 358,
      "size": "M",
      "importance": "high",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: PAN-1381 follow-up: per-reviewer restart with model override (architectural mismatch with PAN-1048)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1424",
      "rank": 359,
      "size": "M",
      "importance": "high",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1311",
      "rank": 360,
      "size": "M",
      "importance": "high",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Swarm: fast-track tier — skip slot dispatch for trivial mechanical items",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1253",
      "rank": 361,
      "size": "M",
      "importance": "high",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Flywheel: respect issue dependencies before autopicking work",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1198",
      "rank": 362,
      "size": "M",
      "importance": "high",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: Workspace init container's bun install doesn't populate container-node-modules named volume",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1196",
      "rank": 363,
      "size": "M",
      "importance": "high",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Workhorse routing by bead difficulty + subject-matter (single-agent and swarm)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2008",
      "rank": 364,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: store-access guard — fail the build on direct store reads outside a domain resolver (PAN-1936 slice)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2006",
      "rank": 365,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Ru...",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2005",
      "rank": 366,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Backlog Sequencer: Pickup Forecast — visualize Flywheel pickup order (waves, lanes, planning bottleneck)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1852",
      "rank": 367,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval data",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1565",
      "rank": 368,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #63147)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1666",
      "rank": 369,
      "size": "XL",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: [EPIC] Pipeline Throughput Hardening — run many work agents safely, on-demand specialists, slot manager, fly.io scale...",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-1556",
      "rank": 370,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Session/activity feed: coalesce review-spawn spam, supersede re-reviews per issue, keep active conversations most-recent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1530",
      "rank": 371,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Investigate: state.json with model='gpt-5.5' (a model that doesn't exist)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1451",
      "rank": 372,
      "size": "M",
      "importance": "high",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1438",
      "rank": 373,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: pan flywheel start launcher process orphans when orchestrator dies externally",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1436",
      "rank": 374,
      "size": "S",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1392",
      "rank": 375,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1386",
      "rank": 376,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Flywheel orchestrator never emits status snapshots — dashboard 'flywheel' pane stays blank during an active run",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1330",
      "rank": 377,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: CLI cannot address planning-*/specialist-* sessions — pan tell/pan kill hard-code 'agent-' prefix; no 'pan plan abort'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1240",
      "rank": 378,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1227",
      "rank": 379,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Substrate: bead can be closed without delivering the work — add per-bead delivery check in pan done",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1226",
      "rank": 380,
      "size": "L",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: PAN-1148 unified-dashboard redesign — 32 gaps vs PRD and mockups (full audit)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1173",
      "rank": 381,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: pan show <bare-number> derives wrong agent ID for PAN-prefixed issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1149",
      "rank": 382,
      "size": "S",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1130",
      "rank": 383,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1113",
      "rank": 384,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Conversations sidebar lets you message review-specialist sessions, which derails them silently",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-578",
      "rank": 385,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Comment mediation layer to prevent prompt injection via tracker comments",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-262",
      "rank": 386,
      "size": "L",
      "importance": "high",
      "score": 38,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Refactor post-merge lifecycle into composable, idempotent operations",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3558",
      "rank": 387,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Subagent rail: show provider logo and model on each agent row",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3464",
      "rank": 388,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: swarm: pan swarm reset does not clear slotCompletions despite 'clear recorded slot state'",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3463",
      "rank": 389,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: swarm: a legitimate no-op slot outcome (empty diff) can never pass its item verify — slot wedges permanently",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3460",
      "rank": 390,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: swarm: per-item verify_commands that run the full root suite make slot merge gates load-fragile and expensive",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3443",
      "rank": 391,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: God View \"Spectrum Deck\" — Winamp-grade activity visualizer (kimi-code-harness mockup + PRD)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3335",
      "rank": 392,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: click a pasted conversation image to open it full size in a popup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3280",
      "rank": 393,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: PAN-3253's agent sessions vanish repeatedly (4x in one run) and its reviewer died writing no artifact, all silently",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3175",
      "rank": 394,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Model explicit semantic dependencies in merge-train ordering — file overlap cannot see that one feature requires another",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3133",
      "rank": 395,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: TRON encoding for prompt-bound xBRIEF payloads",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3132",
      "rank": 396,
      "size": "L",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Adopt xBRIEF v0.9 agentic dispatch fields end-to-end (deftai/xBRIEF#40 alignment)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3131",
      "rank": 397,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Support xBRIEF planRef sharding — planning-side authoring and pipeline-wide consumption",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3100",
      "rank": 398,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Test role evaluates the dirty working tree, so a live work agent's uncommitted edits produce false test failures",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3054",
      "rank": 399,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Benchmark matrix: launch one template issue under N configurations and compare cost/time/outcome",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3036",
      "rank": 400,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: False '! INPUT' chip on completed strike agents — pane-idle heuristic misreads post-strike-ready idle as a pending qu...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3034",
      "rank": 401,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Command Deck session tree misses strike-only and workspace-less issues (no strike node for PAN-3031)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3032",
      "rank": 402,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: Workspace stack rebuild composes under 'overdeck-feature-' prefix while Traefik labels reference 'myn-featur...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2983",
      "rank": 403,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: OKF v3 deferred capabilities: lease-based concurrent write mode + LLM semantic auditor",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2982",
      "rank": 404,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Review convoy should run skill selftests when sync-sources/skills/** changes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2978",
      "rank": 405,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [
        "PAN-2976",
        "PAN-2977"
      ],
      "why": "Pipeline substrate: Auto-install ACP agent CLIs from the setup UI (opt-in, per-agent install recipes)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2977",
      "rank": 406,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [
        "PAN-2976"
      ],
      "why": "Pipeline substrate: ACP agent setup UI: detect installed ACP CLIs, show auth status, and guide login from Settings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2976",
      "rank": 407,
      "size": "L",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Generalize the ACP harness: any ACP-capable agent CLI as a spawnable runtime (named adapters + custom-agent config)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2935",
      "rank": 408,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: Workspace devcontainer duplicate backend hijacks Traefik router — 50% of API calls 504",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2922",
      "rank": 409,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Reduce accidental orchestration complexity after performance stabilization",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2883",
      "rank": 410,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Close-out deploy row fails for every strike-landed issue — PR resolver hardcodes feature/ branch, can't find strike/ PRs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2754",
      "rank": 411,
      "size": "S",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: `always` is inert — it behaves exactly like `auto`, contradicting the documented spec",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2718",
      "rank": 412,
      "size": "S",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: pan restart needs a first-class no-dialog reconciliation flag — autonomous restarts must not park a dialog on the ope...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2356",
      "rank": 413,
      "size": "L",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI / quality gate: Overdeck Anywhere P3: relay service — outbound-only daemon, GitHub OAuth, push origin, multi-tenant front door",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1915",
      "rank": 414,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Security hardening: API key at-rest hardening — startup perm check + OS keychain + deprecate plaintext",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1767",
      "rank": 415,
      "size": "M",
      "importance": "high",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard / operator UX: Show merged-but-not-closed-out count in pan status and the dashboard headline",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1150",
      "rank": 416,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: Settings: \"Anthropic is not configured\" warning persists in Model Routing after claude /login (Provider tab disa...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1027",
      "rank": 417,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Merge-status drift: deacon auto-detect paths set mergeStatus=merged without postMergeLifecycle, never reset on revert",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-630",
      "rank": 418,
      "size": "L",
      "importance": "high",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Multi-tenant workspace isolation with ACLs",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2680",
      "rank": 419,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: pan close: Docker teardown silently skips a running stack in multi-repo projects (MYN), aborting close-out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2678",
      "rank": 420,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: clean blocked state worktrees, fix auricle git-status failure, restore the Deacon (2026-07-14 review outage)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2662",
      "rank": 421,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Add project context-menu actions scoped to issues currently in the pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2651",
      "rank": 422,
      "size": "S",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: simplify lifecycle reconciliation and add a safe post-planning reset",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2646",
      "rank": 423,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: configurable global/project/issue policy UI with default OFF",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2628",
      "rank": 424,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: pan close aborts at close-issue:transition: \"No tracker available and cannot determine issue type\" for GitHub-tracker...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2629",
      "rank": 425,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: pan start kickoff delivery never lands: \"Claude Code did not become ready within 30s\" (both attempts), agent sits idl...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2622",
      "rank": 426,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: cloister.toml materializes ALL defaults into the user file — default changes in code never reach existing installs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2557",
      "rank": 427,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: project-level 'Restart All' context action — restart every agent in a project, throttled by the PAN-2500 memory governor",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2526",
      "rank": 428,
      "size": "L",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Refactor deacon.ts below file-size baseline",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2489",
      "rank": 429,
      "size": "S",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: strike agents are invisible in the project issue tree — needs-you pings with no node to click",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2484",
      "rank": 430,
      "size": "S",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: ready set misses merge-eligible issues without flywheel merge verbs — eligibility sweep added; verb-coverage prompt r...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2469",
      "rank": 431,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: issue-level assembly owner — 'all slots done' must deterministically trigger assemble → verify → review (root cause o...",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2466",
      "rank": 432,
      "size": "S",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: close-out/record writer clobbers closeOut.usage with EMPTY data — cost history lost on the local side (recurring)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2428",
      "rank": 433,
      "size": "S",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: MYN workspace Traefik routing broken post-rebrand — legacy 'panopticon' network + missing traefik.docker.network labe...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2423",
      "rank": 434,
      "size": "S",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: pan workspace rebuild hardcodes 'overdeck-' compose project prefix — mismatches project templates and verification co...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2414",
      "rank": 435,
      "size": "S",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: context-overflow recovery is inconsistent — some agents get the PAN-1781 compact-respawn, others hit the PAN-1980 rot...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2408",
      "rank": 436,
      "size": "S",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: pan start --auto commits the spec to main AFTER creating the worktree — agent's own workspace lacks its spec, causing...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2406",
      "rank": 437,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: close-out gaps: verify-merged rejects record-only deltas; slot/suffixed worktrees never torn down; teardown abort fir...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2399",
      "rank": 438,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: wire replay_threshold/compaction_reroute into the slot-recovery respawn seam (PAN-2397 W3b)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2395",
      "rank": 439,
      "size": "S",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: one invalid tiered_execution enum poisons every config read — live conversations falsely marked ended, resume/new-con...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2347",
      "rank": 440,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: refresh AGENT-STATE-PLANES.md — update, harden, make useful",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2346",
      "rank": 441,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: refresh AGENT_TYPES_INDEX.md — update, harden, make useful",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2345",
      "rank": 442,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: refresh pan-done.md — update, harden, make useful",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2344",
      "rank": 443,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: refresh KANBAN-MODEL.md — update, harden, make useful",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2308",
      "rank": 444,
      "size": "L",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: migrate stale generated compose files off PORT=3011 + deacon quarantine for deterministic container boot refusals (fo...",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2295",
      "rank": 445,
      "size": "L",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: built-in web browser surface (openable like terminal/Claude Code/Codex) + native Agentation integration",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2266",
      "rank": 446,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: add zcode harness and make it the default for glm-5.2",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2213",
      "rank": 447,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Swarm slot allocator picks an orphaned slot index and refuses instead of skipping to the next free one",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2212",
      "rank": 448,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Swarm slot dispatch has no reserved budget — a busy pipeline starves it to zero",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2211",
      "rank": 449,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: PAN-2203 follow-up: swarm slot pan done records completion but slot never becomes merge-ready",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2210",
      "rank": 450,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: PAN-2203 follow-up: a swarm slot's completion can trigger the issue-level review pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2201",
      "rank": 451,
      "size": "S",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Close-out label step fails atomically when a hardcoded label (e.g. 'in-planning') is absent from the repo — closed is...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2197",
      "rank": 452,
      "size": "S",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: work agents skip `pan done` (manual push instead) — sandbox blocks its GitHub calls; idle agents spuriously 'troubled'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2074",
      "rank": 453,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: evaluate ponytail (DietrichGebert/ponytail) for prompt compression and consider building in-house",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2065",
      "rank": 454,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: unified usage & headroom panel across all provider plans (z.ai, Anthropic, Codex, OpenRouter)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2046",
      "rank": 455,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Conversation view does not surface terminal command responses",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-681",
      "rank": 456,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Feedback routing: wrong issueId written to workspace when verification runs for co-active issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2980",
      "rank": 457,
      "size": "S",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI / quality gate: pre-push file-size guard audits the dirty working tree, so another session's uncommitted edits block unrelated pushes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2004",
      "rank": 458,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Resumable Planning node: double-click a planned issue's Planning to resume the planning agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1995",
      "rank": 459,
      "size": "L",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1988",
      "rank": 460,
      "size": "M",
      "importance": "medium",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Verdict signaling: one host-owned write door; agents journal, host owns the DB cache",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1986",
      "rank": 461,
      "size": "S",
      "importance": "medium",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1985",
      "rank": 462,
      "size": "M",
      "importance": "medium",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1980",
      "rank": 463,
      "size": "M",
      "importance": "medium",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1967",
      "rank": 464,
      "size": "M",
      "importance": "medium",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Flywheel must re-validate (re-plan) pre-cutover plans before implementing them",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1965",
      "rank": 465,
      "size": "M",
      "importance": "medium",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1958",
      "rank": 466,
      "size": "M",
      "importance": "medium",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1949",
      "rank": 467,
      "size": "M",
      "importance": "medium",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all item verdicts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1936",
      "rank": 468,
      "size": "M",
      "importance": "medium",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Single source-of-truth reads — one canonical resolver per domain (consolidate the 280+ scattered read endpoints)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1926",
      "rank": 469,
      "size": "S",
      "importance": "medium",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: --big flag to lift strike's precision-only scope guard (operator-authorized larger strikes)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1916",
      "rank": 470,
      "size": "M",
      "importance": "medium",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: configurable web search providers (Exa, Tavily, Brave, Perplexity)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1914",
      "rank": 471,
      "size": "M",
      "importance": "medium",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Follow-up: move /api/health/agents off agent-directory scans",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1895",
      "rank": 472,
      "size": "M",
      "importance": "medium",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Spawn work agents from issue workspace slide-out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1878",
      "rank": 473,
      "size": "M",
      "importance": "medium",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1854",
      "rank": 474,
      "size": "M",
      "importance": "medium",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Define handoff strategy for large conversations: external vs source authoring + tail-biased read",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1840",
      "rank": 475,
      "size": "M",
      "importance": "medium",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Add 'pan switch <id>' — change a running agent's model/harness in one command (kill + fresh-start + re-onboard)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1774",
      "rank": 476,
      "size": "S",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: workspace server container crashloops when dist/dashboard/server.js is missing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1773",
      "rank": 477,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1755",
      "rank": 478,
      "size": "S",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agents racing the next gene...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1751",
      "rank": 479,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flywheel",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1750",
      "rank": 480,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: UAT assembly/conflict agent — observability surfaces + configurable harness/model (default gpt-5.5 via Codex)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1748",
      "rank": 481,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: reuse uat-assembly conflict resolutions across generations (rerere or resolution replay)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1740",
      "rank": 482,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Deacon mislabels SIGTERM workspace container restarts as crashes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1735",
      "rank": 483,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: adopt externally-completed readyForMerge issues into the pipeline/merge queue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1728",
      "rank": 484,
      "size": "S",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: PAN-1700 agent committed .pan/specs/*.vbrief.json mutations — PAN-1124 immutability violated on feature branch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1691",
      "rank": 485,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: conflict-aware merge train + on-demand UAT candidate — stop the rebase-cascade that strands ready PRs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1676",
      "rank": 486,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1674",
      "rank": 487,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: TLDR .venv (~7.5G) is duplicated into every workspace — 236G across 33 worktrees, caused disk-full ENOSPC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1668",
      "rank": 488,
      "size": "S",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: right-click 'restart with <model>' carries model only, never harness — can't move a review off Kimi",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1667",
      "rank": 489,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: unify Agents + Resources into one issue-centric holistic view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1657",
      "rank": 490,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1655",
      "rank": 491,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1653",
      "rank": 492,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1640",
      "rank": 493,
      "size": "L",
      "importance": "medium",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1627",
      "rank": 494,
      "size": "M",
      "importance": "medium",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridable by Pr...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1624",
      "rank": 495,
      "size": "M",
      "importance": "medium",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: pan handoff --author external: authored doc is socket_write-ten but never submitted — successor sits at empt...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1581",
      "rank": 496,
      "size": "M",
      "importance": "medium",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled across ...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1254",
      "rank": 497,
      "size": "L",
      "importance": "high",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: Tailscale integration: advertise dashboard + workspace endpoints over tailnet (Effect-native)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-334",
      "rank": 498,
      "size": "M",
      "importance": "medium",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Dashboard server has no duplicate-process protection — zombie instances cause 502",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-324",
      "rank": 499,
      "size": "M",
      "importance": "medium",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Agent detail pane missing Merge/Approve button",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-304",
      "rank": 500,
      "size": "M",
      "importance": "medium",
      "score": 29,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): closeLinearDirect returns stepOk even when state update never happens",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2553",
      "rank": 501,
      "size": "S",
      "importance": "medium",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI / quality gate: project-level CI visibility — surface repo/main-branch workflow runs on the Command Deck with click-through to logs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2505",
      "rank": 502,
      "size": "S",
      "importance": "medium",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI / quality gate: lint:circular reports new frontend cycles + stale baseline in chat/conversations components",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2501",
      "rank": 503,
      "size": "S",
      "importance": "medium",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI / quality gate: deleteResourceVenvEffect's HttpRouter.schemaParams call fails typecheck under the root tsconfig (masked by src/dashboa...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2487",
      "rank": 504,
      "size": "S",
      "importance": "medium",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI / quality gate: CI-green merge skip + Ship & Merge cockpit view (live door log + progress) + active-node spinner",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2358",
      "rank": 505,
      "size": "M",
      "importance": "high",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning / xBRIEF: PAN-2145 follow-up: restore PAN-1535 hardening in transformMessageForHarness (rewritten during conversations.ts decomp...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1550",
      "rank": 506,
      "size": "M",
      "importance": "medium",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: FilesPane + BrowserPane — file browser and embedded web view implementation details",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1545",
      "rank": 507,
      "size": "M",
      "importance": "medium",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: New Terminal button — spawn ad-hoc bash sessions from sidebar / conversation / drawer / palette",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1542",
      "rank": 508,
      "size": "M",
      "importance": "medium",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Spawn-refusal modal: render the three-button workflow on dirty-workspace 409",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1490",
      "rank": 509,
      "size": "M",
      "importance": "medium",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: show each conversation's current git branch (port t3code BranchToolbar pattern)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1489",
      "rank": 510,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: tune v1.0 readiness criteria after 30 days of telemetry",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1444",
      "rank": 511,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: Follow-up to PAN-1416: dashboard port lockfile + pan doctor multi-instance check",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1437",
      "rank": 512,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: pan flywheel report semantics: split read-only snapshot from run finalization",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1432",
      "rank": 513,
      "size": "S",
      "importance": "medium",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Merge agent leaves packages/contracts/dist stale — typecheck breaks on every fresh checkout",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1356",
      "rank": 514,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Extend the memory Observation pipeline to ad-hoc conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1245",
      "rank": 515,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1244",
      "rank": 516,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1222",
      "rank": 517,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Project-templated DB lifecycle: auxiliary databases + seed refresh from prod",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1165",
      "rank": 518,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Lightweight review path for small/trivial PRs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1154",
      "rank": 519,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: pan up does not kill existing port holders — startup races against orphan dashboard servers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1136",
      "rank": 520,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1135",
      "rank": 521,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Document the hook system in docs/HOOKS.md",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1133",
      "rank": 522,
      "size": "L",
      "importance": "medium",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: TLDR: deacon supervision + pan doctor check + GC",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1129",
      "rank": 523,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1126",
      "rank": 524,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Integrate TLDR summaries into review context manifest",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1124",
      "rank": 525,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Decouple specs and PRDs from workspaces — write directly to main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1121",
      "rank": 526,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1066",
      "rank": 527,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1064",
      "rank": 528,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Harden launcher generation against shell-quote injection (model and arg quoting)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-247",
      "rank": 529,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Deacon has no backoff or escalation for repeated specialist startup failures",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3355",
      "rank": 530,
      "size": "S",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: sessionExists maps a probe failure to absence, so callers read 'not running' when liveness is unknown",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3354",
      "rank": 531,
      "size": "S",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: archiving the main workspace hides the singleton row with no UI recovery path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3017",
      "rank": 532,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: Issue-page UAT panel: expose the full stack action menu and show the panel consistently",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3015",
      "rank": 533,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: pan monitor: pull-based background inbox transport for Claude Code sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2809",
      "rank": 534,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: Live-terminal Playwright UAT blocked in containerized workspaces (node-pty musl/glibc mismatch + Vite/Traefi...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2027",
      "rank": 535,
      "size": "M",
      "importance": "high",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: ohmypi: route kimi-k2 through ohmypi harness instead of CLIProxy (eliminates 200k-window illusion)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1710",
      "rank": 536,
      "size": "S",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI / quality gate: 'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 and feature/pan-164...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1654",
      "rank": 537,
      "size": "S",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI / quality gate: run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1641",
      "rank": 538,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: Run agents on local GPU models via a managed Ollama sidecar",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1533",
      "rank": 539,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: Fork-into-worktree from conversation branch chip",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1166",
      "rank": 540,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Security hardening: Re-introduce /ws/terminal auth gate with a working bootstrap path",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1060",
      "rank": 541,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Self-modify permission handling: stop the interrupt loop without weakening the safety guard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1041",
      "rank": 542,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1040",
      "rank": 543,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: event-driven dispatch for inspect-agent (requiresInspection=true beads)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1037",
      "rank": 544,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Retire 'planning-' tmux prefix — fold into agent-PAN-N keyed by phase",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-962",
      "rank": 545,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Post-PAN-946: vBRIEF lifecycle follow-up plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-961",
      "rank": 546,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Update documentation for vBRIEF v0.6 lifecycle model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-938",
      "rank": 547,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Fizzy visual pipeline — Kanban mirror for specialist pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-932",
      "rank": 548,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: pan done: polyrepo uncommitted changes check + existing MR handling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-927",
      "rank": 549,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Rewrite containerize route: dead code, orphan processes, no pending-op tracking",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-908",
      "rank": 550,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: PAN-908: Make work-agent spawn limits configurable and overridable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-898",
      "rank": 551,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Dashboard polling and WebSocket efficiency: remaining audit findings",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-853",
      "rank": 552,
      "size": "L",
      "importance": "low",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-833",
      "rank": 553,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential l...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-832",
      "rank": 554,
      "size": "S",
      "importance": "low",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents dro...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-810",
      "rank": 555,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Inspector: diagnostic UI when pipeline phase is unknown",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-802",
      "rank": 556,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Resume on conversation session forks instead of resuming",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-786",
      "rank": 557,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Post planning Q\\&A answers as issue comment",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-778",
      "rank": 558,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Write conflict race: review-agent fails when test-agent write scope not yet released",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-777",
      "rank": 559,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Inter-agent communication skill: send messages to conversation-mode agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-774",
      "rank": 560,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Unify launch UX and release pipeline for 1.0 — npx panctl, lazy prereqs, cross-platform...",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-771",
      "rank": 561,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Investigate Vercel Sandbox execution backend support",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-113",
      "rank": 562,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Dashboard 'Start Agent' returns success before verifying agent actually started",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-49",
      "rank": 563,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Fix CloisterService tests that require real runtime",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2767",
      "rank": 564,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: Expose Codex app-server conversation controls in the dashboard",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2533",
      "rank": 565,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: UAT workspace magic-link login 502: Traefik picks unreachable panopticon IP for multi-homed fe/api",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2288",
      "rank": 566,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: tmux managed-server: lossless auto-migration of dirty-founded servers + boot-time ensure call (PAN-1798 foll...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2085",
      "rank": 567,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: Auto-isolate conversations in a lightweight git worktree (Conductor-style workspaces)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2084",
      "rank": 568,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: Auto-create lightweight conversation worktrees on project chats",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1758",
      "rank": 569,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory + knowledge: Watch: ready-for-merge work must converge despite a continuously moving main",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1572",
      "rank": 570,
      "size": "S",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI / quality gate: Settings permission-mode can desync from resolved config — agents silently use --dangerously-skip-permissions despite ...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1435",
      "rank": 571,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: API keys in ~/.panopticon/config.yaml stored as plaintext",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1151",
      "rank": 572,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-749",
      "rank": 573,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Research and borrow best features from gstack",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-736",
      "rank": 574,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): wire per-subagent model overrides from settings to Claude Code spawn env",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-735",
      "rank": 575,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Settings page: review and configure overridden subagent model files",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-727",
      "rank": 576,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Pipeline substrate (needs refinement): Fix orphaned work-agent start handoff after planning",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-709",
      "rank": 577,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): self-improving flywheel — retro agent, skill-change pipeline, audience-scoped skills, Q...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-701",
      "rank": 578,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Quick-Create conversation via keystroke using Conversations-page default model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-687",
      "rank": 579,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Support OpenCode as alternative coding agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-678",
      "rank": 580,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): pan work issue --auto: headless planning → agent handoff without interactive dialog",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-675",
      "rank": 581,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window re...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-654",
      "rank": 582,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Project Setup Wizard — Dashboard UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-646",
      "rank": 583,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Canceled issues: add guided Recover workflow",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-637",
      "rank": 584,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Direct issue kickoff (skip planning) from dashboard UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-629",
      "rank": 585,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Workspace quotas and resource governance",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-624",
      "rank": 586,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Loop nodes: iterative agent execution with conditional termination",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-622",
      "rank": 587,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): YAML workflow DAGs: custom per-project pipeline definitions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-613",
      "rank": 588,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Investigate thinking effort levels for agents — reduce signature corruption frequency",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-607",
      "rank": 589,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Evaluate Ultimate Bug Scanner (UBS) for verification gate",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-606",
      "rank": 590,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Evaluate MCP Agent Mail for inter-agent communication and file reservations",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-604",
      "rank": 591,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Hide planning agent from workspace detail pane",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-603",
      "rank": 592,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Plan review loop with configurable reviewer model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-537",
      "rank": 593,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): show changed files diff summary after each agent response in activity view",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-531",
      "rank": 594,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): PAN: Windows Electron support (WSL2 required)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-483",
      "rank": 595,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Unify Resume Agent UX — all entry points should show message input",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-480",
      "rank": 596,
      "size": "S",
      "importance": "low",
      "score": 23,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Pass --effort flag when spawning planning agents via Cloister",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-476",
      "rank": 597,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Agent resume with Haiku session summary instead of claude --resume",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-471",
      "rank": 598,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Cost reconciler: auto-trigger on agent lifecycle events with debounce",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-468",
      "rank": 599,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Agent test conversations pollute production database — need test isolation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-466",
      "rank": 600,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-461",
      "rank": 601,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Deep-wipe multi-step progress dialog",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-459",
      "rank": 602,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Planning setup screen with SSE progress streaming",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2354",
      "rank": 603,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [
        "PAN-2351"
      ],
      "why": "Harness / model routing: Overdeck Anywhere P1c: needs-you push notification bridge (ntfy first, Web Push later)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2351",
      "rank": 604,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [
        "PAN-1166"
      ],
      "why": "Harness / model routing: Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats (security prerequisites)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1968",
      "rank": 605,
      "size": "S",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: Finish local-domain rename: pan.localhost → overdeck.localhost",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1761",
      "rank": 606,
      "size": "S",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: conversations endpoints fetched via relative /api path — 403 inside workspace/UAT containers (session cookie...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1673",
      "rank": 607,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1669",
      "rank": 608,
      "size": "S",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: restart-with-model doesn't emit a live event — issue tree shows stale model until manual refresh",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1538",
      "rank": 609,
      "size": "M",
      "importance": "high",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: Unblock Pi source forks — remove API guard, verify transcript parsers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1246",
      "rank": 610,
      "size": "M",
      "importance": "high",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: projection-cached VCS driver for diff/checkpoint reads (port of t3code #2586)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1142",
      "rank": 611,
      "size": "M",
      "importance": "high",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: Add reasoning effort level to per-role / per-conversation model config",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2950",
      "rank": 612,
      "size": "L",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory + knowledge: Refactor god files back under file-size ceilings after the UX overhaul",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2243",
      "rank": 613,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning / xBRIEF: pan plan finalize: CLI aborts complete-planning at 90s while the server handler legitimately finishes later (false ✖ F...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2242",
      "rank": 614,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning / xBRIEF: Unidentified duplicate caller fires complete-planning in pairs every ~2 minutes (perpetual loop while session survives)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2241",
      "rank": 615,
      "size": "S",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning / xBRIEF: complete-planning is not serialized or idempotent per issue (spec tmp-rename 500s, bead delete-recreate thrash)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2202",
      "rank": 616,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning / xBRIEF: complete-planning silently skips spec promotion on a dead session's unanswered AskUserQuestion — and finalize reports ...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2071",
      "rank": 617,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: add user-facing page for the Hooks system",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2070",
      "rank": 618,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: add user-facing page for the Flywheel orchestrator",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2068",
      "rank": 619,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: add user-facing page for Caveman (agent output compression)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2067",
      "rank": 620,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: add user-facing page for RTK (Bash output compression)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1223",
      "rank": 621,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard / operator UX: Auto-update for users in the field (npm + desktop binaries)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1208",
      "rank": 622,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: Polyrepo: support non-feature 'main' workspaces alongside feature-*",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1153",
      "rank": 623,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' — breaks pan dev proxy",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1152",
      "rank": 624,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: Remove PANOPTICON_DEV env-var persistence — derive Traefik mode from the running command",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1123",
      "rank": 625,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: Channels delivery: surface failures, add fallback toggle, route conversations through channels",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1068",
      "rank": 626,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: PAN-1048 deferred findings: security, correctness, and model validation gaps",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1063",
      "rank": 627,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Security hardening: Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-713",
      "rank": 628,
      "size": "S",
      "importance": "low",
      "score": 21,
      "condition": "stale",
      "dependsOn": [],
      "why": "CI / quality gate (stale — re-verify relevance): add unit tests for doneCommand and approveCommand",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-299",
      "rank": 629,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Granular session state persistence across context compaction",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-293",
      "rank": 630,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Project Living Memory — per-project semantic memory for agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-283",
      "rank": 631,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Reset should sync workspace feature branch with latest main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-265",
      "rank": 632,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Review skill categorization: all skills available everywhere via personal + workspace",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-255",
      "rank": 633,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Agents lack awareness of MCP tools — sync MCP config and inject into prompts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-244",
      "rank": 634,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "stale",
      "dependsOn": [],
      "why": "Workspace + container infra (stale — re-verify relevance): Deep-wipe leaves local branch and worktree metadata behind",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-228",
      "rank": 635,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Shift-left post-edit diagnostics — type check after every edit",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-227",
      "rank": 636,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Phase gate validation — mid-implementation acceptance checks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3333",
      "rank": 637,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: relative plan-drain indicator on model pickers — show which sibling model burns subscription quota fastest",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3190",
      "rank": 638,
      "size": "M",
      "importance": "high",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feature: pan merge cancel is 100% broken: Commander passes its options object into the fetchImpl injection slot (merge.ts:56)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3011",
      "rank": 639,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: Support poolside Laguna S 2.1 (118B MoE, 1M ctx) — local via Ollama/vLLM, hosted via OpenRouter",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2755",
      "rank": 640,
      "size": "S",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: per-issue review-model override never reached convoy sub-reviewers on the discovery-fork path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2609",
      "rank": 641,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning / xBRIEF: Cross-device sync of conversations and tasks via user-owned git remote",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2444",
      "rank": 642,
      "size": "L",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning / xBRIEF: optional SageOx re-integration — session-reasoning capture for OSS projects (per-project opt-in, v0.11-era ox)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1683",
      "rank": 643,
      "size": "S",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md) — strike kee...",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1561",
      "rank": 644,
      "size": "M",
      "importance": "high",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning / xBRIEF: Project-scoped dashboard nav (deck of tabs per project + conversations/tree column + activity feed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1242",
      "rank": 645,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning / xBRIEF: Create a new issue directly from a kanban column",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1164",
      "rank": 646,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory + knowledge: Conversation diff summaries update live over WebSocket (drop 5s polling)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1051",
      "rank": 647,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + container infra: Subspace-inspired alternate theme with Inter + JetBrains Mono",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-900",
      "rank": 648,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: Trust devroot for conversations + atomic .claude.json writes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-775",
      "rank": 649,
      "size": "L",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "Workspace + container infra (stale — re-verify relevance): Redesign workspace inspector panel: sidebar layout is cramped and wrong",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-772",
      "rank": 650,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "Workspace + container infra (stale — re-verify relevance): Unify terminal stack behavior across tmux sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-198",
      "rank": 651,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Structured audit trail for agent actions",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-190",
      "rank": 652,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): PAN-190: Specialized reviewer prompts (industry best-practice checklists)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-180",
      "rank": 653,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): PAN-180: Cross-terminal file locking for concurrent agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-178",
      "rank": 654,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): PAN-178: Crash recovery with granular task checkpointing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-177",
      "rank": 655,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): PAN-177: Iteration limits with escalation for autonomous agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-176",
      "rank": 656,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): PAN-176: Hook-enforced delegation guardrails for specialist agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-175",
      "rank": 657,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): PAN-175: Pre-compact auto-save hook for agent sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-155",
      "rank": 658,
      "size": "L",
      "importance": "low",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): PAN-155: Redesign health page with Stitch (system overview, timeline, costs)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-77",
      "rank": 659,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Cost breakdown modal: show costs by stage and model when clicking cost badge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-55",
      "rank": 660,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Track specialist costs with time period filtering",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-54",
      "rank": 661,
      "size": "L",
      "importance": "low",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Add pan test:e2e command for full workflow integration test",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-47",
      "rank": 662,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): PRD files should be committed to feature branch, moved to completed/ on merge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-43",
      "rank": 663,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Add Slack and email notifications for agent events",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-38",
      "rank": 664,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Support multiple merge agents per repository",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-37",
      "rank": 665,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Support external PR selection for merge-agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2679",
      "rank": 666,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: conv-lookup skill: resolve transcripts for codex and pi harness conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2626",
      "rank": 667,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: allow composer model switching within the same model family (e.g. Sonnet → Fable)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2600",
      "rank": 668,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: Retire the Codex TUI path after app-server burn-in (no-loss audit gate) — follow-up to PAN-2597",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2527",
      "rank": 669,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: Harness selector should restrict OpenAI models to Claude Code only",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2035",
      "rank": 670,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: ohmypi: GitHub Copilot subscription provider routing via omp",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2034",
      "rank": 671,
      "size": "L",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: ohmypi: end-to-end test that tool-call steps render in Conversation panel",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2033",
      "rank": 672,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: ohmypi: benchmark FIFO vs paste-buffer message delivery latency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2032",
      "rank": 673,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: ohmypi: local Ollama model as zero-cost preliminary review role",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2031",
      "rank": 674,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: ohmypi: add Bun 1.3.11 regression test to checkOhmypi doctor gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2030",
      "rank": 675,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: ohmypi: version-pin extension in package.json and pan doctor mismatch warning",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2029",
      "rank": 676,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: ohmypi: capture kimi thinking_tokens in ohmypi-parser for complete cost accounting",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2028",
      "rank": 677,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: ohmypi: per-provider cost grouping in cost dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2026",
      "rank": 678,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: ohmypi: surface 35+ provider matrix in dashboard model picker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2025",
      "rank": 679,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: ohmypi: extend provider credential passthrough for Groq, Cerebras, Fireworks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2024",
      "rank": 680,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: ohmypi: frontend Tools-toggle for conversation view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1449",
      "rank": 681,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning / xBRIEF: PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1433",
      "rank": 682,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning / xBRIEF: Conversation agents can leave host main repo in abandoned git rebase state for hours",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-700",
      "rank": 683,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "stale",
      "dependsOn": [],
      "why": "Workspace + container infra (stale — re-verify relevance): Detachable terminal for conversation view — popout into OS window",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-663",
      "rank": 684,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "stale",
      "dependsOn": [],
      "why": "Workspace + container infra (stale — re-verify relevance): Workspace frontend containers not auto-started for panopticon-cli self-hosted ...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-591",
      "rank": 685,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "stale",
      "dependsOn": [],
      "why": "Workspace + container infra (stale — re-verify relevance): Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-576",
      "rank": 686,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "stale",
      "dependsOn": [],
      "why": "Workspace + container infra (stale — re-verify relevance): Global / search should include conversations in addition to workspace features",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-568",
      "rank": 687,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "stale",
      "dependsOn": [],
      "why": "Workspace + container infra (stale — re-verify relevance): Kanban: Show workspace and tmux session counts in stats",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-454",
      "rank": 688,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "stale",
      "dependsOn": [],
      "why": "Workspace + container infra (stale — re-verify relevance): Crash recovery: detect orphaned agents and present recovery UI on dashboard st...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-452",
      "rank": 689,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "stale",
      "dependsOn": [],
      "why": "Workspace + container infra (stale — re-verify relevance): Conversation input bar — mode/permissions/workspace selectors",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-407",
      "rank": 690,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "stale",
      "dependsOn": [],
      "why": "Workspace + container infra (stale — re-verify relevance): Run Panopticon from a main workspace for development isolation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-297",
      "rank": 691,
      "size": "S",
      "importance": "low",
      "score": 16,
      "condition": "stale",
      "dependsOn": [],
      "why": "CI / quality gate (stale — re-verify relevance): Workspace templates: pre/post tool hooks for auto-format, typecheck, lint",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-249",
      "rank": 692,
      "size": "S",
      "importance": "low",
      "score": 16,
      "condition": "stale",
      "dependsOn": [],
      "why": "CI / quality gate (stale — re-verify relevance): Add data-testid attributes across dashboard UI and create Playwright smoke test suite",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3469",
      "rank": 693,
      "size": "L",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard / operator UX: migrate NewProjectModal to a full page (page-not-modal doctrine)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3290",
      "rank": 694,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning / xBRIEF: xBRIEF items can carry empty metadata.traces — docs items are invisible to requirement traceability",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2645",
      "rank": 695,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory + knowledge: Add opt-in Observation-first conversation view",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2625",
      "rank": 696,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard / operator UX: auto-run /pan-new-project on project creation + setup banner, checklist, teaching empty states, and a guided dem...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1907",
      "rank": 697,
      "size": "L",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-sele...",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1906",
      "rank": 698,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1853",
      "rank": 699,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1839",
      "rank": 700,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: Settings → Providers: show each provider's default harness in the collapsed row (no expand needed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1782",
      "rank": 701,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: Handoff forks stall at \"Injecting…\" then die on double 300s summary timeout — decouple precompaction from the ha...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1754",
      "rank": 702,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings page",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1685",
      "rank": 703,
      "size": "L",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1684",
      "rank": 704,
      "size": "S",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI / quality gate: build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1672",
      "rank": 705,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1643",
      "rank": 706,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1623",
      "rank": 707,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1454",
      "rank": 708,
      "size": "M",
      "importance": "high",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feature: [META] 9 systemic failure patterns surfaced by 80-issue audit — substrate work to prevent closed-but-not-shipped issues",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2667",
      "rank": 709,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning / xBRIEF: Reimplement the task-progress admission signal in resource discovery (PAN-2648 follow-up)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2608",
      "rank": 710,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning / xBRIEF: Persistent collaboration roles (owner/editor/viewer) and organizations — gated behind the shared-instance milestone",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2572",
      "rank": 711,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feature: Noisy EBADENGINE + deprecation warnings on npx/npm install make a healthy install look broken",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2504",
      "rank": 712,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feature: Auto-relaunch npx @overdeck/core under a compatible Node 22+ instead of failing on old Node",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2491",
      "rank": 713,
      "size": "L",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feature: Migrate @xenova/transformers to @huggingface/transformers to eliminate silent npx install failures from sharp 0.32 postinstall",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2449",
      "rank": 714,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning / xBRIEF: start-planning: GITHUB_REPOS env shadows projects.yaml github_repo; unknown IDs fall through to Linear and plan the wr...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2195",
      "rank": 715,
      "size": "S",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning / xBRIEF: pan plan finalize re-plan churn: stale superseded spec on main transiently materializes the old plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1553",
      "rank": 716,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: Investigate Claude Code Fast mode support (and fast-tier pricing)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1481",
      "rank": 717,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: Add cost-event telemetry for Caveman token savings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1473",
      "rank": 718,
      "size": "L",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1461",
      "rank": 719,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory + knowledge: Conversation transcript: in-page search (Ctrl+F) only finds text in currently-rendered virtualized rows",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1325",
      "rank": 720,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: Artifact storage model is unsafe for polyrepo projects — define a canonical \"orchestration repo\"",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-633",
      "rank": 721,
      "size": "S",
      "importance": "low",
      "score": 13,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pipeline substrate (stale — re-verify relevance): Update Cloister PRD and docs index — stale relative to implementation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-298",
      "rank": 722,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "stale",
      "dependsOn": [],
      "why": "Workspace + container infra (stale — re-verify relevance): Auto-detect package manager and runtime in workspace setup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-252",
      "rank": 723,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "stale",
      "dependsOn": [],
      "why": "Workspace + container infra (stale — re-verify relevance): Disable Sync with Main button when workspace is up to date",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2941",
      "rank": 724,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory + knowledge: OKF v3 — lease-based writes and advisory semantic auditor",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2836",
      "rank": 725,
      "size": "L",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory + knowledge: okf: in-repo placement presets (okf/, docs/okf/) and /okf migrate to switch placements later",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2733",
      "rank": 726,
      "size": "S",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard / operator UX: substrate-bug-poller has never run — BOT_LOGIN is a git author string, not a GitHub user (49,907 failed polls)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1910",
      "rank": 727,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning / xBRIEF: fast-follow(PAN-1908): collapse issue status to ONE canonical field — labels become a derived projection, not the sour...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1646",
      "rank": 728,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning / xBRIEF: Rabbit-hole drift detection and lift-to-new-conversation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-984",
      "rank": 729,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: Evaluate context-mode MCP server as session continuity + search layer",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-943",
      "rank": 730,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: Add memory file review and management command",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-924",
      "rank": 731,
      "size": "L",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: evaluate GitNexus for Panopticon integration",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-901",
      "rank": 732,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness / model routing: Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-818",
      "rank": 733,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Harness / model routing (stale — re-verify relevance): Make summary optional when forking conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-797",
      "rank": 734,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Harness / model routing (stale — re-verify relevance): Cost display: cache write tokens not shown separately; investigate Claude Code dis...",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-773",
      "rank": 735,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Harness / model routing (stale — re-verify relevance): Design prompt-style overlays with model hierarchy and scoped toggles",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-764",
      "rank": 736,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Harness / model routing (stale — re-verify relevance): Add quota/usage inspector for routed model providers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-762",
      "rank": 737,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Harness / model routing (stale — re-verify relevance): Settings: warn when model overrides target disabled providers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-52",
      "rank": 738,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Workspace + container infra (stale — re-verify relevance): Guidance needed: Running complex multi-container projects with Panopticon work...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1443",
      "rank": 739,
      "size": "L",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning / xBRIEF: Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-752",
      "rank": 740,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Harness / model routing (stale — re-verify relevance): Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-730",
      "rank": 741,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Harness / model routing (stale — re-verify relevance): Add provider account telemetry for credits, balances, and usage",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-702",
      "rank": 742,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Harness / model routing (stale — re-verify relevance): OpenAI provider: add plan/subscription support and fix unregistered model resolution",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-649",
      "rank": 743,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "stale",
      "dependsOn": [],
      "why": "Harness / model routing (stale — re-verify relevance): Render Excalidraw drawings inline in Claude Code conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-571",
      "rank": 744,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "stale",
      "dependsOn": [],
      "why": "Harness / model routing (stale — re-verify relevance): Add OpenRouter credits/plan status endpoint and UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-570",
      "rank": 745,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "stale",
      "dependsOn": [],
      "why": "Harness / model routing (stale — re-verify relevance): Show PLAN badge on costs when under a subscription/plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-546",
      "rank": 746,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "stale",
      "dependsOn": [],
      "why": "Harness / model routing (stale — re-verify relevance): Remove claude-code-router — all providers use direct env var injection",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-543",
      "rank": 747,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "stale",
      "dependsOn": [],
      "why": "Harness / model routing (stale — re-verify relevance): Add confirmation dialog before applying Optimal Defaults",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-465",
      "rank": 748,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "stale",
      "dependsOn": [],
      "why": "Harness / model routing (stale — re-verify relevance): Add OpenRouter as a model provider",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-463",
      "rank": 749,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "stale",
      "dependsOn": [],
      "why": "Harness / model routing (stale — re-verify relevance): Add Qwen 3.6+ model support",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-245",
      "rank": 750,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "stale",
      "dependsOn": [],
      "why": "Planning / xBRIEF (stale — re-verify relevance): Ctrl+C aborts planning dialog instead of copying text",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2352",
      "rank": 751,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [
        "PAN-2351"
      ],
      "why": "Dashboard / operator UX: Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel + Access",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1592",
      "rank": 752,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory + knowledge: Composer: make ephemeral composer state reload-durable (pasted images + unsent/failed message text)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1357",
      "rank": 753,
      "size": "M",
      "importance": "high",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard / operator UX: Template conversations: load curated skill bundles into a single conversation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-958",
      "rank": 754,
      "size": "L",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning / xBRIEF: Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-944",
      "rank": 755,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning / xBRIEF: Make vBRIEF the durable task graph source of truth",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-817",
      "rank": 756,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "stale",
      "dependsOn": [],
      "why": "Planning / xBRIEF (stale — re-verify relevance): Improve planning dialog layout and content fit",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2392",
      "rank": 757,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost + telemetry: Standing Crew cost panel — per-member roster with cost, tokens, verdicts, escalations (mockup included)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1984",
      "rank": 758,
      "size": "L",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard / operator UX: Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1571",
      "rank": 759,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard / operator UX: Large multi-line pastes (handoff docs) land unsubmitted — paste/submit verification is blind to Claude's collaps...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1482",
      "rank": 760,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory + knowledge: Token spend report should aggregate data from repo, not just local machine",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1446",
      "rank": 761,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Dashboard / operator UX (needs refinement): PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-cree...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1445",
      "rank": 762,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard / operator UX: PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1128",
      "rank": 763,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard / operator UX: Channels: spurious 'no MCP server configured with that name' banner at conversation startup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1117",
      "rank": 764,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory + knowledge: Memory: pinned docs (long-form doc chunking + retrieval)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1116",
      "rank": 765,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory + knowledge: Memory: cross-project search mode",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3567",
      "rank": 766,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feature: Six floating Effects: Effect.promise/tryPromise wrapping Effect-returning callees — inner Effect never runs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1937",
      "rank": 767,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost + telemetry: data export — portable bundle (conversations + favorites core; decoupled optional cost ledger) + user-facing Export my ...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-51",
      "rank": 768,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "stale",
      "dependsOn": [],
      "why": "Harness / model routing (stale — re-verify relevance): Documentation: Clarify issue tracker options beyond Linear",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2493",
      "rank": 769,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard / operator UX: align the cockpit Agents-lane and sidebar issue-tree feature sets (two-way gaps)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2381",
      "rank": 770,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard / operator UX: three event types missing from DomainEvent schema union poison the RPC stream — permanent \"Reconnecting…\" loop",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2343",
      "rank": 771,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard / operator UX: refresh MISSION-CONTROL.md — update, harden, make useful",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2091",
      "rank": 772,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard / operator UX: delete dead IssueCockpitBody cockpit subtree (8 files, superseded by IssueMissionControl)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1479",
      "rank": 773,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost + telemetry: RTK: Add telemetry to measure token savings from bash output compression",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-947",
      "rank": 774,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard / operator UX: project management actions in unified sidebar",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-751",
      "rank": 775,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Memory + knowledge (needs refinement): PAN-XXX: Historical Metrics Data Persistence — Beyond the 30-Day JSONL Window",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-660",
      "rank": 776,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "stale",
      "dependsOn": [],
      "why": "Memory + knowledge (stale — re-verify relevance): Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-277",
      "rank": 777,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "stale",
      "dependsOn": [],
      "why": "Planning / xBRIEF (stale — re-verify relevance): Session reasoning capture & collaborative PRD refinement",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-243",
      "rank": 778,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "stale",
      "dependsOn": [],
      "why": "Planning / xBRIEF (stale — re-verify relevance): Audit dashboard actions: ensure all are available via CLI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-241",
      "rank": 779,
      "size": "L",
      "importance": "low",
      "score": 8,
      "condition": "stale",
      "dependsOn": [],
      "why": "Planning / xBRIEF (stale — re-verify relevance): Mobile redesign initiative: full UX/UI overhaul + implementation plan",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1656",
      "rank": 780,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard / operator UX: Skills page: make it a full management surface (browse, review, edit, scope, sync status)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1313",
      "rank": 781,
      "size": "M",
      "importance": "high",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feature: Finish src/lib Effect migration: remove or justify legacy Promise/sync surfaces",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1049",
      "rank": 782,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost + telemetry: evaluate Tauri v2 desktop shell",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-765",
      "rank": 783,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "stale",
      "dependsOn": [],
      "why": "Cost + telemetry (stale — re-verify relevance): Preserve trailing zeros in cost displays",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-658",
      "rank": 784,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "stale",
      "dependsOn": [
        "PAN-2356"
      ],
      "why": "Dashboard / operator UX (stale — re-verify relevance): Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-44",
      "rank": 785,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "stale",
      "dependsOn": [],
      "why": "Planning / xBRIEF (stale — re-verify relevance): Planning should fetch ALL issue context: comments, attachments, linked issues, discussions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1983",
      "rank": 786,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feature: Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1913",
      "rank": 787,
      "size": "M",
      "importance": "high",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard / operator UX: Project description: show on click, edit in dashboard, mirror into the project layer (and document what's in .pa...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1552",
      "rank": 788,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard / operator UX: Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1485",
      "rank": 789,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard / operator UX: Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1442",
      "rank": 790,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard / operator UX: Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1440",
      "rank": 791,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feature: Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-750",
      "rank": 792,
      "size": "L",
      "importance": "low",
      "score": 7,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Cost + telemetry (needs refinement): PAN-XXX: Complete Metrics Page Redesign — Real Data, Charts, Time Filtering, and TLDR Analytics",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3058",
      "rank": 793,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feature: Standing-crew templates: ship preset crew configurations (Claude ladder + OpenAI Sol/Terra/Luna) selectable from Settings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2868",
      "rank": 794,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feature: Desktop window opens at fixed 1400×900 — persist window state and default first run to maximized",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1042",
      "rank": 795,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feature: cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-949",
      "rank": 796,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard / operator UX: add conversation for project from sidebar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-903",
      "rank": 797,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard / operator UX: Detect ~/.claude.json corruption on startup and surface it in the dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-902",
      "rank": 798,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard / operator UX: Settings: add 'Run pan sync' button to configuration menu",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-886",
      "rank": 799,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feature: pan review request shows 'fetch failed' instead of actual sync-target-branch error",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2335",
      "rank": 800,
      "size": "S",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feature: review the full open backlog for junk/stale/nonsensical issues — produce a categorized document for operator review (FIND ONLY, ...",
      "gate": "blocked",
      "planning": "skip"
    },
    {
      "issue": "PAN-747",
      "rank": 801,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "stale",
      "dependsOn": [],
      "why": "Dashboard / operator UX (stale — re-verify relevance): Conversation list items lack accessible labels in accessibility tree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-743",
      "rank": 802,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "stale",
      "dependsOn": [],
      "why": "Dashboard / operator UX (stale — re-verify relevance): Add consistent new conversation icon actions in Command Deck",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-738",
      "rank": 803,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Dashboard / operator UX (stale — re-verify relevance): Add right-click fork option to conversation list",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-623",
      "rank": 804,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Dashboard / operator UX (stale — re-verify relevance): Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-565",
      "rank": 805,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Dashboard / operator UX (stale — re-verify relevance): Handle CTRL-Z to undo accidental conversation archival",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-564",
      "rank": 806,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Dashboard / operator UX (stale — re-verify relevance): Slash menu positioned incorrectly — cut off / off-screen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-554",
      "rank": 807,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Dashboard / operator UX (stale — re-verify relevance): Add kanban board deeplinks for issue URLs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-548",
      "rank": 808,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Dashboard / operator UX (stale — re-verify relevance): Command Deck: preserve state across navigation including URL routing for tabs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-438",
      "rank": 809,
      "size": "L",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Dashboard / operator UX (stale — re-verify relevance): Migrate remaining REST polling endpoints to Effect RPC",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1999",
      "rank": 810,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feature: Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-106",
      "rank": 811,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Cost + telemetry (stale — re-verify relevance): Cost prediction/estimation for in-progress work",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2073",
      "rank": 812,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard / operator UX: add user-facing page for the Desktop App",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1524",
      "rank": 813,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feature: Slash command aliases: /handoff → /pan-handoff (and similar short forms)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1483",
      "rank": 814,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feature: Distinguish general-use skills from Panopticon-only dev skills in pan sync",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1480",
      "rank": 815,
      "size": "L",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feature: TLDR: 93% bypass rate — daemon/hook integration broken",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1474",
      "rank": 816,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost + telemetry: Add ACKNOWLEDGEMENTS doc — credit borrowed code from open-source projects (MIT/Apache 2.0)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1065",
      "rank": 817,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feature: Validate issueId at every shell-string interpolation site (defense in depth)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-271",
      "rank": 818,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "Dashboard / operator UX (stale — re-verify relevance): Auto-assign Linear project from project config when creating issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-258",
      "rank": 819,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "Dashboard / operator UX (stale — re-verify relevance): Kanban board: fit all columns without horizontal scrolling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-769",
      "rank": 820,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "Feature (stale — re-verify relevance): Track verification/review/test phase churn over time",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-146",
      "rank": 821,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "Dashboard / operator UX (stale — re-verify relevance): PAN-146: Refine light mode theming across all dashboard pages",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-634",
      "rank": 822,
      "size": "S",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "Cost + telemetry (stale — re-verify relevance): Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale ...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-589",
      "rank": 823,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "Feature (stale — re-verify relevance): Review and update commands-skills.md with all available Panopticon skills",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-294",
      "rank": 824,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "Feature (stale — re-verify relevance): Surface module initialization errors as system-level, not per-issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2348",
      "rank": 825,
      "size": "L",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation: migrate STATE-STORAGE-AUDIT.md content to living docs, then delete",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-450",
      "rank": 826,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "Research / evaluation (stale — re-verify relevance): Adopt remaining Effect patterns — Schema, Platform, Streams, Logging, Testing",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1469",
      "rank": 827,
      "size": "L",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation: End-to-end review and consolidation of all project documentation",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-674",
      "rank": 828,
      "size": "S",
      "importance": "low",
      "score": 4,
      "condition": "stale",
      "dependsOn": [],
      "why": "Documentation (stale — re-verify relevance): add glossary of Panopticon domain terms",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2376",
      "rank": 829,
      "size": "XL",
      "importance": "high",
      "score": 4,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Pipeline substrate (needs refinement): Epic: CI/CD reliability — flake policy, verification-to-merge convergence, strike/swarm merge-path...",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2059",
      "rank": 830,
      "size": "XL",
      "importance": "high",
      "score": 4,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Pipeline substrate (needs refinement): [EPIC] Backlog pickup gate — operator Plan→Release row + AI Objection (5th state) + Flywheel relev...",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-793",
      "rank": 831,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Pipeline substrate (needs refinement): Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-791",
      "rank": 832,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Feature (needs refinement): Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2002",
      "rank": 833,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: [HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID)",
      "gate": "auto",
      "planning": "auto"
    }
  ],
  "edges": [
    {
      "from": "PAN-2075",
      "to": "PAN-2077",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2075",
      "to": "PAN-2078",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2075",
      "to": "PAN-2079",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2075",
      "to": "PAN-2080",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2642",
      "to": "PAN-1868",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2642",
      "to": "PAN-2466",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2642",
      "to": "PAN-570",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2642",
      "to": "PAN-1042",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2642",
      "to": "PAN-77",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2642",
      "to": "PAN-106",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2642",
      "to": "PAN-797",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2642",
      "to": "PAN-2392",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2642",
      "to": "PAN-2443",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2642",
      "to": "PAN-2028",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2642",
      "to": "PAN-2029",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1666",
      "to": "PAN-1556",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1666",
      "to": "PAN-1676",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2350",
      "to": "PAN-2351",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2350",
      "to": "PAN-2352",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2350",
      "to": "PAN-2353",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2350",
      "to": "PAN-2354",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2350",
      "to": "PAN-2355",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2350",
      "to": "PAN-2356",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2350",
      "to": "PAN-658",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2350",
      "to": "PAN-3513",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2566",
      "to": "PAN-2565",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2566",
      "to": "PAN-2608",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2566",
      "to": "PAN-2609",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2424",
      "to": "PAN-3427",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2908",
      "to": "PAN-3090",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2908",
      "to": "PAN-2950",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2908",
      "to": "PAN-3411",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2908",
      "to": "PAN-3469",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2908",
      "to": "PAN-2968",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2976",
      "to": "PAN-2977",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2976",
      "to": "PAN-2978",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2977",
      "to": "PAN-2978",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1166",
      "to": "PAN-2351",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2351",
      "to": "PAN-2352",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2351",
      "to": "PAN-2353",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2351",
      "to": "PAN-2354",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2352",
      "to": "PAN-2355",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2356",
      "to": "PAN-658",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1775",
      "to": "PAN-2077",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2077",
      "to": "PAN-2078",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2077",
      "to": "PAN-2079",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2079",
      "to": "PAN-2080",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3517",
      "to": "PAN-3518",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3572",
      "to": "PAN-3554",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3504",
      "to": "PAN-3554",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3532",
      "to": "PAN-3554",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3512",
      "to": "PAN-3283",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3512",
      "to": "PAN-2746",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3566",
      "to": "PAN-2706",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3566",
      "to": "PAN-3274",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3429",
      "to": "PAN-3314",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3539",
      "to": "PAN-3314",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3062",
      "to": "PAN-3505",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3062",
      "to": "PAN-3250",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2409",
      "to": "PAN-3284",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3188",
      "to": "PAN-3168",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2846",
      "to": "PAN-3168",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3047",
      "to": "PAN-2828",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2079",
      "to": "PAN-1868",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1676",
      "to": "PAN-2549",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2670",
      "to": "PAN-2635",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3308",
      "to": "PAN-3322",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3504",
      "to": "PAN-3499",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.95
    },
    {
      "from": "PAN-3099",
      "to": "PAN-2547",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.95
    },
    {
      "from": "PAN-2580",
      "to": "PAN-2546",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.95
    },
    {
      "from": "PAN-2828",
      "to": "PAN-2995",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.9
    },
    {
      "from": "PAN-3283",
      "to": "PAN-2746",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.9
    },
    {
      "from": "PAN-3306",
      "to": "PAN-3317",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.9
    },
    {
      "from": "PAN-3317",
      "to": "PAN-2738",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.85
    },
    {
      "from": "PAN-3104",
      "to": "PAN-2700",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.9
    },
    {
      "from": "PAN-2966",
      "to": "PAN-2945",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.9
    },
    {
      "from": "PAN-3520",
      "to": "PAN-3492",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3344",
      "to": "PAN-3492",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3236",
      "to": "PAN-3559",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3234",
      "to": "PAN-3261",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3084",
      "to": "PAN-2706",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-2695",
      "to": "PAN-3556",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3224",
      "to": "PAN-2886",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.85
    },
    {
      "from": "PAN-3439",
      "to": "PAN-3224",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.85
    },
    {
      "from": "PAN-3325",
      "to": "PAN-3270",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.85
    },
    {
      "from": "PAN-3270",
      "to": "PAN-2763",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2769",
      "to": "PAN-2888",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3044",
      "to": "PAN-2888",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3248",
      "to": "PAN-3244",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3244",
      "to": "PAN-3205",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-2720",
      "to": "PAN-3308",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-1918",
      "to": "PAN-3532",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-2941",
      "to": "PAN-2983",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.9
    },
    {
      "from": "PAN-3129",
      "to": "PAN-3130",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2659",
      "to": "PAN-3561",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.85
    },
    {
      "from": "PAN-3256",
      "to": "PAN-3267",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2813",
      "to": "PAN-3432",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-2079",
      "to": "PAN-3550",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3179",
      "to": "PAN-3176",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2950",
      "to": "PAN-2189",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2189",
      "to": "PAN-2526",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3186",
      "to": "PAN-3167",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2547",
      "to": "PAN-2663",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    }
  ]
}
```
