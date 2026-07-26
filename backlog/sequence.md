# Backlog Sequence

_Last sequenced: 2026-07-26T05:00:24Z · model: claude-opus-5 · open: 697_


| rank | issue | size | importance | condition | epic | depends-on | why |
|------|-------|------|------------|-----------|------|------------|-----|
| 1 | PAN-3101 | XS | critical | ok |  |  | RED MAIN: #3099 changed --health-timeout without regenerating the composer-command manifest; every PR inherits the failing lint |
| 1 | PAN-3051 | S | critical | ok |  |  | Tool-permission prompts never reach Decisions: surface reads the dead Channels map — 5 agents frozen with nobody told |
| 2 | PAN-3056 | XS | critical | ok |  |  | RED MAIN: a new boot-reconciliation route/export landed without the route-test mock or a no-loss matrix entry |
| 2 | PAN-3029 | XS | critical | ok |  |  | RED MAIN: lint:slash-commands drift on the promote commit blocks CI, deploy and close-out of 4 merged members |
| 6 | PAN-3097 | S | medium | ok |  |  | AskUserQuestion dialog shows a bare identifier and agents write questions that assume the transcript — operator answers blind |
| 7 | PAN-2997 | M | high | ok |  |  | Surface Linear MCP OAuth as a global intervention and wake blocked agents after re-auth |
| 7 | PAN-2876 | M | medium | ok |  |  | Conversation subagent rail: list spawned subagents and open their transcripts. |
| 9 | PAN-2746 | XS | critical | ok |  | PAN-2742, PAN-2695 | infra-failure bypass writes reviewStatus='passed' |
| 10 | PAN-2952 | S | critical | ok |  |  | Review verdict writes lost to per-issue record-lock collisions; reads reconcile stale journal over fresh DB state |
| 11 | PAN-3092 | S | critical | ok |  |  | Review agent's own record lock blocks its own verdict write — the fallback is consumed and the verdict is lost from every plane |
| 12 | PAN-2689 | S | critical | ok |  |  | Review verdicts from sandboxed codex review agents are silently lost |
| 13 | PAN-3084 | S | critical | ok |  |  | A review session spawned but never briefed sits at zero context forever and blocks its own replacement; restart 'preserves' the zombie |
| 14 | PAN-2695 | S | high | ok |  |  | Concurrent review dispatches race fresh-spawn vs resume |
| 15 | PAN-2742 | S | high | ok |  |  | synthesis fires 42s after spawn and reports reviewers with reports on disk as 'infrastructure failure' |
| 16 | PAN-3085 | XS | critical | ok |  |  | Review feedback is written to .overdeck/feedback but agents and the deacon merge gate read a nonexistent .pan/feedback |
| 17 | PAN-3078 | S | critical | ok |  |  | Inspect verdict is persisted but never delivered to the work agent — an agent that waits for it deadlocks forever |
| 18 | PAN-2706 | M | high | ok |  |  | Ghost test sessions absorb every test dispatch |
| 19 | PAN-2700 | S | high | ok |  |  | Test artifact recovery consumes a stale .pan/test/result.json |
| 20 | PAN-3104 | S | critical | ok |  |  | Stale .pan/test/result.json is re-applied with no freshness check against HEAD, re-failing an issue after the fix has landed |
| 21 | PAN-3100 | S | critical | ok |  |  | Test role evaluates the dirty working tree, so a live work agent's uncommitted edits produce false test failures |
| 22 | PAN-2733 | S | high | ok |  |  | substrate-bug-poller has never run |
| 23 | PAN-1560 | XS | high | ok |  |  | Re-review after a PR head moves doesn't re-post panopticon/review status → PR stranded BLOCKED |
| 24 | PAN-2769 | S | high | ok |  |  | review_status rows are never reconciled when an issue closes |
| 25 | PAN-3044 | S | high | ok |  |  | Review feedback delivery runs against CLOSED issues — it resurrects agents and raises needs-you twelve days after close-out |
| 26 | PAN-2828 | S | critical | ok |  |  | pan done --strike always refuses squash-merged strikes (--is-ancestor can't see through a squash) |
| 27 | PAN-2995 | S | high | needs-refinement |  |  | pan done --strike false-blocks after a gh-API squash-merge; should verify PR-merged state, not branch ancestry (overlaps PAN-2828) |
| 28 | PAN-2874 | M | critical | ok |  | PAN-2828 | Strike landing pipeline cannot merge strikes: verification gate demands a vBRIEF checklist strikes never have, and failed-feedback deli… |
| 29 | PAN-2883 | M | high | ok |  | PAN-2828 | Close-out deploy row fails for every strike-landed issue |
| 30 | PAN-3047 | S | high | ok |  |  | Strike-branch teardown never fires: --is-ancestor cannot see a squash merge, so all 96 strike/* branches survive as residue |
| 31 | PAN-2806 | S | high | ok |  |  | strike merge trigger registry splits across dashboard chunks |
| 32 | PAN-2802 | S | high | ok |  |  | same-head strike-ready cannot re-arm a needs-you landing |
| 33 | PAN-2796 | S | high | ok |  |  | idle nudge must not advance after failed mandatory inspection |
| 34 | PAN-3036 | XS | medium | ok |  |  | False '! INPUT' chip on completed strike agents — the pane-idle heuristic misreads post-strike-ready idle as a question |
| 35 | PAN-3034 | S | medium | needs-refinement |  |  | Command Deck session tree missed strike-only issues; the body states the fix already landed on main — verify before picking up |
| 36 | PAN-2940 | M | critical | ok |  |  | Three red-mains in one day from direct-push series bypassing PR CI |
| 37 | PAN-3062 | M | high | ok |  |  | Shared primary main worktree: any agent that pushes main also ships every other session’s unpushed commits, verified or not |
| 38 | PAN-3081 | M | high | ok |  |  | Agent git guard is $PATH-removable and false-blocks pan state writes; an agent derived the bypass unprompted |
| 39 | PAN-2932 | S | high | ok |  | PAN-2337 | intermittent dashboard boot wedge between Cloister start and ReadModel bootstrap leaves :3011 unbound (Bad Gateway) after pan reload |
| 40 | PAN-2935 | S | critical | ok |  |  | Workspace devcontainer duplicate backend hijacks Traefik router |
| 41 | PAN-3049 | S | critical | ok |  |  | Duplicate Docker stacks per workspace (myn-feature-* beside overdeck-feature-*) doubled memory and exhausted the host |
| 42 | PAN-3050 | S | high | ok |  |  | Idle-stack reaper matches only overdeck-feature-*-server|frontend, so non-Overdeck workspace stacks are never reaped |
| 43 | PAN-3032 | M | high | needs-refinement |  |  | Workspace rebuild composes under 'overdeck-feature-' while Traefik labels reference the project prefix — 504s (overlaps PAN-2423) |
| 44 | PAN-2337 | XS | critical | ok |  |  | Reload/build atomicity: an in-place `npm run build` under a live dashboard breaks new PTY-supervisor spawns until restart |
| 45 | PAN-2422 | XS | high | ok |  | PAN-2337 | rebuilding dist under a live server breaks lazy chunk imports |
| 46 | PAN-2699 | XS | high | ok |  |  | npm run build regenerates the committed record-cost-event.js bundle |
| 47 | PAN-2957 | XS | high | ok |  | PAN-2337 | npm run build intermittently produces stale frontend bundles |
| 48 | PAN-2850 | M | high | ok |  |  | npm test fails in clean checkout after pretest removes dashboard bundle |
| 49 | PAN-3099 | S | high | needs-refinement |  |  | pan restart --health-timeout 120 was enforced as 120ms and a false fail left the dashboard DOWN (overlaps PAN-2547) |
| 50 | PAN-2758 | S | critical | ok |  |  | Provider capacity error silently zombies a spawned agent: willRetry=false, turn reported completed, state stays status=running forever |
| 51 | PAN-3043 | M | high | ok |  |  | Mid-run provider quota exhaustion is undetected: the agent stays 'running' for days holding a slot; health is probed only at spawn |
| 52 | PAN-2886 | M | high | ok |  |  | Placeholder (pending-work-spawn) agents crash auto-resume with 'Unknown model' → stranded troubled forever |
| 53 | PAN-2817 | M | high | ok |  |  | Idle-at-prompt work/review agents are never redriven: gpt-5.6-sol sessions stop at the composer mid-task and sit for hours |
| 54 | PAN-3057 | M | high | ok |  |  | Harness-initiated compaction leaves agents idle forever; the GPT-5.6 context window is declared twice (372K vs 150K) |
| 55 | PAN-2813 | M | high | ok |  |  | Scheduler yield never self-clears: yielded work agents stay paused after the blocking review completes/merges |
| 56 | PAN-2848 | S | critical | ok |  |  | Work agent stalls forever on a dead inspection: no re-dispatch, verdict never delivered, swarm-off suppresses recovery of a non-swarm a… |
| 57 | PAN-2846 | S | critical | ok |  |  | Close-out blocks on a dead agent: postMergeLifecycle pauses the work agent but leaves status=running |
| 58 | PAN-2749 | S | high | ok |  |  | Resume restores the conversation but not the machinery: timers, monitors and background processes die and are never re-armed |
| 59 | PAN-2747 | S | high | ok |  |  | Flywheel cannot be resumed after a crash/reboot: Resume is disabled and the only offered action aborts the run |
| 60 | PAN-2759 | S | high | ok |  |  | Dead flywheel with an active run was never auto-relaunched after a reboot |
| 61 | PAN-2971 | S | high | ok |  |  | Flywheel orchestrator finalized its own run but kept ticking for 19 hours; dashboard Pause and Stop were disabled on the zombie |
| 62 | PAN-2709 | M | high | ok |  |  | Flywheel orchestrator is unreachable as a notification target |
| 63 | PAN-2668 | M | high | ok |  |  | Verification/review feedback silently queued to stopped-by-user agents |
| 64 | PAN-2569 | XS | critical | ok |  |  | planning finalizes (issue→planned) but work agent does not auto-spawn |
| 65 | PAN-3023 | S | high | ok |  |  | Post-planning auto-spawn abandoned on a transient Docker failure — 'attempt 1/3' never retries and no patrol re-drives it |
| 66 | PAN-2567 | S | critical | ok |  |  | reviewed+green PR stuck after review |
| 67 | PAN-3103 | S | high | ok |  |  | A transient merge_status=failed permanently skips automatic close-out, leaving merged work open and pickup-eligible |
| 68 | PAN-3106 | S | high | ok |  |  | auto_merge_default: hold is bypassed — shouldHoldForUat is consulted on one merge path, so held issues merge individually |
| 69 | PAN-3094 | XS | high | ok |  |  | pan done's merge fallback force-pushes a fast-forward branch, so a rejected push leaves the command partially complete |
| 70 | PAN-3096 | S | high | needs-refinement |  |  | pan done fails on generated devcontainer harness and agents infer deleting workspace infrastructure (overlaps PAN-2966/2945) |
| 71 | PAN-3048 | S | high | ok |  |  | Pipeline auto-commit lands .pan/drafts/<ISSUE>.md in product feature branches; the duplicated exclusion list has drifted |
| 72 | PAN-3022 | S | high | ok |  |  | Work-spawn route ignores the per-issue workModel override, runs the role default, then clobbers the operator's stored override |
| 73 | PAN-3025 | S | high | ok |  |  | Durable pipeline journal omits verificationStatus, so the DoD verification row false-MISSes after close-out or a DB rebuild |
| 74 | PAN-3077 | XS | high | ok |  |  | Inspect and review-supervisor spawns omit --effort and inherit the harness xhigh default; this fires once per xBRIEF item |
| 75 | PAN-2179 | S | high | ok |  |  | relaunch can leave a zombie agent |
| 76 | PAN-2169 | S | high | ok |  |  | kimi agent silently frozen at 100% ctx (no thrown overflow error) not caught by CONTEXT_OVERFLOW_PATTERNS |
| 77 | PAN-2775 | S | high | ok |  |  | Agents die in sweeps: boot-correlated false reaps (live flywheel reaped, convoy reaped 5x) + unexplained simultaneous 3-host kill at 04… |
| 78 | PAN-2734 | S | high | ok |  |  | merge queue head-of-line zombie |
| 79 | PAN-2323 | S | high | ok |  |  | Flywheel respawn after crash/displacement starts a blank session instead of resuming the live one |
| 80 | PAN-1618 | S | high | ok |  |  | Substrate: work-spawn docker-health gate has no autonomous recovery |
| 81 | PAN-2888 | M | high | ok |  | PAN-2846 | Close-out leaves stale residue that inflates troubled/failed metrics: orphaned inspect sub-agents + uncleared review_status rows on CLO… |
| 82 | PAN-3037 | S | high | ok |  |  | pan sync-main probes the polyrepo workspace root for .git instead of iterating member repos, so it can never run on a polyrepo project |
| 82 | PAN-2960 | S | high | ok |  |  | Inspect supervisor lingers past 12m limit and never self-terminates after posting a verdict |
| 83 | PAN-2959 | S | high | ok |  |  | pan inspect --item <X> reviews workspace HEAD, not item X's commit |
| 84 | PAN-2639 | S | high | ok |  | PAN-2331 | codex-resume replays a rotated-out (revoked) refresh token → codex review convoys wedge with 401 |
| 85 | PAN-2331 | S | high | ok |  |  | codex rate-limit 'Switch to gpt-5.4-mini?' modal stalls autonomous agents (no auto-dismiss) |
| 86 | PAN-2333 | M | high | ok |  |  | feat: handle codex weekly-quota exhaustion gracefully |
| 87 | PAN-2511 | XS | high | ok |  |  | Work agents burn 20+ min on false test failures |
| 88 | PAN-2451 | M | high | ok |  |  | Work agent stranded behind commit-msg gate after overflow-restart + auto-commit + merge-main (non-issue-ref commits) |
| 89 | PAN-2516 | S | high | ok |  |  | Spec plan.status flips left uncommitted in shared primary worktree → spec-vs-record drift + blocks flywheel push |
| 90 | PAN-2763 | S | high | ok |  |  | Workspace node_modules is symlinked to the primary repo, breaking test resolution |
| 91 | PAN-2170 | XS | high | ok |  |  | Docker init container lacks Python |
| 92 | PAN-1198 | S | high | ok |  |  | Workspace init container's bun install doesn't populate container-node-modules named volume |
| 93 | PAN-2106 | S | high | ok |  |  | pan strike workspace setup leaves broken partial workspace + false 'spawned' success (git-lock race) |
| 94 | PAN-3040 | M | high | ok |  |  | pan strike fails on polyrepo projects — worktree creation, merge validation and the strike merge request are all monorepo-shaped |
| 95 | PAN-2954 | XS | critical | ok |  | PAN-2882 | postMergeLifecycle refuses GitLab projects |
| 96 | PAN-2882 | XS | critical | ok |  |  | Pipeline membership has no GitLab merged-MR oracle |
| 97 | PAN-2880 | M | high | ok |  | PAN-2259 | Linear tracker listIssues is a 3N+1 request storm |
| 98 | PAN-2966 | S | high | ok |  |  | Polyrepo wrapper .gitignore misses .pan/ .devcontainer/ dev |
| 99 | PAN-2945 | S | high | ok |  |  | pan done rejects Overdeck-generated runtime in polyrepo wrapper repos (.devcontainer/, dev, .pan/review) |
| 100 | PAN-2680 | M | high | ok |  |  | pan close: Docker teardown silently skips a running stack in multi-repo projects (MYN), aborting close-out |
| 101 | PAN-2627 | S | high | ok |  |  | Linear poller is blind after cycle rollover |
| 102 | PAN-2324 | XS | high | ok |  |  | label transition fails atomically on missing 'in-planning' label |
| 103 | PAN-2165 | XS | high | ok |  |  | pan close: close-issue phase reports success but leaves issue OPEN / wrong labels (remove-label aborts on absent label; no-vBRIEF trans… |
| 104 | PAN-2905 | S | high | ok |  |  | Dashboard steady-state CPU ~50% keeps API responses at 0.5-1.5s |
| 105 | PAN-2259 | S | critical | ok |  |  | something burns the full 5k/hr GitHub GraphQL quota |
| 106 | PAN-2379 | S | high | ok |  |  | dependency install is warn-only + 60s timeout → false verify failures against empty node_modules (blocks swarm convergence) |
| 107 | PAN-2421 | XS | high | ok |  |  | dashboard server route tests flake under full-suite verification load |
| 108 | PAN-2430 | S | high | ok |  |  | frontend typecheck fails with dozens of pre-existing unused-local errors |
| 109 | PAN-2593 | S | high | ok |  |  | server children inherit bare system PATH |
| 110 | PAN-2656 | S | high | ok |  |  | deacon-swarm unit tests read live ~/.overdeck/config.yaml |
| 111 | PAN-1824 | S | high | ok |  |  | Fix flaky main CI: fake timers + @slow exclusion for real-timer test family |
| 112 | PAN-2980 | S | high | ok |  |  | pre-push file-size guard audits the dirty working tree, so another session's uncommitted edits block unrelated pushes |
| 113 | PAN-3046 | XS | medium | ok |  |  | pan CLI crashes at exit with ERR_UNHANDLED_REJECTION when the PostHog shutdown flush times out; a success exits non-zero |
| 114 | PAN-3003 | XS | medium | ok |  |  | Work-agent launchers lack an OVERDECK_AGENT_ID export, so a manual re-launch dies instantly under the PTY supervisor |
| 115 | PAN-3013 | XS | medium | ok |  |  | linear-mcp-auth-hook entries leak into durable ~/.claude/settings.json pointing at dead /tmp/pan-agent-role-* paths |
| 116 | PAN-3014 | XS | medium | ok |  |  | Background AI title/about spawns fail because --bare skips credential reads in Claude Code 2.1.209 |
| 117 | PAN-2075 | XL | high | ok | ✓ |  | Boot Reconciliation + Operator Inbox |
| 118 | PAN-2077 | M | high | ok |  | PAN-1775 | Substrate-complete reconciliation inventory (local tmux + remote Fly machines) |
| 119 | PAN-2078 | M | high | ok |  | PAN-2077 | CLI parity for boot reconciliation: pan boot status + pan resume --all|--select|--freeze|--kill-remote |
| 120 | PAN-2079 | M | high | ok |  | PAN-2077 | Operator Inbox: durable server-side queue + in-dashboard surface (the notification spine) |
| 121 | PAN-2080 | M | high | ok |  | PAN-2079 | Operator Inbox external transports (email/Slack/push/TTS) |
| 122 | PAN-1775 | M | high | ok |  |  | Remote (Fly.io) work agents appear as real session rows in the issue tree |
| 123 | PAN-454 | XS | high | ok |  | PAN-2077 | Crash recovery: detect orphaned agents and present recovery UI on dashboard startup |
| 124 | PAN-1436 | S | high | ok |  |  | PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list |
| 125 | PAN-2642 | XL | high | ok | ✓ |  | Cost strategy: waste detection over budget policing |
| 126 | PAN-1868 | XS | high | ok |  | PAN-2466 | Cost-bleed circuit breaker: progress-aware, always-on guard against runaway agent spend |
| 127 | PAN-2466 | S | high | ok |  |  | close-out/record writer clobbers closeOut.usage with EMPTY data |
| 128 | PAN-1042 | S | high | ok |  |  | cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions |
| 129 | PAN-570 | XS | high | ok |  | PAN-2642 | Show PLAN badge on costs when under a subscription/plan |
| 130 | PAN-106 | M | high | stale |  |  | Cost prediction/estimation for in-progress work |
| 131 | PAN-2059 | XL | high | ok | ✓ |  | Backlog pickup gate |
| 132 | PAN-2376 | XL | high | ok | ✓ |  | Epic: CI/CD reliability |
| 133 | PAN-1666 | XL | medium | ok | ✓ |  | Pipeline Throughput Hardening |
| 134 | PAN-1556 | S | high | ok |  |  | Session/activity feed: coalesce review-spawn spam, supersede re-reviews per issue, keep active conversations most-recent |
| 135 | PAN-3015 | L | high | ok |  |  | pan monitor: a pull-based background inbox transport to replace keystroke injection as the Claude Code delivery path |
| 136 | PAN-3093 | L | high | ok |  | PAN-1696 | Polyrepo UAT assembly: per-repo generation branches, per-repo base SHAs, all-or-nothing promote — unblocks the MYN train |
| 137 | PAN-2188 | M | high | ok |  |  | Flywheel resilience for the codebase-health flood: substrate-first prioritization + tenets spirit-gate |
| 138 | PAN-1990 | M | medium | ok |  |  | First-class workspaces and projects with per-workspace memory — use Overdeck without filing an issue first |
| 139 | PAN-2565 | M | medium | ok |  |  | Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging |
| 140 | PAN-2566 | L | medium | ok |  |  | Traycer parity epic: gap analysis of capabilities Overdeck lacks, with the already-covered set explicitly excluded |
| 141 | PAN-2189 | L | high | ok |  |  | Decompose src/lib/cloister/deacon.ts (3,394 lines) |
| 142 | PAN-2190 | L | high | ok |  |  | Decompose routes/workspaces/merge-ops.ts (1,925 lines) |
| 143 | PAN-2233 | L | high | ok |  |  | decompose merge-agent.ts (1,414 lines) into focused modules |
| 144 | PAN-2526 | M | high | ok |  |  | Refactor deacon.ts below file-size baseline |
| 145 | PAN-2008 | XS | high | ok |  | PAN-1936 | store-access guard |
| 146 | PAN-1936 | M | high | ok |  |  | Single source-of-truth reads |
| 147 | PAN-1988 | M | high | ok |  | PAN-1936 | Verdict signaling: one host-owned write door; agents journal, host owns the DB cache |
| 148 | PAN-1910 | XS | high | ok |  | PAN-1936 | fast-follow(PAN-1908): collapse issue status to ONE canonical field |
| 149 | PAN-1325 | M | high | ok |  |  | Artifact storage model is unsafe for polyrepo projects |
| 150 | PAN-1728 | S | high | ok |  |  | PAN-1700 agent committed .pan/specs/*.vbrief.json mutations |
| 151 | PAN-2651 | S | high | ok |  |  | simplify lifecycle reconciliation and add a safe post-planning reset |
| 152 | PAN-2678 | M | high | ok |  |  | Ops: clean blocked state worktrees, fix auricle git-status failure, restore the Deacon (2026-07-14 review outage) |
| 153 | PAN-2241 | S | high | ok |  |  | complete-planning is not serialized or idempotent per issue (spec tmp-rename 500s, bead delete-recreate thrash) |
| 154 | PAN-2242 | S | high | ok |  |  | Unidentified duplicate caller fires complete-planning in pairs every ~2 minutes (perpetual loop while session survives) |
| 155 | PAN-2240 | S | high | ok |  |  | pan tell contradicts itself on dead ohmypi sessions |
| 156 | PAN-2243 | S | high | ok |  |  | pan plan finalize: CLI aborts complete-planning at 90s while the server handler legitimately finishes later (false ✖ Failed) |
| 157 | PAN-2244 | S | high | ok |  |  | Recurring [pan-dir/auto-commit] GitError on main |
| 158 | PAN-2202 | S | high | ok |  |  | complete-planning silently skips spec promotion on a dead session's unanswered AskUserQuestion |
| 159 | PAN-2195 | M | high | ok |  |  | pan plan finalize re-plan churn: stale superseded spec on main transiently materializes the old plan |
| 160 | PAN-2237 | S | high | ok |  |  | pan plan done swallows vbrief quality lint details |
| 161 | PAN-2487 | M | high | ok |  |  | CI-green merge skip + Ship & Merge cockpit view (live door log + progress) + active-node spinner |
| 162 | PAN-2469 | M | high | ok |  |  | issue-level assembly owner |
| 163 | PAN-2212 | M | high | ok |  |  | Swarm slot dispatch has no reserved budget |
| 164 | PAN-2213 | M | high | ok |  |  | Swarm slot allocator picks an orphaned slot index and refuses instead of skipping to the next free one |
| 165 | PAN-2211 | M | high | ok |  |  | PAN-2203 follow-up: swarm slot pan done records completion but slot never becomes merge-ready |
| 166 | PAN-2210 | M | high | ok |  |  | PAN-2203 follow-up: a swarm slot's completion can trigger the issue-level review pipeline |
| 167 | PAN-2201 | XS | high | ok |  |  | Close-out label step fails atomically when a hardcoded label (e.g. 'in-planning') is absent from the repo |
| 168 | PAN-2718 | M | high | ok |  |  | pan restart needs a first-class no-dialog reconciliation flag |
| 169 | PAN-2646 | XS | high | ok |  |  | configurable global/project/issue policy UI with default OFF |
| 170 | PAN-2652 | M | high | ok |  |  | Conversation view diverges from Terminal: Claude Code backgrounding forks the session file in-process, invisible to all session-id reso… |
| 171 | PAN-2667 | M | high | ok |  |  | Reimplement the task-progress admission signal in resource discovery |
| 172 | PAN-2755 | S | high | ok |  |  | per-issue review-model override never reached convoy sub-reviewers on the discovery-fork path |
| 173 | PAN-2754 | S | high | ok |  |  | `always` is inert |
| 174 | PAN-2809 | M | high | ok |  |  | Live-terminal Playwright UAT blocked in containerized workspaces (node-pty musl/glibc mismatch + Vite/Traefik WS Origin 403) |
| 175 | PAN-2810 | M | high | ok |  |  | Workspace 'vitest --changed' gate diverges from CI: App.test.tsx fails locally on missing selectPendingInputSubjects mock |
| 176 | PAN-2982 | S | medium | ok |  |  | Review convoy should run a skill’s own selftest when sync-sources/skills/** changes; no mechanical gate exists today |
| 177 | PAN-2495 | S | high | ok |  |  | PAN-2487 ci-green merge skip bypassed CI-green gate |
| 178 | PAN-2478 | S | high | ok |  |  | CI flake: Playwright browser install fails on packages.microsoft.com apt (NOSPLIT), red-mains legit merges |
| 179 | PAN-1710 | S | high | ok |  |  | 'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 and feature/pan-1641 |
| 180 | PAN-1720 | S | high | ok |  |  | cloister auto-resume tests fail under full parallel run, pass in isolation |
| 181 | PAN-1558 | M | high | ok |  |  | Review/specialist agents should run in the workspace Docker container, not inherit host-override |
| 182 | PAN-1650 | M | high | ok |  |  | Split readyForMerge → gatesPassed (derived/event-driven) + shipComplete; auto-dispatch ship on gates-green |
| 183 | PAN-3090 | M | medium | ok |  |  | Simple issue page: narrative feed instead of a 55KB raw kickoff dump, surface the pending question, honest blocked state |
| 184 | PAN-3017 | S | medium | ok |  |  | Issue-page UAT panel renders no overflow menu, so a healthy stack has no restart control; panel coverage is inconsistent |
| 185 | PAN-1766 | S | high | ok |  |  | work agents hang on Claude Code settings-file protection when editing .claude/** |
| 186 | PAN-1767 | M | high | ok |  |  | Show merged-but-not-closed-out count in pan status and the dashboard headline |
| 187 | PAN-1770 | S | high | ok |  |  | pan-dir auto-commit rebase races live .pan/continues writes |
| 188 | PAN-1889 | M | high | ok |  |  | retention/compaction policy for docs/FLYWHEEL-STATE.md |
| 189 | PAN-2027 | M | high | ok |  |  | ohmypi: route kimi-k2 through ohmypi harness instead of CLIProxy (eliminates 200k-window illusion) |
| 190 | PAN-2266 | M | high | ok |  |  | feat: add zcode harness and make it the default for glm-5.2 |
| 191 | PAN-1578 | M | high | ok |  |  | GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex) |
| 192 | PAN-1538 | M | high | ok |  |  | Unblock Pi source forks |
| 193 | PAN-687 | M | high | ok |  |  | Support OpenCode as alternative coding agent |
| 194 | PAN-466 | M | high | ok |  |  | Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex |
| 195 | PAN-465 | M | high | ok |  |  | Add OpenRouter as a model provider |
| 196 | PAN-3011 | M | low | ok |  |  | Support poolside Laguna S 2.1 (118B MoE, 1M ctx) — hosted via OpenRouter now, self-host when the hardware exists |
| 197 | PAN-463 | M | high | ok |  |  | Add Qwen 3.6+ model support |
| 198 | PAN-1142 | M | high | ok |  |  | Add reasoning effort level to per-role / per-conversation model config |
| 199 | PAN-1424 | M | high | needs-refinement |  |  | Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122) |
| 200 | PAN-1196 | M | high | needs-refinement |  |  | Workhorse routing by bead difficulty + subject-matter (single-agent and swarm) |
| 201 | PAN-1311 | M | high | needs-refinement |  |  | Swarm: fast-track tier |
| 202 | PAN-1313 | L | high | ok |  |  | Finish src/lib Effect migration: remove or justify legacy Promise/sync surfaces |
| 203 | PAN-1246 | M | high | ok |  |  | Perf: projection-cached VCS driver for diff/checkpoint reads (port of t3code #2586) |
| 204 | PAN-1253 | M | high | ok |  |  | Flywheel: respect issue dependencies before autopicking work |
| 205 | PAN-1254 | L | high | ok |  |  | Tailscale integration: advertise dashboard + workspace endpoints over tailnet (Effect-native) |
| 206 | PAN-1357 | M | high | ok |  |  | Template conversations: load curated skill bundles into a single conversation |
| 207 | PAN-2976 | L | medium | ok |  |  | Generalize the ACP harness: any ACP-capable agent CLI as a spawnable runtime behind a machine-checkable capability gate |
| 208 | PAN-2977 | M | medium | ok |  | PAN-2976 | ACP agent setup UI: detect installed CLIs, show capability and auth status, and guide login from Settings |
| 209 | PAN-3058 | M | medium | ok |  |  | Standing-crew templates: ship preset tiered-execution configurations selectable from Settings |
| 210 | PAN-3054 | M | medium | ok |  |  | Benchmark matrix: launch one template issue under N configurations and compare cost, time and outcome mechanically |
| 211 | PAN-3061 | M | medium | ok |  | PAN-3054 | Dispatch-topology advisor: deterministic start-vs-swarm recommendation computed from plan shape at plan-finalize |
| 212 | PAN-1915 | M | high | ok |  |  | enhancement(security): API key at-rest hardening |
| 213 | PAN-1435 | XS | high | ok |  |  | API keys in ~/.panopticon/config.yaml stored as plaintext |
| 214 | PAN-1672 | M | high | ok |  |  | GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion |
| 215 | PAN-1640 | M | high | ok |  |  | Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic) |
| 216 | PAN-2351 | XS | high | ok |  |  | Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats (security prerequisites) |
| 217 | PAN-2350 | L | high | ok |  |  | Epic: Overdeck Anywhere |
| 218 | PAN-3016 | M | medium | ok |  |  | URL-address every view: cockpit tab, stage panes and Home navigation are not URL-synced, so refresh loses your place |
| 219 | PAN-1217 | XS | high | ok |  |  | Requirements reviewer: classify each AC as in_pr_scope vs whole_feature_scope, only !-block in-PR-scope items |
| 220 | PAN-1218 | M | high | ok |  |  | Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-of-batch mode |
| 221 | PAN-1219 | M | high | ok |  |  | Promote across-cycle review state to first-class data (cycle SHA, prior findings) instead of prompt-derived |
| 222 | PAN-1209 | S | high | ok |  |  | PAN-1052 bead projection disagrees with bd state |
| 223 | PAN-1451 | M | high | ok |  |  | PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift) |
| 224 | PAN-1452 | M | high | ok |  |  | PAN-1381 follow-up: per-reviewer restart with model override (architectural mismatch with PAN-1048) |
| 225 | PAN-1454 | M | high | ok |  |  | [META] 9 systemic failure patterns surfaced by 80-issue audit |
| 226 | PAN-1553 | M | high | ok |  |  | Investigate Claude Code Fast mode support (and fast-tier pricing) |
| 227 | PAN-1504 | M | high | ok |  |  | pan hygiene |
| 228 | PAN-1480 | L | high | ok |  |  | TLDR: 93% bypass rate |
| 229 | PAN-1479 | M | high | ok |  |  | RTK: Add telemetry to measure token savings from bash output compression |
| 230 | PAN-2950 | L | high | ok |  |  | Refactor god files back under file-size ceilings after the UX overhaul |
| 231 | PAN-2837 | M | high | needs-refinement |  |  | Distributed agent presence: record which machine runs each issue's agents on overdeck-state (claim/release, no heartbeats) |
| 232 | PAN-2836 | M | high | ok |  |  | okf: in-repo placement presets (okf/, docs/okf/) and /okf migrate to switch placements later |
| 233 | PAN-2983 | M | low | ok |  |  | OKF v3 deferred capabilities: lease-based concurrent write mode and an LLM semantic auditor, both gated on proven need |
| 234 | PAN-2830 | M | high | needs-refinement |  |  | Shared Logbook: make the overdeck-state branch opt-in |
| 235 | PAN-2720 | M | high | ok |  |  | File-size ratchet counts lines, so it rewards line-packing on the god files it means to improve |
| 236 | PAN-2650 | L | high | ok |  |  | Swarm final ready-to-merge slot wedges when memory-governor sheds the integration stack; pan swarm recover can't recover it |
| 237 | PAN-2549 | M | high | ok |  |  | Fly remote workspaces: sync overdeck-state before re-enabling migrated projects |
| 238 | PAN-2358 | M | high | ok |  |  | PAN-2145 follow-up: restore PAN-1535 hardening in transformMessageForHarness (rewritten during conversations.ts decomposition) |
| 239 | PAN-2334 | XS | high | ok |  |  | write a Definition of Ready (DoR) |
| 240 | PAN-2308 | M | high | ok |  |  | hardening(workspaces): migrate stale generated compose files off PORT=3011 + deacon quarantine for deterministic container boot refusal… |
| 241 | PAN-2193 | S | high | ok |  |  | Held issues (objection/parked/vetoed/needs-handoff) are invisible in the Command Deck tree |
| 242 | PAN-1984 | XS | high | ok |  |  | Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up) |
| 243 | PAN-1913 | XS | high | ok |  |  | Project description: show on click, edit in dashboard, mirror into the project layer (and document what's in .pan and ~/.panopticon) |
| 244 | PAN-1906 | M | high | ok |  |  | Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere |
| 245 | PAN-1544 | M | high | ok |  |  | Type cleanup: strip 'ship' from the Role union and its ~10 downstream references |
| 246 | PAN-955 | S | high | ok |  |  | Workspace devcontainer template versioning + re-render on demand |
| 247 | PAN-2978 | M | low | ok |  | PAN-2976 | Auto-install ACP agent CLIs from the setup UI — opt-in, operator-initiated, pinned per-agent recipes only |
| 248 | PAN-813 | M | high | ok |  |  | Add regression test for /api/review/:issueId/reset preserving work-agent resolution |
| 249 | PAN-807 | L | high | ok |  |  | Epic C: Workspace state sanity on spawn |
| 250 | PAN-630 | M | high | ok |  |  | Multi-tenant workspace isolation with ACLs |
| 251 | PAN-471 | M | high | ok |  |  | Cost reconciler: auto-trigger on agent lifecycle events with debounce |
| 252 | PAN-438 | M | high | ok |  |  | Migrate remaining REST polling endpoints to Effect RPC |
| 253 | PAN-262 | M | high | stale |  |  | Refactor post-merge lifecycle into composable, idempotent operations |
| 254 | PAN-176 | M | high | stale |  |  | PAN-176: Hook-enforced delegation guardrails for specialist agents |
| 255 | PAN-578 | M | high | ok |  |  | Security: Comment mediation layer to prevent prompt injection via tracker comments |
| 256 | PAN-2921 | S | medium | ok |  |  | Strike merge door can report fetch failure after merge and land the same head twice |
| 257 | PAN-2839 | S | medium | ok |  |  | plan→work autoSpawn now 500s with a duplicated workspace prep |
| 258 | PAN-2824 | S | medium | ok |  |  | pan review pending dies when one project's lens gather fails (non-degrading caller; PAN-2820 class) |
| 259 | PAN-2805 | S | medium | ok |  |  | FlywheelPage shows 'No active run' while /api/flywheel/current returns a live run |
| 260 | PAN-2792 | S | medium | ok |  |  | Orphan-process sweeps killed the dashboard and live conversations via lsof +D over Bun-hardlinked node_modules |
| 261 | PAN-2761 | S | medium | ok |  |  | done.test.ts asserts a hardcoded URL without stubbing env, so it fails in any agent shell with OVERDECK_DASHBOARD_URL set and looks lik… |
| 262 | PAN-2739 | S | medium | ok |  |  | first-completion detection throws every patrol cycle |
| 263 | PAN-2738 | S | medium | ok |  |  | strikes deadlock |
| 264 | PAN-2717 | S | medium | ok |  |  | conversation permission waits missing from Awareness; strengthen alert pulse |
| 265 | PAN-2697 | S | medium | ok |  |  | First-review codex parents enter discovery mode and the supervisor session no-ops every discovery-ready signal |
| 266 | PAN-2696 | XS | medium | ok |  |  | Task views still speak beads vocabulary |
| 267 | PAN-2691 | S | medium | ok |  |  | Auto-planned issues park silently when the post-finalize work spawn is gated (stack-unhealthy 422) |
| 268 | PAN-2686 | XS | medium | ok |  |  | Policy strip "restart pending" badge never clears after restart-fresh with a new model (record.model is sticky) |
| 269 | PAN-2672 | S | medium | ok |  |  | Post-/clear siblings render the same original transcript (per-tmux resolution + frozen launcher pin + null claude_session_id) |
| 270 | PAN-2670 | S | medium | ok |  |  | Gate the dashboard-server tsconfig in npm run typecheck |
| 271 | PAN-2664 | S | medium | ok |  |  | auto-commit completes unresolved merge with conflict markers |
| 272 | PAN-2663 | S | medium | ok |  |  | health probe can accept old dashboard after replacement EADDRINUSE |
| 273 | PAN-2659 | S | medium | ok |  |  | fs-lock: crash between mkdir(lock) and owner.json write leaves an unreclaimable record lock (successor to #2623) |
| 274 | PAN-2649 | S | medium | ok |  |  | Ctrl+K conversation search indexes Claude transcripts only |
| 275 | PAN-2981 | S | medium | needs-refinement |  |  | Ctrl-K palette 404s on stale conversations because the search index never prunes deleted sessions; body describes the fix as written |
| 276 | PAN-3012 | M | medium | ok |  |  | Back up harness conversation transcripts before harnesses delete them — archive preserves the pointer, not the data |
| 277 | PAN-2580 | S | medium | ok |  |  | pan tell cannot deliver to codex (GPT) conversations |
| 278 | PAN-2572 | M | medium | ok |  |  | Noisy EBADENGINE + deprecation warnings on npx/npm install make a healthy install look broken |
| 279 | PAN-2563 | S | medium | ok |  |  | npm-flavor desktop (npx @overdeck/desktop) lacks node_modules for the server's externalized deps |
| 280 | PAN-2560 | M | medium | ok |  |  | resolveStateReadHomeSync (state-read-home.ts) resolves state dir by path basename, not registry key |
| 281 | PAN-2554 | S | medium | ok |  |  | clicking a project doesn't update the browser URL |
| 282 | PAN-2550 | XS | medium | ok |  |  | npm test exits 0 despite root-suite failures |
| 283 | PAN-2547 | S | medium | ok |  |  | pan restart --health-timeout parses seconds as milliseconds |
| 284 | PAN-2546 | S | medium | ok |  |  | pan tell is codex-conversation-unaware |
| 285 | PAN-2506 | M | medium | ok |  |  | flywheel-primary-root.test.ts fails on macOS: /var vs /private/var symlink not canonicalized |
| 286 | PAN-2501 | S | medium | ok |  |  | deleteResourceVenvEffect's HttpRouter.schemaParams call fails typecheck under the root tsconfig (masked by src/dashboard/** exclusion) |
| 287 | PAN-2492 | S | medium | ok |  |  | pane-detected waits (rate-limit/session-resume) surface as 'needs you' but cannot be answered from the dashboard |
| 288 | PAN-2491 | M | medium | ok |  |  | Migrate @xenova/transformers to @huggingface/transformers to eliminate silent npx install failures from sharp 0.32 postinstall |
| 289 | PAN-2489 | S | medium | ok |  |  | strike agents are invisible in the project issue tree |
| 290 | PAN-2484 | S | medium | ok |  |  | ready set misses merge-eligible issues without flywheel merge verbs |
| 291 | PAN-2465 | S | medium | ok |  |  | pan done's PR lookup fails at MYN polyrepo root |
| 292 | PAN-2454 | S | medium | ok |  |  | ratchet audit fails per-commit on push ranges whose NET baseline delta is zero |
| 293 | PAN-2428 | XS | medium | ok |  |  | MYN workspace Traefik routing broken post-rebrand |
| 294 | PAN-2423 | XS | medium | ok |  |  | pan workspace rebuild hardcodes 'overdeck-' compose project prefix |
| 295 | PAN-2416 | S | medium | ok |  |  | codex agents can wedge on the Codex CLI first-run/consent screen |
| 296 | PAN-2414 | S | medium | ok |  |  | context-overflow recovery is inconsistent |
| 297 | PAN-2408 | S | medium | ok |  |  | pan start --auto commits the spec to main AFTER creating the worktree |
| 298 | PAN-2395 | S | medium | ok |  |  | one invalid tiered_execution enum poisons every config read |
| 299 | PAN-2381 | S | medium | ok |  |  | three event types missing from DomainEvent schema union poison the RPC stream |
| 300 | PAN-2287 | S | medium | ok |  |  | every supervisor.log line written twice |
| 301 | PAN-2280 | M | medium | ok |  |  | Resumed conversations wedge without writing transcripts when dashboard is black-holed |
| 302 | PAN-2197 | S | medium | ok |  |  | work agents skip `pan done` (manual push instead) |
| 303 | PAN-2186 | S | medium | ok |  |  | post-merge lifecycle can leave merged issues in-review and auto-merge rows stuck |
| 304 | PAN-2069 | XS | medium | ok |  |  | caveman: follow-up gaps |
| 305 | PAN-1918 | XS | medium | ok |  |  | full frontend vitest suite runs in no CI path |
| 306 | PAN-1912 | XS | medium | ok |  |  | Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle |
| 307 | PAN-1846 | S | medium | ok |  |  | unbounded log growth |
| 308 | PAN-1830 | S | medium | ok |  |  | Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY |
| 309 | PAN-1828 | S | medium | ok |  |  | Conversation fork/handoff harness defaults ignore source conversation harness |
| 310 | PAN-1816 | S | medium | ok |  |  | Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry |
| 311 | PAN-1795 | S | medium | ok |  |  | Codebase map bootstrapped in planning worktree is never promoted to main |
| 312 | PAN-1774 | S | medium | ok |  |  | workspace server container crashloops when dist/dashboard/server.js is missing |
| 313 | PAN-1769 | S | medium | ok |  |  | Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + tmux fallback); resumed-conv message stil… |
| 314 | PAN-1761 | S | medium | ok |  |  | conversations endpoints fetched via relative /api path |
| 315 | PAN-1755 | S | medium | ok |  |  | uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agents racing the next generation |
| 316 | PAN-1740 | XS | medium | ok |  |  | Deacon mislabels SIGTERM workspace container restarts as crashes |
| 317 | PAN-1711 | S | medium | ok |  |  | Root-cause and fix dashboard event-loop stalls under load |
| 318 | PAN-1674 | S | medium | ok |  |  | TLDR .venv (~7.5G) is duplicated into every workspace |
| 319 | PAN-1673 | S | medium | ok |  |  | Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously) |
| 320 | PAN-1669 | S | medium | ok |  |  | restart-with-model doesn't emit a live event |
| 321 | PAN-1668 | S | medium | ok |  |  | right-click 'restart with <model>' carries model only, never harness |
| 322 | PAN-1627 | M | medium | ok |  |  | Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridable by PreToolUse auto-appr… |
| 323 | PAN-1624 | S | medium | ok |  |  | pan handoff --author external: authored doc is socket_write-ten but never submitted |
| 324 | PAN-1572 | M | medium | ok |  |  | Settings permission-mode can desync from resolved config |
| 325 | PAN-1571 | S | medium | ok |  |  | Large multi-line pastes (handoff docs) land unsubmitted |
| 326 | PAN-1565 | S | medium | ok |  |  | Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #63147) |
| 327 | PAN-1530 | S | medium | ok |  |  | Investigate: state.json with model='gpt-5.5' (a model that doesn't exist) |
| 328 | PAN-1461 | S | medium | ok |  |  | Conversation transcript: in-page search (Ctrl+F) only finds text in currently-rendered virtualized rows |
| 329 | PAN-1449 | S | medium | ok |  |  | PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec |
| 330 | PAN-1446 | S | medium | ok |  |  | PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep stubs) |
| 331 | PAN-1445 | S | medium | ok |  |  | PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs) |
| 332 | PAN-1444 | S | medium | ok |  |  | Follow-up to PAN-1416: dashboard port lockfile + pan doctor multi-instance check |
| 333 | PAN-1440 | S | medium | ok |  |  | Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause |
| 334 | PAN-1438 | S | medium | ok |  |  | pan flywheel start launcher process orphans when orchestrator dies externally |
| 335 | PAN-1433 | S | medium | ok |  |  | Conversation agents can leave host main repo in abandoned git rebase state for hours |
| 336 | PAN-1416 | S | medium | ok |  |  | Workspace-spawned dashboards must never claim the canonical dashboard port |
| 337 | PAN-1392 | S | medium | ok |  |  | pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists |
| 338 | PAN-1386 | S | medium | ok |  |  | Flywheel orchestrator never emits status snapshots |
| 339 | PAN-1330 | S | medium | ok |  |  | CLI cannot address planning-*/specialist-* sessions |
| 340 | PAN-1245 | M | medium | ok |  |  | Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report) |
| 341 | PAN-1244 | M | medium | ok |  |  | pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server |
| 342 | PAN-1240 | S | medium | ok |  |  | Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery |
| 343 | PAN-1227 | S | medium | needs-refinement |  |  | Substrate: bead can be closed without delivering the work |
| 344 | PAN-1226 | L | medium | ok |  |  | PAN-1148 unified-dashboard redesign |
| 345 | PAN-1173 | S | medium | ok |  |  | pan show <bare-number> derives wrong agent ID for PAN-prefixed issues |
| 346 | PAN-1154 | M | medium | ok |  |  | pan up does not kill existing port holders |
| 347 | PAN-1150 | S | medium | ok |  |  | Settings: "Anthropic is not configured" warning persists in Model Routing after claude /login (Provider tab disagrees) |
| 348 | PAN-1149 | S | medium | ok |  |  | v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves |
| 349 | PAN-1130 | S | medium | ok |  |  | Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart |
| 350 | PAN-1129 | S | medium | ok |  |  | Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977' |
| 351 | PAN-1128 | S | medium | ok |  |  | Channels: spurious 'no MCP server configured with that name' banner at conversation startup |
| 352 | PAN-1113 | S | medium | ok |  |  | Conversations sidebar lets you message review-specialist sessions, which derails them silently |
| 353 | PAN-1068 | S | medium | ok |  |  | PAN-1048 deferred findings: security, correctness, and model validation gaps |
| 354 | PAN-1027 | S | medium | ok |  |  | Merge-status drift: deacon auto-detect paths set mergeStatus=merged without postMergeLifecycle, never reset on revert |
| 355 | PAN-933 | S | medium | ok |  |  | Review poster cannot post to GitLab MRs (only supports GitHub PRs) |
| 356 | PAN-932 | S | medium | ok |  |  | pan done: polyrepo uncommitted changes check + existing MR handling |
| 357 | PAN-927 | M | medium | ok |  |  | Rewrite containerize route: dead code, orphan processes, no pending-op tracking |
| 358 | PAN-900 | S | medium | ok |  |  | Trust devroot for conversations + atomic .claude.json writes |
| 359 | PAN-886 | S | medium | ok |  |  | pan review request shows 'fetch failed' instead of actual sync-target-branch error |
| 360 | PAN-778 | M | medium | ok |  |  | Write conflict race: review-agent fails when test-agent write scope not yet released |
| 361 | PAN-727 | M | medium | ok |  |  | Fix orphaned work-agent start handoff after planning |
| 362 | PAN-681 | S | medium | ok |  |  | Feedback routing: wrong issueId written to workspace when verification runs for co-active issues |
| 363 | PAN-538 | S | medium | ok |  |  | pan reload freshness guard must also verify the frontend bundle |
| 364 | PAN-334 | S | medium | stale |  |  | Dashboard server has no duplicate-process protection |
| 365 | PAN-324 | XS | medium | stale |  |  | Agent detail pane missing Merge/Approve button |
| 366 | PAN-304 | S | medium | stale |  |  | closeLinearDirect returns stepOk even when state update never happens |
| 367 | PAN-247 | S | medium | stale |  |  | Deacon has no backoff or escalation for repeated specialist startup failures |
| 368 | PAN-245 | S | medium | stale |  |  | Ctrl+C aborts planning dialog instead of copying text |
| 369 | PAN-244 | S | medium | stale |  |  | Deep-wipe leaves local branch and worktree metadata behind |
| 370 | PAN-178 | M | medium | stale |  |  | PAN-178: Crash recovery with granular task checkpointing |
| 371 | PAN-113 | S | medium | stale |  |  | Dashboard 'Start Agent' returns success before verifying agent actually started |
| 372 | PAN-49 | XS | medium | stale |  |  | Fix CloisterService tests that require real runtime |
| 373 | PAN-1951 | M | medium | ok |  |  | Inspector resumes a warm per-issue session instead of cold-spawning per item |
| 374 | PAN-1577 | M | medium | ok |  |  | Move a conversation to a different project (CLI + drag/drop + menu action) |
| 375 | PAN-1164 | M | medium | ok |  |  | Conversation diff summaries update live over WebSocket (drop 5s polling) |
| 376 | PAN-1041 | M | medium | ok |  |  | Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template |
| 377 | PAN-924 | L | medium | needs-refinement |  |  | Spike: evaluate GitNexus for Panopticon integration |
| 378 | PAN-863 | M | medium | ok |  |  | One-shot sweep of stale feature branches and worktrees predating the reaper |
| 379 | PAN-817 | M | medium | ok |  |  | Improve planning dialog layout and content fit |
| 380 | PAN-802 | M | medium | ok |  |  | Resume on conversation session forks instead of resuming |
| 381 | PAN-713 | M | medium | ok |  |  | test: add unit tests for doneCommand and approveCommand |
| 382 | PAN-700 | M | medium | ok |  |  | Detachable terminal for conversation view |
| 383 | PAN-646 | XS | medium | ok |  |  | Canceled issues: add guided Recover workflow |
| 384 | PAN-532 | M | medium | ok |  |  | Per-project and per-issue model overrides for pipeline roles |
| 385 | PAN-2896 | M | medium | ok |  |  | Warm resource-discovery and membership caches at boot |
| 386 | PAN-2685 | M | medium | ok |  |  | Annotated live preview: Codex-style annotate-the-app feedback delivered to agents |
| 387 | PAN-2626 | M | medium | ok |  |  | allow composer model switching within the same model family (e.g. Sonnet → Fable) |
| 388 | PAN-2625 | XS | medium | ok |  |  | auto-run /pan-new-project on project creation + setup banner, checklist, teaching empty states, and a guided demo issue |
| 389 | PAN-2609 | M | medium | ok |  |  | Cross-device sync of conversations and tasks via user-owned git remote |
| 390 | PAN-2608 | M | medium | ok |  |  | Persistent collaboration roles (owner/editor/viewer) and organizations |
| 391 | PAN-2582 | M | medium | ok |  |  | show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lanes) |
| 392 | PAN-2558 | L | medium | ok |  |  | support polyrepo projects |
| 393 | PAN-2557 | M | medium | ok |  |  | project-level 'Restart All' context action |
| 394 | PAN-2553 | M | medium | ok |  |  | project-level CI visibility |
| 395 | PAN-2548 | XS | medium | ok |  |  | close the PAN-2541 legacy-fallback deprecation window |
| 396 | PAN-2521 | S | medium | ok |  |  | launch pipeline agents with harness rate-limit model-switch reminder disabled |
| 397 | PAN-2493 | M | medium | ok |  |  | align the cockpit Agents-lane and sidebar issue-tree feature sets (two-way gaps) |
| 398 | PAN-2444 | L | medium | ok |  |  | optional SageOx re-integration |
| 399 | PAN-2443 | M | medium | ok |  |  | OpenTelemetry GenAI semconv |
| 400 | PAN-2442 | M | medium | ok |  |  | Agent Client Protocol (ACP) as Overdeck's structured control plane |
| 401 | PAN-2409 | M | medium | ok |  |  | enforce the workspace boundary |
| 402 | PAN-2399 | M | medium | ok |  |  | wire replay_threshold/compaction_reroute into the slot-recovery respawn seam |
| 403 | PAN-2392 | M | medium | ok |  |  | Standing Crew cost panel |
| 404 | PAN-2335 | XS | medium | ok |  |  | chore: review the full open backlog for junk/stale/nonsensical issues |
| 405 | PAN-2295 | L | medium | needs-refinement |  |  | built-in web browser surface (openable like terminal/Claude Code/Codex) + native Agentation integration |
| 406 | PAN-2288 | L | medium | ok |  |  | tmux managed-server: lossless auto-migration of dirty-founded servers + boot-time ensure call |
| 407 | PAN-2065 | M | medium | ok |  |  | unified usage & headroom panel across all provider plans (z.ai, Anthropic, Codex, OpenRouter) |
| 408 | PAN-2035 | M | medium | ok |  |  | ohmypi: GitHub Copilot subscription provider routing via omp |
| 409 | PAN-2034 | M | medium | ok |  |  | ohmypi: end-to-end test that tool-call steps render in Conversation panel |
| 410 | PAN-2033 | M | medium | ok |  |  | ohmypi: benchmark FIFO vs paste-buffer message delivery latency |
| 411 | PAN-2032 | M | medium | ok |  |  | ohmypi: local Ollama model as zero-cost preliminary review role |
| 412 | PAN-2031 | M | medium | ok |  |  | ohmypi: add Bun 1.3.11 regression test to checkOhmypi doctor gate |
| 413 | PAN-2030 | M | medium | ok |  |  | ohmypi: version-pin extension in package.json and pan doctor mismatch warning |
| 414 | PAN-2029 | M | medium | ok |  |  | ohmypi: capture kimi thinking_tokens in ohmypi-parser for complete cost accounting |
| 415 | PAN-2028 | M | medium | ok |  |  | ohmypi: per-provider cost grouping in cost dashboard |
| 416 | PAN-2026 | M | medium | ok |  |  | ohmypi: surface 35+ provider matrix in dashboard model picker |
| 417 | PAN-2025 | M | medium | ok |  |  | ohmypi: extend provider credential passthrough for Groq, Cerebras, Fireworks |
| 418 | PAN-2024 | XS | medium | ok |  |  | ohmypi: frontend Tools-toggle for conversation view |
| 419 | PAN-2004 | M | medium | ok |  |  | Resumable Planning node: double-click a planned issue's Planning to resume the planning agent |
| 420 | PAN-1995 | M | medium | ok |  |  | infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only) |
| 421 | PAN-1985 | M | medium | ok |  |  | Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation |
| 422 | PAN-1968 | M | medium | ok |  |  | Finish local-domain rename: pan.localhost → overdeck.localhost |
| 423 | PAN-1967 | M | medium | ok |  |  | Flywheel must re-validate (re-plan) pre-cutover plans before implementing them |
| 424 | PAN-1965 | M | medium | ok |  |  | Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue) |
| 425 | PAN-1937 | M | medium | ok |  |  | feat: data export |
| 426 | PAN-1926 | M | medium | ok |  |  | --big flag to lift strike's precision-only scope guard (operator-authorized larger strikes) |
| 427 | PAN-1916 | M | medium | ok |  |  | configurable web search providers (Exa, Tavily, Brave, Perplexity) |
| 428 | PAN-1854 | M | medium | ok |  |  | Define handoff strategy for large conversations: external vs source authoring + tail-biased read |
| 429 | PAN-1853 | M | medium | ok |  |  | Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers) |
| 430 | PAN-1852 | XS | medium | ok |  |  | Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval data |
| 431 | PAN-1844 | M | medium | ok |  |  | Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity notifications link to the specific view |
| 432 | PAN-1840 | M | medium | ok |  |  | Add 'pan switch <id>' |
| 433 | PAN-1839 | M | medium | ok |  |  | Settings → Providers: show each provider's default harness in the collapsed row (no expand needed) |
| 434 | PAN-1837 | M | medium | ok |  |  | Support Kimi Code as a first-class harness (Moonshot's own coding CLI) |
| 435 | PAN-1776 | M | medium | ok |  |  | Hot-updatable message delivery: version-stamped supervisors + server-side delivery logic |
| 436 | PAN-1754 | M | medium | ok |  |  | surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings page |
| 437 | PAN-1751 | M | medium | ok |  |  | harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flywheel |
| 438 | PAN-1750 | M | medium | ok |  |  | UAT assembly/conflict agent |
| 439 | PAN-1748 | M | medium | ok |  |  | reuse uat-assembly conflict resolutions across generations (rerere or resolution replay) |
| 440 | PAN-1735 | M | medium | ok |  |  | adopt externally-completed readyForMerge issues into the pipeline/merge queue |
| 441 | PAN-1691 | M | medium | ok |  |  | conflict-aware merge train + on-demand UAT candidate |
| 442 | PAN-1685 | XS | medium | ok |  |  | Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit |
| 443 | PAN-1676 | M | medium | ok |  |  | harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots) |
| 444 | PAN-1667 | M | medium | ok |  |  | unify Agents + Resources into one issue-centric holistic view |
| 445 | PAN-1657 | M | medium | ok |  |  | feat: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer |
| 446 | PAN-1656 | M | medium | ok |  |  | Skills page: make it a full management surface (browse, review, edit, scope, sync status) |
| 447 | PAN-1655 | M | medium | ok |  |  | Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly |
| 448 | PAN-1654 | XS | medium | ok |  |  | run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace) |
| 449 | PAN-1653 | XS | medium | ok |  |  | batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace) |
| 450 | PAN-1623 | M | medium | ok |  |  | Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion) |
| 451 | PAN-1561 | M | medium | ok |  |  | feat: Project-scoped dashboard nav (deck of tabs per project + conversations/tree column + activity feed) |
| 452 | PAN-1550 | M | medium | ok |  |  | feat: FilesPane + BrowserPane |
| 453 | PAN-1545 | XS | medium | ok |  |  | New Terminal button |
| 454 | PAN-1542 | XS | medium | ok |  |  | Spawn-refusal modal: render the three-button workflow on dirty-workspace 409 |
| 455 | PAN-1524 | M | medium | ok |  |  | Slash command aliases: /handoff → /pan-handoff (and similar short forms) |
| 456 | PAN-1497 | M | medium | ok |  |  | emit TTS announcements on lifecycle events (start, pause, resume, report) |
| 457 | PAN-1490 | M | medium | ok |  |  | show each conversation's current git branch (port t3code BranchToolbar pattern) |
| 458 | PAN-1489 | M | medium | needs-refinement |  |  | task(flywheel): tune v1.0 readiness criteria after 30 days of telemetry |
| 459 | PAN-1485 | M | medium | ok |  |  | Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable |
| 460 | PAN-1473 | M | medium | ok |  |  | Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately) |
| 461 | PAN-1443 | M | medium | ok |  |  | Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/ |
| 462 | PAN-1442 | M | medium | ok |  |  | Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo |
| 463 | PAN-1437 | M | medium | ok |  |  | pan flywheel report semantics: split read-only snapshot from run finalization |
| 464 | PAN-1432 | M | medium | ok |  |  | Merge agent leaves packages/contracts/dist stale |
| 465 | PAN-1223 | M | medium | ok |  |  | Auto-update for users in the field (npm + desktop binaries) |
| 466 | PAN-1165 | M | medium | ok |  |  | Lightweight review path for small/trivial PRs |
| 467 | PAN-1151 | XS | medium | ok |  |  | Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating |
| 468 | PAN-1060 | M | medium | ok |  |  | Self-modify permission handling: stop the interrupt loop without weakening the safety guard |
| 469 | PAN-1051 | M | medium | ok |  |  | feat: Subspace-inspired alternate theme with Inter + JetBrains Mono |
| 470 | PAN-1040 | XS | medium | ok |  |  | event-driven dispatch for inspect-agent (requiresInspection=true beads) |
| 471 | PAN-1037 | M | medium | ok |  |  | Retire 'planning-' tmux prefix |
| 472 | PAN-958 | M | medium | ok |  |  | Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification |
| 473 | PAN-949 | M | medium | ok |  |  | feat: add conversation for project from sidebar |
| 474 | PAN-947 | M | medium | ok |  |  | feat: project management actions in unified sidebar |
| 475 | PAN-938 | M | medium | ok |  |  | Fizzy visual pipeline |
| 476 | PAN-903 | M | medium | ok |  |  | Detect ~/.claude.json corruption on startup and surface it in the dashboard |
| 477 | PAN-902 | XS | medium | ok |  |  | Settings: add 'Run pan sync' button to configuration menu |
| 478 | PAN-901 | XS | medium | ok |  |  | Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch |
| 479 | PAN-818 | M | medium | ok |  |  | Make summary optional when forking conversations |
| 480 | PAN-736 | M | medium | ok |  |  | feat: wire per-subagent model overrides from settings to Claude Code spawn env |
| 481 | PAN-709 | M | medium | ok |  |  | self-improving flywheel |
| 482 | PAN-678 | M | medium | ok |  |  | pan work issue --auto: headless planning → agent handoff without interactive dialog |
| 483 | PAN-675 | M | medium | ok |  |  | Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets |
| 484 | PAN-654 | L | medium | ok |  |  | Project Setup Wizard |
| 485 | PAN-649 | M | medium | ok |  |  | Render Excalidraw drawings inline in Claude Code conversations |
| 486 | PAN-637 | XS | medium | ok |  |  | Direct issue kickoff (skip planning) from dashboard UI |
| 487 | PAN-629 | M | medium | ok |  |  | Workspace quotas and resource governance |
| 488 | PAN-613 | M | medium | needs-refinement |  |  | Investigate thinking effort levels for agents |
| 489 | PAN-607 | M | medium | needs-refinement |  |  | Evaluate Ultimate Bug Scanner (UBS) for verification gate |
| 490 | PAN-606 | M | medium | needs-refinement |  |  | Evaluate MCP Agent Mail for inter-agent communication and file reservations |
| 491 | PAN-548 | M | medium | ok |  |  | Command Deck: preserve state across navigation including URL routing for tabs |
| 492 | PAN-546 | M | medium | ok |  |  | Remove claude-code-router |
| 493 | PAN-537 | M | medium | ok |  |  | feat: show changed files diff summary after each agent response in activity view |
| 494 | PAN-531 | XS | medium | ok |  |  | PAN: Windows Electron support (WSL2 required) |
| 495 | PAN-452 | M | medium | ok |  |  | Conversation input bar |
| 496 | PAN-450 | M | medium | ok |  |  | Adopt remaining Effect patterns |
| 497 | PAN-294 | M | medium | stale |  |  | Surface module initialization errors as system-level, not per-issue |
| 498 | PAN-293 | M | medium | stale |  |  | Project Living Memory |
| 499 | PAN-277 | M | medium | stale |  |  | Session reasoning capture & collaborative PRD refinement |
| 500 | PAN-258 | M | medium | stale |  |  | Kanban board: fit all columns without horizontal scrolling |
| 501 | PAN-255 | M | medium | stale |  |  | Agents lack awareness of MCP tools |
| 502 | PAN-252 | XS | medium | stale |  |  | Disable Sync with Main button when workspace is up to date |
| 503 | PAN-243 | M | medium | stale |  |  | Audit dashboard actions: ensure all are available via CLI |
| 504 | PAN-77 | XS | medium | stale |  |  | Cost breakdown modal: show costs by stage and model when clicking cost badge |
| 505 | PAN-54 | L | medium | stale |  |  | e2e command for full workflow integration test |
| 506 | PAN-38 | M | medium | stale |  |  | Support multiple merge agents per repository |
| 507 | PAN-37 | M | medium | stale |  |  | Support external PR selection for merge-agent |
| 508 | PAN-1126 | M | medium | ok |  |  | Integrate TLDR summaries into review context manifest |
| 509 | PAN-1066 | M | medium | ok |  |  | Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module |
| 510 | PAN-2968 | M | low | ok |  |  | Adopt the interactive decision page as the default way to present operator decisions |
| 511 | PAN-2941 | M | low | ok |  |  | OKF v3 |
| 512 | PAN-2936 | M | low | ok |  |  | Handle loop.max_steps_exceeded: detect and nudge agents to continue instead of stranding them |
| 513 | PAN-2922 | M | low | ok |  |  | Reduce accidental orchestration complexity after performance stabilization |
| 514 | PAN-2868 | M | low | ok |  |  | Desktop window opens at fixed 1400×900 |
| 515 | PAN-2767 | M | low | ok |  |  | Expose Codex app-server conversation controls in the dashboard |
| 516 | PAN-2679 | M | low | ok |  |  | conv-lookup skill: resolve transcripts for codex and pi harness conversations |
| 517 | PAN-2662 | M | low | ok |  |  | Add project context-menu actions scoped to issues currently in the pipeline |
| 518 | PAN-2645 | M | low | ok |  |  | Add opt-in Observation-first conversation view |
| 519 | PAN-2635 | XS | low | ok |  |  | pay down the 152-error src/dashboard/server typecheck debt |
| 520 | PAN-2630 | M | low | ok |  |  | pan binary not on PATH for operator shells or spawned work agents; pan doctor can't be run to diagnose it |
| 521 | PAN-2629 | M | low | ok |  |  | pan start kickoff delivery never lands: "Claude Code did not become ready within 30s" (both attempts), agent sits idle at empty prompt |
| 522 | PAN-2628 | M | low | ok |  |  | pan close aborts at close-issue:transition: "No tracker available and cannot determine issue type" for GitHub-tracker project |
| 523 | PAN-2622 | M | low | ok |  |  | cloister.toml materializes ALL defaults into the user file |
| 524 | PAN-2600 | XS | low | ok |  |  | Retire the Codex TUI path after app-server burn-in (no-loss audit gate) |
| 525 | PAN-2533 | XS | low | ok |  |  | UAT workspace magic-link login 502: Traefik picks unreachable panopticon IP for multi-homed fe/api |
| 526 | PAN-2527 | M | low | ok |  |  | Harness selector should restrict OpenAI models to Claude Code only |
| 527 | PAN-2514 | M | low | ok |  |  | Claude Code Traffic Inspector |
| 528 | PAN-2507 | M | low | ok |  |  | Preemptive pipeline scheduler: yield idle work agents to unblock review/test/merge dispatch |
| 529 | PAN-2505 | M | low | ok |  |  | lint:circular reports new frontend cycles + stale baseline in chat/conversations components |
| 530 | PAN-2504 | M | low | ok |  |  | Auto-relaunch npx @overdeck/core under a compatible Node 22+ instead of failing on old Node |
| 531 | PAN-2449 | M | low | ok |  |  | start-planning: GITHUB_REPOS env shadows projects.yaml github_repo; unknown IDs fall through to Linear and plan the wrong issue |
| 532 | PAN-2424 | L | low | ok |  |  | Epic: the Order Book |
| 533 | PAN-2406 | M | low | ok |  |  | close-out gaps: verify-merged rejects record-only deltas; slot/suffixed worktrees never torn down; teardown abort fires after worktree … |
| 534 | PAN-2394 | M | low | ok |  |  | Incident: conv-* agent-dir cleanup destroyed ohmypi/codex conversation transcripts ("no saved history") |
| 535 | PAN-2390 | M | low | ok |  |  | systemd-oomd killed overdeck-tmux-server.service (all 55 agent processes) under host memory pressure |
| 536 | PAN-2356 | M | low | ok |  |  | Overdeck Anywhere P3: relay service |
| 537 | PAN-2355 | M | low | ok |  |  | Overdeck Anywhere P2: mobile PWA (Needs-You feed, conversation view, pipeline board, Web Push) |
| 538 | PAN-2354 | M | low | ok |  |  | Overdeck Anywhere P1c: needs-you push notification bridge (ntfy first, Web Push later) |
| 539 | PAN-2352 | M | low | ok |  |  | Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel + Access |
| 540 | PAN-2353 | M | low | ok |  |  | Overdeck Anywhere P1b: Hermes external-agent bridge (scoped API + Fly 6PN) |
| 541 | PAN-2282 | M | low | ok |  |  | Conversation view shows no history for ohmypi-harness conversations |
| 542 | PAN-2091 | XS | low | ok |  |  | delete dead IssueCockpitBody cockpit subtree (8 files, superseded by IssueMissionControl) |
| 543 | PAN-2085 | M | low | ok |  |  | Auto-isolate conversations in a lightweight git worktree (Conductor-style workspaces) |
| 544 | PAN-2084 | M | low | ok |  |  | Auto-create lightweight conversation worktrees on project chats |
| 545 | PAN-2083 | M | low | ok |  |  | Composer: a failed first send leaves the text in BOTH the composer box and the retry outbox |
| 545 | PAN-1696 | M | low | ok |  |  | Merge train becomes per-project |
| 546 | PAN-2082 | M | low | ok |  |  | Composer: a single send failure clears ALL in-flight optimistic bubbles (and strips siblings' compaction net) |
| 547 | PAN-2074 | XS | low | ok |  |  | research: evaluate ponytail (DietrichGebert/ponytail) for prompt compression and consider building in-house |
| 548 | PAN-2046 | M | low | ok |  |  | Conversation view does not surface terminal command responses |
| 549 | PAN-2006 | M | low | ok |  |  | Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Run definition |
| 550 | PAN-2005 | M | low | ok |  |  | Backlog Sequencer: Pickup Forecast |
| 551 | PAN-2002 | XS | low | ok |  |  | [HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID) |
| 552 | PAN-1999 | M | low | ok |  |  | Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN) |
| 553 | PAN-1986 | M | low | ok |  |  | restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row |
| 554 | PAN-1983 | L | low | ok |  |  | Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy) |
| 555 | PAN-1980 | M | low | ok |  |  | Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses |
| 556 | PAN-1958 | M | low | ok |  |  | Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source) |
| 557 | PAN-1949 | M | low | ok |  |  | Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all item verdicts |
| 558 | PAN-1914 | M | low | ok |  |  | Follow-up: move /api/health/agents off agent-directory scans |
| 559 | PAN-1907 | M | low | ok |  |  | Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-selectable + validate every… |
| 560 | PAN-1895 | M | low | ok |  |  | Spawn work agents from issue workspace slide-out |
| 561 | PAN-1878 | M | low | ok |  |  | process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts |
| 562 | PAN-1782 | M | low | ok |  |  | Handoff forks stall at "Injecting…" then die on double 300s summary timeout |
| 563 | PAN-1773 | M | low | ok |  |  | Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762) |
| 564 | PAN-1758 | M | low | ok |  |  | Watch: ready-for-merge work must converge despite a continuously moving main |
| 566 | PAN-1646 | M | low | ok |  |  | Rabbit-hole drift detection and lift-to-new-conversation |
| 567 | PAN-1643 | M | low | ok |  |  | Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker |
| 568 | PAN-1641 | M | low | ok |  |  | Run agents on local GPU models via a managed Ollama sidecar |
| 569 | PAN-1592 | M | low | ok |  |  | Composer: make ephemeral composer state reload-durable (pasted images + unsent/failed message text) |
| 570 | PAN-1581 | M | low | ok |  |  | Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled across project+user sync |
| 571 | PAN-1552 | M | low | ok |  |  | Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log |
| 572 | PAN-1533 | M | low | ok |  |  | Fork-into-worktree from conversation branch chip |
| 573 | PAN-1483 | XS | low | ok |  |  | Distinguish general-use skills from Panopticon-only dev skills in pan sync |
| 574 | PAN-1482 | M | low | ok |  |  | Token spend report should aggregate data from repo, not just local machine |
| 575 | PAN-1481 | M | low | ok |  |  | Add cost-event telemetry for Caveman token savings |
| 576 | PAN-1356 | M | low | ok |  |  | Extend the memory Observation pipeline to ad-hoc conversations |
| 577 | PAN-1242 | M | low | ok |  |  | Create a new issue directly from a kanban column |
| 578 | PAN-1222 | M | low | ok |  |  | Project-templated DB lifecycle: auxiliary databases + seed refresh from prod |
| 579 | PAN-1208 | M | low | ok |  |  | Polyrepo: support non-feature 'main' workspaces alongside feature-* |
| 580 | PAN-1166 | M | low | ok |  |  | Re-introduce /ws/terminal auth gate with a working bootstrap path |
| 581 | PAN-1153 | M | low | ok |  |  | Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' |
| 582 | PAN-1152 | XS | low | ok |  |  | Remove PANOPTICON_DEV env-var persistence |
| 583 | PAN-1136 | M | low | ok |  |  | Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency |
| 584 | PAN-1135 | M | low | ok |  |  | Document the hook system in docs/HOOKS.md |
| 585 | PAN-1133 | M | low | ok |  |  | TLDR: deacon supervision + pan doctor check + GC |
| 586 | PAN-1124 | M | low | ok |  |  | Decouple specs and PRDs from workspaces |
| 587 | PAN-1123 | XS | low | ok |  |  | Channels delivery: surface failures, add fallback toggle, route conversations through channels |
| 588 | PAN-1121 | M | low | ok |  |  | Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction |
| 589 | PAN-1117 | M | low | ok |  |  | Memory: pinned docs (long-form doc chunking + retrieval) |
| 590 | PAN-1116 | M | low | ok |  |  | Memory: cross-project search mode |
| 591 | PAN-1065 | M | low | ok |  |  | Validate issueId at every shell-string interpolation site (defense in depth) |
| 592 | PAN-1064 | M | low | ok |  |  | Harden launcher generation against shell-quote injection (model and arg quoting) |
| 593 | PAN-1063 | M | low | ok |  |  | Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound |
| 594 | PAN-1049 | M | low | needs-refinement |  |  | Spike: evaluate Tauri v2 desktop shell |
| 595 | PAN-984 | XS | low | needs-refinement |  |  | Evaluate context-mode MCP server as session continuity + search layer |
| 596 | PAN-962 | M | low | ok |  |  | Post-PAN-946: vBRIEF lifecycle follow-up plan |
| 597 | PAN-961 | M | low | ok |  |  | Update documentation for vBRIEF v0.6 lifecycle model |
| 598 | PAN-944 | M | low | ok |  |  | Make vBRIEF the durable task graph source of truth |
| 599 | PAN-943 | M | low | ok |  |  | Add memory file review and management command |
| 600 | PAN-908 | M | low | ok |  |  | PAN-908: Make work-agent spawn limits configurable and overridable |
| 601 | PAN-898 | M | low | ok |  |  | Dashboard polling and WebSocket efficiency: remaining audit findings |
| 602 | PAN-853 | L | low | needs-refinement |  |  | Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration |
| 603 | PAN-833 | M | low | ok |  |  | Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader) |
| 604 | PAN-832 | M | low | ok |  |  | state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActivity |
| 605 | PAN-810 | XS | low | ok |  |  | Inspector: diagnostic UI when pipeline phase is unknown |
| 606 | PAN-797 | M | low | needs-refinement |  |  | Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy |
| 607 | PAN-793 | XS | low | ok |  |  | Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine |
| 608 | PAN-791 | XS | low | ok |  |  | Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI |
| 609 | PAN-790 | L | low | ok |  |  | PAN-789: Eliminate remaining TanStack Query polling |
| 610 | PAN-786 | M | low | ok |  |  | Post planning Q\&A answers as issue comment |
| 611 | PAN-777 | M | low | ok |  |  | Inter-agent communication skill: send messages to conversation-mode agents |
| 612 | PAN-775 | L | low | ok |  |  | Redesign workspace inspector panel: sidebar layout is cramped and wrong |
| 613 | PAN-774 | XS | low | ok |  |  | Unify launch UX and release pipeline for 1.0 |
| 614 | PAN-773 | XS | low | ok |  |  | Design prompt-style overlays with model hierarchy and scoped toggles |
| 615 | PAN-772 | M | low | ok |  |  | Unify terminal stack behavior across tmux sessions |
| 616 | PAN-771 | M | low | needs-refinement |  |  | Investigate Vercel Sandbox execution backend support |
| 617 | PAN-769 | M | low | ok |  |  | Track verification/review/test phase churn over time |
| 618 | PAN-765 | M | low | ok |  |  | Preserve trailing zeros in cost displays |
| 619 | PAN-764 | M | low | ok |  |  | Add quota/usage inspector for routed model providers |
| 620 | PAN-762 | M | low | ok |  |  | Settings: warn when model overrides target disabled providers |
| 621 | PAN-752 | M | low | ok |  |  | Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro |
| 622 | PAN-751 | M | low | ok |  |  | Historical Metrics Data Persistence |
| 623 | PAN-750 | L | low | ok |  |  | Complete Metrics Page Redesign |
| 624 | PAN-749 | M | low | needs-refinement |  |  | Research and borrow best features from gstack |
| 625 | PAN-747 | XS | low | ok |  |  | Conversation list items lack accessible labels in accessibility tree |
| 626 | PAN-743 | XS | low | ok |  |  | Add consistent new conversation icon actions in Command Deck |
| 627 | PAN-738 | M | low | ok |  |  | Add right-click fork option to conversation list |
| 628 | PAN-735 | M | low | ok |  |  | Settings page: review and configure overridden subagent model files |
| 629 | PAN-730 | M | low | ok |  |  | Add provider account telemetry for credits, balances, and usage |
| 630 | PAN-702 | M | low | ok |  |  | OpenAI provider: add plan/subscription support and fix unregistered model resolution |
| 631 | PAN-701 | XS | low | ok |  |  | Quick-Create conversation via keystroke using Conversations-page default model |
| 632 | PAN-663 | XS | low | ok |  |  | Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces |
| 633 | PAN-660 | M | low | ok |  |  | Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen |
| 634 | PAN-658 | M | low | ok |  |  | Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport |
| 635 | PAN-624 | M | low | ok |  |  | Loop nodes: iterative agent execution with conditional termination |
| 636 | PAN-623 | M | low | ok |  |  | Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks |
| 637 | PAN-622 | M | low | ok |  |  | YAML workflow DAGs: custom per-project pipeline definitions |
| 638 | PAN-604 | M | low | ok |  |  | Hide planning agent from workspace detail pane |
| 639 | PAN-603 | M | low | ok |  |  | Plan review loop with configurable reviewer model |
| 640 | PAN-591 | XS | low | ok |  |  | Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates |
| 641 | PAN-589 | XS | low | ok |  |  | Review and update commands-skills.md with all available Panopticon skills |
| 642 | PAN-576 | M | low | ok |  |  | Global / search should include conversations in addition to workspace features |
| 643 | PAN-571 | XS | low | ok |  |  | Add OpenRouter credits/plan status endpoint and UI |
| 644 | PAN-568 | M | low | ok |  |  | Kanban: Show workspace and tmux session counts in stats |
| 645 | PAN-565 | M | low | ok |  |  | Handle CTRL-Z to undo accidental conversation archival |
| 646 | PAN-564 | M | low | ok |  |  | Slash menu positioned incorrectly |
| 647 | PAN-554 | M | low | ok |  |  | Add kanban board deeplinks for issue URLs |
| 648 | PAN-543 | M | low | ok |  |  | Add confirmation dialog before applying Optimal Defaults |
| 649 | PAN-483 | M | low | ok |  |  | Unify Resume Agent UX |
| 650 | PAN-480 | M | low | ok |  |  | Pass --effort flag when spawning planning agents via Cloister |
| 651 | PAN-476 | M | low | ok |  |  | Agent resume with Haiku session summary instead of claude --resume |
| 652 | PAN-468 | M | low | ok |  |  | Agent test conversations pollute production database |
| 653 | PAN-461 | M | low | ok |  |  | Deep-wipe multi-step progress dialog |
| 654 | PAN-459 | M | low | ok |  |  | Planning setup screen with SSE progress streaming |
| 655 | PAN-407 | XS | low | ok |  |  | Run Panopticon from a main workspace for development isolation |
| 656 | PAN-299 | M | low | stale |  |  | Granular session state persistence across context compaction |
| 657 | PAN-298 | M | low | stale |  |  | Auto-detect package manager and runtime in workspace setup |
| 658 | PAN-297 | M | low | stale |  |  | Workspace templates: pre/post tool hooks for auto-format, typecheck, lint |
| 659 | PAN-283 | M | low | stale |  |  | Reset should sync workspace feature branch with latest main |
| 660 | PAN-271 | M | low | stale |  |  | Auto-assign Linear project from project config when creating issues |
| 661 | PAN-265 | M | low | stale |  |  | Review skill categorization: all skills available everywhere via personal + workspace |
| 662 | PAN-249 | XS | low | stale |  |  | Add data-testid attributes across dashboard UI and create Playwright smoke test suite |
| 663 | PAN-241 | L | low | stale |  |  | Mobile redesign initiative: full UX/UI overhaul + implementation plan |
| 664 | PAN-228 | M | low | stale |  |  | Shift-left post-edit diagnostics |
| 665 | PAN-227 | M | low | stale |  |  | Phase gate validation |
| 666 | PAN-198 | M | low | stale |  |  | Structured audit trail for agent actions |
| 667 | PAN-190 | M | low | stale |  |  | PAN-190: Specialized reviewer prompts (industry best-practice checklists) |
| 668 | PAN-180 | M | low | stale |  |  | PAN-180: Cross-terminal file locking for concurrent agents |
| 669 | PAN-177 | M | low | stale |  |  | PAN-177: Iteration limits with escalation for autonomous agents |
| 670 | PAN-175 | M | low | stale |  |  | PAN-175: Pre-compact auto-save hook for agent sessions |
| 671 | PAN-155 | L | low | stale |  |  | PAN-155: Redesign health page with Stitch (system overview, timeline, costs) |
| 672 | PAN-146 | M | low | stale |  |  | PAN-146: Refine light mode theming across all dashboard pages |
| 673 | PAN-55 | M | low | stale |  |  | Track specialist costs with time period filtering |
| 674 | PAN-52 | XS | low | stale |  |  | Guidance needed: Running complex multi-container projects with Panopticon worktrees |
| 675 | PAN-51 | M | low | stale |  |  | Documentation: Clarify issue tracker options beyond Linear |
| 676 | PAN-47 | M | low | stale |  |  | PRD files should be committed to feature branch, moved to completed/ on merge |
| 677 | PAN-44 | M | low | stale |  |  | Planning should fetch ALL issue context: comments, attachments, linked issues, discussions |
| 678 | PAN-43 | M | low | stale |  |  | Add Slack and email notifications for agent events |
| 679 | PAN-2348 | XS | low | ok |  |  | docs: migrate STATE-STORAGE-AUDIT.md content to living docs, then delete |
| 680 | PAN-2347 | XS | low | ok |  |  | docs: refresh AGENT-STATE-PLANES.md |
| 681 | PAN-2346 | XS | low | ok |  |  | docs: refresh AGENT_TYPES_INDEX.md |
| 682 | PAN-2345 | XS | low | ok |  |  | docs: refresh pan-done.md |
| 683 | PAN-2344 | XS | low | ok |  |  | docs: refresh KANBAN-MODEL.md |
| 684 | PAN-2343 | XS | low | ok |  |  | docs: refresh MISSION-CONTROL.md |
| 685 | PAN-2073 | XS | low | ok |  |  | docs: add user-facing page for the Desktop App |
| 686 | PAN-2071 | XS | low | ok |  |  | docs: add user-facing page for the Hooks system |
| 687 | PAN-2070 | XS | low | ok |  |  | docs: add user-facing page for the Flywheel orchestrator |
| 688 | PAN-2068 | XS | low | ok |  |  | docs: add user-facing page for Caveman (agent output compression) |
| 689 | PAN-2067 | XS | low | ok |  |  | docs: add user-facing page for RTK (Bash output compression) |
| 690 | PAN-1684 | XS | low | ok |  |  | build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed |
| 691 | PAN-1683 | XS | low | ok |  |  | docs: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md) |
| 692 | PAN-1474 | M | low | ok |  |  | Add ACKNOWLEDGEMENTS doc |
| 693 | PAN-1469 | M | low | ok |  |  | End-to-end review and consolidation of all project documentation |
| 694 | PAN-674 | XS | low | ok |  |  | docs: add glossary of Panopticon domain terms |
| 695 | PAN-634 | M | low | ok |  |  | Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs |
| 696 | PAN-633 | M | low | ok |  |  | Update Cloister PRD and docs index |
| 697 | PAN-2908 | M | low | ok |  |  | Make overdeck not suck |

## Rationale detail

### PAN-3101 (rank 1)

Red main from a generated-manifest drift; in-pipeline. Nothing reaches the merge gate until lint:slash-commands is green, so it outranks every other open item. One command (npm run generate:slash-commands) plus commit.

### PAN-3051 (rank 1)

New, top of the list. The detection already fires (hasPendingQuestion/tool_permission) but selectPendingInputSubjects composes kinds only from pendingInputKinds plus channelPermissionRequestsById, and that map is fed by the Claude Code Channels bridge which is now disabled by default. So every tool-permission block is invisible to the operator and the agent waits forever — five were frozen at filing. This is a total loss of the operator-decision path for the most common blocking condition, it holds pipeline slots indefinitely, and it is a small frontend/read-model fix with an obvious discriminator already in the payload.

### PAN-3056 (rank 2)

Second red-main of the same class, already merged and awaiting close-out. Both failures are mechanical (add the mock export, add the matrix row); pinned at the top because a red main empties the merge gate for every project.

### PAN-3029 (rank 2)

In-pipeline, pinned. Red main is the highest-cost pipeline state: it silently empties the merge gate and blocks the DoD deploy row for every merged member of the promoted bundle. The fix is mechanical (regenerate slashCommands.generated.ts and commit it), so the only thing standing between the pipeline and green is a one-command regeneration.

### PAN-3097 (rank 6)

In-pipeline. Small surface change with outsized effect on autonomous throughput: the operator answers questions from the dialog alone, so a question that assumes transcript context is either answered wrong or left to stall the agent.

### PAN-2997 (rank 7)

In-pipeline (in review), pinned. Blocked-on-OAuth agents are invisible unless the operator happens to have that conversation open; the GPT/Codex OAuth banner pattern already exists and this reuses it, including waking every blocked agent through the delivery door after re-auth.

### PAN-2876 (rank 7)

When a conversation spawns Claude Code subagents (Agent tool — Explore, general-purpose), their work is invisible today: only a collapsed `Agent <desc>` row shows. The rail makes each subagent inspectable, which is the difference between trusting a delegated investigation and being able to verify it. In-progress; pin.

### PAN-2746 (rank 9)

Highest integrity risk — infra-failure bypass writes reviewStatus=passed, indistinguishable from real approval; nearly merged a pipeline-critical change unreviewed.

### PAN-2952 (rank 10)

Review verdict writes silently lost to per-issue record-lock collisions; reviewers believe they passed but the record never lands.

### PAN-3092 (rank 11)

Direct successor to PAN-2952 and ranked beside it. Neither the PAN-2989 fallback drain nor pan review resync can recover it, because the drain is PID-aware and the reviewer is alive — so a passed review is unrecoverable and the issue stalls at reviewing forever.

### PAN-2689 (rank 12)

Sandboxed codex review verdicts fire-and-forget into a journal that loses them; review convoy reports green on evidence never delivered.

### PAN-3084 (rank 13)

Review liveness is inferred from session existence rather than progress, so both recovery paths no-op on a dead session and only an abort recovers it. Same family as PAN-2706 ghost test sessions; fixing one should inform the other.

### PAN-2695 (rank 14)

Concurrent review dispatches race fresh-spawn vs resume, second dispatch resumes a still-booting parent and wedges.

### PAN-2742 (rank 15)

Synthesis fires 42s after spawn and mislabels reviewers-with-reports-on-disk as infra-failure, bypassing review.

### PAN-3085 (rank 16)

A one-line rebrand miss that produces verbatim-repeating review loops: the agent is pointed at an empty directory, commits nothing relevant, and the next review restates the same findings. Cheapest high-value fix in the review cluster.

### PAN-3078 (rank 17)

Confirmed by a manual pan tell resuming the agent within seconds, so delivery is the only missing piece. Sits with PAN-2848 (work agent stalls on a dead inspection); together they are the inspection half of the stalled-agent family.

### PAN-2706 (rank 18)

Ghost test sessions that never received kickoff absorb every dispatch, marking testing with no prompt delivered.

### PAN-2700 (rank 19)

Stale .pan/test/result.json is consumed by the next cycle, insta-failing with the previous run verdict.

### PAN-3104 (rank 20)

Pairs with PAN-2700 and with PAN-3100: #3100 manufactures a false failure, this defect replays it indefinitely. Ranked adjacent so a single change can add the HEAD-freshness check both need.

### PAN-3100 (rank 21)

Self-inflicted concurrency: test and work roles share one workspace, so the longer an issue runs the likelier its own scratch state fails it. The verdict also lands with null notes, so downstream only sees an unexplained failure.

### PAN-2733 (rank 22)

substrate-bug-poller has never run — BOT_LOGIN is a git author string not a GitHub login; the auto-triage loop is inert.

### PAN-1560 (rank 23)

Re-review after a PR head moves never re-posts status, stranding otherwise-green PRs at BLOCKED.

### PAN-2769 (rank 24)

review_status rows are never reconciled when an issue closes, so closed issues keep advertising stale review state.

### PAN-3044 (rank 25)

No terminal-issue guard on the feedback-delivery path, so finished work generates fresh operator interrupts and inflates the troubled/needs-you counts the operator triages from. Same residue family as PAN-2888 and PAN-2769.

### PAN-2828 (rank 26)

pan done --strike structurally refuses every squash-merged strike — the landing path doctrine mandates is rejected by its own ancestry check.

### PAN-2995 (rank 27)

Substantively the same defect as PAN-2828, filed from the strike side. Ranked adjacent and flagged needs-refinement so whoever picks either one closes both rather than fixing the ancestry check twice.

### PAN-2874 (rank 28)

Strike landing cannot merge: verification gate demands a vBRIEF checklist strikes never have, and failed-feedback wedges on exited strike agents.

### PAN-2883 (rank 29)

Close-out deploy row fails for every strike-landed issue — PR resolver hardcodes feature/ and cannot find strike/ PRs.

### PAN-3047 (rank 30)

Third instance of the ancestry-vs-squash confusion (with PAN-2828 and PAN-2995) and the reason a close-out can print merged and preserved in the same run. Fixing the shared merged-state predicate resolves the whole cluster.

### PAN-2806 (rank 31)

Strike merge trigger registry splits across dashboard chunks, so the trigger is never registered in the chunk that runs it.

### PAN-2802 (rank 32)

Same-head strike-ready cannot re-arm after a transient needs-you, blocking retry once infra is fixed.

### PAN-2796 (rank 33)

Idle nudge advances a work agent past a failed mandatory inspection, bypassing the inspection gate.

### PAN-3036 (rank 34)

A false needs-you is expensive on an autonomous host: the operator is pulled to an agent that is finished and waiting for the deacon. pendingInputKinds being empty is an available discriminator, so the fix is narrow.

### PAN-3034 (rank 35)

Filed and apparently fixed in the same breath, including unit tests and a file-size baseline bump. Flagged needs-refinement because it may only need close-out rather than work; overlaps PAN-2489.

### PAN-2940 (rank 36)

Three red-mains in one day from direct-push series bypassing PR CI — conversations need a pre-merge CI surface.

### PAN-3062 (rank 37)

The structural cause behind PAN-3056 and the red-main cluster above it — unverified cloister changes reached main because a different session flushed them. Substrate hardening: until writers are isolated, red main stays a matter of timing.

### PAN-3081 (rank 38)

Successor to the just-closed PAN-806, and worse than no guard because the rest of the system assumes it holds. Two defects have to land together: move enforcement off $PATH, and stop the false blocks that motivate the bypass (see PAN-2738).

### PAN-2932 (rank 39)

Intermittent dashboard boot wedge between Cloister start and ReadModel bootstrap leaves :3011 unbound (502) after pan reload.

### PAN-2935 (rank 40)

Workspace devcontainer duplicate backend hijacks the Traefik router — 50% of API calls 504 in real MYN workspaces.

### PAN-3049 (rank 41)

Took the host to 3.8 GB available with swap fully consumed, twice in one day. Resource exhaustion stops every agent at once, so a prefix-collision bug earns critical rank despite a small diff. Pairs with PAN-3050 and PAN-3032, which share the prefix root cause.

### PAN-3050 (rank 42)

The resource-hygiene half of workspace lifecycle is inoperative for every project except Overdeck itself, which is how 4 GB of MYN stacks sat idle for twenty hours. Direct contributor to PAN-3049.

### PAN-3032 (rank 43)

Same one-source-of-truth-for-the-compose-project-name fix as PAN-3049/PAN-3050, plus a second finding that Traefik devnet membership is runtime-only and lost on restart. Flagged needs-refinement because PAN-2423 already covers the prefix half.

### PAN-2337 (rank 44)

Reload/build atomicity — an in-place npm run build under a live dashboard breaks new PTY-supervisor chunks.

### PAN-2422 (rank 45)

Rebuilding dist under a live server breaks lazy chunk imports (Cannot find module), wedging boots.

### PAN-2699 (rank 46)

npm run build regenerates the committed record-cost-event.js bundle, dirtying every workspace tree and blocking clean-workspace gates.

### PAN-2957 (rank 47)

npm run build intermittently produces stale frontend bundles, deploying pre-edit code.

### PAN-2850 (rank 48)

npm test fails in clean checkout — pretest removes the dashboard bundle the test spawns against.

### PAN-3099 (rank 49)

The fix landed on main and produced PAN-3101, so the remaining work is the no-rollback half: a failed health check must confirm the new server never binds before exiting with nothing listening. Overlaps PAN-2547; reconcile the two.

### PAN-2758 (rank 50)

Provider capacity error silently zombies a spawned agent (willRetry=false, status stays running forever), holding a slot.

### PAN-3043 (rank 51)

provider-health.ts already classifies quota and auth failures but has only spawn-path callers, so an alive-but-dead agent holds an advancing-ceiling slot indefinitely. Small change with a direct throughput payoff.

### PAN-2886 (rank 52)

Placeholder pending-work-spawn agents crash auto-resume with Unknown model, stranding agents troubled forever.

### PAN-2817 (rank 53)

Idle-at-prompt gpt-5.6-sol agents are never redriven — one burned $82 idling 6h; nothing nudges them to continue.

### PAN-3057 (rank 54)

Six agents went silently idle after one host restart because a compaction Overdeck did not initiate is invisible to every recovery path. Same detection gap as PAN-2817 idle-at-prompt agents.

### PAN-2813 (rank 55)

Scheduler yield never self-clears — yielded work agents stay paused hours after the blocking review merges.

### PAN-2848 (rank 56)

Work agent stalls forever on a dead inspection session; no re-dispatch, swarm-off suppresses recovery.

### PAN-2846 (rank 57)

Close-out blocks on a dead agent — postMergeLifecycle pauses the agent but leaves status=running, jamming the DoD gate.

### PAN-2749 (rank 58)

Rank held. The body was touched but the defect is unchanged — resume restores the transcript and not the timers, monitors and background processes, which is why a resumed flywheel can sit inert while looking healthy.

### PAN-2747 (rank 59)

Flywheel cannot be resumed after a crash/reboot — Resume disabled, only action silently aborts the active run.

### PAN-2759 (rank 60)

Dead flywheel with an active run was never auto-relaunched after a reboot — sat idle 2h.

### PAN-2971 (rank 61)

The control plane derives run status from report.md existence, so a self-finalized-but-alive orchestrator locks the operator out of the only controls that could stop it. Sits with the flywheel-resilience cluster (PAN-2747, PAN-2759, PAN-2323).

### PAN-2709 (rank 62)

Flywheel orchestrator is unreachable as a notification target — agent feedback dead-ends, resume always fails.

### PAN-2668 (rank 63)

Verification/review feedback silently queued to stopped-by-user agents, never re-driven on delivery.

### PAN-2569 (rank 64)

Planning finalizes (issue->planned) but the work agent never auto-spawns — silent handoff break.

### PAN-3023 (rank 65)

Two gaps in one: the retry loop does not retry, and patrol routing keys off issue state so a planned-but-todo issue has no re-drive owner. Same silent-park family as PAN-2569 and PAN-2691.

### PAN-2567 (rank 66)

Reviewed+green PR stuck after review — advancing verdict reconciled forever, merge never dispatched.

### PAN-3103 (rank 67)

The observed cost was a planning agent spawned on already-shipped code. Close-out demonstrably worked for sibling issues in the same session, so the fix is a retry after the status self-heals rather than a redesign.

### PAN-3106 (rank 68)

The policy module is correct and simply unwired from the deacon and workspace merge paths. It defeats the UAT batch-train model the operator configured, so it gates the MYN train alongside PAN-3093.

### PAN-3094 (rank 69)

Narrow fix in rebase-helper.ts: use a plain push when the remote feature head is still an ancestor of local HEAD, and keep the lease only for rewritten histories. Small, mechanically testable, unblocks resubmits.

### PAN-3096 (rank 70)

Ten live workspaces carried the same untracked dirt, and two agents invented their own exits — one attempted rm of .devcontainer, the other committed a wrapper gitignore that fed a review loop. Overlaps PAN-2966 and PAN-2945; consolidate before starting.

### PAN-3048 (rank 71)

Four MYN branches now carry Overdeck-authored PRDs that will ride into their PRs. The duplicated exclusion list is the real defect — the same .overdeck/-vs-.pan/ asymmetry PAN-3042 fixed in a different code path.

### PAN-3022 (rank 72)

Root cause of the recurring "I asked for model X and got gpt-5.6" reports, with second-order damage: a model-less autoSpawn overwrites the stored override. The CLI path already resolves it correctly, so the fix is aligning determineModel with resolveIssueWorkModel.

### PAN-3025 (rank 73)

Verification is the only verdict not persisted durably, and the DB is doctrinally a disposable cache — so any post-rebuild DoD evaluation hard-blocks auto-close-out on a row that actually passed.

### PAN-3077 (rank 74)

Violates the standing high-never-xhigh policy on the one path that recurs per item rather than per agent, so the overspend compounds across every issue in the pipeline. Threading the existing effort resolution through two more spawn sites.

### PAN-2179 (rank 75)

Relaunch can leave a zombie agent — session alive but kickoff never delivered (liveness probe gap).

### PAN-2169 (rank 76)

Kimi agent silently frozen at 100% context (no thrown overflow) not caught by CONTEXT guards.

### PAN-2775 (rank 77)

Agents die in sweeps — boot-correlated false reaps kill live flywheel and convoys; plus an unexplained simultaneous 3-host kill.

### PAN-2734 (rank 78)

Merge-queue head-of-line zombie — closed PAN-2325 re-triggered on all 294 boots.

### PAN-2323 (rank 79)

Flywheel respawn after crash starts a blank session instead of resuming the live one.

### PAN-1618 (rank 80)

Work-spawn docker-health gate has no autonomous recovery — proposed work cannot auto-start when docker is briefly unhealthy.

### PAN-2888 (rank 81)

Close-out leaves stale residue (orphaned inspect sub-agents, uncleared review rows) that chronically inflates troubled/failed metrics.


<!-- machine-readable; do not hand-edit below this line -->

```json
{
  "version": 1,
  "project": "overdeck",
  "generatedAt": "2026-07-26T05:00:24Z",
  "model": "claude-opus-5",
  "pass": "incremental",
  "openCount": 697,
  "nodes": [
    {
      "issue": "PAN-3101",
      "rank": 1,
      "size": "XS",
      "importance": "critical",
      "score": 96,
      "condition": "ok",
      "dependsOn": [],
      "why": "RED MAIN: #3099 changed --health-timeout without regenerating the composer-command manifest; every PR inherits the failing lint",
      "rationale": "Red main from a generated-manifest drift; in-pipeline. Nothing reaches the merge gate until lint:slash-commands is green, so it outranks every other open item. One command (npm run generate:slash-commands) plus commit.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3056",
      "rank": 2,
      "size": "XS",
      "importance": "critical",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "RED MAIN: a new boot-reconciliation route/export landed without the route-test mock or a no-loss matrix entry",
      "rationale": "Second red-main of the same class, already merged and awaiting close-out. Both failures are mechanical (add the mock export, add the matrix row); pinned at the top because a red main empties the merge gate for every project.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3029",
      "rank": 2,
      "size": "XS",
      "importance": "critical",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "RED MAIN: lint:slash-commands drift on the promote commit blocks CI, deploy and close-out of 4 merged members",
      "rationale": "In-pipeline, pinned. Red main is the highest-cost pipeline state: it silently empties the merge gate and blocks the DoD deploy row for every merged member of the promoted bundle. The fix is mechanical (regenerate slashCommands.generated.ts and commit it), so the only thing standing between the pipeline and green is a one-command regeneration.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3051",
      "rank": 1,
      "size": "S",
      "importance": "critical",
      "score": 94,
      "condition": "ok",
      "dependsOn": [],
      "why": "Tool-permission prompts never reach Decisions: surface reads the dead Channels map — 5 agents frozen with nobody told",
      "rationale": "New, top of the list. The detection already fires (hasPendingQuestion/tool_permission) but selectPendingInputSubjects composes kinds only from pendingInputKinds plus channelPermissionRequestsById, and that map is fed by the Claude Code Channels bridge which is now disabled by default. So every tool-permission block is invisible to the operator and the agent waits forever — five were frozen at filing. This is a total loss of the operator-decision path for the most common blocking condition, it holds pipeline slots indefinitely, and it is a small frontend/read-model fix with an obvious discriminator already in the payload.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3037",
      "rank": 82,
      "size": "S",
      "importance": "high",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan sync-main probes the polyrepo workspace root for .git instead of iterating member repos, so it can never run on a polyrepo project",
      "rationale": "New. The polyrepo workspace root is not a git repo — the members are worktrees in subdirectories — so the MERGE_HEAD probe fails immediately and the operator falls back to a manual per-repo merge loop. Same class as the polyrepo blindness already ranked here (PAN-2966/2945/2680) and cheap once sync-main iterates the member set the workspace manager already knows.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3097",
      "rank": 6,
      "size": "S",
      "importance": "medium",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "AskUserQuestion dialog shows a bare identifier and agents write questions that assume the transcript — operator answers blind",
      "rationale": "In-pipeline. Small surface change with outsized effect on autonomous throughput: the operator answers questions from the dialog alone, so a question that assumes transcript context is either answered wrong or left to stall the agent.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2997",
      "rank": 7,
      "size": "M",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface Linear MCP OAuth as a global intervention and wake blocked agents after re-auth",
      "rationale": "In-pipeline (in review), pinned. Blocked-on-OAuth agents are invisible unless the operator happens to have that conversation open; the GPT/Codex OAuth banner pattern already exists and this reuses it, including waking every blocked agent through the delivery door after re-auth.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2876",
      "rank": 7,
      "size": "M",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation subagent rail: list spawned subagents and open their transcripts.",
      "rationale": "When a conversation spawns Claude Code subagents (Agent tool — Explore, general-purpose), their work is invisible today: only a collapsed `Agent <desc>` row shows. The rail makes each subagent inspectable, which is the difference between trusting a delegated investigation and being able to verify it. In-progress; pin.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2746",
      "rank": 9,
      "size": "XS",
      "importance": "critical",
      "score": 94,
      "condition": "ok",
      "dependsOn": [
        "PAN-2742",
        "PAN-2695"
      ],
      "why": "infra-failure bypass writes reviewStatus='passed'",
      "rationale": "Highest integrity risk — infra-failure bypass writes reviewStatus=passed, indistinguishable from real approval; nearly merged a pipeline-critical change unreviewed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2952",
      "rank": 10,
      "size": "S",
      "importance": "critical",
      "score": 94,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review verdict writes lost to per-issue record-lock collisions; reads reconcile stale journal over fresh DB state",
      "rationale": "Review verdict writes silently lost to per-issue record-lock collisions; reviewers believe they passed but the record never lands.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3092",
      "rank": 11,
      "size": "S",
      "importance": "critical",
      "score": 94,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review agent's own record lock blocks its own verdict write — the fallback is consumed and the verdict is lost from every plane",
      "rationale": "Direct successor to PAN-2952 and ranked beside it. Neither the PAN-2989 fallback drain nor pan review resync can recover it, because the drain is PID-aware and the reviewer is alive — so a passed review is unrecoverable and the issue stalls at reviewing forever.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2689",
      "rank": 12,
      "size": "S",
      "importance": "critical",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review verdicts from sandboxed codex review agents are silently lost",
      "rationale": "Sandboxed codex review verdicts fire-and-forget into a journal that loses them; review convoy reports green on evidence never delivered.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3084",
      "rank": 13,
      "size": "S",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "A review session spawned but never briefed sits at zero context forever and blocks its own replacement; restart 'preserves' the zombie",
      "rationale": "Review liveness is inferred from session existence rather than progress, so both recovery paths no-op on a dead session and only an abort recovers it. Same family as PAN-2706 ghost test sessions; fixing one should inform the other.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2695",
      "rank": 14,
      "size": "S",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Concurrent review dispatches race fresh-spawn vs resume",
      "rationale": "Concurrent review dispatches race fresh-spawn vs resume, second dispatch resumes a still-booting parent and wedges.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2742",
      "rank": 15,
      "size": "S",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "synthesis fires 42s after spawn and reports reviewers with reports on disk as 'infrastructure failure'",
      "rationale": "Synthesis fires 42s after spawn and mislabels reviewers-with-reports-on-disk as infra-failure, bypassing review.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3085",
      "rank": 16,
      "size": "XS",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review feedback is written to .overdeck/feedback but agents and the deacon merge gate read a nonexistent .pan/feedback",
      "rationale": "A one-line rebrand miss that produces verbatim-repeating review loops: the agent is pointed at an empty directory, commits nothing relevant, and the next review restates the same findings. Cheapest high-value fix in the review cluster.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3078",
      "rank": 17,
      "size": "S",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspect verdict is persisted but never delivered to the work agent — an agent that waits for it deadlocks forever",
      "rationale": "Confirmed by a manual pan tell resuming the agent within seconds, so delivery is the only missing piece. Sits with PAN-2848 (work agent stalls on a dead inspection); together they are the inspection half of the stalled-agent family.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2706",
      "rank": 18,
      "size": "M",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ghost test sessions absorb every test dispatch",
      "rationale": "Ghost test sessions that never received kickoff absorb every dispatch, marking testing with no prompt delivered.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2700",
      "rank": 19,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Test artifact recovery consumes a stale .pan/test/result.json",
      "rationale": "Stale .pan/test/result.json is consumed by the next cycle, insta-failing with the previous run verdict.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3104",
      "rank": 20,
      "size": "S",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stale .pan/test/result.json is re-applied with no freshness check against HEAD, re-failing an issue after the fix has landed",
      "rationale": "Pairs with PAN-2700 and with PAN-3100: #3100 manufactures a false failure, this defect replays it indefinitely. Ranked adjacent so a single change can add the HEAD-freshness check both need.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3100",
      "rank": 21,
      "size": "S",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Test role evaluates the dirty working tree, so a live work agent's uncommitted edits produce false test failures",
      "rationale": "Self-inflicted concurrency: test and work roles share one workspace, so the longer an issue runs the likelier its own scratch state fails it. The verdict also lands with null notes, so downstream only sees an unexplained failure.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2733",
      "rank": 22,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "substrate-bug-poller has never run",
      "rationale": "substrate-bug-poller has never run — BOT_LOGIN is a git author string not a GitHub login; the auto-triage loop is inert.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1560",
      "rank": 23,
      "size": "XS",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-review after a PR head moves doesn't re-post panopticon/review status → PR stranded BLOCKED",
      "rationale": "Re-review after a PR head moves never re-posts status, stranding otherwise-green PRs at BLOCKED.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2769",
      "rank": 24,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "review_status rows are never reconciled when an issue closes",
      "rationale": "review_status rows are never reconciled when an issue closes, so closed issues keep advertising stale review state.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3044",
      "rank": 25,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review feedback delivery runs against CLOSED issues — it resurrects agents and raises needs-you twelve days after close-out",
      "rationale": "No terminal-issue guard on the feedback-delivery path, so finished work generates fresh operator interrupts and inflates the troubled/needs-you counts the operator triages from. Same residue family as PAN-2888 and PAN-2769.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2828",
      "rank": 26,
      "size": "S",
      "importance": "critical",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done --strike always refuses squash-merged strikes (--is-ancestor can't see through a squash)",
      "rationale": "pan done --strike structurally refuses every squash-merged strike — the landing path doctrine mandates is rejected by its own ancestry check.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2995",
      "rank": 27,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan done --strike false-blocks after a gh-API squash-merge; should verify PR-merged state, not branch ancestry (overlaps PAN-2828)",
      "rationale": "Substantively the same defect as PAN-2828, filed from the strike side. Ranked adjacent and flagged needs-refinement so whoever picks either one closes both rather than fixing the ancestry check twice.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2874",
      "rank": 28,
      "size": "M",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [
        "PAN-2828"
      ],
      "why": "Strike landing pipeline cannot merge strikes: verification gate demands a vBRIEF checklist strikes never have, and failed-feedback deli…",
      "rationale": "Strike landing cannot merge: verification gate demands a vBRIEF checklist strikes never have, and failed-feedback wedges on exited strike agents.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2883",
      "rank": 29,
      "size": "M",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [
        "PAN-2828"
      ],
      "why": "Close-out deploy row fails for every strike-landed issue",
      "rationale": "Close-out deploy row fails for every strike-landed issue — PR resolver hardcodes feature/ and cannot find strike/ PRs.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3047",
      "rank": 30,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike-branch teardown never fires: --is-ancestor cannot see a squash merge, so all 96 strike/* branches survive as residue",
      "rationale": "Third instance of the ancestry-vs-squash confusion (with PAN-2828 and PAN-2995) and the reason a close-out can print merged and preserved in the same run. Fixing the shared merged-state predicate resolves the whole cluster.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2806",
      "rank": 31,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "strike merge trigger registry splits across dashboard chunks",
      "rationale": "Strike merge trigger registry splits across dashboard chunks, so the trigger is never registered in the chunk that runs it.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2802",
      "rank": 32,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "same-head strike-ready cannot re-arm a needs-you landing",
      "rationale": "Same-head strike-ready cannot re-arm after a transient needs-you, blocking retry once infra is fixed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2796",
      "rank": 33,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "idle nudge must not advance after failed mandatory inspection",
      "rationale": "Idle nudge advances a work agent past a failed mandatory inspection, bypassing the inspection gate.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3036",
      "rank": 34,
      "size": "XS",
      "importance": "medium",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "False '! INPUT' chip on completed strike agents — the pane-idle heuristic misreads post-strike-ready idle as a question",
      "rationale": "A false needs-you is expensive on an autonomous host: the operator is pulled to an agent that is finished and waiting for the deacon. pendingInputKinds being empty is an available discriminator, so the fix is narrow.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3034",
      "rank": 35,
      "size": "S",
      "importance": "medium",
      "score": 62,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Command Deck session tree missed strike-only issues; the body states the fix already landed on main — verify before picking up",
      "rationale": "Filed and apparently fixed in the same breath, including unit tests and a file-size baseline bump. Flagged needs-refinement because it may only need close-out rather than work; overlaps PAN-2489.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2940",
      "rank": 36,
      "size": "M",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "Three red-mains in one day from direct-push series bypassing PR CI",
      "rationale": "Three red-mains in one day from direct-push series bypassing PR CI — conversations need a pre-merge CI surface.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3062",
      "rank": 37,
      "size": "M",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shared primary main worktree: any agent that pushes main also ships every other session’s unpushed commits, verified or not",
      "rationale": "The structural cause behind PAN-3056 and the red-main cluster above it — unverified cloister changes reached main because a different session flushed them. Substrate hardening: until writers are isolated, red main stays a matter of timing.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3081",
      "rank": 38,
      "size": "M",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent git guard is $PATH-removable and false-blocks pan state writes; an agent derived the bypass unprompted",
      "rationale": "Successor to the just-closed PAN-806, and worse than no guard because the rest of the system assumes it holds. Two defects have to land together: move enforcement off $PATH, and stop the false blocks that motivate the bypass (see PAN-2738).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2932",
      "rank": 39,
      "size": "S",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [
        "PAN-2337"
      ],
      "why": "intermittent dashboard boot wedge between Cloister start and ReadModel bootstrap leaves :3011 unbound (Bad Gateway) after pan reload",
      "rationale": "Intermittent dashboard boot wedge between Cloister start and ReadModel bootstrap leaves :3011 unbound (502) after pan reload.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2935",
      "rank": 40,
      "size": "S",
      "importance": "critical",
      "score": 91,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace devcontainer duplicate backend hijacks Traefik router",
      "rationale": "Workspace devcontainer duplicate backend hijacks the Traefik router — 50% of API calls 504 in real MYN workspaces.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3049",
      "rank": 41,
      "size": "S",
      "importance": "critical",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "Duplicate Docker stacks per workspace (myn-feature-* beside overdeck-feature-*) doubled memory and exhausted the host",
      "rationale": "Took the host to 3.8 GB available with swap fully consumed, twice in one day. Resource exhaustion stops every agent at once, so a prefix-collision bug earns critical rank despite a small diff. Pairs with PAN-3050 and PAN-3032, which share the prefix root cause.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3050",
      "rank": 42,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Idle-stack reaper matches only overdeck-feature-*-server|frontend, so non-Overdeck workspace stacks are never reaped",
      "rationale": "The resource-hygiene half of workspace lifecycle is inoperative for every project except Overdeck itself, which is how 4 GB of MYN stacks sat idle for twenty hours. Direct contributor to PAN-3049.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3032",
      "rank": 43,
      "size": "M",
      "importance": "high",
      "score": 83,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Workspace rebuild composes under 'overdeck-feature-' while Traefik labels reference the project prefix — 504s (overlaps PAN-2423)",
      "rationale": "Same one-source-of-truth-for-the-compose-project-name fix as PAN-3049/PAN-3050, plus a second finding that Traefik devnet membership is runtime-only and lost on restart. Flagged needs-refinement because PAN-2423 already covers the prefix half.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2337",
      "rank": 44,
      "size": "XS",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reload/build atomicity: an in-place `npm run build` under a live dashboard breaks new PTY-supervisor spawns until restart",
      "rationale": "Reload/build atomicity — an in-place npm run build under a live dashboard breaks new PTY-supervisor chunks.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2422",
      "rank": 45,
      "size": "XS",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [
        "PAN-2337"
      ],
      "why": "rebuilding dist under a live server breaks lazy chunk imports",
      "rationale": "Rebuilding dist under a live server breaks lazy chunk imports (Cannot find module), wedging boots.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2699",
      "rank": 46,
      "size": "XS",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm run build regenerates the committed record-cost-event.js bundle",
      "rationale": "npm run build regenerates the committed record-cost-event.js bundle, dirtying every workspace tree and blocking clean-workspace gates.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2957",
      "rank": 47,
      "size": "XS",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [
        "PAN-2337"
      ],
      "why": "npm run build intermittently produces stale frontend bundles",
      "rationale": "npm run build intermittently produces stale frontend bundles, deploying pre-edit code.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2850",
      "rank": 48,
      "size": "M",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm test fails in clean checkout after pretest removes dashboard bundle",
      "rationale": "npm test fails in clean checkout — pretest removes the dashboard bundle the test spawns against.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3099",
      "rank": 49,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan restart --health-timeout 120 was enforced as 120ms and a false fail left the dashboard DOWN (overlaps PAN-2547)",
      "rationale": "The fix landed on main and produced PAN-3101, so the remaining work is the no-rollback half: a failed health check must confirm the new server never binds before exiting with nothing listening. Overlaps PAN-2547; reconcile the two.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2758",
      "rank": 50,
      "size": "S",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Provider capacity error silently zombies a spawned agent: willRetry=false, turn reported completed, state stays status=running forever",
      "rationale": "Provider capacity error silently zombies a spawned agent (willRetry=false, status stays running forever), holding a slot.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3043",
      "rank": 51,
      "size": "M",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "Mid-run provider quota exhaustion is undetected: the agent stays 'running' for days holding a slot; health is probed only at spawn",
      "rationale": "provider-health.ts already classifies quota and auth failures but has only spawn-path callers, so an alive-but-dead agent holds an advancing-ceiling slot indefinitely. Small change with a direct throughput payoff.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2886",
      "rank": 52,
      "size": "M",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "Placeholder (pending-work-spawn) agents crash auto-resume with 'Unknown model' → stranded troubled forever",
      "rationale": "Placeholder pending-work-spawn agents crash auto-resume with Unknown model, stranding agents troubled forever.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2817",
      "rank": 53,
      "size": "M",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "Idle-at-prompt work/review agents are never redriven: gpt-5.6-sol sessions stop at the composer mid-task and sit for hours",
      "rationale": "Idle-at-prompt gpt-5.6-sol agents are never redriven — one burned $82 idling 6h; nothing nudges them to continue.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3057",
      "rank": 54,
      "size": "M",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness-initiated compaction leaves agents idle forever; the GPT-5.6 context window is declared twice (372K vs 150K)",
      "rationale": "Six agents went silently idle after one host restart because a compaction Overdeck did not initiate is invisible to every recovery path. Same detection gap as PAN-2817 idle-at-prompt agents.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2813",
      "rank": 55,
      "size": "M",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "Scheduler yield never self-clears: yielded work agents stay paused after the blocking review completes/merges",
      "rationale": "Scheduler yield never self-clears — yielded work agents stay paused hours after the blocking review merges.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2848",
      "rank": 56,
      "size": "S",
      "importance": "critical",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agent stalls forever on a dead inspection: no re-dispatch, verdict never delivered, swarm-off suppresses recovery of a non-swarm a…",
      "rationale": "Work agent stalls forever on a dead inspection session; no re-dispatch, swarm-off suppresses recovery.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2846",
      "rank": 57,
      "size": "S",
      "importance": "critical",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out blocks on a dead agent: postMergeLifecycle pauses the work agent but leaves status=running",
      "rationale": "Close-out blocks on a dead agent — postMergeLifecycle pauses the agent but leaves status=running, jamming the DoD gate.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2749",
      "rank": 58,
      "size": "S",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resume restores the conversation but not the machinery: timers, monitors and background processes die and are never re-armed",
      "rationale": "Rank held. The body was touched but the defect is unchanged — resume restores the transcript and not the timers, monitors and background processes, which is why a resumed flywheel can sit inert while looking healthy.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2747",
      "rank": 59,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel cannot be resumed after a crash/reboot: Resume is disabled and the only offered action aborts the run",
      "rationale": "Flywheel cannot be resumed after a crash/reboot — Resume disabled, only action silently aborts the active run.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2759",
      "rank": 60,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dead flywheel with an active run was never auto-relaunched after a reboot",
      "rationale": "Dead flywheel with an active run was never auto-relaunched after a reboot — sat idle 2h.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2971",
      "rank": 61,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel orchestrator finalized its own run but kept ticking for 19 hours; dashboard Pause and Stop were disabled on the zombie",
      "rationale": "The control plane derives run status from report.md existence, so a self-finalized-but-alive orchestrator locks the operator out of the only controls that could stop it. Sits with the flywheel-resilience cluster (PAN-2747, PAN-2759, PAN-2323).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2709",
      "rank": 62,
      "size": "M",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel orchestrator is unreachable as a notification target",
      "rationale": "Flywheel orchestrator is unreachable as a notification target — agent feedback dead-ends, resume always fails.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2668",
      "rank": 63,
      "size": "M",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Verification/review feedback silently queued to stopped-by-user agents",
      "rationale": "Verification/review feedback silently queued to stopped-by-user agents, never re-driven on delivery.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2569",
      "rank": 64,
      "size": "XS",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "planning finalizes (issue→planned) but work agent does not auto-spawn",
      "rationale": "Planning finalizes (issue->planned) but the work agent never auto-spawns — silent handoff break.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3023",
      "rank": 65,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-planning auto-spawn abandoned on a transient Docker failure — 'attempt 1/3' never retries and no patrol re-drives it",
      "rationale": "Two gaps in one: the retry loop does not retry, and patrol routing keys off issue state so a planned-but-todo issue has no re-drive owner. Same silent-park family as PAN-2569 and PAN-2691.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2567",
      "rank": 66,
      "size": "S",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "reviewed+green PR stuck after review",
      "rationale": "Reviewed+green PR stuck after review — advancing verdict reconciled forever, merge never dispatched.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3103",
      "rank": 67,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "A transient merge_status=failed permanently skips automatic close-out, leaving merged work open and pickup-eligible",
      "rationale": "The observed cost was a planning agent spawned on already-shipped code. Close-out demonstrably worked for sibling issues in the same session, so the fix is a retry after the status self-heals rather than a redesign.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3106",
      "rank": 68,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "auto_merge_default: hold is bypassed — shouldHoldForUat is consulted on one merge path, so held issues merge individually",
      "rationale": "The policy module is correct and simply unwired from the deacon and workspace merge paths. It defeats the UAT batch-train model the operator configured, so it gates the MYN train alongside PAN-3093.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3094",
      "rank": 69,
      "size": "XS",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done's merge fallback force-pushes a fast-forward branch, so a rejected push leaves the command partially complete",
      "rationale": "Narrow fix in rebase-helper.ts: use a plain push when the remote feature head is still an ancestor of local HEAD, and keep the lease only for rewritten histories. Small, mechanically testable, unblocks resubmits.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3096",
      "rank": 70,
      "size": "S",
      "importance": "high",
      "score": 81,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan done fails on generated devcontainer harness and agents infer deleting workspace infrastructure (overlaps PAN-2966/2945)",
      "rationale": "Ten live workspaces carried the same untracked dirt, and two agents invented their own exits — one attempted rm of .devcontainer, the other committed a wrapper gitignore that fed a review loop. Overlaps PAN-2966 and PAN-2945; consolidate before starting.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3048",
      "rank": 71,
      "size": "S",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline auto-commit lands .pan/drafts/<ISSUE>.md in product feature branches; the duplicated exclusion list has drifted",
      "rationale": "Four MYN branches now carry Overdeck-authored PRDs that will ride into their PRs. The duplicated exclusion list is the real defect — the same .overdeck/-vs-.pan/ asymmetry PAN-3042 fixed in a different code path.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3022",
      "rank": 72,
      "size": "S",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work-spawn route ignores the per-issue workModel override, runs the role default, then clobbers the operator's stored override",
      "rationale": "Root cause of the recurring \"I asked for model X and got gpt-5.6\" reports, with second-order damage: a model-less autoSpawn overwrites the stored override. The CLI path already resolves it correctly, so the fix is aligning determineModel with resolveIssueWorkModel.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3025",
      "rank": 73,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Durable pipeline journal omits verificationStatus, so the DoD verification row false-MISSes after close-out or a DB rebuild",
      "rationale": "Verification is the only verdict not persisted durably, and the DB is doctrinally a disposable cache — so any post-rebuild DoD evaluation hard-blocks auto-close-out on a row that actually passed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3077",
      "rank": 74,
      "size": "XS",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspect and review-supervisor spawns omit --effort and inherit the harness xhigh default; this fires once per xBRIEF item",
      "rationale": "Violates the standing high-never-xhigh policy on the one path that recurs per item rather than per agent, so the overspend compounds across every issue in the pipeline. Threading the existing effort resolution through two more spawn sites.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2179",
      "rank": 75,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "relaunch can leave a zombie agent",
      "rationale": "Relaunch can leave a zombie agent — session alive but kickoff never delivered (liveness probe gap).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2169",
      "rank": 76,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "kimi agent silently frozen at 100% ctx (no thrown overflow error) not caught by CONTEXT_OVERFLOW_PATTERNS",
      "rationale": "Kimi agent silently frozen at 100% context (no thrown overflow) not caught by CONTEXT guards.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2775",
      "rank": 77,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agents die in sweeps: boot-correlated false reaps (live flywheel reaped, convoy reaped 5x) + unexplained simultaneous 3-host kill at 04…",
      "rationale": "Agents die in sweeps — boot-correlated false reaps kill live flywheel and convoys; plus an unexplained simultaneous 3-host kill.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2734",
      "rank": 78,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "merge queue head-of-line zombie",
      "rationale": "Merge-queue head-of-line zombie — closed PAN-2325 re-triggered on all 294 boots.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2323",
      "rank": 79,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel respawn after crash/displacement starts a blank session instead of resuming the live one",
      "rationale": "Flywheel respawn after crash starts a blank session instead of resuming the live one.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1618",
      "rank": 80,
      "size": "S",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate: work-spawn docker-health gate has no autonomous recovery",
      "rationale": "Work-spawn docker-health gate has no autonomous recovery — proposed work cannot auto-start when docker is briefly unhealthy.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2888",
      "rank": 81,
      "size": "M",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [
        "PAN-2846"
      ],
      "why": "Close-out leaves stale residue that inflates troubled/failed metrics: orphaned inspect sub-agents + uncleared review_status rows on CLO…",
      "rationale": "Close-out leaves stale residue (orphaned inspect sub-agents, uncleared review rows) that chronically inflates troubled/failed metrics.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2960",
      "rank": 82,
      "size": "S",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspect supervisor lingers past 12m limit and never self-terminates after posting a verdict",
      "rationale": "Inspect supervisor lingers past its 12m limit and never self-terminates after posting a verdict (ran 38m).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2959",
      "rank": 83,
      "size": "S",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan inspect --item <X> reviews workspace HEAD, not item X's commit",
      "rationale": "pan inspect --item reviews workspace HEAD not item X commit, producing spurious FAILED verdicts when HEAD moved past.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2639",
      "rank": 84,
      "size": "S",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [
        "PAN-2331"
      ],
      "why": "codex-resume replays a rotated-out (revoked) refresh token → codex review convoys wedge with 401",
      "rationale": "codex-resume replays a rotated-out revoked refresh token, wedging every codex review convoy with 401.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2331",
      "rank": 85,
      "size": "S",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "codex rate-limit 'Switch to gpt-5.4-mini?' modal stalls autonomous agents (no auto-dismiss)",
      "rationale": "Codex rate-limit Switch to gpt-5.4-mini modal stalls autonomous agents with no auto-dismiss.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2333",
      "rank": 86,
      "size": "M",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: handle codex weekly-quota exhaustion gracefully",
      "rationale": "Codex weekly-quota exhaustion has no graceful handling — needs resource alert + downshift/dismiss policy.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2511",
      "rank": 87,
      "size": "XS",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agents burn 20+ min on false test failures",
      "rationale": "Work agents burn 20+ min on false test failures — sandbox denies spawnSync git (EPERM); a per-issue cycle-time sink.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2451",
      "rank": 88,
      "size": "M",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agent stranded behind commit-msg gate after overflow-restart + auto-commit + merge-main (non-issue-ref commits)",
      "rationale": "Work agent stranded behind commit-msg gate after overflow-restart + auto-commit + merge-main leaves non-issue-ref commits.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2516",
      "rank": 89,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spec plan.status flips left uncommitted in shared primary worktree → spec-vs-record drift + blocks flywheel push",
      "rationale": "Spec plan.status flips left uncommitted in the shared primary worktree, causing spec-vs-record drift and blocking the flywheel push.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2763",
      "rank": 90,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace node_modules is symlinked to the primary repo, breaking test resolution",
      "rationale": "Workspace node_modules is symlinked to the primary repo — the forbidden pattern CLAUDE.md bans; breaks test resolution.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2170",
      "rank": 91,
      "size": "XS",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Docker init container lacks Python",
      "rationale": "Docker init container lacks Python, so node-gyp rebuild of better-sqlite3 fails and the workspace never comes up.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1198",
      "rank": 92,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace init container's bun install doesn't populate container-node-modules named volume",
      "rationale": "Workspace init container bun install does not populate the container-node-modules named volume.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2106",
      "rank": 93,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan strike workspace setup leaves broken partial workspace + false 'spawned' success (git-lock race)",
      "rationale": "pan strike workspace setup leaves a broken partial workspace + false spawned success on a git-lock race.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3040",
      "rank": 94,
      "size": "M",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan strike fails on polyrepo projects — worktree creation, merge validation and the strike merge request are all monorepo-shaped",
      "rationale": "Strikes are the urgency path for pipeline blockers, so a polyrepo project has no fast unblock at all. The normal merge door already handles per-repo merge sets; the strike request simply cannot express them yet.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2954",
      "rank": 95,
      "size": "XS",
      "importance": "critical",
      "score": 87,
      "condition": "ok",
      "dependsOn": [
        "PAN-2882"
      ],
      "why": "postMergeLifecycle refuses GitLab projects",
      "rationale": "postMergeLifecycle refuses GitLab projects — merge state cannot be auto-verified, so teardown/labels never run.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2882",
      "rank": 96,
      "size": "XS",
      "importance": "critical",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline membership has no GitLab merged-MR oracle",
      "rationale": "No GitLab merged-MR oracle — squash-merged GitLab branches show as unmerged, producing false planned_backlog rows.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2880",
      "rank": 97,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [
        "PAN-2259"
      ],
      "why": "Linear tracker listIssues is a 3N+1 request storm",
      "rationale": "Linear listIssues is a 3N+1 request storm — one membership gather burns the entire 2500/hr Linear budget.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2966",
      "rank": 98,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Polyrepo wrapper .gitignore misses .pan/ .devcontainer/ dev",
      "rationale": "Polyrepo wrapper .gitignore misses .pan/ .devcontainer/ dev — pan done cleanliness gate false-fails on Overdeck scaffolding.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2945",
      "rank": 99,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done rejects Overdeck-generated runtime in polyrepo wrapper repos (.devcontainer/, dev, .pan/review)",
      "rationale": "pan done rejects Overdeck-generated runtime (.devcontainer/, dev, .pan/review) in polyrepo wrapper repos.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2680",
      "rank": 100,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close: Docker teardown silently skips a running stack in multi-repo projects (MYN), aborting close-out",
      "rationale": "pan close Docker teardown silently skips a running stack in multi-repo projects, aborting close-out.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2627",
      "rank": 101,
      "size": "S",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "Linear poller is blind after cycle rollover",
      "rationale": "Linear poller is blind after cycle rollover — active-cycle filter returns 0 issues.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2324",
      "rank": 102,
      "size": "XS",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "label transition fails atomically on missing 'in-planning' label",
      "rationale": "Close-out label transition fails atomically on a missing in-planning label, keeping closed issues mislabeled.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2165",
      "rank": 103,
      "size": "XS",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close: close-issue phase reports success but leaves issue OPEN / wrong labels (remove-label aborts on absent label; no-vBRIEF trans…",
      "rationale": "pan close close-issue phase reports success but leaves the issue OPEN / wrong labels.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2905",
      "rank": 104,
      "size": "S",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard steady-state CPU ~50% keeps API responses at 0.5-1.5s",
      "rationale": "Dashboard steady-state ~50% CPU keeps API responses at 0.5-1.5s — a residual burner profile and fix.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2259",
      "rank": 105,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "something burns the full 5k/hr GitHub GraphQL quota",
      "rationale": "Something burns the full 5k/hr GitHub GraphQL quota, repeatedly breaking pan close and gh issue edit.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2379",
      "rank": 106,
      "size": "S",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "dependency install is warn-only + 60s timeout → false verify failures against empty node_modules (blocks swarm convergence)",
      "rationale": "Verify-gate dependency install is warn-only + 60s timeout, producing false verify failures against empty node_modules.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2421",
      "rank": 107,
      "size": "XS",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "dashboard server route tests flake under full-suite verification load",
      "rationale": "Dashboard server route tests flake under full-suite verification load.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2430",
      "rank": 108,
      "size": "S",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "frontend typecheck fails with dozens of pre-existing unused-local errors",
      "rationale": "Frontend typecheck fails with dozens of pre-existing unused-local errors — gates are noisy/unreliable.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2593",
      "rank": 109,
      "size": "S",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "server children inherit bare system PATH",
      "rationale": "Server children inherit bare system PATH — verification gates run npm/node under Node 18 not the server Node 22.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2656",
      "rank": 110,
      "size": "S",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "deacon-swarm unit tests read live ~/.overdeck/config.yaml",
      "rationale": "deacon-swarm unit tests read live ~/.overdeck/config.yaml — 6 tests fail whenever swarm.mjs differs.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1824",
      "rank": 111,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix flaky main CI: fake timers + @slow exclusion for real-timer test family",
      "rationale": "Rank held at the top of the CI-reliability band. The issue picked up the planned label since the last pass but the content is unchanged: the real-timer test family still flakes main CI and still masks real regressions.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2980",
      "rank": 112,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "pre-push file-size guard audits the dirty working tree, so another session's uncommitted edits block unrelated pushes",
      "rationale": "Same shared-primary-worktree hazard as PAN-3062 and the same evaluate-the-commit-not-the-tree fix as PAN-3100. On a machine where several sessions share main, a stranger’s in-progress edit blocks every other push and --no-verify is correctly off the table.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3046",
      "rank": 113,
      "size": "XS",
      "importance": "medium",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan CLI crashes at exit with ERR_UNHANDLED_REJECTION when the PostHog shutdown flush times out; a success exits non-zero",
      "rationale": "The orphaned promise in the timeout race means any caller branching on pan done’s exit code sees failure after a successful merge handoff. One catch handler on the losing arm.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3003",
      "rank": 114,
      "size": "XS",
      "importance": "medium",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work-agent launchers lack an OVERDECK_AGENT_ID export, so a manual re-launch dies instantly under the PTY supervisor",
      "rationale": "Live spawns survive only because exec-time env injects the variable, so the failure surfaces as the misleading \"Claude Code did not become ready within 30s\" during exactly the debugging move an operator reaches for.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3013",
      "rank": 115,
      "size": "XS",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "linear-mcp-auth-hook entries leak into durable ~/.claude/settings.json pointing at dead /tmp/pan-agent-role-* paths",
      "rationale": "Twenty-six dead hook entries accumulated in the user-level settings file and fire on every matching tool call in every session. Mitigated by hand once; needs the registration path fixed so it stops re-accumulating.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3014",
      "rank": 116,
      "size": "XS",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Background AI title/about spawns fail because --bare skips credential reads in Claude Code 2.1.209",
      "rationale": "Reproduced standalone, with a named replacement (--safe-mode plus empty --setting-sources) that keeps every PAN-2657 isolation gate. Small, well-specified, and it restores conversation titles across the whole dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2075",
      "rank": 117,
      "size": "XL",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Boot Reconciliation + Operator Inbox",
      "rationale": "Epic — boot reconciliation + operator inbox; replaces silent all-or-nothing resume with one informed, substrate-complete (local+Fly) decision surface. Ranked by aggregate child impact.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2077",
      "rank": 118,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [
        "PAN-1775"
      ],
      "why": "Substrate-complete reconciliation inventory (local tmux + remote Fly machines)",
      "rationale": "Boot reconciliation substrate-complete inventory resolver (local tmux + remote Fly) — the backend both surfaces consume; depends on remote-agent rows.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2078",
      "rank": 119,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [
        "PAN-2077"
      ],
      "why": "CLI parity for boot reconciliation: pan boot status + pan resume --all|--select|--freeze|--kill-remote",
      "rationale": "CLI parity for boot reconciliation (pan boot status / pan resume flags) — the headless leg.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2079",
      "rank": 120,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [
        "PAN-2077"
      ],
      "why": "Operator Inbox: durable server-side queue + in-dashboard surface (the notification spine)",
      "rationale": "Operator Inbox durable queue + in-dashboard surface — the notification spine; boot reconciliation is producer #1, and it absorbs scattered alert surfaces.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2080",
      "rank": 121,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [
        "PAN-2079"
      ],
      "why": "Operator Inbox external transports (email/Slack/push/TTS)",
      "rationale": "Operator Inbox external transports (email/Slack/push/TTS) — offline reach; fast-follow after the inbox spine.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1775",
      "rank": 122,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remote (Fly.io) work agents appear as real session rows in the issue tree",
      "rationale": "Remote Fly.io work agents appear as real session rows — prerequisite visibility before reconciliation can include them.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-454",
      "rank": 123,
      "size": "XS",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [
        "PAN-2077"
      ],
      "why": "Crash recovery: detect orphaned agents and present recovery UI on dashboard startup",
      "rationale": "Crash recovery UI on dashboard startup — superseded by the boot reconciliation surface but still the local-half tracker.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1436",
      "rank": 124,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list",
      "rationale": "Stale stopped-agent zombies pollute the dashboard list — must be excluded from reconciliation resume candidates.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2642",
      "rank": 125,
      "size": "XL",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost strategy: waste detection over budget policing",
      "rationale": "Epic — cost strategy: retire invented limits, land the progress-aware breaker, make dollars honest. Ranked by aggregate child impact; the breaker is the one real guard.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-1868",
      "rank": 126,
      "size": "XS",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [
        "PAN-2466"
      ],
      "why": "Cost-bleed circuit breaker: progress-aware, always-on guard against runaway agent spend",
      "rationale": "Cost-bleed circuit breaker — progress-aware, always-on guard against runaway spend; the one real guard the epic authorizes.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2466",
      "rank": 127,
      "size": "S",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "close-out/record writer clobbers closeOut.usage with EMPTY data",
      "rationale": "closeOut.usage clobbered with empty data on close-out — per-issue cost history lost locally; ledger integrity, fix early.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1042",
      "rank": 128,
      "size": "S",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions",
      "rationale": "cost_events retention — 14 months of granular rows accumulating with no policy; DB bloat.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-570",
      "rank": 129,
      "size": "XS",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [
        "PAN-2642"
      ],
      "why": "Show PLAN badge on costs when under a subscription/plan",
      "rationale": "Show PLAN badge on costs under a subscription — folds into the billing-mode work that makes headline spend honest.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-106",
      "rank": 130,
      "size": "M",
      "importance": "high",
      "score": 77,
      "condition": "stale",
      "dependsOn": [],
      "why": "Cost prediction/estimation for in-progress work",
      "rationale": "Cost prediction/estimation for in-progress work — folds burn-rate estimation into the breaker.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2059",
      "rank": 131,
      "size": "XL",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog pickup gate",
      "rationale": "Epic — backlog pickup gate: operator Plan->Release row + AI Objection (5th state) + flywheel relevance-vetting; prevents bad/superseded work from burning agent time.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2376",
      "rank": 132,
      "size": "XL",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic: CI/CD reliability",
      "rationale": "Epic — CI/CD reliability: flake policy, verification-to-merge convergence, strike/swarm merge-path hardening, deploy hygiene.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-1666",
      "rank": 133,
      "size": "XL",
      "importance": "medium",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline Throughput Hardening",
      "rationale": "Epic — pipeline throughput hardening; most keystone children closed, remaining open work is coalescing review-spawn noise.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-1556",
      "rank": 134,
      "size": "S",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "Session/activity feed: coalesce review-spawn spam, supersede re-reviews per issue, keep active conversations most-recent",
      "rationale": "Session/activity feed coalesces review-spawn spam and supersedes re-reviews per issue — keeps active conversations most-recent.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3015",
      "rank": 135,
      "size": "L",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan monitor: a pull-based background inbox transport to replace keystroke injection as the Claude Code delivery path",
      "rationale": "Claude Code is the only harness still typed at, and an entire hardening stack (PAN-1769, PAN-2228, PAN-2179, PAN-1988) exists to manage that fragility. The durable mail queue already receives every delivery and nothing drains it, so the substrate is half-built already.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3093",
      "rank": 136,
      "size": "L",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [
        "PAN-1696"
      ],
      "why": "Polyrepo UAT assembly: per-repo generation branches, per-repo base SHAs, all-or-nothing promote — unblocks the MYN train",
      "rationale": "PAN-1696 removes the cwd binding that currently hides this, at which point a polyrepo project goes from silently skipped to attempted-and-failing behind a guard. This issue removes that guard, and until it lands mind-your-now gets no UAT train at all.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2188",
      "rank": 137,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel resilience for the codebase-health flood: substrate-first prioritization + tenets spirit-gate",
      "rationale": "Flywheel resilience for the codebase-health flood — substrate-first prioritization + tenets spirit-gate; landed parts, operator-decision items remain.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1990",
      "rank": 138,
      "size": "M",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "First-class workspaces and projects with per-workspace memory — use Overdeck without filing an issue first",
      "rationale": "Rank lifted from 509: the body now points at a full PRD on overdeck-state that supersedes it, so this moved from an idea to an implementation-ready substrate change with verified references and numbered work items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2565",
      "rank": 139,
      "size": "M",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging",
      "rationale": "Rank lifted from 343: a PRD landed on overdeck-state and the body now verifies what exists against main, making the largest Traycer-parity gap concretely executable rather than aspirational.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2566",
      "rank": 140,
      "size": "L",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Traycer parity epic: gap analysis of capabilities Overdeck lacks, with the already-covered set explicitly excluded",
      "rationale": "Rank lifted from 342 to stay adjacent to PAN-2565, its largest child: the refreshed body now separates genuine gaps from capabilities Overdeck already has, so it is usable as a triage list.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2189",
      "rank": 141,
      "size": "L",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Decompose src/lib/cloister/deacon.ts (3,394 lines)",
      "rationale": "Decompose deacon.ts (3,394 lines) — pipeline-runtime machinery; supervised handoff only, not autonomous pickup.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2190",
      "rank": 142,
      "size": "L",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Decompose routes/workspaces/merge-ops.ts (1,925 lines)",
      "rationale": "Decompose merge-ops.ts (1,925 lines) — new god file from the workspaces split; supervised handoff only.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2233",
      "rank": 143,
      "size": "L",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "decompose merge-agent.ts (1,414 lines) into focused modules",
      "rationale": "Decompose merge-agent.ts (1,414 lines) into focused modules; supervised handoff only.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2526",
      "rank": 144,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Refactor deacon.ts below file-size baseline",
      "rationale": "Refactor deacon.ts below file-size baseline — companion to PAN-2189.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2008",
      "rank": 145,
      "size": "XS",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [
        "PAN-1936"
      ],
      "why": "store-access guard",
      "rationale": "Store-access guard — fail the build on direct store reads outside a domain resolver; the smallest slice of single-source-of-truth.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1936",
      "rank": 146,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Single source-of-truth reads",
      "rationale": "Single source-of-truth reads — one canonical resolver per domain, consolidating 280+ scattered read endpoints.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1988",
      "rank": 147,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [
        "PAN-1936"
      ],
      "why": "Verdict signaling: one host-owned write door; agents journal, host owns the DB cache",
      "rationale": "Verdict signaling — one host-owned write door; agents journal, host owns the DB cache.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1910",
      "rank": 148,
      "size": "XS",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [
        "PAN-1936"
      ],
      "why": "fast-follow(PAN-1908): collapse issue status to ONE canonical field",
      "rationale": "Collapse issue status to one canonical field — labels become a derived projection.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1325",
      "rank": 149,
      "size": "M",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Artifact storage model is unsafe for polyrepo projects",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1728",
      "rank": 150,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1700 agent committed .pan/specs/*.vbrief.json mutations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2651",
      "rank": 151,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "simplify lifecycle reconciliation and add a safe post-planning reset",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2678",
      "rank": 152,
      "size": "M",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ops: clean blocked state worktrees, fix auricle git-status failure, restore the Deacon (2026-07-14 review outage)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2241",
      "rank": 153,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "complete-planning is not serialized or idempotent per issue (spec tmp-rename 500s, bead delete-recreate thrash)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2242",
      "rank": 154,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unidentified duplicate caller fires complete-planning in pairs every ~2 minutes (perpetual loop while session survives)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2240",
      "rank": 155,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell contradicts itself on dead ohmypi sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2243",
      "rank": 156,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan plan finalize: CLI aborts complete-planning at 90s while the server handler legitimately finishes later (false ✖ Failed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2244",
      "rank": 157,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Recurring [pan-dir/auto-commit] GitError on main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2202",
      "rank": 158,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "complete-planning silently skips spec promotion on a dead session's unanswered AskUserQuestion",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2195",
      "rank": 159,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan plan finalize re-plan churn: stale superseded spec on main transiently materializes the old plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2237",
      "rank": 160,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan plan done swallows vbrief quality lint details",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2487",
      "rank": 161,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI-green merge skip + Ship & Merge cockpit view (live door log + progress) + active-node spinner",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2469",
      "rank": 162,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "issue-level assembly owner",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2212",
      "rank": 163,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm slot dispatch has no reserved budget",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2213",
      "rank": 164,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm slot allocator picks an orphaned slot index and refuses instead of skipping to the next free one",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2211",
      "rank": 165,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2203 follow-up: swarm slot pan done records completion but slot never becomes merge-ready",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2210",
      "rank": 166,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2203 follow-up: a swarm slot's completion can trigger the issue-level review pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2201",
      "rank": 167,
      "size": "XS",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out label step fails atomically when a hardcoded label (e.g. 'in-planning') is absent from the repo",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2718",
      "rank": 168,
      "size": "M",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan restart needs a first-class no-dialog reconciliation flag",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2646",
      "rank": 169,
      "size": "XS",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "configurable global/project/issue policy UI with default OFF",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2652",
      "rank": 170,
      "size": "M",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view diverges from Terminal: Claude Code backgrounding forks the session file in-process, invisible to all session-id reso…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2667",
      "rank": 171,
      "size": "M",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reimplement the task-progress admission signal in resource discovery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2755",
      "rank": 172,
      "size": "S",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "per-issue review-model override never reached convoy sub-reviewers on the discovery-fork path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2754",
      "rank": 173,
      "size": "S",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "`always` is inert",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2809",
      "rank": 174,
      "size": "M",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "Live-terminal Playwright UAT blocked in containerized workspaces (node-pty musl/glibc mismatch + Vite/Traefik WS Origin 403)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2810",
      "rank": 175,
      "size": "M",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace 'vitest --changed' gate diverges from CI: App.test.tsx fails locally on missing selectPendingInputSubjects mock",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2982",
      "rank": 176,
      "size": "S",
      "importance": "medium",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review convoy should run a skill’s own selftest when sync-sources/skills/** changes; no mechanical gate exists today",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2495",
      "rank": 177,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2487 ci-green merge skip bypassed CI-green gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2478",
      "rank": 178,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI flake: Playwright browser install fails on packages.microsoft.com apt (NOSPLIT), red-mains legit merges",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1710",
      "rank": 179,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 and feature/pan-1641",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1720",
      "rank": 180,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "cloister auto-resume tests fail under full parallel run, pass in isolation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1558",
      "rank": 181,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review/specialist agents should run in the workspace Docker container, not inherit host-override",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1650",
      "rank": 182,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Split readyForMerge → gatesPassed (derived/event-driven) + shipComplete; auto-dispatch ship on gates-green",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3090",
      "rank": 183,
      "size": "M",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Simple issue page: narrative feed instead of a 55KB raw kickoff dump, surface the pending question, honest blocked state",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3017",
      "rank": 184,
      "size": "S",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Issue-page UAT panel renders no overflow menu, so a healthy stack has no restart control; panel coverage is inconsistent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1766",
      "rank": 185,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "work agents hang on Claude Code settings-file protection when editing .claude/**",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1767",
      "rank": 186,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Show merged-but-not-closed-out count in pan status and the dashboard headline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1770",
      "rank": 187,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan-dir auto-commit rebase races live .pan/continues writes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1889",
      "rank": 188,
      "size": "M",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "retention/compaction policy for docs/FLYWHEEL-STATE.md",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2027",
      "rank": 189,
      "size": "M",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: route kimi-k2 through ohmypi harness instead of CLIProxy (eliminates 200k-window illusion)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2266",
      "rank": 190,
      "size": "M",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: add zcode harness and make it the default for glm-5.2",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1578",
      "rank": 191,
      "size": "M",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1538",
      "rank": 192,
      "size": "M",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unblock Pi source forks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-687",
      "rank": 193,
      "size": "M",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support OpenCode as alternative coding agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-466",
      "rank": 194,
      "size": "M",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-465",
      "rank": 195,
      "size": "M",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add OpenRouter as a model provider",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3011",
      "rank": 196,
      "size": "M",
      "importance": "low",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support poolside Laguna S 2.1 (118B MoE, 1M ctx) — hosted via OpenRouter now, self-host when the hardware exists",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-463",
      "rank": 197,
      "size": "M",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add Qwen 3.6+ model support",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1142",
      "rank": 198,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add reasoning effort level to per-role / per-conversation model config",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1424",
      "rank": 199,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1196",
      "rank": 200,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Workhorse routing by bead difficulty + subject-matter (single-agent and swarm)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1311",
      "rank": 201,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Swarm: fast-track tier",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1313",
      "rank": 202,
      "size": "L",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Finish src/lib Effect migration: remove or justify legacy Promise/sync surfaces",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1246",
      "rank": 203,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Perf: projection-cached VCS driver for diff/checkpoint reads (port of t3code #2586)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1253",
      "rank": 204,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel: respect issue dependencies before autopicking work",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1254",
      "rank": 205,
      "size": "L",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Tailscale integration: advertise dashboard + workspace endpoints over tailnet (Effect-native)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1357",
      "rank": 206,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Template conversations: load curated skill bundles into a single conversation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2976",
      "rank": 207,
      "size": "L",
      "importance": "medium",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "Generalize the ACP harness: any ACP-capable agent CLI as a spawnable runtime behind a machine-checkable capability gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2977",
      "rank": 208,
      "size": "M",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [
        "PAN-2976"
      ],
      "why": "ACP agent setup UI: detect installed CLIs, show capability and auth status, and guide login from Settings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3058",
      "rank": 209,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Standing-crew templates: ship preset tiered-execution configurations selectable from Settings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3054",
      "rank": 210,
      "size": "M",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Benchmark matrix: launch one template issue under N configurations and compare cost, time and outcome mechanically",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3061",
      "rank": 211,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [
        "PAN-3054"
      ],
      "why": "Dispatch-topology advisor: deterministic start-vs-swarm recommendation computed from plan shape at plan-finalize",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1915",
      "rank": 212,
      "size": "M",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "enhancement(security): API key at-rest hardening",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1435",
      "rank": 213,
      "size": "XS",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "API keys in ~/.panopticon/config.yaml stored as plaintext",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1672",
      "rank": 214,
      "size": "M",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1640",
      "rank": 215,
      "size": "M",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2351",
      "rank": 216,
      "size": "XS",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats (security prerequisites)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2350",
      "rank": 217,
      "size": "L",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic: Overdeck Anywhere",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3016",
      "rank": 218,
      "size": "M",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "URL-address every view: cockpit tab, stage panes and Home navigation are not URL-synced, so refresh loses your place",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1217",
      "rank": 219,
      "size": "XS",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Requirements reviewer: classify each AC as in_pr_scope vs whole_feature_scope, only !-block in-PR-scope items",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1218",
      "rank": 220,
      "size": "M",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-of-batch mode",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1219",
      "rank": 221,
      "size": "M",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Promote across-cycle review state to first-class data (cycle SHA, prior findings) instead of prompt-derived",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1209",
      "rank": 222,
      "size": "S",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1052 bead projection disagrees with bd state",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1451",
      "rank": 223,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1452",
      "rank": 224,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1381 follow-up: per-reviewer restart with model override (architectural mismatch with PAN-1048)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1454",
      "rank": 225,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "[META] 9 systemic failure patterns surfaced by 80-issue audit",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1553",
      "rank": 226,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Investigate Claude Code Fast mode support (and fast-tier pricing)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1504",
      "rank": 227,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan hygiene",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1480",
      "rank": 228,
      "size": "L",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR: 93% bypass rate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1479",
      "rank": 229,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "RTK: Add telemetry to measure token savings from bash output compression",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2950",
      "rank": 230,
      "size": "L",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Refactor god files back under file-size ceilings after the UX overhaul",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2837",
      "rank": 231,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Distributed agent presence: record which machine runs each issue's agents on overdeck-state (claim/release, no heartbeats)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2836",
      "rank": 232,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "okf: in-repo placement presets (okf/, docs/okf/) and /okf migrate to switch placements later",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2983",
      "rank": 233,
      "size": "M",
      "importance": "low",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "OKF v3 deferred capabilities: lease-based concurrent write mode and an LLM semantic auditor, both gated on proven need",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2830",
      "rank": 234,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Shared Logbook: make the overdeck-state branch opt-in",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2720",
      "rank": 235,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "File-size ratchet counts lines, so it rewards line-packing on the god files it means to improve",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2650",
      "rank": 236,
      "size": "L",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm final ready-to-merge slot wedges when memory-governor sheds the integration stack; pan swarm recover can't recover it",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2549",
      "rank": 237,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fly remote workspaces: sync overdeck-state before re-enabling migrated projects",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2358",
      "rank": 238,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2145 follow-up: restore PAN-1535 hardening in transformMessageForHarness (rewritten during conversations.ts decomposition)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2334",
      "rank": 239,
      "size": "XS",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "write a Definition of Ready (DoR)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2308",
      "rank": 240,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "hardening(workspaces): migrate stale generated compose files off PORT=3011 + deacon quarantine for deterministic container boot refusal…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2193",
      "rank": 241,
      "size": "S",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Held issues (objection/parked/vetoed/needs-handoff) are invisible in the Command Deck tree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1984",
      "rank": 242,
      "size": "XS",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1913",
      "rank": 243,
      "size": "XS",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project description: show on click, edit in dashboard, mirror into the project layer (and document what's in .pan and ~/.panopticon)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1906",
      "rank": 244,
      "size": "M",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1544",
      "rank": 245,
      "size": "M",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Type cleanup: strip 'ship' from the Role union and its ~10 downstream references",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-955",
      "rank": 246,
      "size": "S",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace devcontainer template versioning + re-render on demand",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2978",
      "rank": 247,
      "size": "M",
      "importance": "low",
      "score": 47,
      "condition": "ok",
      "dependsOn": [
        "PAN-2976"
      ],
      "why": "Auto-install ACP agent CLIs from the setup UI — opt-in, operator-initiated, pinned per-agent recipes only",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-813",
      "rank": 248,
      "size": "M",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add regression test for /api/review/:issueId/reset preserving work-agent resolution",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-807",
      "rank": 249,
      "size": "L",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic C: Workspace state sanity on spawn",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-630",
      "rank": 250,
      "size": "M",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-tenant workspace isolation with ACLs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-471",
      "rank": 251,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost reconciler: auto-trigger on agent lifecycle events with debounce",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-438",
      "rank": 252,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate remaining REST polling endpoints to Effect RPC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-262",
      "rank": 253,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "stale",
      "dependsOn": [],
      "why": "Refactor post-merge lifecycle into composable, idempotent operations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-176",
      "rank": 254,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-176: Hook-enforced delegation guardrails for specialist agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-578",
      "rank": 255,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Security: Comment mediation layer to prevent prompt injection via tracker comments",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2921",
      "rank": 256,
      "size": "S",
      "importance": "medium",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike merge door can report fetch failure after merge and land the same head twice",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2839",
      "rank": 257,
      "size": "S",
      "importance": "medium",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "plan→work autoSpawn now 500s with a duplicated workspace prep",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2824",
      "rank": 258,
      "size": "S",
      "importance": "medium",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan review pending dies when one project's lens gather fails (non-degrading caller; PAN-2820 class)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2805",
      "rank": 259,
      "size": "S",
      "importance": "medium",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "FlywheelPage shows 'No active run' while /api/flywheel/current returns a live run",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2792",
      "rank": 260,
      "size": "S",
      "importance": "medium",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Orphan-process sweeps killed the dashboard and live conversations via lsof +D over Bun-hardlinked node_modules",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2761",
      "rank": 261,
      "size": "S",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "done.test.ts asserts a hardcoded URL without stubbing env, so it fails in any agent shell with OVERDECK_DASHBOARD_URL set and looks lik…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2739",
      "rank": 262,
      "size": "S",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "first-completion detection throws every patrol cycle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2738",
      "rank": 263,
      "size": "S",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "strikes deadlock",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2717",
      "rank": 264,
      "size": "S",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "conversation permission waits missing from Awareness; strengthen alert pulse",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2697",
      "rank": 265,
      "size": "S",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "First-review codex parents enter discovery mode and the supervisor session no-ops every discovery-ready signal",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2696",
      "rank": 266,
      "size": "XS",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task views still speak beads vocabulary",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2691",
      "rank": 267,
      "size": "S",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-planned issues park silently when the post-finalize work spawn is gated (stack-unhealthy 422)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2686",
      "rank": 268,
      "size": "XS",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Policy strip \"restart pending\" badge never clears after restart-fresh with a new model (record.model is sticky)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2672",
      "rank": 269,
      "size": "S",
      "importance": "medium",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-/clear siblings render the same original transcript (per-tmux resolution + frozen launcher pin + null claude_session_id)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2670",
      "rank": 270,
      "size": "S",
      "importance": "medium",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "Gate the dashboard-server tsconfig in npm run typecheck",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2664",
      "rank": 271,
      "size": "S",
      "importance": "medium",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "auto-commit completes unresolved merge with conflict markers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2663",
      "rank": 272,
      "size": "S",
      "importance": "medium",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "health probe can accept old dashboard after replacement EADDRINUSE",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2659",
      "rank": 273,
      "size": "S",
      "importance": "medium",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "fs-lock: crash between mkdir(lock) and owner.json write leaves an unreclaimable record lock (successor to #2623)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2649",
      "rank": 274,
      "size": "S",
      "importance": "medium",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ctrl+K conversation search indexes Claude transcripts only",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2981",
      "rank": 275,
      "size": "S",
      "importance": "medium",
      "score": 62,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ctrl-K palette 404s on stale conversations because the search index never prunes deleted sessions; body describes the fix as written",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3012",
      "rank": 276,
      "size": "M",
      "importance": "medium",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "Back up harness conversation transcripts before harnesses delete them — archive preserves the pointer, not the data",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2580",
      "rank": 277,
      "size": "S",
      "importance": "medium",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell cannot deliver to codex (GPT) conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2572",
      "rank": 278,
      "size": "M",
      "importance": "medium",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "Noisy EBADENGINE + deprecation warnings on npx/npm install make a healthy install look broken",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2563",
      "rank": 279,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm-flavor desktop (npx @overdeck/desktop) lacks node_modules for the server's externalized deps",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2560",
      "rank": 280,
      "size": "M",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "resolveStateReadHomeSync (state-read-home.ts) resolves state dir by path basename, not registry key",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2554",
      "rank": 281,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "clicking a project doesn't update the browser URL",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2550",
      "rank": 282,
      "size": "XS",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm test exits 0 despite root-suite failures",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2547",
      "rank": 283,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan restart --health-timeout parses seconds as milliseconds",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2546",
      "rank": 284,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell is codex-conversation-unaware",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2506",
      "rank": 285,
      "size": "M",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "flywheel-primary-root.test.ts fails on macOS: /var vs /private/var symlink not canonicalized",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2501",
      "rank": 286,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "deleteResourceVenvEffect's HttpRouter.schemaParams call fails typecheck under the root tsconfig (masked by src/dashboard/** exclusion)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2492",
      "rank": 287,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "pane-detected waits (rate-limit/session-resume) surface as 'needs you' but cannot be answered from the dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2491",
      "rank": 288,
      "size": "M",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate @xenova/transformers to @huggingface/transformers to eliminate silent npx install failures from sharp 0.32 postinstall",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2489",
      "rank": 289,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "strike agents are invisible in the project issue tree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2484",
      "rank": 290,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "ready set misses merge-eligible issues without flywheel merge verbs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2465",
      "rank": 291,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done's PR lookup fails at MYN polyrepo root",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2454",
      "rank": 292,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "ratchet audit fails per-commit on push ranges whose NET baseline delta is zero",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2428",
      "rank": 293,
      "size": "XS",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "MYN workspace Traefik routing broken post-rebrand",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2423",
      "rank": 294,
      "size": "XS",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan workspace rebuild hardcodes 'overdeck-' compose project prefix",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2416",
      "rank": 295,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "codex agents can wedge on the Codex CLI first-run/consent screen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2414",
      "rank": 296,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "context-overflow recovery is inconsistent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2408",
      "rank": 297,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start --auto commits the spec to main AFTER creating the worktree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2395",
      "rank": 298,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "one invalid tiered_execution enum poisons every config read",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2381",
      "rank": 299,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "three event types missing from DomainEvent schema union poison the RPC stream",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2287",
      "rank": 300,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "every supervisor.log line written twice",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2280",
      "rank": 301,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resumed conversations wedge without writing transcripts when dashboard is black-holed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2197",
      "rank": 302,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "work agents skip `pan done` (manual push instead)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2186",
      "rank": 303,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "post-merge lifecycle can leave merged issues in-review and auto-merge rows stuck",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2069",
      "rank": 304,
      "size": "XS",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "caveman: follow-up gaps",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1918",
      "rank": 305,
      "size": "XS",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "full frontend vitest suite runs in no CI path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1912",
      "rank": 306,
      "size": "XS",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1846",
      "rank": 307,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "unbounded log growth",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1830",
      "rank": 308,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1828",
      "rank": 309,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation fork/handoff harness defaults ignore source conversation harness",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1816",
      "rank": 310,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1795",
      "rank": 311,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codebase map bootstrapped in planning worktree is never promoted to main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1774",
      "rank": 312,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "workspace server container crashloops when dist/dashboard/server.js is missing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1769",
      "rank": 313,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + tmux fallback); resumed-conv message stil…",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1761",
      "rank": 314,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "conversations endpoints fetched via relative /api path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1755",
      "rank": 315,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agents racing the next generation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1740",
      "rank": 316,
      "size": "XS",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon mislabels SIGTERM workspace container restarts as crashes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1711",
      "rank": 317,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Root-cause and fix dashboard event-loop stalls under load",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1674",
      "rank": 318,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR .venv (~7.5G) is duplicated into every workspace",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1673",
      "rank": 319,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1669",
      "rank": 320,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "restart-with-model doesn't emit a live event",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1668",
      "rank": 321,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "right-click 'restart with <model>' carries model only, never harness",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1627",
      "rank": 322,
      "size": "M",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridable by PreToolUse auto-appr…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1624",
      "rank": 323,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan handoff --author external: authored doc is socket_write-ten but never submitted",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1572",
      "rank": 324,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings permission-mode can desync from resolved config",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1571",
      "rank": 325,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Large multi-line pastes (handoff docs) land unsubmitted",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1565",
      "rank": 326,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #63147)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1530",
      "rank": 327,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Investigate: state.json with model='gpt-5.5' (a model that doesn't exist)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1461",
      "rank": 328,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation transcript: in-page search (Ctrl+F) only finds text in currently-rendered virtualized rows",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1449",
      "rank": 329,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1446",
      "rank": 330,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep stubs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1445",
      "rank": 331,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1444",
      "rank": 332,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-1416: dashboard port lockfile + pan doctor multi-instance check",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1440",
      "rank": 333,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1438",
      "rank": 334,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan flywheel start launcher process orphans when orchestrator dies externally",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1433",
      "rank": 335,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation agents can leave host main repo in abandoned git rebase state for hours",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1416",
      "rank": 336,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace-spawned dashboards must never claim the canonical dashboard port",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1392",
      "rank": 337,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1386",
      "rank": 338,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel orchestrator never emits status snapshots",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1330",
      "rank": 339,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "CLI cannot address planning-*/specialist-* sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1245",
      "rank": 340,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1244",
      "rank": 341,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1240",
      "rank": 342,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1227",
      "rank": 343,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate: bead can be closed without delivering the work",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1226",
      "rank": 344,
      "size": "L",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1148 unified-dashboard redesign",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1173",
      "rank": 345,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan show <bare-number> derives wrong agent ID for PAN-prefixed issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1154",
      "rank": 346,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan up does not kill existing port holders",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1150",
      "rank": 347,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: \"Anthropic is not configured\" warning persists in Model Routing after claude /login (Provider tab disagrees)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1149",
      "rank": 348,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1130",
      "rank": 349,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1129",
      "rank": 350,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1128",
      "rank": 351,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Channels: spurious 'no MCP server configured with that name' banner at conversation startup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1113",
      "rank": 352,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversations sidebar lets you message review-specialist sessions, which derails them silently",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1068",
      "rank": 353,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1048 deferred findings: security, correctness, and model validation gaps",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1027",
      "rank": 354,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge-status drift: deacon auto-detect paths set mergeStatus=merged without postMergeLifecycle, never reset on revert",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-933",
      "rank": 355,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review poster cannot post to GitLab MRs (only supports GitHub PRs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-932",
      "rank": 356,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done: polyrepo uncommitted changes check + existing MR handling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-927",
      "rank": 357,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rewrite containerize route: dead code, orphan processes, no pending-op tracking",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-900",
      "rank": 358,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Trust devroot for conversations + atomic .claude.json writes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-886",
      "rank": 359,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan review request shows 'fetch failed' instead of actual sync-target-branch error",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-778",
      "rank": 360,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Write conflict race: review-agent fails when test-agent write scope not yet released",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-727",
      "rank": 361,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix orphaned work-agent start handoff after planning",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-681",
      "rank": 362,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feedback routing: wrong issueId written to workspace when verification runs for co-active issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-538",
      "rank": 363,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan reload freshness guard must also verify the frontend bundle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-334",
      "rank": 364,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "stale",
      "dependsOn": [],
      "why": "Dashboard server has no duplicate-process protection",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-324",
      "rank": 365,
      "size": "XS",
      "importance": "medium",
      "score": 49,
      "condition": "stale",
      "dependsOn": [],
      "why": "Agent detail pane missing Merge/Approve button",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-304",
      "rank": 366,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "stale",
      "dependsOn": [],
      "why": "closeLinearDirect returns stepOk even when state update never happens",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-247",
      "rank": 367,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "stale",
      "dependsOn": [],
      "why": "Deacon has no backoff or escalation for repeated specialist startup failures",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-245",
      "rank": 368,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ctrl+C aborts planning dialog instead of copying text",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-244",
      "rank": 369,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "stale",
      "dependsOn": [],
      "why": "Deep-wipe leaves local branch and worktree metadata behind",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-178",
      "rank": 370,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-178: Crash recovery with granular task checkpointing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-113",
      "rank": 371,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "stale",
      "dependsOn": [],
      "why": "Dashboard 'Start Agent' returns success before verifying agent actually started",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-49",
      "rank": 372,
      "size": "XS",
      "importance": "medium",
      "score": 48,
      "condition": "stale",
      "dependsOn": [],
      "why": "Fix CloisterService tests that require real runtime",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1951",
      "rank": 373,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspector resumes a warm per-issue session instead of cold-spawning per item",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1577",
      "rank": 374,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Move a conversation to a different project (CLI + drag/drop + menu action)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1164",
      "rank": 375,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation diff summaries update live over WebSocket (drop 5s polling)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1041",
      "rank": 376,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-924",
      "rank": 377,
      "size": "L",
      "importance": "medium",
      "score": 48,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Spike: evaluate GitNexus for Panopticon integration",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-863",
      "rank": 378,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "One-shot sweep of stale feature branches and worktrees predating the reaper",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-817",
      "rank": 379,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Improve planning dialog layout and content fit",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-802",
      "rank": 380,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resume on conversation session forks instead of resuming",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-713",
      "rank": 381,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "test: add unit tests for doneCommand and approveCommand",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-700",
      "rank": 382,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Detachable terminal for conversation view",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-646",
      "rank": 383,
      "size": "XS",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Canceled issues: add guided Recover workflow",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-532",
      "rank": 384,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Per-project and per-issue model overrides for pipeline roles",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2896",
      "rank": 385,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Warm resource-discovery and membership caches at boot",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2685",
      "rank": 386,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Annotated live preview: Codex-style annotate-the-app feedback delivered to agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2626",
      "rank": 387,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "allow composer model switching within the same model family (e.g. Sonnet → Fable)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2625",
      "rank": 388,
      "size": "XS",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "auto-run /pan-new-project on project creation + setup banner, checklist, teaching empty states, and a guided demo issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2609",
      "rank": 389,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cross-device sync of conversations and tasks via user-owned git remote",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2608",
      "rank": 390,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Persistent collaboration roles (owner/editor/viewer) and organizations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2582",
      "rank": 391,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lanes)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2558",
      "rank": 392,
      "size": "L",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "support polyrepo projects",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2557",
      "rank": 393,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "project-level 'Restart All' context action",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2553",
      "rank": 394,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "project-level CI visibility",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2548",
      "rank": 395,
      "size": "XS",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "close the PAN-2541 legacy-fallback deprecation window",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2521",
      "rank": 396,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "launch pipeline agents with harness rate-limit model-switch reminder disabled",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2493",
      "rank": 397,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "align the cockpit Agents-lane and sidebar issue-tree feature sets (two-way gaps)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2444",
      "rank": 398,
      "size": "L",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "optional SageOx re-integration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2443",
      "rank": 399,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "OpenTelemetry GenAI semconv",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2442",
      "rank": 400,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent Client Protocol (ACP) as Overdeck's structured control plane",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2409",
      "rank": 401,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "enforce the workspace boundary",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2399",
      "rank": 402,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "wire replay_threshold/compaction_reroute into the slot-recovery respawn seam",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2392",
      "rank": 403,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Standing Crew cost panel",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2335",
      "rank": 404,
      "size": "XS",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "chore: review the full open backlog for junk/stale/nonsensical issues",
      "gate": "blocked",
      "planning": "skip"
    },
    {
      "issue": "PAN-2295",
      "rank": 405,
      "size": "L",
      "importance": "medium",
      "score": 44,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "built-in web browser surface (openable like terminal/Claude Code/Codex) + native Agentation integration",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2288",
      "rank": 406,
      "size": "L",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "tmux managed-server: lossless auto-migration of dirty-founded servers + boot-time ensure call",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2065",
      "rank": 407,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "unified usage & headroom panel across all provider plans (z.ai, Anthropic, Codex, OpenRouter)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2035",
      "rank": 408,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: GitHub Copilot subscription provider routing via omp",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2034",
      "rank": 409,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: end-to-end test that tool-call steps render in Conversation panel",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2033",
      "rank": 410,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: benchmark FIFO vs paste-buffer message delivery latency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2032",
      "rank": 411,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: local Ollama model as zero-cost preliminary review role",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2031",
      "rank": 412,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: add Bun 1.3.11 regression test to checkOhmypi doctor gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2030",
      "rank": 413,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: version-pin extension in package.json and pan doctor mismatch warning",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2029",
      "rank": 414,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: capture kimi thinking_tokens in ohmypi-parser for complete cost accounting",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2028",
      "rank": 415,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: per-provider cost grouping in cost dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2026",
      "rank": 416,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: surface 35+ provider matrix in dashboard model picker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2025",
      "rank": 417,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: extend provider credential passthrough for Groq, Cerebras, Fireworks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2024",
      "rank": 418,
      "size": "XS",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: frontend Tools-toggle for conversation view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2004",
      "rank": 419,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resumable Planning node: double-click a planned issue's Planning to resume the planning agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1995",
      "rank": 420,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1985",
      "rank": 421,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1968",
      "rank": 422,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Finish local-domain rename: pan.localhost → overdeck.localhost",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1967",
      "rank": 423,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel must re-validate (re-plan) pre-cutover plans before implementing them",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1965",
      "rank": 424,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1937",
      "rank": 425,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: data export",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1926",
      "rank": 426,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "--big flag to lift strike's precision-only scope guard (operator-authorized larger strikes)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1916",
      "rank": 427,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "configurable web search providers (Exa, Tavily, Brave, Perplexity)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1854",
      "rank": 428,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Define handoff strategy for large conversations: external vs source authoring + tail-biased read",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1853",
      "rank": 429,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1852",
      "rank": 430,
      "size": "XS",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval data",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1844",
      "rank": 431,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity notifications link to the specific view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1840",
      "rank": 432,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add 'pan switch <id>'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1839",
      "rank": 433,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings → Providers: show each provider's default harness in the collapsed row (no expand needed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1837",
      "rank": 434,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support Kimi Code as a first-class harness (Moonshot's own coding CLI)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1776",
      "rank": 435,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hot-updatable message delivery: version-stamped supervisors + server-side delivery logic",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1754",
      "rank": 436,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings page",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1751",
      "rank": 437,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flywheel",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1750",
      "rank": 438,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT assembly/conflict agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1748",
      "rank": 439,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "reuse uat-assembly conflict resolutions across generations (rerere or resolution replay)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1735",
      "rank": 440,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "adopt externally-completed readyForMerge issues into the pipeline/merge queue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1691",
      "rank": 441,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "conflict-aware merge train + on-demand UAT candidate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1685",
      "rank": 442,
      "size": "XS",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1676",
      "rank": 443,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1667",
      "rank": 444,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "unify Agents + Resources into one issue-centric holistic view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1657",
      "rank": 445,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1656",
      "rank": 446,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Skills page: make it a full management surface (browse, review, edit, scope, sync status)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1655",
      "rank": 447,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1654",
      "rank": 448,
      "size": "XS",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1653",
      "rank": 449,
      "size": "XS",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1623",
      "rank": 450,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1561",
      "rank": 451,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: Project-scoped dashboard nav (deck of tabs per project + conversations/tree column + activity feed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1550",
      "rank": 452,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: FilesPane + BrowserPane",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1545",
      "rank": 453,
      "size": "XS",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "New Terminal button",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1542",
      "rank": 454,
      "size": "XS",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spawn-refusal modal: render the three-button workflow on dirty-workspace 409",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1524",
      "rank": 455,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Slash command aliases: /handoff → /pan-handoff (and similar short forms)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1497",
      "rank": 456,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "emit TTS announcements on lifecycle events (start, pause, resume, report)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1490",
      "rank": 457,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "show each conversation's current git branch (port t3code BranchToolbar pattern)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1489",
      "rank": 458,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "task(flywheel): tune v1.0 readiness criteria after 30 days of telemetry",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1485",
      "rank": 459,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1473",
      "rank": 460,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1443",
      "rank": 461,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1442",
      "rank": 462,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1437",
      "rank": 463,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan flywheel report semantics: split read-only snapshot from run finalization",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1432",
      "rank": 464,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge agent leaves packages/contracts/dist stale",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1223",
      "rank": 465,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-update for users in the field (npm + desktop binaries)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1165",
      "rank": 466,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Lightweight review path for small/trivial PRs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1151",
      "rank": 467,
      "size": "XS",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1060",
      "rank": 468,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Self-modify permission handling: stop the interrupt loop without weakening the safety guard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1051",
      "rank": 469,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: Subspace-inspired alternate theme with Inter + JetBrains Mono",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1040",
      "rank": 470,
      "size": "XS",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "event-driven dispatch for inspect-agent (requiresInspection=true beads)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1037",
      "rank": 471,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Retire 'planning-' tmux prefix",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-958",
      "rank": 472,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-949",
      "rank": 473,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: add conversation for project from sidebar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-947",
      "rank": 474,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: project management actions in unified sidebar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-938",
      "rank": 475,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fizzy visual pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-903",
      "rank": 476,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Detect ~/.claude.json corruption on startup and surface it in the dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-902",
      "rank": 477,
      "size": "XS",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: add 'Run pan sync' button to configuration menu",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-901",
      "rank": 478,
      "size": "XS",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-818",
      "rank": 479,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Make summary optional when forking conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-736",
      "rank": 480,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: wire per-subagent model overrides from settings to Claude Code spawn env",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-709",
      "rank": 481,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "self-improving flywheel",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-678",
      "rank": 482,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan work issue --auto: headless planning → agent handoff without interactive dialog",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-675",
      "rank": 483,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-654",
      "rank": 484,
      "size": "L",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project Setup Wizard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-649",
      "rank": 485,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Render Excalidraw drawings inline in Claude Code conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-637",
      "rank": 486,
      "size": "XS",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Direct issue kickoff (skip planning) from dashboard UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-629",
      "rank": 487,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace quotas and resource governance",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-613",
      "rank": 488,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Investigate thinking effort levels for agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-607",
      "rank": 489,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Evaluate Ultimate Bug Scanner (UBS) for verification gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-606",
      "rank": 490,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Evaluate MCP Agent Mail for inter-agent communication and file reservations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-548",
      "rank": 491,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Command Deck: preserve state across navigation including URL routing for tabs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-546",
      "rank": 492,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remove claude-code-router",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-537",
      "rank": 493,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: show changed files diff summary after each agent response in activity view",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-531",
      "rank": 494,
      "size": "XS",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN: Windows Electron support (WSL2 required)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-452",
      "rank": 495,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation input bar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-450",
      "rank": 496,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Adopt remaining Effect patterns",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-294",
      "rank": 497,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "stale",
      "dependsOn": [],
      "why": "Surface module initialization errors as system-level, not per-issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-293",
      "rank": 498,
      "size": "M",
      "importance": "medium",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "Project Living Memory",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-277",
      "rank": 499,
      "size": "M",
      "importance": "medium",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "Session reasoning capture & collaborative PRD refinement",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-258",
      "rank": 500,
      "size": "M",
      "importance": "medium",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "Kanban board: fit all columns without horizontal scrolling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-255",
      "rank": 501,
      "size": "M",
      "importance": "medium",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "Agents lack awareness of MCP tools",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-252",
      "rank": 502,
      "size": "XS",
      "importance": "medium",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "Disable Sync with Main button when workspace is up to date",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-243",
      "rank": 503,
      "size": "M",
      "importance": "medium",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "Audit dashboard actions: ensure all are available via CLI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-77",
      "rank": 504,
      "size": "XS",
      "importance": "medium",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "Cost breakdown modal: show costs by stage and model when clicking cost badge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-54",
      "rank": 505,
      "size": "L",
      "importance": "medium",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "e2e command for full workflow integration test",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-38",
      "rank": 506,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "stale",
      "dependsOn": [],
      "why": "Support multiple merge agents per repository",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-37",
      "rank": 507,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "stale",
      "dependsOn": [],
      "why": "Support external PR selection for merge-agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1126",
      "rank": 508,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Integrate TLDR summaries into review context manifest",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1066",
      "rank": 509,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2968",
      "rank": 510,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Adopt the interactive decision page as the default way to present operator decisions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2941",
      "rank": 511,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "OKF v3",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2936",
      "rank": 512,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Handle loop.max_steps_exceeded: detect and nudge agents to continue instead of stranding them",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2922",
      "rank": 513,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reduce accidental orchestration complexity after performance stabilization",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2868",
      "rank": 514,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Desktop window opens at fixed 1400×900",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2767",
      "rank": 515,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Expose Codex app-server conversation controls in the dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2679",
      "rank": 516,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "conv-lookup skill: resolve transcripts for codex and pi harness conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2662",
      "rank": 517,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add project context-menu actions scoped to issues currently in the pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2645",
      "rank": 518,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add opt-in Observation-first conversation view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2635",
      "rank": 519,
      "size": "XS",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "pay down the 152-error src/dashboard/server typecheck debt",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2630",
      "rank": 520,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan binary not on PATH for operator shells or spawned work agents; pan doctor can't be run to diagnose it",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2629",
      "rank": 521,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start kickoff delivery never lands: \"Claude Code did not become ready within 30s\" (both attempts), agent sits idle at empty prompt",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2628",
      "rank": 522,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close aborts at close-issue:transition: \"No tracker available and cannot determine issue type\" for GitHub-tracker project",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2622",
      "rank": 523,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "cloister.toml materializes ALL defaults into the user file",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2600",
      "rank": 524,
      "size": "XS",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Retire the Codex TUI path after app-server burn-in (no-loss audit gate)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2533",
      "rank": 525,
      "size": "XS",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT workspace magic-link login 502: Traefik picks unreachable panopticon IP for multi-homed fe/api",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2527",
      "rank": 526,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness selector should restrict OpenAI models to Claude Code only",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2514",
      "rank": 527,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Claude Code Traffic Inspector",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2507",
      "rank": 528,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Preemptive pipeline scheduler: yield idle work agents to unblock review/test/merge dispatch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2505",
      "rank": 529,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "lint:circular reports new frontend cycles + stale baseline in chat/conversations components",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2504",
      "rank": 530,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-relaunch npx @overdeck/core under a compatible Node 22+ instead of failing on old Node",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2449",
      "rank": 531,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "start-planning: GITHUB_REPOS env shadows projects.yaml github_repo; unknown IDs fall through to Linear and plan the wrong issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2424",
      "rank": 532,
      "size": "L",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic: the Order Book",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2406",
      "rank": 533,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "close-out gaps: verify-merged rejects record-only deltas; slot/suffixed worktrees never torn down; teardown abort fires after worktree …",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2394",
      "rank": 534,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Incident: conv-* agent-dir cleanup destroyed ohmypi/codex conversation transcripts (\"no saved history\")",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2390",
      "rank": 535,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "systemd-oomd killed overdeck-tmux-server.service (all 55 agent processes) under host memory pressure",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2356",
      "rank": 536,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P3: relay service",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2355",
      "rank": 537,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P2: mobile PWA (Needs-You feed, conversation view, pipeline board, Web Push)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2354",
      "rank": 538,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1c: needs-you push notification bridge (ntfy first, Web Push later)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2352",
      "rank": 539,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel + Access",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2353",
      "rank": 540,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1b: Hermes external-agent bridge (scoped API + Fly 6PN)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2282",
      "rank": 541,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view shows no history for ohmypi-harness conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2091",
      "rank": 542,
      "size": "XS",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "delete dead IssueCockpitBody cockpit subtree (8 files, superseded by IssueMissionControl)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2085",
      "rank": 543,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-isolate conversations in a lightweight git worktree (Conductor-style workspaces)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2084",
      "rank": 544,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-create lightweight conversation worktrees on project chats",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2083",
      "rank": 545,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer: a failed first send leaves the text in BOTH the composer box and the retry outbox",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2082",
      "rank": 546,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer: a single send failure clears ALL in-flight optimistic bubbles (and strips siblings' compaction net)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2074",
      "rank": 547,
      "size": "XS",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "research: evaluate ponytail (DietrichGebert/ponytail) for prompt compression and consider building in-house",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2046",
      "rank": 548,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view does not surface terminal command responses",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2006",
      "rank": 549,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Run definition",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2005",
      "rank": 550,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog Sequencer: Pickup Forecast",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2002",
      "rank": 551,
      "size": "XS",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "[HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1999",
      "rank": 552,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1986",
      "rank": 553,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1983",
      "rank": 554,
      "size": "L",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1980",
      "rank": 555,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1958",
      "rank": 556,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1949",
      "rank": 557,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all item verdicts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1914",
      "rank": 558,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up: move /api/health/agents off agent-directory scans",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1907",
      "rank": 559,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-selectable + validate every…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1895",
      "rank": 560,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spawn work agents from issue workspace slide-out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1878",
      "rank": 561,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1782",
      "rank": 562,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Handoff forks stall at \"Injecting…\" then die on double 300s summary timeout",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1773",
      "rank": 563,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1758",
      "rank": 564,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Watch: ready-for-merge work must converge despite a continuously moving main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1696",
      "rank": 545,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge train becomes per-project",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1646",
      "rank": 566,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rabbit-hole drift detection and lift-to-new-conversation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1643",
      "rank": 567,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1641",
      "rank": 568,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Run agents on local GPU models via a managed Ollama sidecar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1592",
      "rank": 569,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer: make ephemeral composer state reload-durable (pasted images + unsent/failed message text)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1581",
      "rank": 570,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled across project+user sync",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1552",
      "rank": 571,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1533",
      "rank": 572,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fork-into-worktree from conversation branch chip",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1483",
      "rank": 573,
      "size": "XS",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Distinguish general-use skills from Panopticon-only dev skills in pan sync",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1482",
      "rank": 574,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Token spend report should aggregate data from repo, not just local machine",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1481",
      "rank": 575,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add cost-event telemetry for Caveman token savings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1356",
      "rank": 576,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Extend the memory Observation pipeline to ad-hoc conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1242",
      "rank": 577,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Create a new issue directly from a kanban column",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1222",
      "rank": 578,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project-templated DB lifecycle: auxiliary databases + seed refresh from prod",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1208",
      "rank": 579,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Polyrepo: support non-feature 'main' workspaces alongside feature-*",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1166",
      "rank": 580,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-introduce /ws/terminal auth gate with a working bootstrap path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1153",
      "rank": 581,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1152",
      "rank": 582,
      "size": "XS",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remove PANOPTICON_DEV env-var persistence",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1136",
      "rank": 583,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1135",
      "rank": 584,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Document the hook system in docs/HOOKS.md",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1133",
      "rank": 585,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR: deacon supervision + pan doctor check + GC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1124",
      "rank": 586,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Decouple specs and PRDs from workspaces",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1123",
      "rank": 587,
      "size": "XS",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Channels delivery: surface failures, add fallback toggle, route conversations through channels",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1121",
      "rank": 588,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1117",
      "rank": 589,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory: pinned docs (long-form doc chunking + retrieval)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1116",
      "rank": 590,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory: cross-project search mode",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1065",
      "rank": 591,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Validate issueId at every shell-string interpolation site (defense in depth)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1064",
      "rank": 592,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harden launcher generation against shell-quote injection (model and arg quoting)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1063",
      "rank": 593,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1049",
      "rank": 594,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Spike: evaluate Tauri v2 desktop shell",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-984",
      "rank": 595,
      "size": "XS",
      "importance": "low",
      "score": 19,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Evaluate context-mode MCP server as session continuity + search layer",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-962",
      "rank": 596,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-PAN-946: vBRIEF lifecycle follow-up plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-961",
      "rank": 597,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Update documentation for vBRIEF v0.6 lifecycle model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-944",
      "rank": 598,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Make vBRIEF the durable task graph source of truth",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-943",
      "rank": 599,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add memory file review and management command",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-908",
      "rank": 600,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-908: Make work-agent spawn limits configurable and overridable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-898",
      "rank": 601,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard polling and WebSocket efficiency: remaining audit findings",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-853",
      "rank": 602,
      "size": "L",
      "importance": "low",
      "score": 19,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-833",
      "rank": 603,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-832",
      "rank": 604,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActivity",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-810",
      "rank": 605,
      "size": "XS",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspector: diagnostic UI when pipeline phase is unknown",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-797",
      "rank": 606,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-793",
      "rank": 607,
      "size": "XS",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-791",
      "rank": 608,
      "size": "XS",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-790",
      "rank": 609,
      "size": "L",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-789: Eliminate remaining TanStack Query polling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-786",
      "rank": 610,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post planning Q\\&A answers as issue comment",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-777",
      "rank": 611,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inter-agent communication skill: send messages to conversation-mode agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-775",
      "rank": 612,
      "size": "L",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Redesign workspace inspector panel: sidebar layout is cramped and wrong",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-774",
      "rank": 613,
      "size": "XS",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unify launch UX and release pipeline for 1.0",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-773",
      "rank": 614,
      "size": "XS",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Design prompt-style overlays with model hierarchy and scoped toggles",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-772",
      "rank": 615,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unify terminal stack behavior across tmux sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-771",
      "rank": 616,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Investigate Vercel Sandbox execution backend support",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-769",
      "rank": 617,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Track verification/review/test phase churn over time",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-765",
      "rank": 618,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Preserve trailing zeros in cost displays",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-764",
      "rank": 619,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add quota/usage inspector for routed model providers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-762",
      "rank": 620,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: warn when model overrides target disabled providers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-752",
      "rank": 621,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-751",
      "rank": 622,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Historical Metrics Data Persistence",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-750",
      "rank": 623,
      "size": "L",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Complete Metrics Page Redesign",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-749",
      "rank": 624,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Research and borrow best features from gstack",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-747",
      "rank": 625,
      "size": "XS",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation list items lack accessible labels in accessibility tree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-743",
      "rank": 626,
      "size": "XS",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add consistent new conversation icon actions in Command Deck",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-738",
      "rank": 627,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add right-click fork option to conversation list",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-735",
      "rank": 628,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings page: review and configure overridden subagent model files",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-730",
      "rank": 629,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add provider account telemetry for credits, balances, and usage",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-702",
      "rank": 630,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "OpenAI provider: add plan/subscription support and fix unregistered model resolution",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-701",
      "rank": 631,
      "size": "XS",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Quick-Create conversation via keystroke using Conversations-page default model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-663",
      "rank": 632,
      "size": "XS",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-660",
      "rank": 633,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-658",
      "rank": 634,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-624",
      "rank": 635,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Loop nodes: iterative agent execution with conditional termination",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-623",
      "rank": 636,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-622",
      "rank": 637,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "YAML workflow DAGs: custom per-project pipeline definitions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-604",
      "rank": 638,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hide planning agent from workspace detail pane",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-603",
      "rank": 639,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Plan review loop with configurable reviewer model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-591",
      "rank": 640,
      "size": "XS",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-589",
      "rank": 641,
      "size": "XS",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review and update commands-skills.md with all available Panopticon skills",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-576",
      "rank": 642,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Global / search should include conversations in addition to workspace features",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-571",
      "rank": 643,
      "size": "XS",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add OpenRouter credits/plan status endpoint and UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-568",
      "rank": 644,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Kanban: Show workspace and tmux session counts in stats",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-565",
      "rank": 645,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Handle CTRL-Z to undo accidental conversation archival",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-564",
      "rank": 646,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Slash menu positioned incorrectly",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-554",
      "rank": 647,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add kanban board deeplinks for issue URLs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-543",
      "rank": 648,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add confirmation dialog before applying Optimal Defaults",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-483",
      "rank": 649,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unify Resume Agent UX",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-480",
      "rank": 650,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pass --effort flag when spawning planning agents via Cloister",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-476",
      "rank": 651,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent resume with Haiku session summary instead of claude --resume",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-468",
      "rank": 652,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent test conversations pollute production database",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-461",
      "rank": 653,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deep-wipe multi-step progress dialog",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-459",
      "rank": 654,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning setup screen with SSE progress streaming",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-407",
      "rank": 655,
      "size": "XS",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Run Panopticon from a main workspace for development isolation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-299",
      "rank": 656,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "stale",
      "dependsOn": [],
      "why": "Granular session state persistence across context compaction",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-298",
      "rank": 657,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "stale",
      "dependsOn": [],
      "why": "Auto-detect package manager and runtime in workspace setup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-297",
      "rank": 658,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Workspace templates: pre/post tool hooks for auto-format, typecheck, lint",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-283",
      "rank": 659,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Reset should sync workspace feature branch with latest main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-271",
      "rank": 660,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Auto-assign Linear project from project config when creating issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-265",
      "rank": 661,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Review skill categorization: all skills available everywhere via personal + workspace",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-249",
      "rank": 662,
      "size": "XS",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add data-testid attributes across dashboard UI and create Playwright smoke test suite",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-241",
      "rank": 663,
      "size": "L",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Mobile redesign initiative: full UX/UI overhaul + implementation plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-228",
      "rank": 664,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Shift-left post-edit diagnostics",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-227",
      "rank": 665,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Phase gate validation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-198",
      "rank": 666,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Structured audit trail for agent actions",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-190",
      "rank": 667,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-190: Specialized reviewer prompts (industry best-practice checklists)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-180",
      "rank": 668,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-180: Cross-terminal file locking for concurrent agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-177",
      "rank": 669,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-177: Iteration limits with escalation for autonomous agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-175",
      "rank": 670,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-175: Pre-compact auto-save hook for agent sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-155",
      "rank": 671,
      "size": "L",
      "importance": "low",
      "score": 11,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-155: Redesign health page with Stitch (system overview, timeline, costs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-146",
      "rank": 672,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-146: Refine light mode theming across all dashboard pages",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-55",
      "rank": 673,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "stale",
      "dependsOn": [],
      "why": "Track specialist costs with time period filtering",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-52",
      "rank": 674,
      "size": "XS",
      "importance": "low",
      "score": 11,
      "condition": "stale",
      "dependsOn": [],
      "why": "Guidance needed: Running complex multi-container projects with Panopticon worktrees",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-51",
      "rank": 675,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "stale",
      "dependsOn": [],
      "why": "Documentation: Clarify issue tracker options beyond Linear",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-47",
      "rank": 676,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "stale",
      "dependsOn": [],
      "why": "PRD files should be committed to feature branch, moved to completed/ on merge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-44",
      "rank": 677,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "stale",
      "dependsOn": [],
      "why": "Planning should fetch ALL issue context: comments, attachments, linked issues, discussions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-43",
      "rank": 678,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add Slack and email notifications for agent events",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2348",
      "rank": 679,
      "size": "XS",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: migrate STATE-STORAGE-AUDIT.md content to living docs, then delete",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2347",
      "rank": 680,
      "size": "XS",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh AGENT-STATE-PLANES.md",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2346",
      "rank": 681,
      "size": "XS",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh AGENT_TYPES_INDEX.md",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2345",
      "rank": 682,
      "size": "XS",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh pan-done.md",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2344",
      "rank": 683,
      "size": "XS",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh KANBAN-MODEL.md",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2343",
      "rank": 684,
      "size": "XS",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh MISSION-CONTROL.md",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2073",
      "rank": 685,
      "size": "XS",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Desktop App",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2071",
      "rank": 686,
      "size": "XS",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Hooks system",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2070",
      "rank": 687,
      "size": "XS",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Flywheel orchestrator",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2068",
      "rank": 688,
      "size": "XS",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for Caveman (agent output compression)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2067",
      "rank": 689,
      "size": "XS",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for RTK (Bash output compression)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1684",
      "rank": 690,
      "size": "XS",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1683",
      "rank": 691,
      "size": "XS",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1474",
      "rank": 692,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add ACKNOWLEDGEMENTS doc",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1469",
      "rank": 693,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "End-to-end review and consolidation of all project documentation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-674",
      "rank": 694,
      "size": "XS",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add glossary of Panopticon domain terms",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-634",
      "rank": 695,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-633",
      "rank": 696,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Update Cloister PRD and docs index",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2908",
      "rank": 697,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Make overdeck not suck",
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
      "from": "PAN-2075",
      "to": "PAN-1775",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2075",
      "to": "PAN-454",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2075",
      "to": "PAN-1436",
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
      "to": "PAN-1042",
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
      "to": "PAN-106",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2642",
      "to": "PAN-2079",
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
      "from": "PAN-1775",
      "to": "PAN-2077",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2077",
      "to": "PAN-2078",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2077",
      "to": "PAN-2079",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2079",
      "to": "PAN-2080",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2077",
      "to": "PAN-454",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2466",
      "to": "PAN-1868",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2642",
      "to": "PAN-570",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2828",
      "to": "PAN-2874",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2828",
      "to": "PAN-2883",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2742",
      "to": "PAN-2746",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2695",
      "to": "PAN-2746",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2337",
      "to": "PAN-2932",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2337",
      "to": "PAN-2422",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2337",
      "to": "PAN-2957",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-1936",
      "to": "PAN-2008",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-1936",
      "to": "PAN-1988",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-1936",
      "to": "PAN-1910",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2882",
      "to": "PAN-2954",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2259",
      "to": "PAN-2880",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2846",
      "to": "PAN-2888",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2331",
      "to": "PAN-2639",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2189",
      "to": "PAN-2190",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-1936",
      "to": "PAN-1988",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2905",
      "to": "PAN-2259",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2075",
      "to": "PAN-2642",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-1696",
      "to": "PAN-3093",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2976",
      "to": "PAN-2977",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2976",
      "to": "PAN-2978",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-3054",
      "to": "PAN-3061",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2828",
      "to": "PAN-2995",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2982",
      "to": "PAN-2983",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-2976",
      "to": "PAN-2566",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.7
    },
    {
      "from": "PAN-2565",
      "to": "PAN-2566",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2997",
      "to": "PAN-3043",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-3100",
      "to": "PAN-3104",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.85
    },
    {
      "from": "PAN-3062",
      "to": "PAN-3056",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3062",
      "to": "PAN-2980",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3049",
      "to": "PAN-3050",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3049",
      "to": "PAN-3032",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2423",
      "to": "PAN-3032",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-2547",
      "to": "PAN-3099",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-2489",
      "to": "PAN-3034",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2649",
      "to": "PAN-2981",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2966",
      "to": "PAN-3096",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-2945",
      "to": "PAN-3096",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2952",
      "to": "PAN-3092",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-2706",
      "to": "PAN-3084",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2848",
      "to": "PAN-3078",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-2700",
      "to": "PAN-3104",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-2738",
      "to": "PAN-3081",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2828",
      "to": "PAN-3047",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-2817",
      "to": "PAN-3057",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.65
    },
    {
      "from": "PAN-2888",
      "to": "PAN-3044",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.65
    },
    {
      "from": "PAN-3015",
      "to": "PAN-2668",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3106",
      "to": "PAN-3093",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.65
    }
  ]
}
```
