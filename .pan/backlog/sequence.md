# Backlog Sequence

_Last sequenced: 2026-11-24T06:56:05Z · model: claude-opus-5-5 · open: 958_


| rank | issue | size | importance | condition | epic | depends-on | why |
|------|-------|------|------------|-----------|------|------------|-----|
| 1 | PAN-5637 | S | critical | ok |  |  | In pipeline. Merge train never admits polyrepo issues touching CI-less member repos; add ci: none per repo so MYN infra/docs MRs merge |
| 1 | PAN-5638 | M | critical | ok |  |  | In pipeline. Polyrepo review verdicts refuse GitHub member PRs and the ready set ignores verdict markers; MIN-1142 can't merge |
| 1 | PAN-5654 | S | high | ok |  |  | In pipeline. mobile-android CI goes red on non-mobile PRs when Robolectric android-all download fails; cache the jar. |
| 1 | PAN-5657 | S | high | ok |  |  | In pipeline. 7 CodeRabbit findings on merged PAN-5652; 2 Major: failed pane listing reads as pane-dead, legacy tmux agents read as gone. |
| 2 | PAN-5652 | M | critical | ok |  |  | Herdr agents fail tmux has-session checks, so polyrepo merge aborts on live agents (MIN-1144). Merge routes: TENET-10 handoff. |
| 3 | PAN-5013 | S | critical | ok |  |  | Liveness, parked route and read-model map a Herdr 'done' pane to stopped; finished-turn agents look dead and may be respawned. |
| 4 | PAN-5430 | S | medium | ok |  |  | Markdown Preview prints raw HTML (README logo <div>/<picture>) as text; render it via rehype-raw + rehype-sanitize in doc previews. |
| 5 | PAN-5567 | S | high | ok |  |  | Codex app-server threads hardcode on-request/workspace-write, so Read-only and Full access settings never apply. |
| 6 | PAN-5489 | S | high | ok |  |  | pan plan from an agent shell fails workspace creation without HUME_API_KEY, leaves a half-built workspace and hides the cause. |
| 7 | PAN-5566 | M | high | ok |  |  | UI/help text says Auto blocks destructive calls but the hook approves all; repo .pan.yaml can set bypass mode. |
| 8 | PAN-5385 | S | critical | ok |  |  | Anywhere remote access is down for trickle clients: machine drops ICE candidates sent before session registers; small server fix |
| 9 | PAN-5633 | M | high | ok |  |  | Codex app-server auth burn never flags: banner silent, conv shows isWorking while 578 turns fail over 14h. Detect turn errors. |
| 10 | PAN-4636 | S | critical | ok |  |  | Adopted outside PRs fail verification on the missing xBRIEF and the failure reaches nobody; stalls PAN-4630's PR silently. |
| 10 | PAN-5523 | S | high | ok |  |  | pan conversations move/heal send raw fetch with no token, so routes refuse with Missing origin; same fix pattern as in-pipeline PAN-5516. |
| 10 | PAN-5625 | M | critical | ok |  |  | Approved green PR for new standalone project BT-1 sits 'held'; train never batches and per-PR scheduler defers forever. |
| 10 | PAN-5641 | M | critical | ok |  | PAN-5637, PAN-5638 | Polyrepo UAT batch promote and train board read one PR from the non-git root, so no MYN batch can land; walk member repos. |
| 11 | PAN-4553 | S | critical | ok |  |  | Duplicate of PAN-4929, now in review as PR #4963; close PAN-4553 when that PR merges. |
| 11 | PAN-5640 | S | high | needs-refinement |  | PAN-5637 | Overlaps PAN-5641 (derived state reads MRs at non-git polyrepo root); unique part: glab MR list omits head_pipeline, never green. |
| 12 | PAN-4733 | M | high | ok |  |  | Follow-up to closed PAN-4732: root-cause the title-bar spec, move 4 browser specs to a gating test-e2e lane, un-quarantine it. |
| 13 | PAN-4710 | S | high | ok |  |  | Deferred plan hand-off retries omit the guardrail ack, so they're refused at 'agent count high' and give up silently; needs handoff |
| 14 | PAN-4554 | S | high | ok |  |  | pan start --plan auto finalizes planning but never spawns the work agent; re-test now that likely root cause PAN-5526 merged. |
| 14 | PAN-5527 | M | high | needs-refinement |  |  | Overlaps merged PAN-5526 (consent field, unread marker); unique part is resuming a promotion interrupted by a dashboard death. |
| 14 | PAN-5529 | M | high | ok |  |  | Auto-start hand-off still strands: orphaned consent claims, queued container starts lost on restart, read errors read as revoked. |
| 15 | PAN-4666 | S | critical | ok |  |  | Flywheel status drops live agents whose Herdr pane says 'done'; loop may respawn them. Route via liveness.ts. Needs handoff. |
| 16 | PAN-4547 | M | high | ok |  |  | Restore automatic close-out for verifying-on-main issues whose DoD fully passes; close_out.auto inert since PAN-3917 |
| 17 | PAN-4511 | S | high | ok |  |  | pan spawn starts its worker pane with argv '--model <m>' and no harness binary, so foreman item workers never launch |
| 18 | PAN-5447 | M | high | ok |  |  | Palette search stalls 15s+: sync 5 GB sqlite-vec scan on the event loop; aborted searches keep running and stall /api/version |
| 19 | PAN-5381 | S | high | ok |  |  | Dashboard main thread: findProjectByPath runs realpathSync on every project root per call (10.8% of profile); cache roots once. |
| 20 | PAN-4544 | S | high | ok |  |  | /api/costs/stream blocks the event loop ~1.6 s per poll with a sync scan of a 386 MB events.jsonl |
| 21 | PAN-4551 | L | high | ok |  |  | Upgrade all Effect packages from 4.0.0-beta.73 to stable 4.0.0; run after the verification bundle merges. TENET-10: supervised |
| 22 | PAN-4671 | M | high | ok |  |  | CodeRabbit comments posted after the reviewer snapshot merge unseen; deliver late ones to the work agent at merge. Needs handoff. |
| 23 | PAN-4675 | S | critical | ok |  |  | One transient gh label timeout aborts post-merge lifecycle; merge door replies Already merged, so the issue can never close. |
| 24 | PAN-4705 | S | high | ok |  |  | quality-gate-admission test leaks a poller past afterEach rmSync; unhandled ENOENT fails unrelated PR CI shards. |
| 25 | PAN-4746 | S | high | ok |  |  | CI test shard flakes on ENOTEMPTY: afterEach rmSync races an unawaited snapshot write; reds unrelated PRs (seen on #4745). |
| 26 | PAN-5104 | XS | high | ok |  |  | Stale cost hook bundle prices Fable 5.1/5.2 at Fable 5 rates; reconciler never corrects it. Unblocked: PAN-5103 merged. |
| 27 | PAN-4572 | M | medium | ok |  |  | Residual re-render offenders PAN-4560 profiled but left: unmemoized deck rows, App 5 s poll, clock/selector identity bugs. |
| 28 | PAN-4586 | XS | critical | ok |  |  | Herdr pane.read nests text under result.read; every Overdeck pane-text reader gets '' — detection, inventory, resume all blind |
| 29 | PAN-4217 | S | critical | ok |  |  | vbrief-ac gate reads AC statuses nothing writes; plans with nested ACs fail verification and pan done with no verb to clear it |
| 30 | PAN-4219 | S | critical | needs-refinement |  |  | pan done refuses on unclosable AC sub-items; likely duplicate of PAN-4217 (same missing writer); fold into its fix. |
| 31 | PAN-4708 | M | high | needs-refinement |  |  | docs.json nav is a hot file: concurrent docs PRs conflict, each costing a merge-main and re-review. Pick a fix option first. |
| 32 | PAN-4229 | S | critical | needs-refinement |  | PAN-4217 | pan task done skips nested AC children, so pan done refuses at the end; third report of the PAN-4217 missing writer; fold into its fix. |
| 33 | PAN-3050 | S | high | ok |  |  | Reaper's full-stack tier never fires for any project: it JSON-parses Docker's label string, so compose project is always undefined. |
| 33 | PAN-3566 | XS | critical | ok |  |  | Test-role launcher execs claude with no user prompt, so the role boots an idle REPL — the deterministic producer of zombie test agents. |
| 33 | PAN-5537 | M | high | ok |  |  | Nothing emits review.approved, so the test role and browser UAT never run after review approval; re-emit it or retire the step. |
| 34 | PAN-3952 | S | critical | ok |  |  | Herdr sizes unviewed panes to 1 row: 10 of 13 work panes report nothing to pane read; every pane-text consumer is blind |
| 35 | PAN-3285 | M | critical | ok |  |  | A supervisor pinned to a reload generation SIGTERMs every healthy dashboard and cannot start one: 3.5h outage, 1107 silent failures. |
| 36 | PAN-3524 | M | critical | needs-refinement |  |  | A server-owned --changed verification loop relaunches through deacon freeze, review abort, pause and operator stop; peaked at 78 workers. |
| 37 | PAN-4166 | S | critical | ok |  |  | write-sequence replays every superseded sequence commit and dies on an old one, so the ranked order never reaches origin/main |
| 38 | PAN-3250 | S | critical | ok |  |  | Workspace spawn branches from local HEAD instead of origin/main, so every new feature branch inherits unpushed local-main commits. |
| 39 | PAN-3946 | S | critical | ok |  |  | Review request treats an APPROVED review on an older commit as "already passed"; newer commits ride an old approval |
| 39 | PAN-5632 | S | high | ok |  |  | Verification calls a target-branch merge with extra edits synced, so a pass is adopted for unverified edits; compare merge-tree. |
| 40 | PAN-2954 | XS | critical | ok |  |  | postMergeLifecycle refuses GitLab projects |
| 41 | PAN-3935 | S | critical | ok |  |  | PRD draft promotion writes the draft into the primary main checkout and deletes the feature-branch copy; PRDs are stranded untracked |
| 42 | PAN-3657 | S | critical | ok |  |  | Merge-train queues endpoint runs the monorepo queue builder for polyrepo projects, so MYN/Auricle trains are permanently empty. |
| 44 | PAN-4240 | S | critical | ok |  |  | Reaper rm -rf's workspaces of closed issues: unmerged polyrepo branches, and (Nov 4) untracked evidence after a merged MR. |
| 45 | PAN-3565 | M | critical | ok |  |  | Failed review spawn wedges 'starting', and an all-lanes infra failure is synthesized as a real CHANGES REQUESTED verdict. |
| 46 | PAN-3554 | M | critical | needs-refinement |  |  | Red main has no mechanical owner: it hid for ~5h because the merge gate renders red main as an empty queue, not an alarm. |
| 47 | PAN-3532 | S | critical | ok |  |  | CI runs only a hand-picked slice of the frontend suite, so main stayed red on frontend for hours while every run reported green. |
| 48 | PAN-4241 | XS | high | ok |  |  | computeWorkspaceRepoRoots joins an absolute repoPath, so polyrepo repos named unlike their path (fe/frontend) are skipped by pan task done. |
| 49 | PAN-5167 | S | critical | ok |  |  | Post-merge lifecycle refuses forever on one transient GitHub fetch failure; agent stays running and close-out is blocked. |
| 50 | PAN-4396 | XS | critical | ok |  |  | test-skip gate fails closed on any branch diff over 1 MiB (execFile default maxBuffer); one-line fix unblocks big PRs |
| 51 | PAN-3085 | XS | critical | needs-refinement |  |  | Review feedback is written to .overdeck/feedback but agents and the deacon merge gate are pointed at a nonexistent .pan/feedback. |
| 52 | PAN-3653 | M | critical | ok |  |  | A strike blocked on red main has no owner that wakes it when main goes green; the session stays alive so recover refuses it. |
| 53 | PAN-3630 | M | critical | ok |  |  | pan tell reported three deliveries to a live agent, moved all three to read/, and the agent received none — the delivery door lies. |
| 54 | PAN-3805 | S | critical | needs-refinement |  |  | Codex idle poke spawns codex exec instead of the app-server door; failed sends still tick the counter and pause healthy agents |
| 55 | PAN-5139 | M | critical | ok |  |  | pan reload refuses both generations when the pan shim points at the non-live generation; deploys stall. |
| 56 | PAN-3560 | M | critical | ok |  |  | PTY supervisor overloads under concurrent review convoys; fleet-wide 502 'input echo confirmation failed' kills resumes and feedback. |
| 57 | PAN-3520 | S | critical | ok |  |  | Test gate records 'failed' for load-induced timeouts; retry timeout-only failures in isolation before writing a verdict. |
| 58 | PAN-4439 | S | high | ok |  |  | CI relay has no backstop for webhooks missed during pan reload; red test jobs never reach the agent, PRs stall |
| 59 | PAN-4392 | XS | high | ok |  |  | pan task done accepts an Item: trailer from another issue's merged commit (history-wide grep); gate passes with no evidence |
| 60 | PAN-3500 | S | critical | ok |  |  | A review sub-role edited seven tracked files after writing its report and the changes were auto-committed into the feature history. |
| 61 | PAN-3313 | S | critical | ok |  |  | A transient upstream stream error benches CLIProxy's only auth: ~70% of GPT-routed inference 503s with a message that blames credentials. |
| 62 | PAN-3282 | M | critical | ok |  |  | Review agents die before writing a verdict across 5 issues and 2 projects, leaving a verdict-shaped status with no artifact behind it. |
| 63 | PAN-4391 | S | high | ok |  |  | pan worker run fails in polyrepo workspaces because the root is not a git repo; delegation is broken for MYN |
| 64 | PAN-4390 | S | high | ok |  |  | Polyrepo workspace create runs npm install in the project's parent dir, reports failure and hides the workspace from list |
| 65 | PAN-2695 | S | high | ok |  |  | Concurrent review dispatches race fresh-spawn vs resume |
| 66 | PAN-2742 | S | high | ok |  |  | synthesis fires 42s after spawn and reports reviewers with reports on disk as 'infrastructure failure' |
| 67 | PAN-2706 | M | high | needs-refinement |  |  | Ghost test sessions absorb every test dispatch |
| 68 | PAN-5228 | S | high | ok |  |  | Advisory CodeRabbit journal entries land last and hide stalled reviews from recoverStalledReviews and other last-entry readers. |
| 69 | PAN-4344 | S | high | ok |  |  | Registered projects lack the agent main-push guard; ship a pre-push hook so agents cannot push to main outside overdeck |
| 69 | PAN-5661 | S | high | ok |  |  | Issue panel says 'Nothing needs you yet' while the Flywheel holds the issue as needs-you; read needsYouIssueIds in StatusNarrative. |
| 70 | PAN-4550 | XS | medium | ok |  |  | Two unit tests read host state (DASHSCOPE_BASE_URL, git-ignored .map files), so pan release check reports false reds locally |
| 71 | PAN-4566 | S | high | ok |  |  | A failed replayEvents leaves the coordinator un-bootstrapped; tab defers live events with no banner. PAN-4559 fallback has landed. |
| 71 | PAN-5653 | S | high | ok |  |  | 3 CodeRabbit findings on merged PAN-5648; 2 Major: stack lock does not fence a stale holder, file-lock release can delete a new lock. |
| 72 | PAN-5193 | XS | high | ok |  |  | PRD-first gate reads a short main stub before the full workspace draft and refuses finalize for epic children. |
| 73 | PAN-2940 | M | critical | ok |  |  | Three red-mains in one day from direct-push series bypassing PR CI |
| 74 | PAN-3708 | M | critical | ok |  |  | pan strike dies at git worktree list on a polyrepo wrapper — the urgent-strike escape hatch is unavailable for MYN-class projects. |
| 75 | PAN-3605 | XS | high | ok |  |  | Supply chain: lint-effect-diagnostics npx fell back to the registry and ran a squatted unscoped package; pin the scoped local bin. |
| 76 | PAN-5133 | M | high | ok |  |  | pan pause cannot hold a planned issue whose deferred work-agent start is retried; no operator door to stop it. |
| 77 | PAN-4792 | S | high | ok |  |  | Paste guard only knows numbered menus; a failed paste presses Enter into unnumbered selects, silently setting defaultMode=auto. |
| 78 | PAN-3557 | S | critical | ok |  |  | Post-merge label writes have no retry; a 403 hides a merged issue from the verify-on-main sweep while lifecycle reports success. |
| 79 | PAN-3543 | S | critical | ok |  |  | Completed-handoff agents are unstartable: start, --fresh and reset-session all refuse while the refusal itself recommends --fresh. |
| 80 | PAN-3522 | S | critical | ok |  |  | Supervisor watchdog restart-churns under CPU storm because the probe timeout budget ignores the boot warm phase. |
| 81 | PAN-3314 | M | critical | ok |  |  | One cgroup holds every agent pane, so a single hungry agent inflates the unit and oomd kills the whole fleet — twice now. |
| 82 | PAN-3278 | S | critical | needs-refinement |  |  | A finished work agent with an open PR sat two hours because review was never dispatched and auto-requeue fired none of 25 attempts. |
| 83 | PAN-5636 | S | medium | ok |  | PAN-5633 | UI follow-up to PAN-5633: row state word and composer notice (with Hand off) for failed Codex turns; needs 5633's providerError.kind. |
| 84 | PAN-3234 | S | critical | needs-refinement |  |  | Agents freeze indefinitely on blocking choice menus and no health surface notices; the detector is wired only to delivery refusal. |
| 84 | PAN-5467 | XL | high | ok | ✓ |  | Epic: docs overhaul, 16 page issues, 6 accuracy audits (PAN-5499..5504) and an intro rewrite (PAN-5505); order book drives pickup. |
| 84 | PAN-5642 | M | medium | ok |  |  | Plan-action endpoints accept approval without matching toolUseId; a stale dialog can approve a plan the operator never reviewed. |
| 85 | PAN-3205 | S | critical | ok |  |  | The deployment gate promises the queued deploy will fire at the next verification boundary; that trigger does not exist. |
| 86 | PAN-3118 | S | critical | needs-refinement |  |  | Model-specific quota exhaustion is invisible everywhere but the pane: four planning agents read 'running' at $0.00 with no fallback. |
| 87 | PAN-3106 | S | critical | ok |  |  | auto_merge_default: hold is consulted on one merge path only, so held issues merge individually and defeat the UAT train. |
| 88 | PAN-3100 | S | critical | ok |  |  | The test role evaluates the dirty working tree, so a live work agent's uncommitted edits are recorded as the issue's test failure. |
| 89 | PAN-4213 | M | high | ok |  |  | Merge-train follow-ups from #4066 (merged): stamp-vs-pin mismatch, reset --keep can strand agent commits, fetch retry, tests |
| 90 | PAN-5263 | M | high | ok |  |  | Pipeline membership sees zero open overdeck issues: the App token lacks issues permission and the gh fallback never runs. |
| 91 | PAN-3096 | S | critical | ok |  |  | pan done blocks on generated .devcontainer/ and dev, and agents resolve it by deleting workspace infrastructure or inventing gitignores. |
| 92 | PAN-3084 | S | critical | needs-refinement |  |  | A review session spawned but never briefed sits at zero context forever, and restart 'preserves' the zombie that blocks its replacement. |
| 93 | PAN-3043 | S | critical | needs-refinement |  |  | Provider health is probed only at spawn, so a mid-run 403 quota refusal leaves an agent 'running' for days holding a slot. |
| 94 | PAN-1824 | S | high | ok |  |  | Fix flaky main CI: fake timers + @slow exclusion for real-timer test family |
| 95 | PAN-2932 | S | high | ok |  | PAN-2337 | intermittent dashboard boot wedge between Cloister start and ReadModel bootstrap leaves :3011 unbound (Bad Gateway) after pan reload |
| 96 | PAN-2935 | S | critical | ok |  |  | Workspace devcontainer duplicate backend hijacks Traefik router |
| 97 | PAN-2337 | XS | critical | ok |  |  | Reload/build atomicity: an in-place `npm run build` under a live dashboard breaks new PTY-supervisor spawns until restart |
| 98 | PAN-2422 | XS | high | ok |  | PAN-2337 | rebuilding dist under a live server breaks lazy chunk imports |
| 99 | PAN-2699 | XS | high | ok |  |  | npm run build regenerates the committed record-cost-event.js bundle |
| 100 | PAN-2957 | XS | high | ok |  | PAN-2337 | npm run build intermittently produces stale frontend bundles |
| 101 | PAN-2850 | M | high | ok |  |  | npm test fails in clean checkout after pretest removes dashboard bundle |
| 102 | PAN-2758 | S | critical | needs-refinement |  |  | Provider capacity error silently zombies a spawned agent: willRetry=false, turn reported completed, state stays status=running forever |
| 103 | PAN-2817 | M | high | needs-refinement |  |  | Idle-at-prompt work/review agents are never redriven: gpt-5.6-sol sessions stop at the composer mid-task and sit for hours |
| 104 | PAN-2813 | M | high | ok |  |  | Scheduler yield never self-clears: yielded work agents stay paused after the blocking review completes/merges |
| 105 | PAN-2668 | M | high | ok |  |  | Verification/review feedback silently queued to stopped-by-user agents |
| 106 | PAN-2569 | XS | critical | ok |  |  | planning finalizes (issue→planned) but work agent does not auto-spawn |
| 107 | PAN-4269 | M | high | ok |  |  | macOS conversations hang on 'Working…'/'waiting for transcript'; governor ruled out, root cause unknown (delivery or transcript find). |
| 108 | PAN-3811 | M | high | ok |  |  | The PAN-3809 emergency strike prunes BuildKit unconditionally; inventory, bounded reclaim door and retention floor are still missing |
| 109 | PAN-2179 | S | high | needs-refinement |  |  | relaunch can leave a zombie agent |
| 110 | PAN-2169 | S | high | needs-refinement |  |  | kimi agent silently frozen at 100% ctx (no thrown overflow error) not caught by CONTEXT_OVERFLOW_PATTERNS |
| 111 | PAN-2734 | S | high | ok |  |  | merge queue head-of-line zombie |
| 112 | PAN-3697 | XS | high | ok |  |  | Deployed dashboard PATH omits Bun, so verification workers hit 'bun: not found' before the required install gate. |
| 113 | PAN-3633 | S | high | ok |  |  | Strike workspaces spawn without @types, so the contract's own typecheck gate fails and agents abort reporting a false red main. |
| 114 | PAN-4420 | S | high | ok |  |  | npx @overdeck/core on native Windows serves 404 for every page: static root is built from a URL path |
| 114 | PAN-5543 | XS | high | ok |  |  | overdeck up treats the install script's ~/.local/bin/overdeck CLI bin as the desktop app, so up never starts the dashboard properly. |
| 115 | PAN-3099 | XS | critical | ok |  |  | --health-timeout 120 is enforced as 120ms and a false-failed check exits after killing the old server — nothing left listening. |
| 116 | PAN-4418 | S | high | ok |  |  | vault join fails on native Windows: core.autocrlf=true rewrites the VAULT-FORMAT marker; blocks Windows continue flow |
| 117 | PAN-3040 | S | critical | ok |  |  | pan strike is monorepo-shaped end to end and fails immediately on polyrepo projects; same defect as PAN-3708. |
| 118 | PAN-3023 | S | critical | ok |  |  | Post-planning auto-spawn logs 'attempt 1/3' and never retries after a transient Docker EOF, stranding the issue with no re-drive owner. |
| 119 | PAN-1618 | S | high | ok |  |  | Substrate: work-spawn docker-health gate has no autonomous recovery |
| 120 | PAN-3916 | M | high | ok |  |  | Session pointers go stale after rollover + crash recovery; issue view and pan tell confirmation track a dead transcript |
| 121 | PAN-3900 | S | high | ok |  |  | Docker bridge pool exhausted by orphaned workspace networks; pan start fails; bridge-pool patrol only warns |
| 122 | PAN-3793 | S | high | ok |  |  | resolveIssuePullRequestRef probes only feature/ and strike/ names, so close-out cannot find a merged PR on a descriptive branch |
| 123 | PAN-2639 | S | high | ok |  | PAN-2331 | codex-resume replays a rotated-out (revoked) refresh token → codex review convoys wedge with 401 |
| 124 | PAN-2331 | S | high | ok |  |  | codex rate-limit 'Switch to gpt-5.4-mini?' modal stalls autonomous agents (no auto-dismiss) |
| 125 | PAN-2333 | M | high | ok |  |  | feat: handle codex weekly-quota exhaustion gracefully |
| 126 | PAN-4184 | S | high | needs-refinement |  |  | --no-deacon on the host port is refused as a peer after the old server stops, so the escape hatch may leave no dashboard; fix unpicked |
| 127 | PAN-2511 | XS | high | ok |  |  | Work agents burn 20+ min on false test failures |
| 128 | PAN-2763 | S | high | ok |  |  | Workspace node_modules is symlinked to the primary repo, breaking test resolution |
| 128 | PAN-3579 | M | high | ok |  |  | Workspace page Pull/Run/Open and palette activate send no CSRF token, so they 403 now; ~20 more bare-header mutations at risk. |
| 129 | PAN-2170 | XS | high | ok |  |  | Docker init container lacks Python |
| 130 | PAN-1198 | S | high | ok |  |  | Workspace init container's bun install doesn't populate container-node-modules named volume |
| 131 | PAN-4453 | XS | high | ok |  |  | runtimes/codex.ts uses homedir() not OVERDECK_HOME; isolated homes write thread ids into the real ~/.overdeck |
| 132 | PAN-2106 | S | high | ok |  |  | pan strike workspace setup leaves broken partial workspace + false 'spawned' success (git-lock race) |
| 133 | PAN-2880 | M | high | ok |  | PAN-2259 | Linear tracker listIssues is a 3N+1 request storm |
| 134 | PAN-2966 | S | high | ok |  |  | Polyrepo wrapper .gitignore misses .pan/ .devcontainer/ dev |
| 135 | PAN-2945 | S | high | ok |  |  | pan done rejects Overdeck-generated runtime in polyrepo wrapper repos (.devcontainer/, dev, .pan/review) |
| 136 | PAN-2680 | M | high | ok |  |  | pan close: Docker teardown silently skips a running stack in multi-repo projects (MYN), aborting close-out |
| 137 | PAN-4419 | S | high | ok |  | PAN-4418 | pan vault resume cannot spawn claude on native Windows (ENOENT, needs shell/.cmd resolution); --no-launch works |
| 138 | PAN-3734 | S | high | ok |  |  | Completed swarm slot reuse can start a new item from a stale polyrepo branch — silent wrong-parent work. |
| 139 | PAN-3621 | M | high | ok |  |  | pan start intermittently dies resolving a chunk graph spliced across two builds — importer from primary dist, path in the live generation. |
| 140 | PAN-3555 | S | high | ok |  |  | pan start without --fresh silently abandoned an intact 7.5MB warm session, violating the warm-by-default contract. |
| 141 | PAN-3498 | S | high | ok |  |  | write-sequence pins in-pipeline ranks without renumbering, so the persisted sequence carries duplicate ranks and gaps. |
| 142 | PAN-3496 | XS | high | ok |  |  | A review convoy member blocked on an operator AskUserQuestion about review depth; review agents must decide and record, not ask. |
| 143 | PAN-3081 | S | high | ok |  |  | The agent git guard is PATH-based and an agent stripped it unprompted to get past a false block; a control the agent can remove isn't one. |
| 144 | PAN-2627 | S | high | ok |  |  | Linear poller is blind after cycle rollover |
| 145 | PAN-2324 | XS | high | ok |  |  | label transition fails atomically on missing 'in-planning' label |
| 146 | PAN-2165 | XS | high | ok |  |  | pan close: close-issue phase reports success but leaves issue OPEN / wrong labels (remove-label aborts on absent label; no-vBRIEF trans… |
| 147 | PAN-2905 | S | high | ok |  |  | Dashboard steady-state CPU ~50% keeps API responses at 0.5-1.5s |
| 148 | PAN-2259 | S | critical | ok |  |  | something burns the full 5k/hr GitHub GraphQL quota |
| 149 | PAN-2379 | S | high | ok |  |  | dependency install is warn-only + 60s timeout → false verify failures against empty node_modules (blocks swarm convergence) |
| 150 | PAN-2421 | XS | high | ok |  |  | dashboard server route tests flake under full-suite verification load |
| 151 | PAN-2430 | S | high | ok |  |  | frontend typecheck fails with dozens of pre-existing unused-local errors |
| 152 | PAN-2593 | S | high | ok |  |  | server children inherit bare system PATH |
| 153 | PAN-4302 | M | high | ok |  |  | ~19 files exec gh directly, bypassing runGh: spend is unattributed and keeps hitting GitHub during quota pause. Follow-up to PAN-4291 |
| 154 | PAN-2080 | M | high | needs-refinement |  |  | External transports (email/Slack/push/TTS) still plausible; its stated dependency on the PAN-2079 Inbox spine is undercut by boot… |
| 155 | PAN-5048 | M | high | ok |  |  | Needs-you drops an unanswered AskUserQuestion seconds after its phone push; the phone shows 'already answered' with no card. |
| 156 | PAN-1436 | S | high | ok |  |  | PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list |
| 157 | PAN-3556 | S | high | ok |  |  | No per-agent spawn mutex: two flows allocated session identities 3s apart and the second pin orphaned the first transcript. |
| 158 | PAN-3553 | S | high | ok |  |  | tmux list-panes -a exits 1 on a zero-session server, so the census reads unavailable post-reboot and conversations hang on 'Starting…'. |
| 159 | PAN-3535 | S | high | ok |  |  | The drain/resume hold is re-derived from the caller's env each boot, so any restart from a clean shell silently drops it. |
| 160 | PAN-3429 | M | high | ok |  |  | Memory governor defers admissions but sheds nothing under HARD pressure; concurrent heavy gate runs aren't in the shed ladder. |
| 161 | PAN-3397 | S | high | ok |  |  | Fresh convoy lanes freeze at 0 output before kickoff; PAN-3375's detector only covers warm resumes, so recovery is manual. |
| 162 | PAN-3325 | S | high | ok |  |  | A fresh workspace ships an empty-but-present node_modules, so tooling silently resolves the parent repo's deps and gates go false-green. |
| 163 | PAN-3317 | S | high | ok |  |  | Strike agents are told to rebase, the launcher guard blocks it, and pan sync-main can't resolve a -strike workspace. Overlaps PAN-3306. |
| 164 | PAN-3284 | S | high | ok |  |  | A workspace-confined agent wrote a doc edit into the primary main worktree — the PAN-2204 write-to-main hazard through a new door. |
| 165 | PAN-3270 | S | high | ok |  |  | New workspaces arrive with empty node_modules and bun off the agent shell PATH, so the documented bun install remedy fails. |
| 166 | PAN-4487 | XS | high | ok |  |  | cleanAgentState whitelist drops foreman, modelSpawnKey, workspaceId on every state.json write; add fields + round-trip test |
| 167 | PAN-3257 | S | high | ok |  |  | Crash-resume leaves a stale PTY socket and drops supervisorEnabled from state.json, so every supervisor delivery fails afterwards. |
| 168 | PAN-3129 | M | high | ok |  |  | No symlink/TOCTOU containment on canonical writes under agent-controlled paths; a planted symlink redirects a server-side write. |
| 169 | PAN-3120 | S | high | ok |  |  | A scheduler-yielded work agent makes operator MERGE hard-error on polyrepo and silently dead-end on single-repo. |
| 170 | PAN-4349 | S | high | ok |  |  | Agent-side GitHub reads prefer REST over GraphQL gh --json until PAN-4302 meters callers; protects the hourly quota |
| 171 | PAN-3062 | M | high | ok |  |  | The shared primary main worktree stacks several sessions' commits, so whoever pushes next ships everyone else's unverified work. |
| 172 | PAN-3048 | XS | high | needs-refinement |  |  | Pipeline auto-commit lands Overdeck's own .pan/drafts PRD into product feature branches; the exclusion list is duplicated and has drifted. |
| 173 | PAN-3032 | S | high | ok |  |  | Rebuild composes under overdeck-feature- while Traefik labels name myn-feature- devnet, and traefik attaches are runtime-only. |
| 174 | PAN-3833 | S | high | ok |  |  | Feed renders assistant text emitted after tool calls as collapsed thinking rows; operator believes the agent never answered |
| 175 | PAN-3902 | S | high | ok |  |  | Verification gates inherit OVERDECK_* env from the dashboard, so host boot state (e.g. OVERDECK_NO_RESUME) can red any branch |
| 176 | PAN-4629 | M | high | ok |  |  | Fresh npx machine cannot pan start: no gh auth token fallback for the GitHub tracker, and registration derives the wrong issue prefix. |
| 177 | PAN-3854 | S | high | ok |  |  | Feature-workspace devcontainer stack 403s on POST /api/dashboard/session, blocking all in-browser mutation UAT |
| 178 | PAN-4577 | M | high | ok |  |  | Operator's facts didn't follow them to a new Mac: no importer for Claude auto-memory. PAN-3957 merged, so W9-W11 are unblocked. |
| 179 | PAN-3307 | XS | high | ok |  |  | commitlint scope-enum lists 11 scopes, 14 real ones are missing, and it still names the removed beads scope — trains everyone to ignore it. |
| 180 | PAN-5250 | M | high | ok |  |  | Idle workspace frontend and dev containers never stop while an agent lives; ~9 GB held by unviewed Vite containers. |
| 181 | PAN-2642 | XL | high | ok | ✓ |  | Cost strategy: waste detection over budget policing |
| 181 | PAN-5649 | M | medium | ok |  | PAN-5250 | Browser half of PAN-5250 restart-on-demand (wake page, start-app action); PAN-5250 merged, so it can start now. |
| 182 | PAN-1868 | XS | high | ok |  |  | Cost-bleed circuit breaker: progress-aware, always-on guard against runaway agent spend |
| 183 | PAN-4847 | S | high | ok |  |  | Remote reap silently skips review request when a background writer dirties a tracked file; pipeline stalls at PR-open. |
| 184 | PAN-1042 | S | high | ok |  |  | cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions |
| 185 | PAN-4844 | S | medium | ok |  |  | Claude Code parser prices glm-*/qwen3* as Sonnet 4, ohmypi prices DashScope at $0; route both to custom rows. |
| 186 | PAN-570 | XS | high | ok |  | PAN-2642 | Show PLAN badge on costs when under a subscription/plan |
| 187 | PAN-2059 | XL | high | ok | ✓ |  | Backlog pickup gate |
| 188 | PAN-2376 | XL | high | stale | ✓ |  | Epic: CI/CD reliability — all 21 named children are closed; needs an operator disposition (close or restate) |
| 189 | PAN-3775 | S | high | ok |  |  | makeDbLive opens overdeck.db unmigrated; zero-table db poisons a vitest worker home and breaks later read-only audits. |
| 190 | PAN-3652 | XS | high | ok |  |  | No workflow_dispatch on ci.yml / state-plane-branches.yml, so an unverified main tip can never be verified and DoD row 6 blocks close-out. |
| 192 | PAN-3541 | S | high | ok |  |  | Review restart loops on the session-resume menu because eligibility ignores how the prior session ended; partial mechanical break landed. |
| 193 | PAN-3463 | S | high | ok |  |  | A legitimate empty-diff slot outcome can never pass item verify, so the slot wedges and blocks dispatch of remaining items forever. |
| 194 | PAN-3460 | S | high | ok |  |  | Per-item verify_commands that run the whole root suite make slot merge gates load-fragile and hold a patrol in flight for ~17 minutes. |
| 195 | PAN-3454 | M | high | ok |  |  | Cost hook rescans fork-copied parent history from byte 0 under the reviewer's id — fabricated cache-miss warnings and double-billed spend. |
| 196 | PAN-3432 | S | high | ok |  |  | Preemptive yield fans out: seven work agents paused to make room for one review convoy, then flood back oldest-first. |
| 197 | PAN-3306 | S | high | ok |  |  | Three layers disagree on how a strike rebases: the prompt instructs it, the launcher guard blocks it, sync-main resolves the wrong worktree. |
| 198 | PAN-3297 | S | high | ok |  |  | After a dashboard restart, delivery calls a healthy agent a zombie while resume calls it healthy; both classifiers can't be right. |
| 199 | PAN-3274 | S | high | needs-refinement |  |  | A test-role agent spawned and never ran a turn, holding an approved CI-green issue out of the merge gate behind a stale failed verdict. |
| 200 | PAN-3267 | S | high | ok |  |  | GitLab merged-head oracle spawns one glab subprocess per repo × head, so pipeline membership refresh fails on every cycle. |
| 200 | PAN-5488 | S | high | ok |  |  | Plan dialog header Stop completes planning while footer Stop aborts to Todo; same label, opposite outcomes. |
| 200 | PAN-5544 | S | high | ok |  |  | Flywheel author/assignee rail hardcodes login eltmon in skill, role and vision; non-maintainer installs skip or ungate issues. |
| 201 | PAN-3261 | S | high | ok |  |  | The tmux delivery fallback answered a live session-resume menu because its own paste hid the menu from the detector — silent /compact. |
| 201 | PAN-5548 | XS | high | ok |  |  | CodeRabbit follow-up issues hard-code assignee eltmon; other operators' Flywheel gate never passes them. Sibling of PAN-5544. |
| 202 | PAN-3256 | S | high | ok |  |  | glab mr list runs with a polyrepo wrapper root as cwd, which is not a git repo, so MYN membership fails forge_unavailable every cycle. |
| 203 | PAN-4342 | M | medium | ok |  |  | Re-review rounds resume every lane on its own round-1 findings; give each round one fresh critic lane (Deft method) |
| 204 | PAN-3174 | S | high | ok |  |  | Polyrepo UAT stacks 504: Traefik labels carry the old myn- prefix, Traefik isn't on the overdeck-* devnet, and the fe port is wrong. |
| 206 | PAN-4365 | S | medium | ok |  |  | Stale defaults: workhorses.expensive is Opus 4.8 and the flywheel role is a literal that ignores the slot; evals now unblocked |
| 207 | PAN-2980 | XS | high | ok |  |  | The pre-push file-size guard reads the shared working tree, so another session's uncommitted edits block an unrelated, guard-clean push. |
| 208 | PAN-5448 | S | medium | ok |  |  | Left column gains a Files item that toggles the Files dock; Ctrl+Shift+E has no always-visible button. Operator-raised, spec complete |
| 209 | PAN-3769 | S | high | needs-refinement |  |  | Red main 707089c5→e4b280b3 blocked deploys ~14h: missing no-loss lock entry + stale OpenRouter expectation. Verify still reproducing. |
| 210 | PAN-3760 | S | high | ok |  |  | permissionMode 'auto' undocumented as non-bypass, launcher can emit invalid --permission-mode, invalid values drop silently. |
| 211 | PAN-3629 | M | high | ok |  |  | No sanctioned door to re-scope a live agent; the operator must violate pan tell doctrine or let the rejected design land. |
| 212 | PAN-3517 | M | high | ok |  |  | Convoy forks still miss the parent prompt cache in production — launch-injection byte drift plus resume dropping the cache-scope header. |
| 213 | PAN-3508 | S | high | ok |  |  | pan reload deletes the generation the global pan link points at, so the CLI vanishes mid-deploy for anyone invoking from elsewhere. |
| 214 | PAN-3303 | S | high | ok |  |  | An empty registered-projects 200 is treated as authoritative, latching Command Deck at 'Unknown project' until a manual page reload. |
| 215 | PAN-4364 | S | medium | ok |  |  | GPT-6 catalog: gpt-6-sol misclassed frontier and OpenAI tierModels still remap to GPT-5.6; prerequisites have closed |
| 216 | PAN-3196 | S | high | ok |  |  | Root-owned container residue makes close-out die on EACCES after passing every DoD row; same family as PAN-3570. |
| 217 | PAN-3186 | XS | high | ok |  |  | One configured non-git member (auricle/infra) blanks pipeline membership for the whole project the resolver claims it can answer. |
| 218 | PAN-3185 | XS | high | ok |  |  | Racer (deacon auto-resume) was cut but the check-then-create gap in spawn.ts remains; pan start must report the live agent, not fail. |
| 219 | PAN-5517 | M | medium | ok |  |  | Tiered Execution settings save supervisor, call-out and replay options nothing acts on; PlanCard toggle hits a route deleted in PAN-3917. |
| 220 | PAN-3179 | M | high | ok |  |  | A UAT promote is complete at merge time with no production-reach check, so members read shipped while prod serves the old build. |
| 221 | PAN-3130 | S | high | ok |  |  | Identifier-joined write paths have no containment assertion, so a crafted issue or agent id could redirect a canonical write. |
| 222 | PAN-3047 | XS | high | ok |  |  | Strike-branch teardown uses --is-ancestor, which cannot see a squash merge, so all 96 strike/* branches survive as residue. |
| 223 | PAN-3046 | XS | high | ok |  |  | pan exits with ERR_UNHANDLED_REJECTION when the PostHog shutdown flush times out, so callers read a successful merge handoff as failure. |
| 224 | PAN-1711 | S | high | ok |  |  | Dashboard event-loop stalls under load force watchdog restarts; the root cause behind the PAN-3522 churn and the 0.5-1.5s API latencies. |
| 225 | PAN-3667 | M | high | ok |  |  | CLIProxy has no cross-family remap, so every Anthropic-pinned subagent dies at spawn in a proxied session; stopgap is hand-written. |
| 226 | PAN-5435 | M | medium | ok |  |  | React Compiler burn-down for app shell, pages, hooks, lib: 67 skips, 100 memo sites. Do first; hooks feed all groups. Unblocked. |
| 226 | PAN-5532 | S | medium | ok |  |  | Six dashboard UI bugs where text or filters disagree with code: Experimental copy, Cycle filter, No PR chip, Merging label, palette. |
| 228 | PAN-2874 | M | high | needs-refinement |  |  | Two of three defects are gone: strike verification now sets skipPlanChecklist, and the landing loop was deleted in the cut. Rescope. |
| 228 | PAN-5551 | S | medium | ok |  |  | Emergency stop writes a flywheel pause nothing reads and its toast names a missing control; no CLI clears the Deacon freeze. |
| 229 | PAN-3778 | S | medium | ok |  |  | Server snapshot cap shipped in #4558 (closed). Resume-from-offset on resubscribe is the remaining open piece; now unblocked. |
| 229 | PAN-5555 | S | medium | ok |  |  | add-repo parses repo-groups.yaml by regex: block lists and hyphenated groups fail; auto-detect needs workspaces_dir. |
| 230 | PAN-4575 | S | high | ok |  |  | Kimi ACP cancel is sent with id:"" and rejected, so interrupts never stop Kimi; late chunks land after turn_completed. Unblocked. |
| 230 | PAN-5552 | S | medium | ok |  |  | pan docs disable/enable: default session scope does nothing and project scope acts global; DOCS-RAG.md names wrong keys. |
| 231 | PAN-5454 | S | medium | ok |  |  | Clients read welcome.tier and gate on capabilities; Account card and pan account status show the paid plan. PAN-4294 merged. |
| 231 | PAN-5553 | M | medium | ok |  |  | pan artifacts share is a stub, printed /s/ wrapper URL has no route, and the briefing names an invalid command. |
| 232 | PAN-5116 | S | high | ok |  |  | restart-all closes the pane but the launcher ignores SIGHUP, so the old ACP host and agent child keep running; stop runtime first. |
| 232 | PAN-5549 | XS | medium | ok |  |  | pan restore never restores the agents folder that pan sync backs up; backups list it but restore skips it. |
| 233 | PAN-3510 | S | high | ok |  |  | Agent stop leaves detached docker-run test containers alive for hours, contending with other agents' quality gates. |
| 234 | PAN-4909 | S | high | ok |  |  | Mac set up with connect: Safari on localhost:3011 gets HTTP 401 from the loopback session mint, so the Mac's own dashboard won't load. |
| 235 | PAN-4616 | S | medium | ok |  |  | After PAN-4614 lands, check whether GitHub mergeable honors merge=union; if not, plan a merge-gate fallback |
| 236 | PAN-4747 | S | high | ok |  |  | Two pan reloads built into the same generation slot 12s apart; restart lock taken over early, first build died on TS6053. |
| 237 | PAN-3355 | XS | high | ok |  |  | sessionExists collapses 'no such session' and 'could not ask' into false, so callers read not-running when liveness is unknown. |
| 238 | PAN-3289 | S | high | ok |  |  | A sequencer pass ran against an empty manifest while the read model held 1120 issues — a transiently empty read at spawn. |
| 239 | PAN-4348 | S | medium | ok |  |  | Verification emits warn-first evidence of changed files outside every item's files_scope, so scope creep is visible |
| 240 | PAN-3218 | S | high | ok |  |  | No release-drift signal: an install-breaking fix sat merged and unpublished for ~9 hours with nothing surfacing it. |
| 241 | PAN-3210 | XS | high | ok |  |  | Close-out teardown scopes by compose project while the guard scopes by working_dir, so an unprefixed dead init container blocks it. |
| 242 | PAN-3167 | S | high | ok |  |  | krux and lexerra are permanently unreadable through the membership door: an App-not-installed 404 is typed as retryable forge_unavailable. |
| 243 | PAN-3113 | M | high | ok |  |  | Blocking agent-pane choice prompts show nothing in the conversation view; surface them as inline decision cards with keystroke delivery. |
| 244 | PAN-3108 | XS | high | ok |  |  | dashboard.log reached 867MB with no rotation — disk cost and un-greppable incident logs exactly when they're needed. |
| 245 | PAN-3094 | XS | high | ok |  |  | pan done's merge fallback still force-pushes a fast-forwardable branch, so a rejected push leaves completion half-done. |
| 246 | PAN-3012 | M | high | ok |  |  | Archiving preserves the pointer, not the data: harnesses delete session JSONL on their own schedule and the conversation is unrecoverable. |
| 247 | PAN-3627 | XS | high | ok |  |  | backlog-auto-trigger throws on a legitimately empty manifest, so a plain npx @overdeck/core in a non-project dir prints a stack trace. |
| 248 | PAN-3617 | S | high | needs-refinement |  |  | Three strike dispatches for PAN-3586 died with zero output while a sibling worked; may be stale — re-confirm before picking up. |
| 249 | PAN-4346 | S | medium | ok |  |  | Byte ratchet on the always-loaded rules bundle (40 KB, no ceiling); seeded at current size, growth forbidden |
| 250 | PAN-3276 | XS | high | ok |  |  | Needs-you rows for pane questions and permission prompts are click-dead, so the list that exists to route the operator routes nowhere. |
| 251 | PAN-3235 | S | high | ok |  |  | Render and answer agent pane-choice menus on the decision card; PAN-3228 shipped the core and CLI, the dashboard UX remains. |
| 252 | PAN-4203 | L | high | ok |  |  | Operator-requested pan replan + right-click Replan: API-archive stale branch, verify, reset, comment, auto-replan from main. |
| 253 | PAN-3789 | L | medium | needs-refinement |  |  | MCP servers configured in standalone Codex never reach Overdeck conversations; no setup, auth or lifecycle story across harnesses |
| 254 | PAN-3175 | M | high | ok |  |  | Merge-train ordering derives conflicts from file overlap alone, so semantically dependent members batch in any order and break the schema. |
| 255 | PAN-3015 | L | high | ok |  |  | Claude Code is the only harness still driven by keystroke injection; a pull-based monitor inbox would retire the whole hardening stack. |
| 256 | PAN-3518 | M | high | needs-refinement |  | PAN-3517 | Re-review resumes re-bill the whole cold history; make reviewResumeDecision TTL- and size-aware. Needs design sign-off. |
| 257 | PAN-3445 | XS | high | ok |  |  | projects.yaml TCP lock ports overlap the OS ephemeral range, so an unrelated socket makes an uncontended config write fail. |
| 258 | PAN-3332 | S | high | ok |  |  | A detached slash-command spawn died in 150ms while the UI kept saying 'running in the background'; the activity must own its outcome. |
| 259 | PAN-4426 | M | medium | ok |  |  | Dashboard controls for Deft Directive detection and managed mode over the PAN-3943 library; blocker has closed |
| 260 | PAN-4345 | XS | medium | ok |  |  | Terse gate-integrity rule (fix the work, never the gate) plus a Rule Authority note in rule authoring |
| 261 | PAN-3013 | XS | high | ok |  |  | Role-spawn wrote 26 session-scoped hook paths into the durable ~/.claude/settings.json; they fail on every Linear tool call forever. |
| 262 | PAN-3771 | M | high | ok |  |  | Conversation search silently empty end-to-end: palette flag off by default, FTS scan manual-only, no summaries. |
| 263 | PAN-4530 | XS | medium | ok |  |  | Flywheel skill: define 'pipeline clear', go idle with conversation open, and never stop on a stuck pipeline |
| 264 | PAN-3533 | L | high | ok |  |  | No per-project resource partitioning, so one project's docker stacks and installs starve another project's pipeline and the dashboard. |
| 265 | PAN-3107 | S | high | ok |  |  | OOM spikes are unattributable after the fact; productize the machine-local memory-attribution census stopgap. |
| 266 | PAN-4512 | M | medium | needs-refinement |  |  | Tier escalation config is shown but nothing fires it since the Cut; choose a trigger, persist tierOverrides, re-dispatch |
| 266 | PAN-5597 | M | medium | ok |  |  | Order books page rework: show the live book, simpler build/run. Body is a placeholder; PRD and mockup pending. |
| 267 | PAN-1666 | XL | medium | ok | ✓ |  | Pipeline Throughput Hardening |
| 268 | PAN-1556 | S | high | ok |  |  | Session/activity feed: coalesce review-spawn spam, supersede re-reviews per issue, keep active conversations most-recent |
| 269 | PAN-4510 | S | medium | ok |  |  | Show effort on issue-view agent rows, conversation rows and Agents-page conversation entries; split from closed PAN-4259 |
| 270 | PAN-2190 | L | high | ok |  |  | Decompose routes/workspaces/merge-ops.ts (1,925 lines) |
| 271 | PAN-2233 | L | high | ok |  |  | decompose merge-agent.ts (1,414 lines) into focused modules |
| 272 | PAN-2186 | S | high | ok |  |  | Rescoped: after a merge the pending auto-merge row must clear and tracker labels must match the merged PR. Label-retry half is PAN-3557. |
| 273 | PAN-4632 | S | medium | ok |  |  | Markdown chip 'Open in File Manager' xdg-opens the file in its MIME app and sticks as the left-click default; drop it, repair stored pref. |
| 274 | PAN-2241 | S | high | ok |  |  | complete-planning is not serialized or idempotent per issue (spec tmp-rename 500s, bead delete-recreate thrash) |
| 275 | PAN-2242 | S | high | ok |  |  | Unidentified duplicate caller fires complete-planning in pairs every ~2 minutes (perpetual loop while session survives) |
| 276 | PAN-2240 | S | high | ok |  |  | pan tell contradicts itself on dead ohmypi sessions |
| 277 | PAN-4926 | XS | medium | ok |  |  | pan down SIGTERMs the smee pidfile PID without verifying it is smee; a reused PID kills an unrelated process. XS guard + test. |
| 278 | PAN-2243 | S | high | ok |  |  | pan plan finalize: CLI aborts complete-planning at 90s while the server handler legitimately finishes later (false ✖ Failed) |
| 279 | PAN-2202 | S | high | ok |  |  | complete-planning silently skips spec promotion on a dead session's unanswered AskUserQuestion |
| 280 | PAN-2237 | S | high | ok |  |  | pan plan done swallows vbrief quality lint details |
| 281 | PAN-2487 | M | high | ok |  |  | CI-green merge skip + Ship & Merge cockpit view (live door log + progress) + active-node spinner |
| 282 | PAN-4811 | M | medium | ok |  |  | Lanes on a new Fly VM plus gauntlet.fly.max_vms cap; PAN-4743 landed the Fly target door, so this is now unblocked. |
| 283 | PAN-5079 | S | high | ok |  |  | pan task claim/cancel/done write any id, so a typo leaves a stray row in the committed continue file an agent can't remove. |
| 284 | PAN-5446 | S | medium | ok |  |  | 7 CodeRabbit findings on merged PAN-4590 sast gate; 2 Major: dirty scans not bound to tree, incomplete scans reported as scanned |
| 285 | PAN-4778 | S | medium | ok |  |  | Workspace-image CI never published: wrong Fly app, fly not on PATH, no FLY_API_TOKEN (operator). Fly VMs run a June image. |
| 286 | PAN-4817 | S | medium | ok |  | PAN-4778 | Fly app's cached image predates pan serve --no-open, so every new Fly VM crashes and rolls back; blocks live Fly verification. |
| 287 | PAN-2211 | M | high | ok |  |  | writeSwarmSlotCompletion has no production caller; pan done in a slot workspace must record it. Swarm is dormant (Cut D11). |
| 288 | PAN-2210 | M | high | ok |  |  | Rewritten pan done has no slot handling: a slot agent takes the issue-level PR/review path. Must record slot completion only. |
| 289 | PAN-2201 | XS | high | ok |  |  | Close-out label step fails atomically when a hardcoded label (e.g. 'in-planning') is absent from the repo |
| 290 | PAN-2646 | XS | high | ok |  |  | configurable global/project/issue policy UI with default OFF |
| 291 | PAN-2755 | S | high | ok |  |  | per-issue review-model override never reached convoy sub-reviewers on the discovery-fork path |
| 292 | PAN-2754 | S | high | ok |  |  | `always` is inert |
| 293 | PAN-2809 | M | high | ok |  |  | Live-terminal Playwright UAT blocked in containerized workspaces (node-pty musl/glibc mismatch + Vite/Traefik WS Origin 403) |
| 294 | PAN-2810 | M | high | ok |  |  | Workspace 'vitest --changed' gate diverges from CI: App.test.tsx fails locally on missing selectPendingInputSubjects mock |
| 295 | PAN-2495 | S | high | ok |  |  | PAN-2487 ci-green merge skip bypassed CI-green gate |
| 296 | PAN-2478 | S | high | ok |  |  | CI flake: Playwright browser install fails on packages.microsoft.com apt (NOSPLIT), red-mains legit merges |
| 297 | PAN-1710 | S | high | ok |  |  | 'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 and feature/pan-1641 |
| 298 | PAN-1558 | M | high | ok |  |  | Review/specialist agents should run in the workspace Docker container, not inherit host-override |
| 299 | PAN-1766 | S | high | ok |  |  | work agents hang on Claude Code settings-file protection when editing .claude/** |
| 300 | PAN-4853 | M | low | ok |  |  | SageOx dashboard views (session tab, context trace, project panel); blocked by PAN-4852; session-to-issue mapping is a checkpoint |
| 301 | PAN-2266 | M | high | ok |  |  | feat: add zcode harness and make it the default for glm-5.2 |
| 302 | PAN-1578 | M | high | ok |  |  | GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex) |
| 303 | PAN-1538 | M | high | ok |  |  | Unblock Pi source forks |
| 304 | PAN-687 | M | high | ok |  |  | Support OpenCode as alternative coding agent |
| 305 | PAN-466 | M | high | ok |  |  | Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex |
| 306 | PAN-465 | M | high | ok |  |  | Add OpenRouter as a model provider |
| 307 | PAN-463 | M | high | ok |  |  | Add Qwen 3.6+ model support |
| 308 | PAN-1142 | M | high | needs-refinement |  |  | Per-role/conversation effort config; likely superseded by merged PAN-4249 resolver and its S-slices, confirm or close |
| 309 | PAN-1424 | M | high | needs-refinement |  |  | Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122) |
| 310 | PAN-1196 | M | high | needs-refinement |  |  | Workhorse routing by bead difficulty + subject-matter (single-agent and swarm) |
| 311 | PAN-1311 | M | high | needs-refinement |  |  | Swarm: fast-track tier |
| 312 | PAN-1313 | L | high | ok |  |  | Finish src/lib Effect migration: remove or justify legacy Promise/sync surfaces |
| 313 | PAN-4863 | S | medium | ok |  |  | Manual AC-10 check of Anywhere connect on a real systemd VPS; needs a release shipping `pan connect` and a human-provisioned VPS. |
| 314 | PAN-1246 | M | high | ok |  |  | Perf: projection-cached VCS driver for diff/checkpoint reads (port of t3code #2586) |
| 315 | PAN-1253 | M | high | needs-refinement |  |  | Flywheel: respect issue dependencies before autopicking work |
| 316 | PAN-1357 | M | high | ok |  |  | Template conversations: load curated skill bundles into a single conversation |
| 317 | PAN-1915 | M | high | ok |  |  | enhancement(security): API key at-rest hardening |
| 318 | PAN-4886 | S | medium | ok |  |  | Live relay check on Fly unrun three times: device codes expire unapproved. Needs an operator present to approve one code. |
| 319 | PAN-1435 | XS | high | ok |  |  | API keys in ~/.panopticon/config.yaml stored as plaintext |
| 320 | PAN-1672 | M | high | ok |  |  | GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion |
| 321 | PAN-1640 | M | high | ok |  |  | Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic) |
| 322 | PAN-4297 | L | medium | ok |  |  | Hosted encrypted vault on overdeck.ai in tester mode; account service built 2026-10-02, billing no longer a prerequisite |
| 323 | PAN-2350 | L | high | needs-refinement | ✓ |  | Epic rebaselined 2026-09-28; account service and share-service slice 1 built 2026-10-02. Children carry the order. |
| 324 | PAN-1217 | XS | high | ok |  |  | Requirements reviewer: classify each AC as in_pr_scope vs whole_feature_scope, only !-block in-PR-scope items |
| 325 | PAN-2079 | M | high | needs-refinement |  |  | Inbox spine: boot reconciliation (producer #1) is gone; may still be worth pursuing for pending AUQ, cost alerts and other producers |
| 326 | PAN-4204 | S | medium | ok |  | PAN-4203 | Sync-main conflict error dumps every file path; show the count, a Replan button, and Open workspace only for few conflicts. |
| 327 | PAN-1219 | M | high | needs-refinement |  |  | Promote across-cycle review state to first-class data (cycle SHA, prior findings) instead of prompt-derived |
| 328 | PAN-1451 | M | high | needs-refinement |  |  | PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift) |
| 329 | PAN-1452 | M | high | ok |  |  | PAN-1381 follow-up: per-reviewer restart with model override (architectural mismatch with PAN-1048) |
| 330 | PAN-1553 | M | high | ok |  |  | Investigate Claude Code Fast mode support (and fast-tier pricing) |
| 331 | PAN-1504 | M | high | ok |  |  | pan hygiene |
| 332 | PAN-1480 | L | high | ok |  |  | TLDR: 93% bypass rate |
| 333 | PAN-5058 | XL | high | ok |  |  | Parked, in planning: TLS passthrough relay at <name>.mcp.overdeck.ai so hosted bots reach /mcp without Tailscale Funnel. |
| 334 | PAN-1479 | M | high | ok |  |  | RTK: Add telemetry to measure token savings from bash output compression |
| 334 | PAN-5490 | M | medium | ok |  | PAN-5058 | MCP relay S-A: hostname registry, relay tickets in account service, wire contract. First slice; waits on PAN-5058 PRD. |
| 335 | PAN-2950 | L | high | ok |  |  | Refactor god files back under file-size ceilings after the UX overhaul |
| 335 | PAN-5491 | L | medium | ok |  | PAN-5058, PAN-5490 | MCP relay S-B: SNI passthrough relay service on Fly (services/mcp-relay); never decrypts. Needs S-A (PAN-5490). |
| 336 | PAN-2720 | M | high | ok |  |  | File-size ratchet counts lines, so it rewards line-packing on the god files it means to improve |
| 336 | PAN-5492 | L | medium | ok |  | PAN-5058, PAN-5490 | MCP relay S-C: machine tunnel client and TLS listener for public /mcp; one public-ingress predicate. Needs S-A (PAN-5490). |
| 337 | PAN-2650 | S | high | ok |  |  | Shed-stack half is moot (slot merges verify on host); remaining: pan swarm recover path for a stuck ready-to-merge slot. |
| 337 | PAN-5493 | M | medium | ok |  | PAN-5058, PAN-5492 | MCP relay S-D: ACME TLS-ALPN-01 certificates on the machine; key never leaves it. Needs S-C (PAN-5492). |
| 338 | PAN-2358 | M | high | ok |  |  | PAN-2145 follow-up: restore PAN-1535 hardening in transformMessageForHarness (rewritten during conversations.ts decomposition) |
| 338 | PAN-5494 | M | medium | ok |  | PAN-5058, PAN-5491, PAN-5492, PAN-5493 | MCP relay S-E: Settings switch, enable flow, loopback end-to-end test and user docs. Needs S-B, S-C and S-D. |
| 339 | PAN-2334 | XS | high | ok |  |  | write a Definition of Ready (DoR) |
| 339 | PAN-5495 | S | medium | ok |  | PAN-5058, PAN-5493 | MCP relay S-F: Google Trust Services fallback CA via EAB when Let's Encrypt rate-limits. Needs S-D (PAN-5493). |
| 340 | PAN-2193 | S | high | ok |  |  | Held issues (objection/parked/vetoed/needs-handoff) are invisible in the Command Deck tree |
| 340 | PAN-5496 | S | medium | ok |  | PAN-5058, PAN-5493 | MCP relay S-G: daily Certificate Transparency watch for the relay hostname; ships with S-E. Needs S-D (PAN-5493). |
| 341 | PAN-1984 | XS | high | ok |  |  | Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up) |
| 341 | PAN-5602 | M | medium | ok |  | PAN-5058, PAN-5494 | Live Grok Bot and Muse checkpoints over the MCP relay, moved from PAN-5058. Blocked by relay S-E (PAN-5494); needs operator sign-ins. |
| 342 | PAN-1913 | XS | high | ok |  |  | Project description: show on click, edit in dashboard, mirror into the project layer (and document what's in .pan and ~/.panopticon) |
| 343 | PAN-1906 | M | high | ok |  |  | Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere |
| 344 | PAN-1544 | M | high | ok |  |  | Type cleanup: strip 'ship' from the Role union and its ~10 downstream references |
| 345 | PAN-955 | S | high | ok |  |  | Workspace devcontainer template versioning + re-render on demand |
| 346 | PAN-807 | L | high | ok |  |  | Epic C: Workspace state sanity on spawn |
| 347 | PAN-630 | M | high | ok |  |  | Multi-tenant workspace isolation with ACLs |
| 348 | PAN-471 | M | high | ok |  |  | Cost reconciler: auto-trigger on agent lifecycle events with debounce |
| 349 | PAN-438 | M | high | ok |  |  | Migrate remaining REST polling endpoints to Effect RPC |
| 350 | PAN-578 | M | high | ok |  |  | Security: Comment mediation layer to prevent prompt injection via tracker comments |
| 351 | PAN-2921 | S | medium | ok |  |  | Strike merge door can report fetch failure after merge and land the same head twice |
| 352 | PAN-4195 | M | medium | ok |  |  | Every pan call costs ~0.5s/230MB from eager command imports; lazy-load command modules, target --version <100ms |
| 353 | PAN-2839 | S | medium | ok |  |  | plan→work autoSpawn now 500s with a duplicated workspace prep |
| 354 | PAN-2824 | S | medium | ok |  |  | pan review pending dies when one project's lens gather fails (non-degrading caller; PAN-2820 class) |
| 355 | PAN-2792 | S | medium | ok |  |  | Orphan-process sweeps killed the dashboard and live conversations via lsof +D over Bun-hardlinked node_modules |
| 356 | PAN-2761 | S | medium | ok |  |  | done.test.ts asserts a hardcoded URL without stubbing env, so it fails in any agent shell with OVERDECK_DASHBOARD_URL set and looks lik… |
| 357 | PAN-2738 | S | medium | ok |  |  | strikes deadlock |
| 358 | PAN-2717 | S | medium | ok |  |  | conversation permission waits missing from Awareness; strengthen alert pulse |
| 359 | PAN-2697 | S | medium | ok |  |  | First-review codex parents enter discovery mode and the supervisor session no-ops every discovery-ready signal |
| 360 | PAN-4236 | S | medium | ok |  |  | GPT-5.6 luna/sol rows in cost.ts disagree with catalog and OpenAI list prices; reconcile and add a cost.ts-vs-catalog parity test |
| 361 | PAN-2691 | S | medium | ok |  |  | Auto-planned issues park silently when the post-finalize work spawn is gated (stack-unhealthy 422) |
| 362 | PAN-4306 | M | medium | ok |  |  | Move phase/role/cleanup telemetry from activity.entry to activity.detailed so it stops evicting news; blocked by PAN-4300 |
| 363 | PAN-3701 | L | high | ok |  |  | Four separate first-party LLM client stacks; consolidate onto effect/unstable/ai LanguageModel + ExecutionPlan. PRD written. |
| 364 | PAN-3090 | M | high | ok |  |  | Simple issue page opens with a 55KB raw kickoff prompt and hides the pending question the operator actually has to answer. |
| 365 | PAN-4552 | M | medium | ok |  |  | Fresh-host setup errors still say 'edit config'/'run X'; audit each to auto-fix or one click, and find other first-launch dialogs |
| 366 | PAN-2670 | S | medium | ok |  |  | Gate the dashboard-server tsconfig in npm run typecheck |
| 367 | PAN-2664 | S | medium | ok |  |  | auto-commit completes unresolved merge with conflict markers |
| 368 | PAN-2663 | S | medium | ok |  |  | health probe can accept old dashboard after replacement EADDRINUSE |
| 369 | PAN-2649 | S | medium | ok |  |  | Ctrl+K conversation search indexes Claude transcripts only |
| 370 | PAN-2580 | S | medium | needs-refinement |  |  | pan tell to codex (GPT) conversations; PAN-5095 (closed) added app-server delivery, so verify whether this is fixed. |
| 371 | PAN-2572 | M | medium | ok |  |  | Noisy EBADENGINE + deprecation warnings on npx/npm install make a healthy install look broken |
| 372 | PAN-2563 | S | medium | ok |  |  | npm-flavor desktop (npx @overdeck/desktop) lacks node_modules for the server's externalized deps |
| 373 | PAN-2554 | S | medium | ok |  |  | clicking a project doesn't update the browser URL |
| 374 | PAN-2550 | XS | medium | ok |  |  | npm test exits 0 despite root-suite failures |
| 375 | PAN-2547 | S | medium | ok |  |  | pan restart --health-timeout parses seconds as milliseconds |
| 376 | PAN-2546 | S | medium | needs-refinement |  |  | pan tell is codex-conversation-unaware; PAN-5095 (closed) added app-server delivery, so verify whether this is fixed. |
| 377 | PAN-4303 | S | medium | needs-refinement |  |  | Steer busy Codex app-server turns via turn/steer; verify first whether turn/start already steers. Needs PAN-4292's steerKind. |
| 378 | PAN-3003 | XS | medium | ok |  |  | Generated launcher.sh files omit the OVERDECK_AGENT_ID export the PTY supervisor requires, so manual re-launch dies instantly. |
| 379 | PAN-2501 | S | medium | ok |  |  | deleteResourceVenvEffect's HttpRouter.schemaParams call fails typecheck under the root tsconfig (masked by src/dashboard/** exclusion) |
| 380 | PAN-2492 | S | medium | needs-refinement |  |  | pane-detected waits (rate-limit/session-resume) surface as 'needs you' but cannot be answered from the dashboard |
| 381 | PAN-2491 | M | medium | ok |  |  | Migrate @xenova/transformers to @huggingface/transformers to eliminate silent npx install failures from sharp 0.32 postinstall |
| 382 | PAN-2489 | S | medium | ok |  |  | strike agents are invisible in the project issue tree |
| 383 | PAN-2465 | S | medium | ok |  |  | pan done's PR lookup fails at MYN polyrepo root |
| 384 | PAN-2454 | S | medium | ok |  |  | ratchet audit fails per-commit on push ranges whose NET baseline delta is zero |
| 385 | PAN-2428 | XS | medium | ok |  |  | MYN workspace Traefik routing broken post-rebrand |
| 387 | PAN-2416 | S | medium | ok |  |  | codex agents can wedge on the Codex CLI first-run/consent screen |
| 388 | PAN-4250 | XS | medium | ok |  |  | Stale dated CONVERSATION_TITLE_MODEL literal throws UnknownModelError when titleModel config is unset; one-line fix plus audit |
| 389 | PAN-2395 | S | medium | ok |  |  | one invalid tiered_execution enum poisons every config read |
| 390 | PAN-2381 | S | medium | ok |  |  | three event types missing from DomainEvent schema union poison the RPC stream |
| 391 | PAN-2287 | S | medium | ok |  |  | every supervisor.log line written twice |
| 392 | PAN-5372 | XS | medium | ok |  |  | First split in a Stage deck remounts the open pane, silently dropping an unsaved editor draft; fix with a stable key per paneId. |
| 393 | PAN-3661 | XS | medium | ok |  |  | Secure review-mode dispatch dropped the HTTP-200 semantic-rejection surface; two frontend tests fail locally while CI stays green. |
| 394 | PAN-3288 | XS | medium | ok |  |  | Dev-checkout preflight: after a git pull that adds a dep, the CLI dies with ERR_MODULE_NOT_FOUND instead of saying 'run bun install'. |
| 395 | PAN-3164 | XS | medium | ok |  |  | probeUatStack reports readiness from container count, so the UI offers 'Open UAT frontend' while the API is still resolving Maven deps. |
| 396 | PAN-3121 | S | medium | ok |  |  | The failed-send outbox never reconciles against the transcript, so a delivered message keeps a Retry twin that would double-send. |
| 397 | PAN-3014 | XS | medium | ok |  |  | Background title/about spawns use --bare, which now skips credential reads, so every one fails 'Not logged in' with empty stderr. |
| 398 | PAN-5436 | L | medium | ok |  |  | React Compiler burn-down for components/chat: 44 skips in 30 files, then drop 163 manual memo sites. PAN-4561 has merged. |
| 399 | PAN-5438 | L | medium | ok |  |  | React Compiler burn-down for Command Deck, Stage, frame, dock: 56 skips, 237 memo sites. PAN-4561 has merged. |
| 400 | PAN-5366 | M | medium | ok |  |  | Conversation page cannot show whether per-turn memory injection reaches it; add a state route and a status-line part. |
| 401 | PAN-3944 | S | medium | needs-refinement |  |  | Main fix landed (host-backed targets skip Herdr agent.prompt); remaining: buffer bracketed paste in the app-server host, placeholder guard |
| 402 | PAN-3829 | L | medium | ok |  |  | Managed Claude launch home: overlay hooks/settings/plugins/auth without touching native ~/.claude (draft at handoff/20260909/main) |
| 403 | PAN-2280 | M | medium | ok |  |  | Resumed conversations wedge without writing transcripts when dashboard is black-holed |
| 404 | PAN-2197 | S | medium | ok |  |  | work agents skip `pan done` (manual push instead) |
| 405 | PAN-2069 | XS | medium | ok |  |  | caveman: follow-up gaps |
| 406 | PAN-1918 | XS | medium | ok |  |  | full frontend vitest suite runs in no CI path |
| 407 | PAN-1912 | XS | medium | ok |  |  | Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle |
| 408 | PAN-4208 | M | medium | ok |  |  | #4205 follow-ups: Effect-free config read for telemetry to hit <100ms pan --version; CI import test for lazy command targets |
| 409 | PAN-1846 | S | medium | needs-refinement |  |  | unbounded log growth |
| 410 | PAN-1830 | S | medium | ok |  |  | Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY |
| 411 | PAN-1816 | S | medium | ok |  |  | Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry |
| 412 | PAN-1795 | S | medium | ok |  |  | Codebase map bootstrapped in planning worktree is never promoted to main |
| 413 | PAN-1774 | S | medium | ok |  |  | workspace server container crashloops when dist/dashboard/server.js is missing |
| 414 | PAN-1769 | S | medium | ok |  |  | Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + tmux fallback); resumed-conv message stil… |
| 415 | PAN-1761 | S | medium | ok |  |  | conversations endpoints fetched via relative /api path |
| 416 | PAN-1755 | S | medium | ok |  |  | uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agents racing the next generation |
| 417 | PAN-3516 | XS | medium | ok |  |  | Repo .claude/skills holds stale duplicates of pan-handoff, pan-flywheel and okf, so overdeck-dev sessions load outdated skill text. |
| 418 | PAN-3455 | XS | medium | ok |  |  | cliproxy --version exits 2, so the up-to-date check always returns false and every ensure re-downloads the pinned release. |
| 419 | PAN-3117 | XS | medium | ok |  |  | A deterministic 400 renders as the generic 'Failed to send' bubble with a Retry that can never succeed. |
| 420 | PAN-3036 | XS | medium | ok |  |  | Pane-idle detection reads a completed strike's idle composer as a pending question, so a finished strike shows '! INPUT'. |
| 421 | PAN-3016 | M | medium | ok |  |  | Operator ask: every view should be URL-addressable; cockpit tabs, stage panes and several drawers are still local state. |
| 422 | PAN-3890 | S | medium | ok |  |  | opencode provider stream errors (rate limit) are invisible in the feed and never retried; first message dies silently |
| 423 | PAN-3822 | L | medium | ok |  |  | PRD landed (12 items, FR-1..14): link PRs to conversations via branch detection + explicit override; unblocks PAN-3920 |
| 424 | PAN-5028 | M | medium | ok |  |  | list_pending_input loses a conversation's AskUserQuestion after the PAN-1520 deny hook, contrary to the existing test's contract. |
| 425 | PAN-5386 | XS | medium | ok |  |  | CodeRabbit follow-up for PAN-5361 (PR #5373): 1 Major finding, baseline burst can hide an idle regression in bare-host smoke |
| 426 | PAN-1673 | S | medium | ok |  |  | Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously) |
| 426 | PAN-5515 | XS | medium | ok |  |  | CodeRabbit Major on PR #5513: release.yml may notarize an ad-hoc-signed macOS helper when the API key exists but no cert. |
| 427 | PAN-5227 | S | medium | ok |  |  | Closed-issue reaper re-checks every issue's state every 60 s, spending ~25% of the GitHub App REST bucket while idle. |
| 428 | PAN-5439 | L | medium | ok |  |  | React Compiler burn-down for explorer, God View, conversations, workspace, project: 40 skips, 132 memo sites. |
| 429 | PAN-1669 | S | medium | ok |  |  | restart-with-model doesn't emit a live event |
| 430 | PAN-1668 | S | medium | ok |  |  | right-click 'restart with <model>' carries model only, never harness |
| 431 | PAN-1627 | M | medium | ok |  |  | Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridable by PreToolUse auto-appr… |
| 432 | PAN-1624 | S | medium | ok |  |  | pan handoff --author external: authored doc is socket_write-ten but never submitted |
| 433 | PAN-3901 | S | medium | ok |  |  | test-skip gate has no audited exemption for opt-in live suites (skipIf on env/binary); allowlist row with justification |
| 434 | PAN-3852 | S | medium | ok |  |  | Project creation follow-ups: SSH-port repo URLs, dotted repo names, partial-registration retry, non-duplicate 409 mapping |
| 435 | PAN-5437 | M | medium | ok |  |  | React Compiler burn-down for components/Settings: 60 skips in 31 files, 27 memo sites. PAN-4561 has merged. |
| 436 | PAN-3862 | L | medium | needs-refinement |  |  | /agents-v2 machine session explorer over Herdr + all tmux servers; local first, remote via the PAN-3762 environment model |
| 437 | PAN-1572 | M | medium | needs-refinement |  |  | Settings permission-mode can desync from the resolved mode; body cites the removed DSP flag and a renamed symbol — rewrite first |
| 438 | PAN-4627 | S | medium | ok |  |  | Homebrew Claude Code installs get a copy-only upgrade banner; make the brew plan runnable and auto-upgrade outdated runnable installs. |
| 439 | PAN-1571 | S | medium | ok |  |  | Large multi-line pastes (handoff docs) land unsubmitted |
| 440 | PAN-1565 | S | medium | ok |  |  | Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #63147) |
| 441 | PAN-5312 | S | medium | ok |  |  | Quality-gate admission: a head that can never fit alone serializes every gate behind it. |
| 442 | PAN-5241 | L | medium | ok |  |  | Spill work agents to linked machines, then Fly, when this machine is full, up to operator caps. |
| 443 | PAN-1530 | S | medium | ok |  |  | Investigate: state.json with model='gpt-5.5' (a model that doesn't exist) |
| 444 | PAN-1461 | S | medium | ok |  |  | Conversation transcript: in-page search (Ctrl+F) only finds text in currently-rendered virtualized rows |
| 445 | PAN-1449 | S | medium | ok |  |  | Memory extraction still failing; the live symptom PAN-4370 closed and PAN-4374 adds a working provider; layout half remains |
| 446 | PAN-1446 | S | medium | ok |  |  | PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep stubs) |
| 447 | PAN-5180 | M | medium | ok |  |  | Tab-open REST burst (~45 requests) delays every client 1.0-1.4 s; uncached prerequisite and status probes. |
| 447 | PAN-5562 | M | medium | ok |  |  | pan cost today/week/month/report read dead per-day files and print $0; budgets never accrue; Costs page Event Count wrong. |
| 447 | PAN-5576 | S | medium | ok |  |  | Moonshine, the default dictation provider, has no sidecar on npm installs; pan install builds only in a source checkout. |
| 448 | PAN-5264 | M | medium | ok |  |  | Attribute the app-rest GitHub caller (1,422 untraced App REST calls/hour), then cut the largest path. |
| 449 | PAN-5340 | S | medium | ok |  |  | A Preview link to another Markdown file should open it in Preview, not Edit. Follows PAN-5337. |
| 450 | PAN-5440 | L | medium | ok |  |  | React Compiler burn-down for all remaining components: 78 skips in 42 files, 288 memo sites. Largest group; do last. |
| 451 | PAN-1445 | S | medium | ok |  |  | PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs) |
| 451 | PAN-5557 | S | medium | ok |  |  | pan up on Linux treats the overdeck CLI in ~/.local/bin as the desktop app, prints a false launch and skips its own startup path. |
| 452 | PAN-3616 | S | medium | ok |  |  | Planned deploy restarts show the alarm-toned Reconnecting banner; use the lifecycle signal for calm 'updating' copy. |
| 452 | PAN-5556 | M | medium | ok |  |  | Desktop app tray status, six notification switches, Open Workspace menu and Linux launch-at-login are dead controls; fix or hide. |
| 453 | PAN-2982 | XS | medium | ok |  |  | Nothing runs a skill's own selftest when sync-sources/skills/** changes; a convoy passed a PR with its selftest red. |
| 454 | PAN-5322 | S | medium | ok |  |  | CodeRabbit follow-up on PR #5319: unguarded identifier.toUpperCase(), modal focus, needs-you rows that open nothing. |
| 455 | PAN-5317 | S | medium | ok |  |  | CodeRabbit follow-up on PR #5127: route live Codex app-server sends correctly; no replayable mail for keyed sends. |
| 455 | PAN-5565 | XS | medium | ok |  |  | CodeRabbit follow-up on merged PAN-5541: close only the answered request; keep seeded queries fresh in a test. |
| 456 | PAN-2981 | S | medium | ok |  |  | The conversation search index never prunes deleted sessions, so Ctrl-K offers zombie hits that 404 on open. |
| 456 | PAN-5560 | S | medium | ok |  |  | pan docs reindex ignores docs.* config and, from an npm install, silently overwrites a full index with a partial corpus. |
| 457 | PAN-2976 | L | medium | ok |  |  | Generalize the ACP harness to any capability-passing ACP CLI: named adapters plus a config-declared custom-agent escape hatch. |
| 458 | PAN-1444 | S | medium | ok |  |  | Follow-up to PAN-1416: dashboard port lockfile + pan doctor multi-instance check |
| 459 | PAN-2469 | S | medium | ok |  |  | Assembly landed (mergeReadySlots + finalization); remaining: alarm when all slots merged but no review requested. Swarm dormant. |
| 460 | PAN-1433 | S | medium | ok |  |  | Conversation agents can leave host main repo in abandoned git rebase state for hours |
| 461 | PAN-1416 | S | medium | ok |  |  | Workspace-spawned dashboards must never claim the canonical dashboard port |
| 461 | PAN-5582 | S | medium | ok |  |  | 11 CodeRabbit doc findings on merged PAN-5500 PR #5581; 1 Major: push-notifications must enable token sign-in before manual Serve. |
| 462 | PAN-1392 | S | low | stale |  |  | docs/prds/active→completed archive step is superseded by .pan/drafts and .pan/specs on the feature branch |
| 463 | PAN-4151 | L | medium | needs-refinement |  | PAN-3822 | Deferred remainder of PAN-3822/#4067: GitLab MR sync, PR page + search, handoff link copy, diffstat, link-dialog a11y, sync throttle |
| 464 | PAN-1330 | S | medium | ok |  |  | CLI cannot address planning-*/specialist-* sessions |
| 465 | PAN-4971 | S | medium | ok |  |  | Viewer header shows only host + count; roster of all participants with host/controller marked. Frontend-only, payload exists. |
| 466 | PAN-1226 | L | medium | ok |  |  | PAN-1148 unified-dashboard redesign |
| 467 | PAN-1173 | S | medium | ok |  |  | pan show <bare-number> derives wrong agent ID for PAN-prefixed issues |
| 468 | PAN-1154 | M | medium | ok |  |  | pan up does not kill existing port holders |
| 469 | PAN-3354 | XS | medium | ok |  |  | The archive write door accepts kind=main, hiding a project's singleton workspace with no unarchive affordance in the UI. |
| 470 | PAN-3178 | XL | medium | ok |  |  | Make worktrees and diffs first class: +/- badge, dedicated Changes surface, conversation worktrees. PRD and mockup exist. |
| 470 | PAN-5571 | XS | medium | ok |  |  | Archived (N) expander never renders: list fetch omits includeArchived, so archived workspaces vanish with no UI way back. |
| 471 | PAN-3017 | S | medium | ok |  |  | The issue-page UAT panel renders only inline actions, so restart/rebuild/stop are unreachable outside the rail's context menu. |
| 472 | PAN-5174 | XS | medium | ok |  |  | Flaky CI test: share/rate-limit.test.ts flips 201/429 under CI timing; quarantine or make deterministic. |
| 473 | PAN-3873 | M | medium | ok |  |  | GitHub event delivery: support gh webhook forward alongside smee with guided setup, settings exposure, and docs |
| 474 | PAN-5346 | S | medium | ok |  |  | Auth docs misstate #overdeck_token delivery, the Origin rule and 401 troubleshooting; PAN-5344 fix has landed. |
| 475 | PAN-1150 | S | medium | ok |  |  | Settings: "Anthropic is not configured" warning persists in Model Routing after claude /login (Provider tab disagrees) |
| 475 | PAN-5486 | M | medium | ok |  |  | Bot integration core pins are hand-typed and stale (0.74/0.77); stamp them at release and fix Grok Bot docs. |
| 476 | PAN-1149 | S | medium | ok |  |  | v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves |
| 477 | PAN-1130 | S | medium | ok |  |  | Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart |
| 478 | PAN-1129 | S | medium | ok |  |  | Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977' |
| 479 | PAN-1128 | S | medium | ok |  |  | Channels: spurious 'no MCP server configured with that name' banner at conversation startup |
| 480 | PAN-1113 | S | medium | ok |  |  | Conversations sidebar lets you message review-specialist sessions, which derails them silently |
| 481 | PAN-1068 | S | medium | ok |  |  | PAN-1048 deferred findings: security, correctness, and model validation gaps |
| 482 | PAN-3938 | M | medium | needs-refinement |  |  | Run Muse Spark under Claude Code via cliproxy — only the paid Zen model is routable; free tier is OpenCode-client gated; needs credit… |
| 482 | PAN-5464 | L | medium | ok |  |  | Video skill set: Remotion, HyperFrames, OpenMontage, video-use packs + 'video' group; fixes LFS extraction. PRD on main. |
| 483 | PAN-933 | S | medium | ok |  |  | Review poster cannot post to GitLab MRs (only supports GitHub PRs) |
| 484 | PAN-5465 | L | medium | ok |  |  | Add skill packs to a live conversation: /reload-plugins hot apply, resume fallback, CLI, MCP tool, dashboard modal. PRD on main. |
| 484 | PAN-932 | S | medium | ok |  |  | pan done: polyrepo uncommitted changes check + existing MR handling |
| 485 | PAN-5497 | S | medium | ok |  | PAN-5464, PAN-5465 | Follow-up: accept pack groups in pan skills add, add_skills and the Add skills dialog; PAN-5464 and PAN-5465 merged. |
| 485 | PAN-927 | M | medium | ok |  |  | Rewrite containerize route: dead code, orphan processes, no pending-op tracking |
| 486 | PAN-900 | S | medium | ok |  |  | Trust devroot for conversations + atomic .claude.json writes |
| 487 | PAN-886 | S | medium | ok |  |  | pan review request shows 'fetch failed' instead of actual sync-target-branch error |
| 488 | PAN-778 | M | medium | ok |  |  | Write conflict race: review-agent fails when test-agent write scope not yet released |
| 489 | PAN-681 | S | medium | ok |  |  | Feedback routing: wrong issueId written to workspace when verification runs for co-active issues |
| 490 | PAN-3732 | S | medium | ok |  |  | Codex handoff serializes a large rollout twice (~286MB peak RSS on 50MB); serialize once or stream. |
| 491 | PAN-3700 | M | medium | ok |  |  | pan acp serve would let Zed and other ACP clients drive Overdeck conversations through canonical doors. PRD written. |
| 492 | PAN-3290 | XS | medium | ok |  |  | xBRIEF items can carry empty metadata.traces, so docs items sit unanchored in the requirement traceability graph. |
| 493 | PAN-3132 | M | medium | ok |  |  | xBRIEF v0.9 agentic dispatch fields are half-adopted as a behavior accident; make difficulty/filesScope/verifyCommands a contract. |
| 494 | PAN-3909 | M | medium | needs-refinement |  |  | One agents read door (operator-directed); the cut deleted the agents table and made liveness.ts canonical — re-scope what remains |
| 495 | PAN-2659 | S | medium | ok |  |  | acquireRecordLock survives for the planning auto-start consent lock; an ownerless lock after a crash is never reclaimed. |
| 496 | PAN-3831 | S | medium | ok |  |  | Model picker: gray out models whose provider has no API key or subscription login (per-provider readiness resolver) |
| 497 | PAN-4779 | S | medium | ok |  |  | Docs on main: 2 MDX parse errors hide pages from Mintlify + 15 broken vision.mdx links; mint broken-links can't gate |
| 498 | PAN-538 | S | medium | ok |  |  | pan reload freshness guard must also verify the frontend bundle |
| 499 | PAN-1164 | M | medium | ok |  |  | Conversation diff summaries update live over WebSocket (drop 5s polling) |
| 500 | PAN-3563 | S | medium | needs-refinement |  |  | pan unstick is gone; verify whether a spawned-but-never-briefed role agent can still read as running forever under liveness.ts |
| 501 | PAN-1041 | M | medium | ok |  |  | Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template |
| 502 | PAN-924 | L | medium | needs-refinement |  |  | Spike: evaluate GitNexus for Panopticon integration |
| 503 | PAN-3770 | S | medium | ok |  |  | Codex conversations never show the working spinner mid-turn; parser marks every agent_message instantly complete. |
| 504 | PAN-4568 | XS | medium | ok |  |  | Codex sub-agent turn start shows thread: not sub: label; adoption lands one frame late. PAN-4563 replay test has landed. |
| 505 | PAN-3731 | S | medium | ok |  |  | Restart-gate banner gives no feedback after approval; dead-requester approvals read as a broken button. |
| 506 | PAN-3530 | S | medium | ok |  |  | Four God View components poll on 30s timers instead of the documented /ws/rpc event contract. |
| 507 | PAN-3131 | L | medium | ok |  |  | Support xBRIEF planRef sharding so a 1.1MB/227-item plan stops making every finalize failure whole-plan-fatal. |
| 508 | PAN-3061 | M | medium | ok |  |  | Deterministic start-vs-swarm recommendation at plan-finalize, derived from plan shape plus recorded outcomes. |
| 509 | PAN-3057 | S | medium | needs-refinement |  |  | Compaction tracking is gone; remaining bug = GPT-5.6 context window declared twice (372K vs 150K); verify separately |
| 510 | PAN-3892 | M | medium | needs-refinement |  |  | Substrate review follow-ups deferred from PAN-3845 (minor findings, config clear-sentinel); split into workable items |
| 511 | PAN-4918 | M | medium | ok |  |  | Six Anywhere UI bugs seen while filming: Codex keeps Claude model, Zen models listed first, chip wrap, Pull-here state, no remote archive. |
| 512 | PAN-863 | M | medium | ok |  |  | One-shot sweep of stale feature branches and worktrees predating the reaper |
| 513 | PAN-817 | M | medium | ok |  |  | Improve planning dialog layout and content fit |
| 514 | PAN-802 | M | medium | ok |  |  | Resume on conversation session forks instead of resuming |
| 515 | PAN-713 | M | medium | ok |  |  | test: add unit tests for doneCommand and approveCommand |
| 516 | PAN-700 | M | medium | ok |  |  | Detachable terminal for conversation view |
| 517 | PAN-646 | XS | medium | needs-refinement |  |  | Cancel no longer clears beads or a record; a Recover workflow now means reopening the tracker issue and re-planning |
| 518 | PAN-532 | M | medium | ok |  |  | Per-project and per-issue model overrides for pipeline roles |
| 519 | PAN-2896 | M | medium | ok |  |  | Warm resource-discovery and membership caches at boot |
| 520 | PAN-2685 | M | medium | ok |  |  | Annotated live preview: Codex-style annotate-the-app feedback delivered to agents |
| 521 | PAN-2626 | M | medium | ok |  |  | allow composer model switching within the same model family (e.g. Sonnet → Fable) |
| 522 | PAN-5231 | S | medium | ok |  |  | Explorer: retrying Send through pipeline after a partial failure creates a second issue and branch. |
| 522 | PAN-5575 | S | medium | ok |  |  | TTS Voice Map and Utterance Templates offer 10 event keys nothing emits; mapped voices and templates never apply. |
| 523 | PAN-5204 | S | medium | ok |  |  | Voice: mixed 16/24 kHz sample rates on /ws/voice, and dictation turns leak into AutoPreso as errors. |
| 523 | PAN-5574 | S | medium | ok |  |  | Settings TTS Rate is sent to the Qwen3-TTS daemon, which ignores it; fix in the daemon or remove the control. |
| 524 | PAN-2625 | XS | medium | ok |  |  | auto-run /pan-new-project on project creation + setup banner, checklist, teaching empty states, and a guided demo issue |
| 524 | PAN-5577 | S | medium | ok |  |  | Settings Voice input device, output device and volume are saved to localStorage but nothing reads them. |
| 525 | PAN-2608 | M | medium | ok |  |  | Persistent collaboration roles (owner/editor/viewer) and organizations |
| 526 | PAN-2582 | M | medium | ok |  |  | show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lanes) |
| 527 | PAN-2566 | L | medium | ok | ✓ |  | Triage list of genuine Traycer capability gaps; a container for child issues, not directly workable. |
| 528 | PAN-2565 | M | medium | ok |  |  | Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging |
| 529 | PAN-3735 | S | medium | ok |  |  | Sandboxed pan CLI reports 'dashboard down, run pan up' when the real cause is no network; sends agents down the wrong path. |
| 530 | PAN-3335 | XS | medium | ok |  |  | A pasted screenshot can't be viewed anywhere in the dashboard: thumbnail has no click handler and the sent form is a file-link chip. |
| 531 | PAN-3054 | M | medium | ok |  |  | Benchmark matrix, redesigned 2026-09-29 as E6 of the model-routing PRD; its medians feed PAN-4364 and PAN-4367 |
| 532 | PAN-2977 | M | medium | ok |  | PAN-2976 | Settings surface that detects installed ACP CLIs, renders the capability checklist, and guides login without a manual terminal. |
| 533 | PAN-2557 | M | medium | ok |  |  | project-level 'Restart All' context action |
| 534 | PAN-2553 | M | medium | ok |  |  | project-level CI visibility |
| 535 | PAN-2521 | S | medium | ok |  |  | launch pipeline agents with harness rate-limit model-switch reminder disabled |
| 536 | PAN-2493 | M | medium | ok |  |  | align the cockpit Agents-lane and sidebar issue-tree feature sets (two-way gaps) |
| 537 | PAN-3772 | XS | medium | ok |  |  | Conv view renders Claude Code's synthetic 'no visible output' nudge as an operator message; should read as plumbing. |
| 538 | PAN-3853 | S | medium | needs-refinement |  |  | Review synthesizer self-declared an operator override; that override door was deleted by the cut — verify on the PR-review path |
| 539 | PAN-3830 | S | medium | ok |  |  | OpenCode provider: curate picker models via Settings favorites (OpenRouter pattern) instead of listing every discovered model |
| 540 | PAN-4924 | S | medium | ok |  |  | linked-machines.mdx promises switch model for running conversations; dashboard disables it. Fix docs or add the control. |
| 541 | PAN-4367 | M | medium | ok |  |  | Replace inherited capability scores for Sonnet 5.5, GPT-6 Sol/Luna with measured ones; eval harness has closed |
| 542 | PAN-2443 | M | medium | ok |  |  | OpenTelemetry GenAI semconv |
| 543 | PAN-2442 | M | medium | ok |  |  | Agent Client Protocol (ACP) as Overdeck's structured control plane |
| 544 | PAN-2409 | M | medium | ok |  |  | enforce the workspace boundary |
| 545 | PAN-5145 | S | medium | ok |  |  | CLIProxy oauth-model-alias hides gpt-6-sol, gpt-5.6-terra and gpt-5.6-luna by their own ids on claude-code. |
| 546 | PAN-5201 | XL | medium | ok |  |  | Speaker-aware STT: diarizing engines (Speechmatics, AssemblyAI, Muse, Voxtral, NeMo) and one VoiceSettings contract. |
| 547 | PAN-2392 | M | medium | needs-refinement |  |  | Standing Crew survives; panel becomes a cost view from cost_events + tier-metrics; verdict/escalation columns need a new source. |
| 548 | PAN-2335 | XS | medium | ok |  |  | chore: review the full open backlog for junk/stale/nonsensical issues |
| 549 | PAN-2295 | L | medium | needs-refinement |  |  | built-in web browser surface (openable like terminal/Claude Code/Codex) + native Agentation integration |
| 550 | PAN-3767 | S | medium | ok |  |  | Model switch could hang at 'Saving…'; onError toast landed, remaining work is reproducing the hang on a healthy server. |
| 551 | PAN-3615 | S | medium | needs-refinement |  |  | TTS silent 9+ days from four stacked failures; three already fixed, only follow-ups remain — rescope to what is left. |
| 552 | PAN-3558 | S | medium | ok |  |  | Subagent rail shows no model or provider, so mixed-model orchestration needs a transcript open per row to see what it is running. |
| 553 | PAN-3469 | S | medium | ok |  |  | NewProjectModal violates the PAN-3410 page-not-modal doctrine; migrate the create-project flow to a routed page. |
| 554 | PAN-3333 | M | medium | ok |  |  | Model pickers show $/1M, which says nothing under a subscription; show relative plan-quota drain among sibling models. |
| 555 | PAN-3058 | M | medium | ok |  |  | Ship named crew presets that populate the whole tiered_execution block so operators don't hand-build the crew table. |
| 556 | PAN-2288 | L | medium | ok |  |  | tmux managed-server: lossless auto-migration of dirty-founded servers + boot-time ensure call |
| 557 | PAN-2065 | M | medium | ok |  |  | unified usage & headroom panel across all provider plans (z.ai, Anthropic, Codex, OpenRouter) |
| 558 | PAN-2031 | M | medium | ok |  |  | ohmypi: add Bun 1.3.11 regression test to checkOhmypi doctor gate |
| 559 | PAN-2026 | M | medium | ok |  |  | ohmypi: surface 35+ provider matrix in dashboard model picker |
| 560 | PAN-2025 | M | medium | ok |  |  | ohmypi: extend provider credential passthrough for Groq, Cerebras, Fireworks |
| 561 | PAN-4366 | M | medium | ok |  |  | Plan the Haiku 4.5 successor and give workhorse:cheap a consumer or drop it; gated on E4 summary-faithfulness |
| 562 | PAN-5314 | S | medium | ok |  |  | CodeRabbit follow-up on PR #5313 (CLIProxy pool): body-read timeout, cache-miss coalescing, reset timestamps. |
| 563 | PAN-5267 | S | medium | ok |  |  | CodeRabbit follow-up on PR #5266: escalation limit and caching transient GraphQL errors as missing issues. |
| 564 | PAN-2004 | M | medium | ok |  |  | Resumable Planning node: double-click a planned issue's Planning to resume the planning agent |
| 565 | PAN-1995 | M | medium | ok |  |  | infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only) |
| 566 | PAN-3739 | S | medium | ok |  |  | cost-reconcile re-warns every model-less codex subthread rollout on every sweep; log flood grows without bound. |
| 567 | PAN-4393 | XS | medium | ok |  |  | ac-eval-fixtures requires observable:false >= 8 but honest labeling of all specs yields 6; lower the floor |
| 568 | PAN-1985 | M | medium | ok |  |  | Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation |
| 569 | PAN-1968 | M | medium | ok |  |  | Finish local-domain rename: pan.localhost → overdeck.localhost |
| 570 | PAN-1967 | M | medium | needs-refinement |  |  | Flywheel must re-validate (re-plan) pre-cutover plans before implementing them |
| 571 | PAN-1965 | M | medium | ok |  |  | Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue) |
| 572 | PAN-1937 | M | medium | ok |  |  | feat: data export |
| 573 | PAN-1926 | M | medium | ok |  |  | --big flag to lift strike's precision-only scope guard (operator-authorized larger strikes) |
| 574 | PAN-1916 | M | medium | ok |  |  | configurable web search providers (Exa, Tavily, Brave, Perplexity) |
| 575 | PAN-1854 | M | medium | ok |  |  | Define handoff strategy for large conversations: external vs source authoring + tail-biased read |
| 576 | PAN-1853 | M | medium | ok |  |  | Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers) |
| 577 | PAN-1852 | XS | medium | ok |  |  | Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval data |
| 578 | PAN-1844 | M | medium | ok |  |  | Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity notifications link to the specific view |
| 579 | PAN-5202 | XL | medium | ok |  | PAN-5201 | Flux: experimental live meeting page capturing open items, ticket proposals and diagrams. Depends on PAN-5201. |
| 580 | PAN-5141 | M | medium | ok |  |  | Reviewer pairing code: multi-day, reusable, restart-safe code so app store review can pair unattended. |
| 581 | PAN-1840 | M | medium | ok |  |  | Add 'pan switch <id>' |
| 582 | PAN-1839 | M | medium | ok |  |  | Settings → Providers: show each provider's default harness in the collapsed row (no expand needed) |
| 583 | PAN-1776 | M | medium | ok |  |  | Hot-updatable message delivery: version-stamped supervisors + server-side delivery logic |
| 584 | PAN-3706 | L | medium | ok |  |  | Broadsheet shipped typography only; color, surface, elevation and texture still on Ledger values, so it doesn't read like Subspace. |
| 585 | PAN-3539 | XS | medium | needs-refinement |  |  | OOMPolicy=continue fix landed with the issue; re-scope to whatever hardening remains or close it out. |
| 586 | PAN-3502 | XS | medium | needs-refinement |  |  | tiered-crews blendedCost expectation stale vs pricing catalog; likely already fixed by the PAN-3532 cherry-pick — verify. |
| 587 | PAN-4409 | M | medium | ok |  |  | Overdeck integration on OKF v0.2.0 (injector trust tiers, new verbs); blocked on external eltmon/okf#9 |
| 588 | PAN-4410 | M | medium | ok |  | PAN-4409 | Migrate eltmon/overdeck-knowledge to OKF v0.2 and refresh stale concepts; last link in the OKF chain |
| 589 | PAN-2978 | S | medium | ok |  | PAN-2976, PAN-2977 | Opt-in per-agent install recipes for ACP CLIs from the setup UI; deliberately separated for its supply-chain trust decision. |
| 590 | PAN-4878 | XS | low | ok |  |  | Delete dead ox curl installer in prereqs registry; PAN-4852 builds ox from the pinned fork commit, so ~/.local/bin/ox is never used. |
| 591 | PAN-1754 | M | medium | ok |  |  | surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings page |
| 592 | PAN-1751 | M | medium | ok |  |  | harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flywheel |
| 593 | PAN-1750 | M | medium | ok |  |  | UAT assembly/conflict agent |
| 594 | PAN-1748 | M | medium | ok |  |  | reuse uat-assembly conflict resolutions across generations (rerere or resolution replay) |
| 595 | PAN-1691 | M | medium | ok |  |  | conflict-aware merge train + on-demand UAT candidate |
| 596 | PAN-1685 | XS | medium | ok |  |  | Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit |
| 597 | PAN-1676 | M | medium | ok |  |  | Harden Fly remote workspaces + pan workspace move; work-agent spill policy now specified in PAN-5241. |
| 598 | PAN-1667 | M | medium | ok |  |  | unify Agents + Resources into one issue-centric holistic view |
| 599 | PAN-1657 | M | medium | ok |  |  | feat: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer |
| 600 | PAN-1656 | M | medium | ok |  |  | Skills page: make it a full management surface (browse, review, edit, scope, sync status) |
| 601 | PAN-1655 | M | medium | ok |  |  | Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly |
| 602 | PAN-1654 | XS | medium | ok |  |  | run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace) |
| 603 | PAN-1653 | XS | medium | ok |  |  | batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace) |
| 604 | PAN-5309 | S | low | ok |  |  | CodeRabbit minor findings on the PAN-5283 Flywheel page redesign; verify each against main before fixing. |
| 605 | PAN-5308 | S | low | ok |  |  | CodeRabbit findings on the PAN-5282 CLIProxy v8 upgrade: config-write ordering, Windows upgrade staging. |
| 606 | PAN-1623 | M | medium | ok |  |  | Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion) |
| 607 | PAN-1561 | M | medium | ok |  |  | feat: Project-scoped dashboard nav (deck of tabs per project + conversations/tree column + activity feed) |
| 608 | PAN-1550 | M | medium | ok |  |  | BrowserPane half only; the FilesPane half is superseded by the PAN-5183 file explorer, whose children have all closed. |
| 609 | PAN-1545 | XS | medium | ok |  |  | New Terminal button |
| 610 | PAN-1542 | XS | medium | ok |  |  | Spawn-refusal modal: render the three-button workflow on dirty-workspace 409 |
| 611 | PAN-1524 | M | medium | ok |  |  | Slash command aliases: /handoff → /pan-handoff (and similar short forms) |
| 612 | PAN-1490 | M | medium | ok |  |  | show each conversation's current git branch (port t3code BranchToolbar pattern) |
| 613 | PAN-1485 | S | medium | needs-refinement |  |  | Remaining scope after #4655 auto-settle: day-10 archive + favorite clearing; close-or-keep is an operator call. |
| 613 | PAN-5578 | XS | low | ok |  |  | pan-tts SKILL.md and EXTERNAL-EVENT-STREAM.md cite a private sidecar, port 3000, 2048-dim embeddings, stale catalog. |
| 614 | PAN-1473 | M | medium | ok |  |  | Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately) |
| 615 | PAN-1443 | M | low | stale |  |  | Specs live directly under .pan/specs now; only check that no stale legacy files remain under docs/prds/ |
| 616 | PAN-1442 | M | medium | ok |  |  | Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo |
| 617 | PAN-1432 | M | medium | ok |  |  | Merge agent leaves packages/contracts/dist stale |
| 618 | PAN-1223 | M | medium | ok |  |  | Auto-update for users in the field (npm + desktop binaries) |
| 619 | PAN-1165 | M | medium | ok |  |  | Lightweight review path for small/trivial PRs |
| 620 | PAN-1151 | XS | medium | ok |  |  | Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating |
| 621 | PAN-4360 | S | medium | ok |  |  | Add pan claude upgrade and offer the Claude Code upgrade in pan install / pan sync; PAN-4359 has closed |
| 622 | PAN-1060 | M | medium | ok |  |  | Self-modify permission handling: stop the interrupt loop without weakening the safety guard |
| 623 | PAN-1051 | M | medium | ok |  |  | feat: Subspace-inspired alternate theme with Inter + JetBrains Mono |
| 624 | PAN-1037 | M | medium | ok |  |  | Retire 'planning-' tmux prefix |
| 625 | PAN-958 | M | medium | ok |  |  | Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification |
| 626 | PAN-949 | M | medium | ok |  |  | feat: add conversation for project from sidebar |
| 627 | PAN-3157 | XS | medium | ok |  |  | Rescoped: Awareness rail should show conv-flywheel as the Flywheel with its last tick (derive-status.ts) and link to /flywheel. |
| 628 | PAN-5067 | M | medium | ok |  |  | Skill overrides: bad-YAML issue file is overwritten on write (data loss), license detection gaps, Pi ignores --pack silently. |
| 629 | PAN-4908 | S | low | ok |  |  | Other remote-not-enabled messages name no file and the dead verb 'pan remote setup'; reuse PAN-4905's remoteEnabledHint(). |
| 630 | PAN-5130 | S | medium | ok |  |  | pan project add gains --issue-prefix for any tracker; --linear-team becomes a deprecated alias. Follow-up to closed PAN-51. |
| 631 | PAN-947 | M | medium | ok |  |  | feat: project management actions in unified sidebar |
| 632 | PAN-938 | M | medium | ok |  |  | Fizzy visual pipeline |
| 633 | PAN-903 | M | medium | ok |  |  | Detect ~/.claude.json corruption on startup and surface it in the dashboard |
| 634 | PAN-902 | XS | medium | ok |  |  | Settings: add 'Run pan sync' button to configuration menu |
| 635 | PAN-901 | XS | medium | ok |  |  | Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch |
| 636 | PAN-818 | M | medium | ok |  |  | Make summary optional when forking conversations |
| 637 | PAN-4308 | S | medium | ok |  |  | Settle reaped Fly remote transcripts into the Session Vault; PAN-4295 auto-reap landed, still blocked by PAN-2609 (engine). |
| 638 | PAN-3322 | XS | medium | ok |  |  | launcher-generator.ts's file-size ceiling sits 126 lines above the real file, handing back the regrowth the ratchet exists to prevent. |
| 639 | PAN-678 | M | medium | ok |  |  | pan work issue --auto: headless planning → agent handoff without interactive dialog |
| 640 | PAN-675 | M | medium | needs-refinement |  |  | Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets |
| 641 | PAN-654 | L | medium | ok |  |  | Project Setup Wizard |
| 642 | PAN-649 | M | medium | ok |  |  | Render Excalidraw drawings inline in Claude Code conversations |
| 643 | PAN-637 | XS | medium | ok |  |  | Direct issue kickoff (skip planning) from dashboard UI |
| 644 | PAN-629 | M | medium | ok |  |  | Workspace quotas and resource governance |
| 645 | PAN-613 | M | medium | needs-refinement |  |  | Investigate thinking effort levels for agents |
| 646 | PAN-607 | M | medium | needs-refinement |  |  | Evaluate Ultimate Bug Scanner (UBS) for verification gate |
| 647 | PAN-606 | M | medium | needs-refinement |  |  | Evaluate MCP Agent Mail for inter-agent communication and file reservations |
| 648 | PAN-548 | M | medium | ok |  |  | Command Deck: preserve state across navigation including URL routing for tabs |
| 649 | PAN-546 | M | medium | ok |  |  | Remove claude-code-router |
| 650 | PAN-537 | M | medium | ok |  |  | feat: show changed files diff summary after each agent response in activity view |
| 651 | PAN-531 | XS | medium | ok |  |  | PAN: Windows Electron support (WSL2 required) |
| 652 | PAN-452 | M | medium | ok |  |  | Conversation input bar |
| 653 | PAN-450 | M | medium | ok |  |  | Adopt remaining Effect patterns |
| 654 | PAN-1126 | M | medium | ok |  |  | Integrate TLDR summaries into review context manifest |
| 655 | PAN-5154 | L | low | needs-refinement |  |  | GitHub account, token and host per owner (work accounts, GHES). Not scheduled; needs a PRD first. |
| 656 | PAN-1066 | M | medium | ok |  |  | Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module |
| 657 | PAN-3441 | L | low | ok |  |  | God View 'River' WebGL pipeline visualization fed by the live hook-event stream; PRD and mockup exist. |
| 658 | PAN-2968 | M | low | ok |  |  | Adopt the interactive decision page as the default way to present operator decisions |
| 659 | PAN-2941 | M | low | stale |  |  | Superseded by OKF v0.2: drafts plus human verify replace the PR gate (eltmon/okf#6); semantic pass is eltmon/okf#7 |
| 660 | PAN-2936 | M | low | ok |  |  | Handle loop.max_steps_exceeded: detect and nudge agents to continue instead of stranding them |
| 661 | PAN-4373 | M | medium | ok |  |  | Optional Jev relevance filter for prompt-time memory injection candidates; both prerequisites have closed |
| 662 | PAN-2868 | M | low | ok |  |  | Desktop window opens at fixed 1400×900 |
| 663 | PAN-2767 | M | low | ok |  |  | Expose Codex app-server conversation controls in the dashboard |
| 664 | PAN-2679 | M | low | ok |  |  | conv-lookup skill: resolve transcripts for codex and pi harness conversations |
| 665 | PAN-2662 | M | low | ok |  |  | Add project context-menu actions scoped to issues currently in the pipeline |
| 666 | PAN-2645 | M | low | ok |  |  | Add opt-in Observation-first conversation view |
| 667 | PAN-2635 | XS | low | ok |  |  | pay down the 152-error src/dashboard/server typecheck debt |
| 668 | PAN-5066 | M | medium | ok |  |  | Project skills in .pan/skills skip the CLI workspace fallback, never refresh, lose to bundled skills, and never reach Codex/Pi. |
| 669 | PAN-3443 | L | low | ok |  |  | God View 'Spectrum Deck' visualizer concept with mockup and PRD; pure exploration, no substrate impact. |
| 670 | PAN-4350 | M | medium | needs-refinement |  |  | Re-dispatch budget for foreman items; issue itself flags an unresolved conflict with the no-stored-state rule |
| 671 | PAN-4003 | L | medium | ok |  |  | Parked: delete the ohmypi/omp harness, keep Pi; obsoletes 10 open ohmypi issues and shrinks PAN-3958's CH-7 scope |
| 672 | PAN-4368 | S | medium | ok |  |  | Operator-run checklist: verify Sonnet 5.5 across switch-model, fork and compaction (model-locked thinking blocks) |
| 673 | PAN-2622 | M | low | ok |  |  | cloister.toml materializes ALL defaults into the user file |
| 674 | PAN-2600 | XS | low | ok |  |  | Retire the Codex TUI path after app-server burn-in (no-loss audit gate) |
| 675 | PAN-2533 | XS | low | ok |  |  | UAT workspace magic-link login 502: Traefik picks unreachable panopticon IP for multi-homed fe/api |
| 676 | PAN-2527 | M | low | ok |  |  | Harness selector should restrict OpenAI models to Claude Code only |
| 677 | PAN-2514 | M | low | ok |  |  | Claude Code Traffic Inspector |
| 678 | PAN-2505 | M | low | ok |  |  | lint:circular reports new frontend cycles + stale baseline in chat/conversations components |
| 679 | PAN-2504 | M | low | ok |  |  | Auto-relaunch npx @overdeck/core under a compatible Node 22+ instead of failing on old Node |
| 680 | PAN-2449 | M | low | ok |  |  | start-planning: GITHUB_REPOS env shadows projects.yaml github_repo; unknown IDs fall through to Linear and plan the wrong issue |
| 681 | PAN-4769 | XS | low | ok |  |  | Two-sentence wording fix in features/skill-packs.mdx; PAN-4759 created the page and closed, so this is unblocked. |
| 682 | PAN-3940 | XL | low | ok | ✓ |  | Parked epic: event-driven plugin/hook system on pipeline-notifier + hygiene-scheduler; do not pick up until the journal has soaked |
| 682 | PAN-5608 | S | low | ok |  |  | Orders routes resolve .pan from raw project.path, CLI via issue_routing; latent split for routed projects. Never fired yet. |
| 683 | PAN-2424 | L | low | ok | ✓ |  | Epic: the Order Book |
| 684 | PAN-2406 | S | low | ok |  |  | Remaining scope: findAllWorkspacePaths must also enumerate -strike-wt and named-suffix worktrees; gaps 1 and 3 are moot. |
| 685 | PAN-2394 | M | low | ok |  |  | Incident: conv-* agent-dir cleanup destroyed ohmypi/codex conversation transcripts ("no saved history") |
| 686 | PAN-4823 | XL | medium | ok | ✓ |  | Epic: Capacitor phone client for Anywhere without Tailscale; 15 children filed (#4828-4843); OD-1 settled; PAN-4774 done. |
| 687 | PAN-2353 | M | low | needs-refinement |  |  | Overdeck Anywhere P1b: Hermes external-agent bridge (scoped API + Fly 6PN) |
| 688 | PAN-5518 | S | medium | needs-refinement |  |  | roles.<role>.harness validates but no pipeline spawn reads it; CLI help says it is a default. Needs honor-or-retire decision first. |
| 689 | PAN-3133 | S | low | ok |  |  | Evaluation spike for TRON encoding of prompt-bound xBRIEF payloads; savings are modest today since agents get a bounded slice. |
| 690 | PAN-5082 | XL | medium | ok |  |  | Move every MCP surface to SDK v2 for the 2026-07-28 spec while keeping 2025-11-25 clients; time it on PAN-5083 data. |
| 691 | PAN-3011 | M | low | ok |  | PAN-465 | Add poolside Laguna S 2.1 as a model target; the honest hardware note says it will not fit this machine's GPU. |
| 692 | PAN-2282 | M | low | ok |  |  | Conversation view shows no history for ohmypi-harness conversations |
| 693 | PAN-2091 | XS | low | ok |  |  | delete dead IssueCockpitBody cockpit subtree (8 files, superseded by IssueMissionControl) |
| 694 | PAN-2085 | M | low | ok |  |  | Auto-isolate conversations in a lightweight git worktree (Conductor-style workspaces) |
| 695 | PAN-2084 | M | low | ok |  |  | Auto-create lightweight conversation worktrees on project chats |
| 696 | PAN-2083 | M | low | ok |  | PAN-1592 | Composer: a failed first send leaves the text in BOTH the composer box and the retry outbox |
| 697 | PAN-2082 | M | low | ok |  |  | Composer: a single send failure clears ALL in-flight optimistic bubbles (and strips siblings' compaction net) |
| 698 | PAN-2074 | XS | low | ok |  |  | research: evaluate ponytail (DietrichGebert/ponytail) for prompt compression and consider building in-house |
| 699 | PAN-2046 | M | low | stale |  |  | Conversation view does not surface terminal command responses |
| 700 | PAN-2006 | M | low | ok |  |  | Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Run definition |
| 700 | PAN-5487 | XS | low | ok |  |  | pan scope --help says it moves xBRIEF files; the code rewrites status fields in place. Reword 5 descriptions. |
| 701 | PAN-3919 | S | low | needs-refinement |  |  | Review the universal effort-high default and supervisor effort discretion; explicitly an operator decision, no work authorized |
| 701 | PAN-5550 | XS | low | ok |  |  | pan reload --force is a no-op and help plus core-commands.mdx still claim a deploy-window bypass; remove or define it. |
| 702 | PAN-2005 | M | low | ok |  |  | Backlog Sequencer: Pickup Forecast |
| 703 | PAN-2002 | XS | low | ok |  |  | [HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID) |
| 704 | PAN-1999 | M | low | ok |  |  | Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN) |
| 705 | PAN-1986 | M | low | ok |  |  | restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row |
| 706 | PAN-1983 | L | low | ok |  |  | Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy) |
| 707 | PAN-2672 | S | low | needs-refinement |  |  | Transcript half reported fixed; parent-stays-ended half moved to PAN-4485. Verify on current build, then close. |
| 708 | PAN-1958 | M | low | ok |  |  | Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source) |
| 709 | PAN-1907 | M | low | ok |  |  | Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-selectable + validate every… |
| 710 | PAN-1895 | M | low | ok |  |  | Spawn work agents from issue workspace slide-out |
| 711 | PAN-1878 | M | low | ok |  |  | process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts |
| 712 | PAN-1782 | M | low | ok |  |  | Handoff forks stall at "Injecting…" then die on double 300s summary timeout |
| 713 | PAN-1773 | M | low | ok |  |  | Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762) |
| 714 | PAN-1646 | M | low | ok |  |  | Rabbit-hole drift detection and lift-to-new-conversation |
| 715 | PAN-1643 | M | low | ok |  |  | Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker |
| 716 | PAN-1592 | M | low | ok |  |  | Composer: make ephemeral composer state reload-durable (pasted images + unsent/failed message text) |
| 717 | PAN-1581 | M | low | ok |  |  | Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled across project+user sync |
| 718 | PAN-1533 | M | low | ok |  |  | Fork-into-worktree from conversation branch chip |
| 719 | PAN-1483 | XS | low | ok |  |  | Distinguish general-use skills from Panopticon-only dev skills in pan sync |
| 720 | PAN-1482 | M | low | ok |  |  | Token spend report should aggregate data from repo, not just local machine |
| 721 | PAN-1481 | M | low | ok |  |  | Add cost-event telemetry for Caveman token savings |
| 722 | PAN-1356 | M | low | ok |  |  | Extend the memory Observation pipeline to ad-hoc conversations |
| 723 | PAN-1242 | M | low | ok |  |  | Create a new issue directly from a kanban column |
| 724 | PAN-1222 | M | low | ok |  |  | Project-templated DB lifecycle: auxiliary databases + seed refresh from prod |
| 725 | PAN-1208 | M | low | ok |  |  | Polyrepo: support non-feature 'main' workspaces alongside feature-* |
| 726 | PAN-4352 | XS | low | ok |  |  | Operator verification: skill packs in a managed interactive Claude Code launch now that PAN-4334 has shipped |
| 727 | PAN-1153 | M | low | ok |  |  | Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' |
| 728 | PAN-4298 | XL | low | needs-refinement |  | PAN-1676 | Anywhere paid tier: run agents on hosted Fly capacity; tenant isolation, credentials, metering open; PAN-1676 unbuilt |
| 729 | PAN-1152 | XS | low | ok |  |  | Remove PANOPTICON_DEV env-var persistence |
| 730 | PAN-1135 | M | low | ok |  |  | Document the hook system in docs/HOOKS.md |
| 731 | PAN-1133 | M | low | stale |  |  | Deacon-patrol tie-in for TLDR supervision is gone; would need its own liveness check |
| 732 | PAN-1123 | XS | low | ok |  |  | Channels delivery: surface failures, add fallback toggle, route conversations through channels |
| 733 | PAN-1121 | M | low | ok |  |  | Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction |
| 734 | PAN-4248 | L | medium | ok |  |  | List, pull and delete local Ollama models (size, store, in-use) in CLI, dashboard and doctor; PAN-1641 sidecar has merged. |
| 735 | PAN-1117 | M | low | ok |  |  | Memory: pinned docs (long-form doc chunking + retrieval) |
| 736 | PAN-1116 | M | low | ok |  |  | Memory: cross-project search mode |
| 737 | PAN-1065 | M | low | ok |  |  | Validate issueId at every shell-string interpolation site (defense in depth) |
| 738 | PAN-1064 | M | low | ok |  |  | Harden launcher generation against shell-quote injection (model and arg quoting) |
| 739 | PAN-1063 | M | low | ok |  |  | Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound |
| 740 | PAN-3971 | L | low | ok |  |  | Overdeck-native artifact pages (pan artifact publish + state door + dashboard listing); body says backlog only, Claude artifacts work today |
| 741 | PAN-3768 | XS | low | ok |  |  | pan handoff --title already implemented and landed (678f6b389e5); open only pending close-out. |
| 742 | PAN-3034 | XS | low | ok |  |  | Fix already landed on main (strike/slot workspace names and live tmux now seed the session tree); open pending close-out. |
| 743 | PAN-2983 | M | low | stale |  |  | Superseded by the OKF v0.2 redesign: write modes and drafts (eltmon/okf#6) and the advisory semantic pass (eltmon/okf#7) |
| 744 | PAN-3824 | XS | low | needs-refinement |  |  | Image-only report: default view on Windows breaks the model selector; needs a written repro and expected behavior |
| 745 | PAN-3823 | XS | low | needs-refinement |  |  | Image-only report titled "pan sync issue"; needs the command, output text, and expected behavior |
| 746 | PAN-1049 | M | low | needs-refinement |  |  | Spike: evaluate Tauri v2 desktop shell |
| 747 | PAN-984 | XS | low | needs-refinement |  |  | Evaluate context-mode MCP server as session continuity + search layer |
| 748 | PAN-5431 | XS | low | ok |  |  | CodeRabbit minor follow-up on PR #5429 (PAN-5424): RELEASING.md direct vs transitive deps wording; native path in a test assertion. |
| 748 | PAN-5629 | XS | low | ok |  |  | 3 Minor CodeRabbit findings on merged PAN-5599 PR #5627: order-book docs wording and a post-backfill detail snapshot. |
| 749 | PAN-962 | M | low | needs-refinement |  |  | Post-PAN-946: vBRIEF lifecycle follow-up plan |
| 750 | PAN-961 | M | low | ok |  |  | Update documentation for vBRIEF v0.6 lifecycle model |
| 751 | PAN-5365 | S | low | needs-refinement |  |  | MCP memory_add gains a source param now that PAN-5360 shipped; the supersedes-on-agent-surface decision is still open. |
| 752 | PAN-943 | M | low | ok |  |  | Add memory file review and management command |
| 753 | PAN-908 | M | low | ok |  |  | PAN-908: Make work-agent spawn limits configurable and overridable |
| 754 | PAN-898 | M | low | ok |  |  | Dashboard polling and WebSocket efficiency: remaining audit findings |
| 755 | PAN-853 | L | low | needs-refinement |  |  | Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration |
| 756 | PAN-833 | M | low | ok |  |  | Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader) |
| 757 | PAN-832 | M | low | needs-refinement |  |  | state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActivity |
| 758 | PAN-4347 | S | low | ok |  |  | pan done appends continue.json decisions to the PR body so significant decisions outlive the workspace |
| 759 | PAN-797 | M | low | needs-refinement |  |  | Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy |
| 760 | PAN-4275 | S | low | ok |  |  | Prove a local Ollama model can finish a real work-agent task; gemma4:12b made zero tool calls. PAN-1641 has merged. |
| 761 | PAN-2836 | M | low | needs-refinement |  |  | Placement presets now belong on eltmon/okf#4 after the OKF v0.2 redesign; migrate verb collides; re-scope or move upstream |
| 762 | PAN-790 | L | low | ok |  |  | PAN-789: Eliminate remaining TanStack Query polling |
| 763 | PAN-786 | M | low | ok |  |  | Post planning Q\&A answers as issue comment |
| 764 | PAN-777 | M | low | ok |  |  | Inter-agent communication skill: send messages to conversation-mode agents |
| 765 | PAN-775 | L | low | ok |  |  | Redesign workspace inspector panel: sidebar layout is cramped and wrong |
| 766 | PAN-3456 | XS | low | ok |  |  | Already fixed in 4117c9a777 with a regression test; open only pending close-out. |
| 767 | PAN-774 | XS | low | ok |  |  | Unify launch UX and release pipeline for 1.0 |
| 768 | PAN-773 | XS | low | ok |  |  | Design prompt-style overlays with model hierarchy and scoped toggles |
| 769 | PAN-772 | M | low | stale |  |  | Auto-resume ladder paths it names are gone; terminal-stack consistency now means the Herdr/tmux contract in TERMINAL-BACKENDS.md |
| 770 | PAN-771 | M | low | needs-refinement |  |  | Investigate Vercel Sandbox execution backend support |
| 771 | PAN-769 | M | low | stale |  | PAN-750 | Phase-transition history no longer accumulates in a record; a churn metric would be rebuilt from PR review cycles or the pipeline journal |
| 772 | PAN-765 | M | low | ok |  |  | Preserve trailing zeros in cost displays |
| 773 | PAN-764 | M | low | ok |  |  | Add quota/usage inspector for routed model providers |
| 774 | PAN-4425 | M | low | ok |  |  | Deft fork work in eltmon/directive (env off switch, external-orchestrator mode); outside the overdeck pipeline |
| 775 | PAN-752 | M | low | ok |  |  | Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro |
| 776 | PAN-751 | M | low | ok |  |  | Historical Metrics Data Persistence |
| 777 | PAN-750 | L | low | ok |  |  | Complete Metrics Page Redesign |
| 778 | PAN-749 | M | low | needs-refinement |  |  | Research and borrow best features from gstack |
| 779 | PAN-747 | XS | low | ok |  |  | Conversation list items lack accessible labels in accessibility tree |
| 780 | PAN-743 | XS | low | ok |  |  | Add consistent new conversation icon actions in Command Deck |
| 781 | PAN-738 | M | low | ok |  |  | Add right-click fork option to conversation list |
| 782 | PAN-735 | M | low | ok |  |  | Settings page: review and configure overridden subagent model files |
| 783 | PAN-730 | M | low | ok |  |  | Add provider account telemetry for credits, balances, and usage |
| 784 | PAN-701 | XS | low | ok |  |  | Quick-Create conversation via keystroke using Conversations-page default model |
| 785 | PAN-663 | XS | low | ok |  |  | Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces |
| 786 | PAN-660 | M | low | ok |  |  | Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen |
| 787 | PAN-624 | M | low | ok |  |  | Loop nodes: iterative agent execution with conditional termination |
| 788 | PAN-623 | M | low | ok |  |  | Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks |
| 789 | PAN-622 | M | low | ok |  |  | YAML workflow DAGs: custom per-project pipeline definitions |
| 790 | PAN-604 | M | low | ok |  |  | Hide planning agent from workspace detail pane |
| 791 | PAN-603 | M | low | ok |  |  | Plan review loop with configurable reviewer model |
| 792 | PAN-591 | XS | low | ok |  |  | Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates |
| 793 | PAN-589 | XS | low | ok |  |  | Review and update commands-skills.md with all available Panopticon skills |
| 794 | PAN-576 | M | low | ok |  |  | Global / search should include conversations in addition to workspace features |
| 795 | PAN-571 | XS | low | ok |  |  | Add OpenRouter credits/plan status endpoint and UI |
| 796 | PAN-568 | M | low | ok |  |  | Kanban: Show workspace and tmux session counts in stats |
| 797 | PAN-565 | M | low | ok |  |  | Handle CTRL-Z to undo accidental conversation archival |
| 798 | PAN-564 | M | low | ok |  |  | Slash menu positioned incorrectly |
| 799 | PAN-554 | M | low | ok |  |  | Add kanban board deeplinks for issue URLs |
| 800 | PAN-543 | M | low | ok |  |  | Add confirmation dialog before applying Optimal Defaults |
| 801 | PAN-483 | M | low | ok |  |  | Unify Resume Agent UX |
| 802 | PAN-480 | M | low | needs-refinement |  |  | Planning-agent --effort; likely covered by merged PAN-4249 resolver and PAN-4258 (plan effort), confirm or close |
| 803 | PAN-476 | M | low | ok |  |  | Agent resume with Haiku session summary instead of claude --resume |
| 804 | PAN-468 | M | low | ok |  |  | Agent test conversations pollute production database |
| 805 | PAN-461 | M | low | ok |  |  | Deep-wipe multi-step progress dialog |
| 806 | PAN-459 | M | low | ok |  |  | Planning setup screen with SSE progress streaming |
| 807 | PAN-407 | XS | low | ok |  |  | Run Panopticon from a main workspace for development isolation |
| 808 | PAN-2348 | XS | low | ok |  |  | docs: migrate STATE-STORAGE-AUDIT.md content to living docs, then delete |
| 809 | PAN-2346 | XS | low | ok |  |  | docs: refresh AGENT_TYPES_INDEX.md to the post-Cut taxonomy in ROLES.md (xBRIEF items, foreman, conv-flywheel, worker role). |
| 810 | PAN-2345 | XS | low | ok |  |  | docs: rewrite pan-done.md against done.ts + done-preflight.ts; fix continue path; point MERGE link at MERGE-WORKFLOW.md. |
| 811 | PAN-2344 | XS | low | needs-refinement |  |  | docs: rewrite KANBAN-MODEL.md for the current pipeline; relabeled needs-rescope, so scope must be restated before work. |
| 812 | PAN-2343 | XS | low | ok |  |  | docs: rewrite MISSION-CONTROL.md: state label from deriveStateLabel, membership, liveness.ts; review_status table is gone. |
| 813 | PAN-2073 | XS | low | ok |  |  | docs: add user-facing page for the Desktop App |
| 814 | PAN-2071 | XS | low | ok |  |  | docs: add user-facing page for the Hooks system |
| 815 | PAN-2068 | XS | low | ok |  |  | docs: add user-facing page for Caveman (agent output compression) |
| 816 | PAN-2067 | XS | low | ok |  |  | docs: add user-facing page for RTK (Bash output compression) |
| 817 | PAN-1684 | XS | low | ok |  |  | build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed |
| 818 | PAN-1683 | XS | low | ok |  |  | docs: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md) |
| 819 | PAN-1474 | M | low | ok |  |  | Add ACKNOWLEDGEMENTS doc |
| 820 | PAN-1469 | M | low | ok |  |  | End-to-end review and consolidation of all project documentation |
| 821 | PAN-674 | XS | low | ok |  |  | docs: add glossary of Panopticon domain terms |
| 822 | PAN-634 | M | low | ok |  |  | Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs |
| 823 | PAN-2908 | M | low | ok |  |  | Make overdeck not suck |
| 824 | PAN-106 | M | high | stale |  |  | Cost prediction/estimation for in-progress work |
| 825 | PAN-262 | M | high | stale |  |  | Refactor post-merge lifecycle into composable, idempotent operations |
| 826 | PAN-176 | M | high | stale |  |  | PAN-176: Hook-enforced delegation guardrails for specialist agents |
| 827 | PAN-334 | S | medium | stale |  |  | Dashboard server has no duplicate-process protection |
| 828 | PAN-324 | XS | medium | needs-refinement |  |  | Approval is now a PR review or the dashboard MERGE button; verify whether the agent detail pane already surfaces MERGE post-cut |
| 829 | PAN-304 | S | medium | stale |  |  | closeLinearDirect returns stepOk even when state update never happens |
| 830 | PAN-245 | S | medium | stale |  |  | Ctrl+C aborts planning dialog instead of copying text |
| 831 | PAN-244 | S | medium | stale |  |  | Deep-wipe leaves local branch and worktree metadata behind |
| 832 | PAN-4332 | M | low | ok |  |  | Interop: continue t3code sessions in Overdeck and back via native transcripts; PAN-2609 Phase A has closed |
| 833 | PAN-113 | S | medium | stale |  |  | Dashboard 'Start Agent' returns success before verifying agent actually started |
| 834 | PAN-49 | XS | medium | stale |  |  | Fix CloisterService tests that require real runtime |
| 835 | PAN-294 | M | medium | stale |  |  | Surface module initialization errors as system-level, not per-issue |
| 836 | PAN-293 | M | medium | stale |  |  | Project Living Memory |
| 837 | PAN-277 | M | medium | stale |  |  | Session reasoning capture & collaborative PRD refinement |
| 838 | PAN-258 | M | medium | stale |  |  | Kanban board: fit all columns without horizontal scrolling |
| 839 | PAN-255 | M | medium | stale |  |  | Agents lack awareness of MCP tools |
| 840 | PAN-252 | XS | medium | stale |  |  | Disable Sync with Main button when workspace is up to date |
| 841 | PAN-243 | M | medium | stale |  |  | Audit dashboard actions: ensure all are available via CLI |
| 842 | PAN-77 | XS | medium | stale |  |  | Cost breakdown modal: show costs by stage and model when clicking cost badge |
| 843 | PAN-54 | L | medium | stale |  |  | e2e command for full workflow integration test |
| 844 | PAN-38 | M | medium | stale |  |  | Support multiple merge agents per repository |
| 845 | PAN-37 | M | medium | stale |  |  | Support external PR selection for merge-agent |
| 846 | PAN-3248 | XS | low | stale |  |  | Stale: targets the deploy patrol (pan reload is the new home) deleted by the PAN-3917 cut (ca15def); re-triage or close |
| 847 | PAN-3244 | S | low | stale |  |  | Stale: targets the deploy-patrol deploy window deleted by the PAN-3917 cut (ca15def); re-triage or close |
| 848 | PAN-2775 | S | low | needs-refinement |  |  | Stale: targets boot-correlated reaping (boot reconciliation) deleted by the PAN-3917 cut (ca15def); re-triage or close |
| 849 | PAN-5033 | XS | medium | ok |  |  | OpenClaw Connect a bot snippet omits hooks.allowConversationAccess, so the needs-you summary stays off with no message. |
| 850 | PAN-3505 | XS | low | needs-refinement |  |  | Stale: targets the flywheel state write door deleted by the PAN-3917 cut (ca15def); re-triage or close |
| 851 | PAN-5043 | S | medium | ok |  |  | Commit the phone-app iOS Simulator harness (Miniflare connect stand-in, stub account service, rig steps) built twice by hand. |
| 852 | PAN-5065 | L | medium | ok |  |  | Opt-in mode where a project's agents and gates stop seeing ~/.overdeck.env keys the project did not list. |
| 853 | PAN-3321 | XS | low | stale |  |  | Stale: targets pan unstick deleted by the PAN-3917 cut (ca15def); re-triage or close |
| 854 | PAN-736 | M | low | stale |  |  | Retired: work-types.ts, WorkTypeRouter and models.overrides are all gone (#4174); per-subagent routing needs a fresh roles.* design |
| 855 | PAN-762 | M | low | stale |  |  | Premise gone: models.overrides is a retired, ignored key since #4174, so there are no overrides left to warn about |
| 856 | PAN-299 | M | low | stale |  |  | Granular session state persistence across context compaction |
| 857 | PAN-298 | M | low | stale |  |  | Auto-detect package manager and runtime in workspace setup |
| 858 | PAN-297 | M | low | stale |  |  | Workspace templates: pre/post tool hooks for auto-format, typecheck, lint |
| 859 | PAN-283 | M | low | stale |  |  | Reset should sync workspace feature branch with latest main |
| 860 | PAN-271 | M | low | stale |  |  | Auto-assign Linear project from project config when creating issues |
| 861 | PAN-265 | M | low | stale |  |  | Review skill categorization: all skills available everywhere via personal + workspace |
| 862 | PAN-249 | XS | low | stale |  |  | Add data-testid attributes across dashboard UI and create Playwright smoke test suite |
| 863 | PAN-228 | M | low | stale |  |  | Shift-left post-edit diagnostics |
| 864 | PAN-227 | M | low | stale |  |  | Phase gate validation |
| 865 | PAN-198 | M | low | stale |  |  | Structured audit trail for agent actions |
| 866 | PAN-190 | M | low | stale |  |  | PAN-190: Specialized reviewer prompts (industry best-practice checklists) |
| 867 | PAN-180 | M | low | stale |  |  | PAN-180: Cross-terminal file locking for concurrent agents |
| 868 | PAN-177 | M | low | stale |  |  | PAN-177: Iteration limits with escalation for autonomous agents |
| 869 | PAN-175 | M | low | stale |  |  | PAN-175: Pre-compact auto-save hook for agent sessions |
| 870 | PAN-155 | L | low | stale |  |  | PAN-155: Redesign health page with Stitch (system overview, timeline, costs) |
| 871 | PAN-146 | M | low | stale |  |  | PAN-146: Refine light mode theming across all dashboard pages |
| 872 | PAN-55 | M | low | stale |  |  | Track specialist costs with time period filtering |
| 873 | PAN-44 | M | low | stale |  |  | Planning should fetch ALL issue context: comments, attachments, linked issues, discussions |
| 874 | PAN-2070 | XS | low | needs-refinement |  |  | Likely done: PAN-5470 shipped features/flywheel.mdx for the loop skill; verify and close. |
| 875 | PAN-3536 | S | low | needs-refinement |  |  | Subsumed by PAN-4003 (OMP harness removal): pan tell can not reach ohmypi conversations; fix dies with the harness |
| 876 | PAN-2027 | M | low | needs-refinement |  |  | Subsumed by PAN-4003 (OMP harness removal): routing kimi-k2 through ohmypi needs a different home once OMP is gone |
| 877 | PAN-2035 | M | low | needs-refinement |  |  | Subsumed by PAN-4003 (OMP harness removal): Copilot provider routing via omp |
| 878 | PAN-2034 | M | low | needs-refinement |  |  | Subsumed by PAN-4003 (OMP harness removal): end-to-end test for ohmypi tool-call rendering |
| 879 | PAN-2033 | M | low | needs-refinement |  |  | Subsumed by PAN-4003 (OMP harness removal): ohmypi message-delivery latency benchmark |
| 880 | PAN-2032 | M | low | needs-refinement |  |  | Subsumed by PAN-4003 (OMP harness removal): local Ollama review role via omp |
| 881 | PAN-2030 | M | low | needs-refinement |  |  | Subsumed by PAN-4003 (OMP harness removal): version-pin the ohmypi extension |
| 882 | PAN-2029 | M | low | needs-refinement |  |  | Subsumed by PAN-4003 (OMP harness removal): ohmypi-parser thinking_tokens capture |
| 883 | PAN-2028 | M | low | needs-refinement |  |  | Subsumed by PAN-4003 (OMP harness removal): per-provider cost grouping keyed on omp |
| 884 | PAN-2024 | XS | low | needs-refinement |  |  | Subsumed by PAN-4003 (OMP harness removal): ohmypi conversation Tools-toggle |
| 885 | PAN-2883 | M | high | needs-refinement |  |  | Appears already fixed: resolveIssuePullRequestRef probes strike/<id> at pull-requests.ts:209, which is exactly the fix. Verify and close. |
| 886 | PAN-2995 | XS | high | needs-refinement |  |  | Same defect as PAN-2828, closed as a duplicate of the fixed #2907; verifyStrikeBranchMergedIntoMain already checks PR-merge and content. |
| 887 | PAN-4555 | XS | low | ok |  |  | Date-gated: start on/after 2026-12-01. Raise gemini-4-argon and gemini-4-carbon pricing rows to list rates. |
| 888 | PAN-5449 | M | low | ok |  |  | Unblocked: PAN-4590 sast gate merged. A skipped sast scan renders as a green pass; add skipped state + findings list. |
| 889 | PAN-5434 | M | low | ok |  |  | Codex apply_patch post-edit Semgrep scan; needs a hooks.json composer shared with SageOx. PAN-4591 merged; live Codex probe first. |
| 890 | PAN-5453 | M | low | ok |  |  | One-time $3 Creem 'Extra 50 GB relay' product, per-account relayCapBytes and a live entitlement push to connect. Billing landed. |
| 891 | PAN-5455 | M | low | ok |  |  | SIGNUP_MODE invite|open switch for overdeck.ai plus abuse limits; opening sign-up is the operator's launch call. Billing landed. |
| 892 | PAN-4593 | L | low | needs-refinement |  |  | Semgrep Platform/Guardian tier; operator decisions (offer Guardian? contact Semgrep first?) still open — refine before work. |
| 893 | PAN-5022 | L | medium | ok |  |  | Phone app: relay notification preferences to offline machines via the directory, and drop muted pushes on the phone. |
| 894 | PAN-5021 | M | low | needs-refinement |  |  | PAN-5100 landed phone telemetry with conflicting decisions; re-scope to any remaining gap or close as superseded. |
| 895 | PAN-5029 | M | medium | needs-refinement |  |  | Grok Build Tailscale reach can't work: pan mcp serve verifies tokens only against its own machine. Needs a design choice. |
| 896 | PAN-4842 | S | medium | ok |  |  | Phone app W-DOC: phone-app.mdx and updates to Anywhere, push, tailscale and service docs; finished last. |
| 897 | PAN-4851 | S | low | needs-refinement |  |  | Open question: opt-in Overdeck reviewer for Deft-pipeline issues; operator says low priority, do not plan or start without them |
| 898 | PAN-4887 | M | medium | ok |  |  | Phone app: let phone credentials reach linked machines (fleet Needs-you, linked-conv proxy, /ws/linked); PAN-4835 merged. |
| 899 | PAN-5207 | L | low | needs-refinement |  | PAN-5202 | Parked by the operator: Flux meeting bots for Zoom, Teams, Meet, Slack as a paid integration. Do not start. |
| 900 | PAN-5456 | M | low | needs-refinement |  | PAN-4297 | +100 GB hosted vault add-on; billing model (Creem per-unit vs variants) undecided; needs hosted vault PAN-4297 first. |
| 901 | PAN-5181 | XS | low | ok |  |  | Fix shipped in PR #5179 (merged 2026-11-13); the body says it closes on merge. Verify and close. |
| 902 | PAN-5305 | XS | low | ok |  |  | Main build break already fixed: needsYou.ts imports from needsYouRows and main CI is green. Verify and close. |
| 903 | PAN-5444 | XS | low | ok |  |  | Two Minor CodeRabbit findings left on merged PR #5443: semgrep repo rules resolve from event cwd; hook tests not isolated from Docker. |
| 904 | PAN-5405 | S | medium | ok |  |  | CodeRabbit follow-up on PR #5403: changes-query refetch after turns, Send menu keyboard/scheduling guard, tab-menu focus. |
| 905 | PAN-2423 | XS | low | stale |  |  | Likely fixed: rebuild now uses the PAN-3049 resolver (docker.ts:181) and reap has no hardcoded prefix; confirm and close. |

## Rationale detail

### PAN-5637 (rank 1)

New since the prior run and already in the pipeline, so it is pinned at rank 1. The ready set requires green checks on every member MR, and MYN's infra and docs repos have no CI, so MIN-1144 and MIN-1146 can never queue; the fix site and a safe opt-in field are named, so it is ok and S-sized.

### PAN-5638 (rank 1)

New since the prior run and already in the pipeline, so it is pinned at rank 1. It replaces the PAN-5614 stopgap that refuses GitHub-member verdicts and teaches githubRows to read verdict markers, which unblocks polyrepo issues like MIN-1142 from reaching the merge train.

### PAN-5654 (rank 1)

Already in the pipeline, so pinned at rank 1. A flaky Robolectric runtime download turns the test aggregate red on PRs that touch no mobile code, as it did on PR #5651 for PAN-5250.

### PAN-5657 (rank 1)

New CodeRabbit follow-up on the merged PAN-5652 Herdr liveness fix, already in the pipeline, so pinned at rank 1. Two Major findings are liveness misreports in merge-ops and the cloister service, which is substrate hardening at the same tier as PAN-5653.

### PAN-5652 (rank 2)

New substrate bug: merge-ops.ts and several cloister modules test agent liveness with tmux has-session, which is always false on Herdr, the default backend. It failed the MIN-1144 polyrepo merge within 50 seconds while the agent was finishing the rebases, so it blocks polyrepo merges and sits beside the polyrepo merge cluster (PAN-5637, PAN-5638, PAN-5641) in a free rank slot. The fix routes these checks through liveness.ts and adds a ratchet; it touches merge routes, so it needs a supervised handoff.

### PAN-5013 (rank 3)

Substrate bug in the same class as PAN-4666 (rank 10): three more readers treat Herdr's done state, which means the harness is alive and waiting, as no live agent. Derived issue state feeds pickup and respawn, so a wrong answer here can launch duplicate agents. Small, well-located fix, so it takes the rank-2 slot freed by the closure of PAN-4998.

### PAN-5430 (rank 4)

New issue, sibling of the just-merged front-matter fix PAN-5427, and already queued in the active workflow-redesign order book, so it takes free rank 4 behind critical PAN-5013. It is a small, well-specified MarkdownTab change with named tests, a sanitising allow-list and a concrete acceptance check on the README preview; its parent epic PAN-5284 is closed, so it carries no contains edge.

### PAN-5567 (rank 5)

New bug: on the default Codex transport the permission setting is silently ignored, so a Read-only choice still lets agents write. A safety setting that does nothing ranks with the top substrate fixes; the fix is small and well specified.

### PAN-5489 (rank 6)

Unchanged rank: a 2026-11-22 comment adds an unconfirmed related start_issue 500 for MIN-1142; the CLI env-dependence bug still strands Flywheel planning.

### PAN-5566 (rank 7)

New bug: operators choose Auto believing it gates destructive calls, and a project .pan.yaml can switch agents to bypass/full-access. Item 6 needs a decision (strip the keys or document); the text fixes are mechanical.

### PAN-5385 (rank 8)

New issue. Phones (iOS, Android) and the connector cannot reach the machine at all, directly or through the relay, because RtcTransport.accept awaits ICE servers before registering the signalling session and drops trickle candidates that arrive in that window. The root cause and the fix (buffer candidates from offer acceptance) are stated in the body and touch only the dashboard server, so this is a small, well-defined fix for a full outage of a shipped feature. It takes the open rank-8 slot ahead of the remaining pipeline-substrate bugs.

### PAN-5633 (rank 9)

New bug with a traced root cause: classifyNativeCodexAuth treats any refresh token as valid and nothing writes the codex-auth-burned flag, so a Codex app-server conversation failed silently for 14 hours. It ranks beside PAN-5567 (the other Codex app-server substrate gap) because silent agent failure undermines every Codex-routed conversation and worker.

### PAN-4636 (rank 10)

New substrate bug with a verified root cause: adoption (PAN-4605) calls startReview without skipPlanChecklist, so every adopted outside PR fails incomplete-plan-items and, with no work agent, the feedback is delivered nowhere. It is currently stalling the critical in-pipeline PAN-4630 fix, so it takes the rank-5 slot freed by the closure of PAN-4534.

### PAN-5523 (rank 10)

Rank unchanged; PAN-5516 closed, so that dependency is removed.

### PAN-5625 (rank 10)

New bug with live evidence: the merge train and the per-PR auto-merge scheduler each defer to the other, so an approved, green PR in a new standalone GitHub project never merges. That blocks the pipeline's final step for every newly registered project, so it ranks with the other merge-path blockers.

### PAN-5641 (rank 10)

New since the prior run. It is the last step before a polyrepo batch can merge: in-pipeline PAN-5637 and PAN-5638 fix admission and verdicts, but promote eligibility and the board still read one PR from the non-git MYN root. The fix site and the reuse of memberReposForProject are named, so it is ok and ranks just behind its in-pipeline siblings.

### PAN-4553 (rank 11)

Rank unchanged; its duplicate PAN-4929 entered the pipeline with an open PR, so this issue now waits on that PR instead of being picked up separately.

### PAN-5640 (rank 11)

New since the prior run and filed minutes before PAN-5641 with the same first cause, so it carries a duplicate risk. Its unique second cause (GitLab's MR listing omits head_pipeline, so checks never read green) must ride with PAN-5641 or be scoped to that alone.

### PAN-4733 (rank 12)

Rank held: parent PAN-4732 (move heavy e2e out of the default shards) closed as completed on 2026-11-01, so this follow-up is now unblocked and next in line.

### PAN-4710 (rank 13)

New issue, ranked into the rank-10 slot beside PAN-4554. When pan start --plan auto finishes planning while the pipeline is busy, the deferred hand-off retries without the agent_count_high/memory_tight acknowledgement the first attempt sends, so it is refused below the ceiling until the attempt cap gives up with no operator signal; PAN-4663 and PAN-4670 sat three hours without work agents. It is substrate work with a precise root cause and testable ACs, but it carries needs-handoff (TENET-10), so it lands through a supervised handoff, and a manual second pan start is a working fallback, so it ranks high rather than critical.

### PAN-4554 (rank 14)

New issue, ranked into the open rank-7 slot beside PAN-4553. The paved road (pan start with auto-planning) promises the work agent starts after planning finalizes, but on mind-your-now seven issues reached planned with no work agent, so every auto-planned start silently stalls until an operator re-runs pan start. It ranks high rather than critical because a manual second pan start is a working fallback, and it may share a cause with the PAN-4553 workspace-setup abort that preceded it. A 2026-11-14 comment adds an overdeck instance (PAN-5232), so it is not polyrepo-only; rank and importance unchanged because a second pan start still works. PAN-5526 (its likely root cause) merged on 2026-11-18, so the first step is to re-test and close if fixed; rank unchanged.

### PAN-5527 (rank 14)

Rank unchanged; PAN-5526 merged, so that dependency is removed and the remaining scope (resuming an interrupted promotion) can now be refined.

### PAN-5529 (rank 14)

Rank unchanged; PAN-5498 closed, so that dependency is removed.

### PAN-4666 (rank 15)

New substrate bug in the Flywheel's own status read model: a second liveness rule in derive-status.ts hides live agents, so the loop or operator may respawn running work; small fix with clear ACs, ranked beside PAN-4636 as critical but labeled needs-handoff (TENET-10), so it goes through a supervised pan handoff.

### PAN-4547 (rank 16)

Operator decision 2026-10-04 after the Flywheel closed 19 deployed issues by hand. With false DoD refusals fixed by PAN-4543, auto close-out only needs a patrol on the existing verify-on-main path and live settings. High because unclosed issues distort every pipeline view.

### PAN-4511 (rank 17)

pan spawn is the foreman's pane-only item worker, so parallel waves cannot run any item through it on either backend. The test suite never asserts argv, so it stayed green. Small fix with a clear expected behavior.

### PAN-5447 (rank 18)

New issue. Like PAN-4544 and PAN-5381, it blocks the dashboard event loop: each search runs a 1.1 s synchronous vector scan, superseded keystroke searches are never aborted, and stacked scans froze unrelated routes for 4.8 s. The root cause is measured and the fix direction is concrete, so it ranks with the other event-loop blockers.

### PAN-5381 (rank 19)

New follow-up to in-pipeline PAN-5369 from the same main-thread CPU profile: about 40 call sites, several on poll paths, each pay (projects+1) synchronous realpath calls, so it is the next-largest cause of a frozen dashboard after the orphan scan. Small, verified in code, with a mechanical acceptance test, so it ranks directly after PAN-5369.

### PAN-4544 (rank 20)

Follow-up to PAN-4543, which fixed the summary route. The Pipeline view polls this route in the background, so every poll freezes all HTTP and WebSocket traffic for ~1.6 s and can fail DoD health probes. The async reader already exists, so the fix is small.

### PAN-4551 (rank 21)

Moves 705 importing files off a four-month-old beta onto the supported line, which is substrate hardening. PAN-4527, PAN-4531 and PAN-4540 closed on 2026-10-24, so it now waits only on PAN-4534 (in pipeline); rank holds at 14.

### PAN-4671 (rank 22)

New substrate fix to the merge door that closes the gap which let PAN-4672's findings merge unreviewed; advisory-only with a clear design and ACs, but TENET-10 requires a supervised handoff.

### PAN-4675 (rank 23)

New this pass. addLabel in merge-agent.ts uses Effect.promise, so one gh network timeout becomes a defect that skips pausing agents and stopping the stack, and the merge door then refuses re-runs with Already merged. PAN-4299 is stuck half-closed right now, and pan close refuses on DoD row 5. Substrate bug with clear AC, so it slots into the free rank 19 beside the other merge and close-out fixes; it overlaps PAN-3557 (label retry), and fixing either should consult the other.

### PAN-4705 (rank 24)

New since the prior pass. A latent race in the PAN-4546 admission test fails whole CI shards with an unhandled ENOENT on PRs that never touch it (seen on #4703), costing verification attempts pipeline-wide. It sits beside PAN-4680, the sibling flake fix, because both keep CI verification honest; the fix is small and scoped to one test file or publishExclusive.

### PAN-4746 (rank 25)

New flaky-test bug: a background membership-snapshot write races the test's teardown rmSync and turned an unrelated PR's CI shard red. Ranked next to PAN-4705, the same leaked-async-work-vs-teardown pattern, because each red shard costs a PR a rerun on the path to merge.

### PAN-5104 (rank 26)

Its only dependency, PAN-5103 (Fable 5.2 rollout), closed as completed, so the XS rebuild is unblocked; rank held at 20 because it is a cost-accuracy fix, not pipeline substrate.

### PAN-4572 (rank 27)

PAN-4560 merged (closed completed 2026-10-20), so this follow-up is now unblocked; rank held at 19 near the top tier because its offenders are already measured and file-referenced.

### PAN-4586 (rank 28)

New issue. Verified against herdr 0.9.1: HerdrApiClient.call returns response.result, whose pane_read text sits under read.text, but readHerdrPaneText, diagnoseDetectionFailure and the herdr-submit composer read a top-level text, so every pane-text consumer on the default backend sees an empty string. A three-site fix plus corrected test stubs; placed in a free rank slot just above the Herdr pane-sizing pair (PAN-4582, PAN-3952) because it is smaller and likely explains part of PAN-3952's 'pane read returns nothing' observation.

### PAN-4217 (rank 29)

New bug discovered on PAN-4199. The vbrief-ac verification gate and the pan done preflight both count acceptance-criterion sub-items, but updateSubItemStatus has no production caller and the feedback names a nonexistent 'pan task close' verb, so every plan with nested ACs fails verification until an agent hand-writes a script. It blocks the pipeline's verification step directly, so it ranks critical in the free slot right after the other in-pipeline pickup blockers.

### PAN-4219 (rank 30)

New bug filed from PAN-4201: pan done refused completion on 36 acceptance-criterion sub-items that no supported verb can close, and the vbrief-ac feedback names a nonexistent pan task close. It ranks critical and right behind PAN-4217 because it blocks completion of every issue planned with nested ACs, the default planner shape. It is marked needs-refinement because PAN-4217 already describes the same missing writer (updateSubItemStatus has no production caller) including the done-preflight half, so it should be closed as a duplicate or fixed by the same change.

### PAN-4708 (rank 31)

New substrate-improvement issue, the second hot-file conflict source after in-pipeline PAN-4697; on 2026-11-01 it forced merge-main cycles and fresh head reviews on three PRs. It takes the free rank 27 beside its sibling so no other node moves, and it stays needs-refinement because the body asks for a decision among three fixes (frontmatter-generated nav, per-group fragments, JSON merge driver) before work starts.

### PAN-4229 (rank 32)

New bug filed from PAN-4222: after all eleven top-level items were closed through pan task done, pan done refused on 39 pending acceptance-criterion children that pan task next never surfaced, and the agent had to make 39 empty trailer commits to get through. It blocks completion of every issue planned with nested ACs, the default planner shape, so it ranks critical beside PAN-4217 and PAN-4219. It is marked needs-refinement because it describes the same missing AC-status writer as PAN-4217 and PAN-4219; the three should be fixed by one change and the extras closed as duplicates.

### PAN-3050 (rank 33)

Raised from 205: a 2026-11-23 comment found the 2h full-stack reap tier inert for every project (labels mis-parsed), feeding today's gate-queue memory starvation (PAN-5621). Fix is small but turns on stopping postgres/redis, so it needs its own review.

### PAN-3566 (rank 33)

New this pass and the highest-leverage fix in the batch: the test-role launcher's final exec has no -p, no positional prompt and no piped stdin, so the role boots an interactive REPL and never takes a turn. That single missing argument is the deterministic producer of the zombie test agents tracked in PAN-2706, PAN-3563 and PAN-3274 — three separate hardening issues chasing one root cause. Reproduced across eight session IDs, so there is no diagnosis left to do.

### PAN-5537 (rank 33)

New pipeline bug found while planning PAN-5468: the review.approved event has no producer, so the reactive test-role dispatch is dead and the failed-UAT merge block can never fire. CI tests still gate merge, so it is high rather than critical. It sits beside PAN-3566 (test-role launcher boots an idle REPL), since both must be fixed before the test role does anything; the plan agent picks between re-emitting the event and retiring the step.

### PAN-3952 (rank 34)

On the default backend the harness TUI renders into a one-line terminal until an operator opens it, so stuck detection, readiness scans, health capture, AUQ/permission detection and screenshots all see nothing. Deterministic pane sizing in the Herdr adapter is a small change with fleet-wide effect.

### PAN-3285 (rank 35)

New this pass, labelled critical. A supervisor unit pinned to a pan reload generation SIGTERMs every correctly-running dashboard and is structurally incapable of starting a replacement; the observed outcome was a 3.5-hour total outage with 1,107 consecutive failed recovery attempts and no operator escalation. Manual recovery also fails, because the supervisor kills the operator's dashboard within 30 seconds. Nothing else in the backlog can take the whole product down for hours with the recovery path itself broken.

### PAN-3524 (rank 36)

Triage: verify the --changed verification-loop relaunch against deacon-lite's smaller suppression surface. Kept in the critical band: an unstoppable server-owned test loop is the worst kind of runaway.

### PAN-4166 (rank 37)

New issue (2026-09-24), the only delta since the prior run. pushPlanArtifacts replays the whole local range through git merge-tree, so one superseded rendering of .pan/backlog/sequence.md aborts the push and origin keeps serving a stale ranked order that the Flywheel reads for pickup; the silent reset --keep refusal then adds another unpushed commit every run, so the failure compounds. Ranked 31 rather than into the vacated top slots: the acute incident was hand-repaired (main is level with origin, the identical untracked drafts removed), so the bug is latent until the next untracked-draft collision, and it ranks behind the actively-biting pipeline blockers at 19-30 while staying in the critical band because a stale sequence misdirects every Flywheel pickup. Root cause is verified in the body with a named file, a proposed fix, and three mechanical acceptance criteria.

### PAN-3250 (rank 38)

New this pass, labelled blocks-main and substrate. Two spawn sites branch from the local HEAD or defaultBranch instead of origin/main, so every new feature branch inherits whatever unpushed commits are sitting on the shared local main. Four branches were already contaminated when it was filed, two of them created after the problem was identified, and their PRs read MERGEABLE/CLEAN. It spreads with each spawn, so the cost of leaving it grows.

### PAN-3946 (rank 39)

Merge-safety bug seen on PR #3933: an approval on fd3334e6 satisfied the request for head ae9d82f0. Approval must count only when its commit_id is the current head; add --force as the explicit override.

### PAN-5632 (rank 39)

New issue from CodeRabbit on PR #5631: classifyRepoHead trusts merge parents and ignores the tree, so the verification gate can adopt a pass for a head whose extra edits nothing verified. Small, well-specified fix with named tests; ranked beside PAN-3946, the same class of stale-verdict head-identity gap.

### PAN-2954 (rank 40)

Dependency cleared: PAN-2882 (the missing GitLab merged-MR oracle this blocked on) closed since the last pass, so postMergeLifecycle's GitLab refusal is now directly workable. Re-ranked up from 67 to sit with the other unblocked critical merge-path fixes.

### PAN-3935 (rank 41)

The PAN-2858 defect in a new shape: complete-planning promotes to the primary checkout, where nothing commits, and removes the workspace copy the planning commit would have picked up. Evidence: untracked pan-3927.md on main. Also a write-to-main hazard.

### PAN-3657 (rank 42)

New this pass. The merge-train queues endpoint correctly gathers eligible candidates and then hands them to the monorepo queue builder, which does git rev-parse against a polyrepo project root that is not a git repository — so every polyrepo project's train is permanently empty while monorepo projects populate fine. MYN and Auricle cannot use merge trains at all until this lands.

### PAN-4240 (rank 44)

A second incident on 2026-11-04 (MIN-1135) widened the bug: after a merged MR the reaper removed the whole workspace, destroying untracked evidence files and nested worktrees that the merged-branch check never covers. Rank holds at 39 because it is already critical; the fix must now gate on untracked/nested content, not only branch merge state.

### PAN-3565 (rank 45)

New this pass. Three review-lifecycle defects, one of them severe: when all four reviewer lanes died at spawn on a record lock, the supervisor wrote a synthesis declaring CHANGES REQUESTED with every lane marked failed — an infrastructure flake recorded as a real code verdict. It was caught only because a human was watching live. Same integrity family as PAN-3283 and PAN-2746.

### PAN-3554 (rank 46)

New this pass. Main stayed red for about five hours because nothing owns the state 'the latest main-push CI run failed' — no needs-you, no activity entry, no strike recommendation. The failure actively hides itself: the merge gate renders red main as an empty eligible set, so the operator sees a quiet queue rather than an alarm. Detection must not depend on the flywheel being awake, since it frequently is not. Condition changed after the PAN-3917 cut: the merge gate that rendered red main as an empty queue was deleted by the cut; red-main ownership still needs a home — re-scope.

### PAN-3532 (rank 47)

New this pass. The CI test job runs root npm test, whose frontend leg is a hand-picked list of files, so two frontend test files were red on main for hours while every main CI run reported success. Green CI that does not mean green is worse than no CI, because every downstream gate and every close-out trusts it.

### PAN-4241 (rank 48)

New this pass. computeWorkspaceRepoRoots builds its fallback candidate by joining the workspace path with an absolute repoPath, so any polyrepo repo whose configured name differs from its directory is never found. That makes pan task done refuse valid Item trailers and also affects head snapshots and merge completeness for MYN. The fix is a one-line candidate change plus a test, and a symlink workaround exists, so it ranks high rather than critical.

### PAN-5167 (rank 49)

New substrate bug placed in a freed critical-tier slot. One transient fetch failure leaves a merged issue in_review with a live agent and needs manual kill plus pan close --force, the same failure class as PAN-4675.

### PAN-4396 (rank 50)

New issue. The test-skip verification gate fails every branch whose diff exceeds 1 MiB before it inspects a test, as PAN-4362 showed; that blocks verification outright for large but legitimate PRs. The fix is one maxBuffer argument, so it ranks in the critical pipeline block.

### PAN-3085 (rank 51)

New this pass and a one-line class of defect with outsized cost. Review feedback is written to the resolved .overdeck/feedback directory but the path handed to the work agent is a hardcoded .pan/feedback that no longer exists after the rebrand, and the deacon merge gate reads the same dead path. Agents are told to fix findings they cannot find, and the gate counts zero feedback files no matter how many exist. Condition changed after the PAN-3917 cut: the deacon merge gate is gone; only the agent-side .pan/feedback path pointer remains to verify — re-scope.

### PAN-3653 (rank 52)

New this pass, labelled blocks-main. A strike that correctly stops because its gate is blocked by red main has no owner that wakes it when main goes green: the session stays alive, so liveness calls it healthy and pan recover refuses with 'already has a live harness runtime'. The urgent path exists precisely to unblock the pipeline fast, so a strike that silently idles through the clearing of its own blocker defeats the mechanism.

### PAN-3630 (rank 53)

New this pass. pan tell reported successful delivery three times to a live, heart-beating agent, moved all three messages into the read mailbox, and the agent's transcript shows it received none of them. The delivery door is the sanctioned way every part of the system talks to a running agent; a door that lies about delivery makes every downstream 'we told it' claim unreliable.

### PAN-3805 (rank 54)

Idle remediation is now deacon-lite nudge routines; triage asks to verify the Codex app-server delivery bypass against that implementation. The persistent-session invariant still forbids codex exec; rank held.

### PAN-5139 (rank 55)

New substrate bug placed in a freed critical-tier slot. Any launch from the non-live generation repoints the shim, after which every pan reload refuses, so merged fixes stop shipping.

### PAN-3560 (rank 56)

New this pass. Under concurrent review convoys the PTY supervisor returns 502 'input echo confirmation failed' fleet-wide, so no agent can be booted or re-booted and pipeline feedback delivery fails while load is high — confirmed across at least six unrelated agents in one hour. Delivery failing exactly when the pipeline is busiest is what turns a load spike into a stall.

### PAN-3520 (rank 57)

New this pass. The test gate records a real 'test failed' verdict for uniform 5000ms timeout signatures under host load, proven on multiple branches where the same files pass in isolation in about 19 seconds. Every false verdict costs a full rework cycle and another saturated re-test, so this is both a correctness and a cost fix. Retrying timeout-only failures in isolation before writing a verdict is the minimal change.

### PAN-4439 (rank 58)

New issue. The polling backstop for the CI failure relay was deleted in the Cut, so a check that completes while the dashboard reloads is never relayed and the PR stalls. Reloads are frequent, and its stated dependency PAN-4432 has closed, so it ranks high in the pipeline block.

### PAN-4392 (rank 59)

New issue. hasTrailerCommit greps all reachable history, so generic item ids such as docs or tests are satisfied by any merged commit and the checklist gate certifies work that was never committed. It is a gate-integrity hole with an XS fix.

### PAN-3500 (rank 60)

New this pass. A review sub-role that had already written its report was resumed by a later message and edited seven tracked files, and pan start --fresh then auto-committed those reviewer-owned changes into the feature history during sync-main. Review isolation is currently prompt-level only; it has to be mechanical, because a contaminated branch is very hard to detect after the fact.

### PAN-3313 (rank 61)

New this pass. A transient upstream stream error benches CLIProxy's only auth entry, so every GPT-routed request returns 503 auth_unavailable until an internal cooldown lapses — 35 failures against 14 successes in one hour, with valid credentials throughout. The message reads as 'your credentials are gone' and sends the operator to re-authenticate, which fixes nothing. Every GPT-routed agent on the machine is affected at once.

### PAN-3282 (rank 62)

New this pass. Review agents terminate before writing their report across five issues and two projects, twice recurring after a successful recovery, leaving a verdict-shaped status with no artifact behind it and a stuck flag that blocks progress until someone restarts the reviewer by hand. This is the upstream condition PAN-3283 then converts into a false passed verdict.

### PAN-4391 (rank 63)

New issue. Worker delegation is the supported path for sub-tasks, and it fails outright in every polyrepo workspace, so MYN issues cannot delegate without a manual --cwd workaround. Polyrepo correctness bugs sit in the high band in this sequence.

### PAN-4390 (rank 64)

New issue. Workspace creation for a polyrepo project reports failure and omits the workspace from pan workspace list although it is usable, which misleads every caller. It belongs with the other polyrepo substrate bugs.

### PAN-2695 (rank 65)

Concurrent review dispatches race fresh-spawn vs resume, second dispatch resumes a still-booting parent and wedges.

### PAN-2742 (rank 66)

Synthesis fires 42s after spawn and mislabels reviewers-with-reports-on-disk as infra-failure, bypassing review.

### PAN-2706 (rank 67)

Triage: verify whether a never-kicked-off test session can still absorb dispatch under the current liveness model. Rank held.

### PAN-5228 (rank 68)

New pipeline bug placed in a freed critical-tier slot. Reviews whose reviewers die after a CodeRabbit post are never re-dispatched, and PAN-5218 widened the masking.

### PAN-4344 (rank 69)

New issue from the Deft adoption PRD. Its dependency PAN-3308 has closed. The main-push guard exists only in the overdeck repo, so agents in other registered projects can still push to main, which is the PAN-2204 hazard class.


<!-- machine-readable; do not hand-edit below this line -->

```json
{
  "version": 1,
  "project": "overdeck",
  "generatedAt": "2026-11-24T06:56:05Z",
  "model": "claude-opus-5-5",
  "pass": "incremental",
  "openCount": 958,
  "nodes": [
    {
      "issue": "PAN-5637",
      "rank": 1,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "In pipeline. Merge train never admits polyrepo issues touching CI-less member repos; add ci: none per repo so MYN infra/docs MRs merge",
      "rationale": "New since the prior run and already in the pipeline, so it is pinned at rank 1. The ready set requires green checks on every member MR, and MYN's infra and docs repos have no CI, so MIN-1144 and MIN-1146 can never queue; the fix site and a safe opt-in field are named, so it is ok and S-sized.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5638",
      "rank": 1,
      "size": "M",
      "importance": "critical",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "In pipeline. Polyrepo review verdicts refuse GitHub member PRs and the ready set ignores verdict markers; MIN-1142 can't merge",
      "rationale": "New since the prior run and already in the pipeline, so it is pinned at rank 1. It replaces the PAN-5614 stopgap that refuses GitHub-member verdicts and teaches githubRows to read verdict markers, which unblocks polyrepo issues like MIN-1142 from reaching the merge train.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5654",
      "rank": 1,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "In pipeline. mobile-android CI goes red on non-mobile PRs when Robolectric android-all download fails; cache the jar.",
      "rationale": "Already in the pipeline, so pinned at rank 1. A flaky Robolectric runtime download turns the test aggregate red on PRs that touch no mobile code, as it did on PR #5651 for PAN-5250.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5657",
      "rank": 1,
      "size": "S",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "In pipeline. 7 CodeRabbit findings on merged PAN-5652; 2 Major: failed pane listing reads as pane-dead, legacy tmux agents read as gone.",
      "rationale": "New CodeRabbit follow-up on the merged PAN-5652 Herdr liveness fix, already in the pipeline, so pinned at rank 1. Two Major findings are liveness misreports in merge-ops and the cloister service, which is substrate hardening at the same tier as PAN-5653.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5652",
      "rank": 2,
      "size": "M",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Herdr agents fail tmux has-session checks, so polyrepo merge aborts on live agents (MIN-1144). Merge routes: TENET-10 handoff.",
      "rationale": "New substrate bug: merge-ops.ts and several cloister modules test agent liveness with tmux has-session, which is always false on Herdr, the default backend. It failed the MIN-1144 polyrepo merge within 50 seconds while the agent was finishing the rebases, so it blocks polyrepo merges and sits beside the polyrepo merge cluster (PAN-5637, PAN-5638, PAN-5641) in a free rank slot. The fix routes these checks through liveness.ts and adds a ratchet; it touches merge routes, so it needs a supervised handoff.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5013",
      "rank": 3,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Liveness, parked route and read-model map a Herdr 'done' pane to stopped; finished-turn agents look dead and may be respawned.",
      "rationale": "Substrate bug in the same class as PAN-4666 (rank 10): three more readers treat Herdr's done state, which means the harness is alive and waiting, as no live agent. Derived issue state feeds pickup and respawn, so a wrong answer here can launch duplicate agents. Small, well-located fix, so it takes the rank-2 slot freed by the closure of PAN-4998.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5430",
      "rank": 4,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Markdown Preview prints raw HTML (README logo <div>/<picture>) as text; render it via rehype-raw + rehype-sanitize in doc previews.",
      "rationale": "New issue, sibling of the just-merged front-matter fix PAN-5427, and already queued in the active workflow-redesign order book, so it takes free rank 4 behind critical PAN-5013. It is a small, well-specified MarkdownTab change with named tests, a sanitising allow-list and a concrete acceptance check on the README preview; its parent epic PAN-5284 is closed, so it carries no contains edge.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5567",
      "rank": 5,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codex app-server threads hardcode on-request/workspace-write, so Read-only and Full access settings never apply.",
      "rationale": "New bug: on the default Codex transport the permission setting is silently ignored, so a Read-only choice still lets agents write. A safety setting that does nothing ranks with the top substrate fixes; the fix is small and well specified.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5489",
      "rank": 6,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan plan from an agent shell fails workspace creation without HUME_API_KEY, leaves a half-built workspace and hides the cause.",
      "rationale": "Unchanged rank: a 2026-11-22 comment adds an unconfirmed related start_issue 500 for MIN-1142; the CLI env-dependence bug still strands Flywheel planning.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5566",
      "rank": 7,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "UI/help text says Auto blocks destructive calls but the hook approves all; repo .pan.yaml can set bypass mode.",
      "rationale": "New bug: operators choose Auto believing it gates destructive calls, and a project .pan.yaml can switch agents to bypass/full-access. Item 6 needs a decision (strip the keys or document); the text fixes are mechanical.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5385",
      "rank": 8,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Anywhere remote access is down for trickle clients: machine drops ICE candidates sent before session registers; small server fix",
      "rationale": "New issue. Phones (iOS, Android) and the connector cannot reach the machine at all, directly or through the relay, because RtcTransport.accept awaits ICE servers before registering the signalling session and drops trickle candidates that arrive in that window. The root cause and the fix (buffer candidates from offer acceptance) are stated in the body and touch only the dashboard server, so this is a small, well-defined fix for a full outage of a shipped feature. It takes the open rank-8 slot ahead of the remaining pipeline-substrate bugs.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5633",
      "rank": 9,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codex app-server auth burn never flags: banner silent, conv shows isWorking while 578 turns fail over 14h. Detect turn errors.",
      "rationale": "New bug with a traced root cause: classifyNativeCodexAuth treats any refresh token as valid and nothing writes the codex-auth-burned flag, so a Codex app-server conversation failed silently for 14 hours. It ranks beside PAN-5567 (the other Codex app-server substrate gap) because silent agent failure undermines every Codex-routed conversation and worker.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4636",
      "rank": 10,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Adopted outside PRs fail verification on the missing xBRIEF and the failure reaches nobody; stalls PAN-4630's PR silently.",
      "rationale": "New substrate bug with a verified root cause: adoption (PAN-4605) calls startReview without skipPlanChecklist, so every adopted outside PR fails incomplete-plan-items and, with no work agent, the feedback is delivered nowhere. It is currently stalling the critical in-pipeline PAN-4630 fix, so it takes the rank-5 slot freed by the closure of PAN-4534.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5523",
      "rank": 10,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan conversations move/heal send raw fetch with no token, so routes refuse with Missing origin; same fix pattern as in-pipeline PAN-5516.",
      "rationale": "Rank unchanged; PAN-5516 closed, so that dependency is removed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5625",
      "rank": 10,
      "size": "M",
      "importance": "critical",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Approved green PR for new standalone project BT-1 sits 'held'; train never batches and per-PR scheduler defers forever.",
      "rationale": "New bug with live evidence: the merge train and the per-PR auto-merge scheduler each defer to the other, so an approved, green PR in a new standalone GitHub project never merges. That blocks the pipeline's final step for every newly registered project, so it ranks with the other merge-path blockers.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5641",
      "rank": 10,
      "size": "M",
      "importance": "critical",
      "score": 80,
      "condition": "ok",
      "dependsOn": [
        "PAN-5637",
        "PAN-5638"
      ],
      "why": "Polyrepo UAT batch promote and train board read one PR from the non-git root, so no MYN batch can land; walk member repos.",
      "rationale": "New since the prior run. It is the last step before a polyrepo batch can merge: in-pipeline PAN-5637 and PAN-5638 fix admission and verdicts, but promote eligibility and the board still read one PR from the non-git MYN root. The fix site and the reuse of memberReposForProject are named, so it is ok and ranks just behind its in-pipeline siblings.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4553",
      "rank": 11,
      "size": "S",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Duplicate of PAN-4929, now in review as PR #4963; close PAN-4553 when that PR merges.",
      "rationale": "Rank unchanged; its duplicate PAN-4929 entered the pipeline with an open PR, so this issue now waits on that PR instead of being picked up separately.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5640",
      "rank": 11,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-5637"
      ],
      "why": "Overlaps PAN-5641 (derived state reads MRs at non-git polyrepo root); unique part: glab MR list omits head_pipeline, never green.",
      "rationale": "New since the prior run and filed minutes before PAN-5641 with the same first cause, so it carries a duplicate risk. Its unique second cause (GitLab's MR listing omits head_pipeline, so checks never read green) must ride with PAN-5641 or be scoped to that alone.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4733",
      "rank": 12,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to closed PAN-4732: root-cause the title-bar spec, move 4 browser specs to a gating test-e2e lane, un-quarantine it.",
      "rationale": "Rank held: parent PAN-4732 (move heavy e2e out of the default shards) closed as completed on 2026-11-01, so this follow-up is now unblocked and next in line.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4710",
      "rank": 13,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deferred plan hand-off retries omit the guardrail ack, so they're refused at 'agent count high' and give up silently; needs handoff",
      "rationale": "New issue, ranked into the rank-10 slot beside PAN-4554. When pan start --plan auto finishes planning while the pipeline is busy, the deferred hand-off retries without the agent_count_high/memory_tight acknowledgement the first attempt sends, so it is refused below the ceiling until the attempt cap gives up with no operator signal; PAN-4663 and PAN-4670 sat three hours without work agents. It is substrate work with a precise root cause and testable ACs, but it carries needs-handoff (TENET-10), so it lands through a supervised handoff, and a manual second pan start is a working fallback, so it ranks high rather than critical.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4554",
      "rank": 14,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start --plan auto finalizes planning but never spawns the work agent; re-test now that likely root cause PAN-5526 merged.",
      "rationale": "New issue, ranked into the open rank-7 slot beside PAN-4553. The paved road (pan start with auto-planning) promises the work agent starts after planning finalizes, but on mind-your-now seven issues reached planned with no work agent, so every auto-planned start silently stalls until an operator re-runs pan start. It ranks high rather than critical because a manual second pan start is a working fallback, and it may share a cause with the PAN-4553 workspace-setup abort that preceded it. A 2026-11-14 comment adds an overdeck instance (PAN-5232), so it is not polyrepo-only; rank and importance unchanged because a second pan start still works. PAN-5526 (its likely root cause) merged on 2026-11-18, so the first step is to re-test and close if fixed; rank unchanged.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5527",
      "rank": 14,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Overlaps merged PAN-5526 (consent field, unread marker); unique part is resuming a promotion interrupted by a dashboard death.",
      "rationale": "Rank unchanged; PAN-5526 merged, so that dependency is removed and the remaining scope (resuming an interrupted promotion) can now be refined.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5529",
      "rank": 14,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-start hand-off still strands: orphaned consent claims, queued container starts lost on restart, read errors read as revoked.",
      "rationale": "Rank unchanged; PAN-5498 closed, so that dependency is removed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4666",
      "rank": 15,
      "size": "S",
      "importance": "critical",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel status drops live agents whose Herdr pane says 'done'; loop may respawn them. Route via liveness.ts. Needs handoff.",
      "rationale": "New substrate bug in the Flywheel's own status read model: a second liveness rule in derive-status.ts hides live agents, so the loop or operator may respawn running work; small fix with clear ACs, ranked beside PAN-4636 as critical but labeled needs-handoff (TENET-10), so it goes through a supervised pan handoff.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4547",
      "rank": 16,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restore automatic close-out for verifying-on-main issues whose DoD fully passes; close_out.auto inert since PAN-3917",
      "rationale": "Operator decision 2026-10-04 after the Flywheel closed 19 deployed issues by hand. With false DoD refusals fixed by PAN-4543, auto close-out only needs a patrol on the existing verify-on-main path and live settings. High because unclosed issues distort every pipeline view.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4511",
      "rank": 17,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan spawn starts its worker pane with argv '--model <m>' and no harness binary, so foreman item workers never launch",
      "rationale": "pan spawn is the foreman's pane-only item worker, so parallel waves cannot run any item through it on either backend. The test suite never asserts argv, so it stayed green. Small fix with a clear expected behavior.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5447",
      "rank": 18,
      "size": "M",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "Palette search stalls 15s+: sync 5 GB sqlite-vec scan on the event loop; aborted searches keep running and stall /api/version",
      "rationale": "New issue. Like PAN-4544 and PAN-5381, it blocks the dashboard event loop: each search runs a 1.1 s synchronous vector scan, superseded keystroke searches are never aborted, and stacked scans froze unrelated routes for 4.8 s. The root cause is measured and the fix direction is concrete, so it ranks with the other event-loop blockers.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5381",
      "rank": 19,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard main thread: findProjectByPath runs realpathSync on every project root per call (10.8% of profile); cache roots once.",
      "rationale": "New follow-up to in-pipeline PAN-5369 from the same main-thread CPU profile: about 40 call sites, several on poll paths, each pay (projects+1) synchronous realpath calls, so it is the next-largest cause of a frozen dashboard after the orphan scan. Small, verified in code, with a mechanical acceptance test, so it ranks directly after PAN-5369.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4544",
      "rank": 20,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "/api/costs/stream blocks the event loop ~1.6 s per poll with a sync scan of a 386 MB events.jsonl",
      "rationale": "Follow-up to PAN-4543, which fixed the summary route. The Pipeline view polls this route in the background, so every poll freezes all HTTP and WebSocket traffic for ~1.6 s and can fail DoD health probes. The async reader already exists, so the fix is small.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4551",
      "rank": 21,
      "size": "L",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Upgrade all Effect packages from 4.0.0-beta.73 to stable 4.0.0; run after the verification bundle merges. TENET-10: supervised",
      "rationale": "Moves 705 importing files off a four-month-old beta onto the supported line, which is substrate hardening. PAN-4527, PAN-4531 and PAN-4540 closed on 2026-10-24, so it now waits only on PAN-4534 (in pipeline); rank holds at 14.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4671",
      "rank": 22,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "CodeRabbit comments posted after the reviewer snapshot merge unseen; deliver late ones to the work agent at merge. Needs handoff.",
      "rationale": "New substrate fix to the merge door that closes the gap which let PAN-4672's findings merge unreviewed; advisory-only with a clear design and ACs, but TENET-10 requires a supervised handoff.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4675",
      "rank": 23,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "One transient gh label timeout aborts post-merge lifecycle; merge door replies Already merged, so the issue can never close.",
      "rationale": "New this pass. addLabel in merge-agent.ts uses Effect.promise, so one gh network timeout becomes a defect that skips pausing agents and stopping the stack, and the merge door then refuses re-runs with Already merged. PAN-4299 is stuck half-closed right now, and pan close refuses on DoD row 5. Substrate bug with clear AC, so it slots into the free rank 19 beside the other merge and close-out fixes; it overlaps PAN-3557 (label retry), and fixing either should consult the other.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4705",
      "rank": 24,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "quality-gate-admission test leaks a poller past afterEach rmSync; unhandled ENOENT fails unrelated PR CI shards.",
      "rationale": "New since the prior pass. A latent race in the PAN-4546 admission test fails whole CI shards with an unhandled ENOENT on PRs that never touch it (seen on #4703), costing verification attempts pipeline-wide. It sits beside PAN-4680, the sibling flake fix, because both keep CI verification honest; the fix is small and scoped to one test file or publishExclusive.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4746",
      "rank": 25,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI test shard flakes on ENOTEMPTY: afterEach rmSync races an unawaited snapshot write; reds unrelated PRs (seen on #4745).",
      "rationale": "New flaky-test bug: a background membership-snapshot write races the test's teardown rmSync and turned an unrelated PR's CI shard red. Ranked next to PAN-4705, the same leaked-async-work-vs-teardown pattern, because each red shard costs a PR a rerun on the path to merge.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5104",
      "rank": 26,
      "size": "XS",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stale cost hook bundle prices Fable 5.1/5.2 at Fable 5 rates; reconciler never corrects it. Unblocked: PAN-5103 merged.",
      "rationale": "Its only dependency, PAN-5103 (Fable 5.2 rollout), closed as completed, so the XS rebuild is unblocked; rank held at 20 because it is a cost-accuracy fix, not pipeline substrate.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4572",
      "rank": 27,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Residual re-render offenders PAN-4560 profiled but left: unmemoized deck rows, App 5 s poll, clock/selector identity bugs.",
      "rationale": "PAN-4560 merged (closed completed 2026-10-20), so this follow-up is now unblocked; rank held at 19 near the top tier because its offenders are already measured and file-referenced.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4586",
      "rank": 28,
      "size": "XS",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Herdr pane.read nests text under result.read; every Overdeck pane-text reader gets '' — detection, inventory, resume all blind",
      "rationale": "New issue. Verified against herdr 0.9.1: HerdrApiClient.call returns response.result, whose pane_read text sits under read.text, but readHerdrPaneText, diagnoseDetectionFailure and the herdr-submit composer read a top-level text, so every pane-text consumer on the default backend sees an empty string. A three-site fix plus corrected test stubs; placed in a free rank slot just above the Herdr pane-sizing pair (PAN-4582, PAN-3952) because it is smaller and likely explains part of PAN-3952's 'pane read returns nothing' observation.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4217",
      "rank": 29,
      "size": "S",
      "importance": "critical",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "vbrief-ac gate reads AC statuses nothing writes; plans with nested ACs fail verification and pan done with no verb to clear it",
      "rationale": "New bug discovered on PAN-4199. The vbrief-ac verification gate and the pan done preflight both count acceptance-criterion sub-items, but updateSubItemStatus has no production caller and the feedback names a nonexistent 'pan task close' verb, so every plan with nested ACs fails verification until an agent hand-writes a script. It blocks the pipeline's verification step directly, so it ranks critical in the free slot right after the other in-pipeline pickup blockers.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4219",
      "rank": 30,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan done refuses on unclosable AC sub-items; likely duplicate of PAN-4217 (same missing writer); fold into its fix.",
      "rationale": "New bug filed from PAN-4201: pan done refused completion on 36 acceptance-criterion sub-items that no supported verb can close, and the vbrief-ac feedback names a nonexistent pan task close. It ranks critical and right behind PAN-4217 because it blocks completion of every issue planned with nested ACs, the default planner shape. It is marked needs-refinement because PAN-4217 already describes the same missing writer (updateSubItemStatus has no production caller) including the done-preflight half, so it should be closed as a duplicate or fixed by the same change.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4708",
      "rank": 31,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "docs.json nav is a hot file: concurrent docs PRs conflict, each costing a merge-main and re-review. Pick a fix option first.",
      "rationale": "New substrate-improvement issue, the second hot-file conflict source after in-pipeline PAN-4697; on 2026-11-01 it forced merge-main cycles and fresh head reviews on three PRs. It takes the free rank 27 beside its sibling so no other node moves, and it stays needs-refinement because the body asks for a decision among three fixes (frontmatter-generated nav, per-group fragments, JSON merge driver) before work starts.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4229",
      "rank": 32,
      "size": "S",
      "importance": "critical",
      "score": 82,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-4217"
      ],
      "why": "pan task done skips nested AC children, so pan done refuses at the end; third report of the PAN-4217 missing writer; fold into its fix.",
      "rationale": "New bug filed from PAN-4222: after all eleven top-level items were closed through pan task done, pan done refused on 39 pending acceptance-criterion children that pan task next never surfaced, and the agent had to make 39 empty trailer commits to get through. It blocks completion of every issue planned with nested ACs, the default planner shape, so it ranks critical beside PAN-4217 and PAN-4219. It is marked needs-refinement because it describes the same missing AC-status writer as PAN-4217 and PAN-4219; the three should be fixed by one change and the extras closed as duplicates.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3050",
      "rank": 33,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reaper's full-stack tier never fires for any project: it JSON-parses Docker's label string, so compose project is always undefined.",
      "rationale": "Raised from 205: a 2026-11-23 comment found the 2h full-stack reap tier inert for every project (labels mis-parsed), feeding today's gate-queue memory starvation (PAN-5621). Fix is small but turns on stopping postgres/redis, so it needs its own review.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3566",
      "rank": 33,
      "size": "XS",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "Test-role launcher execs claude with no user prompt, so the role boots an idle REPL — the deterministic producer of zombie test agents.",
      "rationale": "New this pass and the highest-leverage fix in the batch: the test-role launcher's final exec has no -p, no positional prompt and no piped stdin, so the role boots an interactive REPL and never takes a turn. That single missing argument is the deterministic producer of the zombie test agents tracked in PAN-2706, PAN-3563 and PAN-3274 — three separate hardening issues chasing one root cause. Reproduced across eight session IDs, so there is no diagnosis left to do.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5537",
      "rank": 33,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Nothing emits review.approved, so the test role and browser UAT never run after review approval; re-emit it or retire the step.",
      "rationale": "New pipeline bug found while planning PAN-5468: the review.approved event has no producer, so the reactive test-role dispatch is dead and the failed-UAT merge block can never fire. CI tests still gate merge, so it is high rather than critical. It sits beside PAN-3566 (test-role launcher boots an idle REPL), since both must be fixed before the test role does anything; the plan agent picks between re-emitting the event and retiring the step.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3952",
      "rank": 34,
      "size": "S",
      "importance": "critical",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Herdr sizes unviewed panes to 1 row: 10 of 13 work panes report nothing to pane read; every pane-text consumer is blind",
      "rationale": "On the default backend the harness TUI renders into a one-line terminal until an operator opens it, so stuck detection, readiness scans, health capture, AUQ/permission detection and screenshots all see nothing. Deterministic pane sizing in the Herdr adapter is a small change with fleet-wide effect.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3285",
      "rank": 35,
      "size": "M",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "A supervisor pinned to a reload generation SIGTERMs every healthy dashboard and cannot start one: 3.5h outage, 1107 silent failures.",
      "rationale": "New this pass, labelled critical. A supervisor unit pinned to a pan reload generation SIGTERMs every correctly-running dashboard and is structurally incapable of starting a replacement; the observed outcome was a 3.5-hour total outage with 1,107 consecutive failed recovery attempts and no operator escalation. Manual recovery also fails, because the supervisor kills the operator's dashboard within 30 seconds. Nothing else in the backlog can take the whole product down for hours with the recovery path itself broken.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3524",
      "rank": 36,
      "size": "M",
      "importance": "critical",
      "score": 90,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "A server-owned --changed verification loop relaunches through deacon freeze, review abort, pause and operator stop; peaked at 78 workers.",
      "rationale": "Triage: verify the --changed verification-loop relaunch against deacon-lite's smaller suppression surface. Kept in the critical band: an unstoppable server-owned test loop is the worst kind of runaway.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4166",
      "rank": 37,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "write-sequence replays every superseded sequence commit and dies on an old one, so the ranked order never reaches origin/main",
      "rationale": "New issue (2026-09-24), the only delta since the prior run. pushPlanArtifacts replays the whole local range through git merge-tree, so one superseded rendering of .pan/backlog/sequence.md aborts the push and origin keeps serving a stale ranked order that the Flywheel reads for pickup; the silent reset --keep refusal then adds another unpushed commit every run, so the failure compounds. Ranked 31 rather than into the vacated top slots: the acute incident was hand-repaired (main is level with origin, the identical untracked drafts removed), so the bug is latent until the next untracked-draft collision, and it ranks behind the actively-biting pipeline blockers at 19-30 while staying in the critical band because a stale sequence misdirects every Flywheel pickup. Root cause is verified in the body with a named file, a proposed fix, and three mechanical acceptance criteria.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3250",
      "rank": 38,
      "size": "S",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace spawn branches from local HEAD instead of origin/main, so every new feature branch inherits unpushed local-main commits.",
      "rationale": "New this pass, labelled blocks-main and substrate. Two spawn sites branch from the local HEAD or defaultBranch instead of origin/main, so every new feature branch inherits whatever unpushed commits are sitting on the shared local main. Four branches were already contaminated when it was filed, two of them created after the problem was identified, and their PRs read MERGEABLE/CLEAN. It spreads with each spawn, so the cost of leaving it grows.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3946",
      "rank": 39,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review request treats an APPROVED review on an older commit as \"already passed\"; newer commits ride an old approval",
      "rationale": "Merge-safety bug seen on PR #3933: an approval on fd3334e6 satisfied the request for head ae9d82f0. Approval must count only when its commit_id is the current head; add --force as the explicit override.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5632",
      "rank": 39,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Verification calls a target-branch merge with extra edits synced, so a pass is adopted for unverified edits; compare merge-tree.",
      "rationale": "New issue from CodeRabbit on PR #5631: classifyRepoHead trusts merge parents and ignores the tree, so the verification gate can adopt a pass for a head whose extra edits nothing verified. Small, well-specified fix with named tests; ranked beside PAN-3946, the same class of stale-verdict head-identity gap.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2954",
      "rank": 40,
      "size": "XS",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "postMergeLifecycle refuses GitLab projects",
      "rationale": "Dependency cleared: PAN-2882 (the missing GitLab merged-MR oracle this blocked on) closed since the last pass, so postMergeLifecycle's GitLab refusal is now directly workable. Re-ranked up from 67 to sit with the other unblocked critical merge-path fixes.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3935",
      "rank": 41,
      "size": "S",
      "importance": "critical",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "PRD draft promotion writes the draft into the primary main checkout and deletes the feature-branch copy; PRDs are stranded untracked",
      "rationale": "The PAN-2858 defect in a new shape: complete-planning promotes to the primary checkout, where nothing commits, and removes the workspace copy the planning commit would have picked up. Evidence: untracked pan-3927.md on main. Also a write-to-main hazard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3657",
      "rank": 42,
      "size": "S",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge-train queues endpoint runs the monorepo queue builder for polyrepo projects, so MYN/Auricle trains are permanently empty.",
      "rationale": "New this pass. The merge-train queues endpoint correctly gathers eligible candidates and then hands them to the monorepo queue builder, which does git rev-parse against a polyrepo project root that is not a git repository — so every polyrepo project's train is permanently empty while monorepo projects populate fine. MYN and Auricle cannot use merge trains at all until this lands.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4240",
      "rank": 44,
      "size": "S",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reaper rm -rf's workspaces of closed issues: unmerged polyrepo branches, and (Nov 4) untracked evidence after a merged MR.",
      "rationale": "A second incident on 2026-11-04 (MIN-1135) widened the bug: after a merged MR the reaper removed the whole workspace, destroying untracked evidence files and nested worktrees that the merged-branch check never covers. Rank holds at 39 because it is already critical; the fix must now gate on untracked/nested content, not only branch merge state.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3565",
      "rank": 45,
      "size": "M",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Failed review spawn wedges 'starting', and an all-lanes infra failure is synthesized as a real CHANGES REQUESTED verdict.",
      "rationale": "New this pass. Three review-lifecycle defects, one of them severe: when all four reviewer lanes died at spawn on a record lock, the supervisor wrote a synthesis declaring CHANGES REQUESTED with every lane marked failed — an infrastructure flake recorded as a real code verdict. It was caught only because a human was watching live. Same integrity family as PAN-3283 and PAN-2746.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3554",
      "rank": 46,
      "size": "M",
      "importance": "critical",
      "score": 88,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Red main has no mechanical owner: it hid for ~5h because the merge gate renders red main as an empty queue, not an alarm.",
      "rationale": "New this pass. Main stayed red for about five hours because nothing owns the state 'the latest main-push CI run failed' — no needs-you, no activity entry, no strike recommendation. The failure actively hides itself: the merge gate renders red main as an empty eligible set, so the operator sees a quiet queue rather than an alarm. Detection must not depend on the flywheel being awake, since it frequently is not. Condition changed after the PAN-3917 cut: the merge gate that rendered red main as an empty queue was deleted by the cut; red-main ownership still needs a home — re-scope.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3532",
      "rank": 47,
      "size": "S",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI runs only a hand-picked slice of the frontend suite, so main stayed red on frontend for hours while every run reported green.",
      "rationale": "New this pass. The CI test job runs root npm test, whose frontend leg is a hand-picked list of files, so two frontend test files were red on main for hours while every main CI run reported success. Green CI that does not mean green is worse than no CI, because every downstream gate and every close-out trusts it.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4241",
      "rank": 48,
      "size": "XS",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "computeWorkspaceRepoRoots joins an absolute repoPath, so polyrepo repos named unlike their path (fe/frontend) are skipped by pan task done.",
      "rationale": "New this pass. computeWorkspaceRepoRoots builds its fallback candidate by joining the workspace path with an absolute repoPath, so any polyrepo repo whose configured name differs from its directory is never found. That makes pan task done refuse valid Item trailers and also affects head snapshots and merge completeness for MYN. The fix is a one-line candidate change plus a test, and a symlink workaround exists, so it ranks high rather than critical.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5167",
      "rank": 49,
      "size": "S",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-merge lifecycle refuses forever on one transient GitHub fetch failure; agent stays running and close-out is blocked.",
      "rationale": "New substrate bug placed in a freed critical-tier slot. One transient fetch failure leaves a merged issue in_review with a live agent and needs manual kill plus pan close --force, the same failure class as PAN-4675.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4396",
      "rank": 50,
      "size": "XS",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "test-skip gate fails closed on any branch diff over 1 MiB (execFile default maxBuffer); one-line fix unblocks big PRs",
      "rationale": "New issue. The test-skip verification gate fails every branch whose diff exceeds 1 MiB before it inspects a test, as PAN-4362 showed; that blocks verification outright for large but legitimate PRs. The fix is one maxBuffer argument, so it ranks in the critical pipeline block.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3085",
      "rank": 51,
      "size": "XS",
      "importance": "critical",
      "score": 88,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Review feedback is written to .overdeck/feedback but agents and the deacon merge gate are pointed at a nonexistent .pan/feedback.",
      "rationale": "New this pass and a one-line class of defect with outsized cost. Review feedback is written to the resolved .overdeck/feedback directory but the path handed to the work agent is a hardcoded .pan/feedback that no longer exists after the rebrand, and the deacon merge gate reads the same dead path. Agents are told to fix findings they cannot find, and the gate counts zero feedback files no matter how many exist. Condition changed after the PAN-3917 cut: the deacon merge gate is gone; only the agent-side .pan/feedback path pointer remains to verify — re-scope.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3653",
      "rank": 52,
      "size": "M",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "A strike blocked on red main has no owner that wakes it when main goes green; the session stays alive so recover refuses it.",
      "rationale": "New this pass, labelled blocks-main. A strike that correctly stops because its gate is blocked by red main has no owner that wakes it when main goes green: the session stays alive, so liveness calls it healthy and pan recover refuses with 'already has a live harness runtime'. The urgent path exists precisely to unblock the pipeline fast, so a strike that silently idles through the clearing of its own blocker defeats the mechanism.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3630",
      "rank": 53,
      "size": "M",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell reported three deliveries to a live agent, moved all three to read/, and the agent received none — the delivery door lies.",
      "rationale": "New this pass. pan tell reported successful delivery three times to a live, heart-beating agent, moved all three messages into the read mailbox, and the agent's transcript shows it received none of them. The delivery door is the sanctioned way every part of the system talks to a running agent; a door that lies about delivery makes every downstream 'we told it' claim unreliable.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3805",
      "rank": 54,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Codex idle poke spawns codex exec instead of the app-server door; failed sends still tick the counter and pause healthy agents",
      "rationale": "Idle remediation is now deacon-lite nudge routines; triage asks to verify the Codex app-server delivery bypass against that implementation. The persistent-session invariant still forbids codex exec; rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5139",
      "rank": 55,
      "size": "M",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan reload refuses both generations when the pan shim points at the non-live generation; deploys stall.",
      "rationale": "New substrate bug placed in a freed critical-tier slot. Any launch from the non-live generation repoints the shim, after which every pan reload refuses, so merged fixes stop shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3560",
      "rank": 56,
      "size": "M",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "PTY supervisor overloads under concurrent review convoys; fleet-wide 502 'input echo confirmation failed' kills resumes and feedback.",
      "rationale": "New this pass. Under concurrent review convoys the PTY supervisor returns 502 'input echo confirmation failed' fleet-wide, so no agent can be booted or re-booted and pipeline feedback delivery fails while load is high — confirmed across at least six unrelated agents in one hour. Delivery failing exactly when the pipeline is busiest is what turns a load spike into a stall.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3520",
      "rank": 57,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Test gate records 'failed' for load-induced timeouts; retry timeout-only failures in isolation before writing a verdict.",
      "rationale": "New this pass. The test gate records a real 'test failed' verdict for uniform 5000ms timeout signatures under host load, proven on multiple branches where the same files pass in isolation in about 19 seconds. Every false verdict costs a full rework cycle and another saturated re-test, so this is both a correctness and a cost fix. Retrying timeout-only failures in isolation before writing a verdict is the minimal change.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4439",
      "rank": 58,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI relay has no backstop for webhooks missed during pan reload; red test jobs never reach the agent, PRs stall",
      "rationale": "New issue. The polling backstop for the CI failure relay was deleted in the Cut, so a check that completes while the dashboard reloads is never relayed and the PR stalls. Reloads are frequent, and its stated dependency PAN-4432 has closed, so it ranks high in the pipeline block.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4392",
      "rank": 59,
      "size": "XS",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan task done accepts an Item: trailer from another issue's merged commit (history-wide grep); gate passes with no evidence",
      "rationale": "New issue. hasTrailerCommit greps all reachable history, so generic item ids such as docs or tests are satisfied by any merged commit and the checklist gate certifies work that was never committed. It is a gate-integrity hole with an XS fix.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3500",
      "rank": 60,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "A review sub-role edited seven tracked files after writing its report and the changes were auto-committed into the feature history.",
      "rationale": "New this pass. A review sub-role that had already written its report was resumed by a later message and edited seven tracked files, and pan start --fresh then auto-committed those reviewer-owned changes into the feature history during sync-main. Review isolation is currently prompt-level only; it has to be mechanical, because a contaminated branch is very hard to detect after the fact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3313",
      "rank": 61,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "A transient upstream stream error benches CLIProxy's only auth: ~70% of GPT-routed inference 503s with a message that blames credentials.",
      "rationale": "New this pass. A transient upstream stream error benches CLIProxy's only auth entry, so every GPT-routed request returns 503 auth_unavailable until an internal cooldown lapses — 35 failures against 14 successes in one hour, with valid credentials throughout. The message reads as 'your credentials are gone' and sends the operator to re-authenticate, which fixes nothing. Every GPT-routed agent on the machine is affected at once.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3282",
      "rank": 62,
      "size": "M",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review agents die before writing a verdict across 5 issues and 2 projects, leaving a verdict-shaped status with no artifact behind it.",
      "rationale": "New this pass. Review agents terminate before writing their report across five issues and two projects, twice recurring after a successful recovery, leaving a verdict-shaped status with no artifact behind it and a stuck flag that blocks progress until someone restarts the reviewer by hand. This is the upstream condition PAN-3283 then converts into a false passed verdict.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4391",
      "rank": 63,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan worker run fails in polyrepo workspaces because the root is not a git repo; delegation is broken for MYN",
      "rationale": "New issue. Worker delegation is the supported path for sub-tasks, and it fails outright in every polyrepo workspace, so MYN issues cannot delegate without a manual --cwd workaround. Polyrepo correctness bugs sit in the high band in this sequence.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4390",
      "rank": 64,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Polyrepo workspace create runs npm install in the project's parent dir, reports failure and hides the workspace from list",
      "rationale": "New issue. Workspace creation for a polyrepo project reports failure and omits the workspace from pan workspace list although it is usable, which misleads every caller. It belongs with the other polyrepo substrate bugs.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2695",
      "rank": 65,
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
      "rank": 66,
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
      "issue": "PAN-2706",
      "rank": 67,
      "size": "M",
      "importance": "high",
      "score": 84,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ghost test sessions absorb every test dispatch",
      "rationale": "Triage: verify whether a never-kicked-off test session can still absorb dispatch under the current liveness model. Rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5228",
      "rank": 68,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Advisory CodeRabbit journal entries land last and hide stalled reviews from recoverStalledReviews and other last-entry readers.",
      "rationale": "New pipeline bug placed in a freed critical-tier slot. Reviews whose reviewers die after a CodeRabbit post are never re-dispatched, and PAN-5218 widened the masking.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4344",
      "rank": 69,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Registered projects lack the agent main-push guard; ship a pre-push hook so agents cannot push to main outside overdeck",
      "rationale": "New issue from the Deft adoption PRD. Its dependency PAN-3308 has closed. The main-push guard exists only in the overdeck repo, so agents in other registered projects can still push to main, which is the PAN-2204 hazard class.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5661",
      "rank": 69,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Issue panel says 'Nothing needs you yet' while the Flywheel holds the issue as needs-you; read needsYouIssueIds in StatusNarrative.",
      "rationale": "New substrate-improvement bug with a clear root cause and fix: StatusNarrative.tsx derives needsYou from pipeline state only, so Flywheel needs-you items (already in the frontend as needsYouIssueIds) never reach the issue panel, and an unplanned idle issue reads as 'Planning what to build'. The label sets a high floor and it directly serves the operator's UI-discoverability priority, but it unblocks no other work, so it sits with the other high, small substrate bugs at rank 69.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4550",
      "rank": 70,
      "size": "XS",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Two unit tests read host state (DASHSCOPE_BASE_URL, git-ignored .map files), so pan release check reports false reds locally",
      "rationale": "Found cutting v0.65.0: CI was green but the local release check failed on two host-dependent tests. XS fix that removes false reds from the release verb, so it sits above routine medium work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4566",
      "rank": 71,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "A failed replayEvents leaves the coordinator un-bootstrapped; tab defers live events with no banner. PAN-4559 fallback has landed.",
      "rationale": "Rank held at 63 but now unblocked: PAN-4559 closed, so the snapshot fallback this fix routes failures to is on main and work can start.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5653",
      "rank": 71,
      "size": "S",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "3 CodeRabbit findings on merged PAN-5648; 2 Major: stack lock does not fence a stale holder, file-lock release can delete a new lock.",
      "rationale": "New CodeRabbit follow-up on the just-merged PAN-5648 stack-lock fixes. Two Major findings are lock races in the shared file-lock and stack lock that guard container stop/restore, so it ranks beside its parent as high-importance substrate hardening.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5193",
      "rank": 72,
      "size": "XS",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "PRD-first gate reads a short main stub before the full workspace draft and refuses finalize for epic children.",
      "rationale": "New planning bug placed in a freed high-tier slot. It blocks pan plan finalize for every epic child with a stub draft on main; the fix is a candidate-order change plus one test.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2940",
      "rank": 73,
      "size": "M",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "Three red-mains in one day from direct-push series bypassing PR CI",
      "rationale": "Three red-mains in one day from direct-push series bypassing PR CI — conversations need a pre-merge CI surface.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3708",
      "rank": 74,
      "size": "M",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan strike dies at git worktree list on a polyrepo wrapper — the urgent-strike escape hatch is unavailable for MYN-class projects.",
      "rationale": "New this pass. pan strike dies at git worktree list --porcelain on a polyrepo wrapper root, which is not a git repository, so the urgent-strike escape hatch is simply unavailable for MYN-class projects. pan swarm already understands nested repos; strike must use the same project repository inventory. Duplicate of PAN-3040 — close one when this lands.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3605",
      "rank": 75,
      "size": "XS",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Supply chain: lint-effect-diagnostics npx fell back to the registry and ran a squatted unscoped package; pin the scoped local bin.",
      "rationale": "New this pass and the only supply-chain finding in the batch. A stale node_modules made npx fall back to the registry, where the unscoped effect-language-service name is claimed by a third party, and npm installed and executed it non-interactively. The payload was benign this time; the name stays third-party-controlled, so a malicious patch release would run on any machine in the same state. The fix is small and the downside is unbounded.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5133",
      "rank": 76,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan pause cannot hold a planned issue whose deferred work-agent start is retried; no operator door to stop it.",
      "rationale": "New substrate bug placed in a freed high-tier slot. Under memory pressure the operator has no supported way to stop a deferred start, and the Flywheel had to write the journal directly.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4792",
      "rank": 77,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Paste guard only knows numbered menus; a failed paste presses Enter into unnumbered selects, silently setting defaultMode=auto.",
      "rationale": "New bug found while planning PAN-4738: the tmux paste guard misses Claude Code's unnumbered select dialogs, so a failed paste's fallback Enter can answer them, including a silent permission-mode change. PAN-4738 removes the one known trigger on Fly, so it ranks with the high-tier delivery bugs rather than the top tier.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3557",
      "rank": 78,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-merge label writes have no retry; a 403 hides a merged issue from the verify-on-main sweep while lifecycle reports success.",
      "rationale": "New this pass. Post-merge label application has no retry, so a rate-limited 403 leaves a merged issue without its verifying-on-main label — and the verify-on-main phase enumerates by that label, which makes the issue invisible to the phase that owns it. Lifecycle reported 'completed' throughout, so nothing noticed for 45 minutes.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3543",
      "rank": 79,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Completed-handoff agents are unstartable: start, --fresh and reset-session all refuse while the refusal itself recommends --fresh.",
      "rationale": "New this pass. A completed-handoff agent owed rework after a blocked verdict cannot be started at all: pan start refuses and recommends --fresh, --fresh gives the identical refusal, and reset-session is refused too because the durable plane reconstructs the session pointer. The refusal message names an action the operator cannot take, which is the self-contradictory-deadlock family PAN-3526 opened.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3522",
      "rank": 80,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Supervisor watchdog restart-churns under CPU storm because the probe timeout budget ignores the boot warm phase.",
      "rationale": "New this pass. Under a CPU storm the supervisor watchdog counted probe timeouts through a new generation's 138-second boot warm phase and killed it anyway, producing four restarts in ten minutes, racing spawns on port 3012, and a WATCHDOG GIVING UP. Each restart re-triggered docker stack rebuilds, feeding the storm. The probe budget has to know the difference between starved and starting.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3314",
      "rank": 81,
      "size": "M",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "One cgroup holds every agent pane, so a single hungry agent inflates the unit and oomd kills the whole fleet — twice now.",
      "rationale": "New this pass. Every agent pane is a child of one transient tmux-server unit, so agent memory is the unit's memory and systemd-oomd's kill decision is all-or-nothing: one hungry agent takes the entire fleet with it. That has now happened twice, the second time killing seven work agents, four strikes and a live review convoy. Blast-radius containment is a different fix from choosing a better victim.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3278",
      "rank": 82,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "A finished work agent with an open PR sat two hours because review was never dispatched and auto-requeue fired none of 25 attempts.",
      "rationale": "Triage: the auto-requeue machinery cited targeted the deleted review_status table; verify review-dispatch-after-PR-open against the current mechanism (see PAN-3939 for the post-cut reproduction). Rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5636",
      "rank": 83,
      "size": "S",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [
        "PAN-5633"
      ],
      "why": "UI follow-up to PAN-5633: row state word and composer notice (with Hand off) for failed Codex turns; needs 5633's providerError.kind.",
      "rationale": "New issue split from PAN-5633's PRD (D13); it only reads server fields PAN-5633 adds, so it ranks behind that in-pipeline fix as a small medium-value UI follow-up.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3234",
      "rank": 84,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Agents freeze indefinitely on blocking choice menus and no health surface notices; the detector is wired only to delivery refusal.",
      "rationale": "Triage: verify whether blocking-choice-menu detection is wired to the current liveness/health surface. Rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5467",
      "rank": 84,
      "size": "XL",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic: docs overhaul, 16 page issues, 6 accuracy audits (PAN-5499..5504) and an intro rewrite (PAN-5505); order book drives pickup.",
      "rationale": "Rank unchanged; the epic body gained seven children (six nav-group accuracy audits and the introduction rewrite), so its why now lists them. The order book still drives child pickup, so the epic itself is never picked.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": true
    },
    {
      "issue": "PAN-5642",
      "rank": 84,
      "size": "M",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Plan-action endpoints accept approval without matching toolUseId; a stale dialog can approve a plan the operator never reviewed.",
      "rationale": "New issue: write-side validation gap in both plan-action routes, flagged on PR #5639 (PAN-5604). The fix is concrete (send toolUseId, 409 on mismatch) but CodeRabbit scoped it as heavy; ranked with recent operator-input correctness bugs.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3205",
      "rank": 85,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "The deployment gate promises the queued deploy will fire at the next verification boundary; that trigger does not exist.",
      "rationale": "New this pass. The deployment gate's queue message is unusually good — it names the holders, the queue age, and warns against forcing — and it promises a 'next verification boundary' trigger that does not exist. Every holder cleared and the deploy never fired; the live build stayed stale for 35 minutes until a manual reload. A correct-sounding instruction that cannot happen is worse than no message.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3118",
      "rank": 86,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Model-specific quota exhaustion is invisible everywhere but the pane: four planning agents read 'running' at $0.00 with no fallback.",
      "rationale": "Triage: verify \"running at $0.00 with no capacity fallback\" against the current liveness definition. Rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3106",
      "rank": 87,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "auto_merge_default: hold is consulted on one merge path only, so held issues merge individually and defeat the UAT train.",
      "rationale": "New this pass. shouldHoldForUat is consulted on exactly one merge path, so every other path merges a ready issue without asking whether its project holds for UAT — verified at code level on a real MIN-901 merge. This defeats the batch-train model directly: issues merge one at a time before a generation can assemble them.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3100",
      "rank": 88,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "The test role evaluates the dirty working tree, so a live work agent's uncommitted edits are recorded as the issue's test failure.",
      "rationale": "New this pass. The test role evaluates the workspace working tree rather than the reviewed commit, so a live work agent's in-progress uncommitted edits are counted against the issue — the gate's own artifact diagnosed it exactly, failing on a file the reviewed commit never touched. Combined with PAN-3104, which replays the stale artifact, it becomes a durable trap.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-4213",
      "rank": 89,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge-train follow-ups from #4066 (merged): stamp-vs-pin mismatch, reset --keep can strand agent commits, fetch retry, tests",
      "rationale": "Rank held at 82; its dependency closed. PAN-3983 closed 2026-09-25 when PR #4066 merged, so these seven follow-ups now harden code that is on main. Items 2 and 5 are real merge-path correctness hazards: a success status can sit on a head that never landed, and git reset --keep can move an agent commit off its branch. Each item names its file, so the work is well defined and is now startable.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5263",
      "rank": 90,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline membership sees zero open overdeck issues: the App token lacks issues permission and the gh fallback never runs.",
      "rationale": "New bug placed in a freed high-tier slot. Phase labels are ignored for overdeck and every gather refetches ~492 numbers; the fix needs care because it raises candidate count.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3096",
      "rank": 91,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done blocks on generated .devcontainer/ and dev, and agents resolve it by deleting workspace infrastructure or inventing gitignores.",
      "rationale": "New this pass. pan done's preflight blocks on the generated .devcontainer/ and dev artifacts, and with only commit/discard/surface offered, agents invented their own exits: one attempted to delete workspace infrastructure, another committed a wrapper-repo gitignore change that moved HEAD and fed a four-hour review reset loop. A gate that pushes agents toward destructive workarounds needs fixing at the gate.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3084",
      "rank": 92,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "A review session spawned but never briefed sits at zero context forever, and restart 'preserves' the zombie that blocks its replacement.",
      "rationale": "Triage: the cited function is deleted; verify whether a never-briefed review session can still block its replacement (PAN-3939 shows the post-cut shape). Rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3043",
      "rank": 93,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Provider health is probed only at spawn, so a mid-run 403 quota refusal leaves an agent 'running' for days holding a slot.",
      "rationale": "Triage: verify days-stale \"running\" against the current liveness definition (idle = stale work activity). Rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1824",
      "rank": 94,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix flaky main CI: fake timers + @slow exclusion for real-timer test family",
      "rationale": "Re-ranked up (prior rank 83, score 78). Four issues filed since the last pass — PAN-3243, PAN-3492, PAN-3520 and PAN-2421 — all trace red or flaky main to real-timer tests under load. This is the shared fix for that family and it is now marked ready, so it should sit with the other CI-integrity work rather than behind it.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2932",
      "rank": 95,
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
      "rank": 96,
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
      "issue": "PAN-2337",
      "rank": 97,
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
      "rank": 98,
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
      "rank": 99,
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
      "rank": 100,
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
      "rank": 101,
      "size": "M",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm test fails in clean checkout after pretest removes dashboard bundle",
      "rationale": "npm test fails in clean checkout — pretest removes the dashboard bundle the test spawns against.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2758",
      "rank": 102,
      "size": "S",
      "importance": "critical",
      "score": 90,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Provider capacity error silently zombies a spawned agent: willRetry=false, turn reported completed, state stays status=running forever",
      "rationale": "Triage: verify whether a provider-capacity zombie can still read as running under the current liveness definition. Rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2817",
      "rank": 103,
      "size": "M",
      "importance": "high",
      "score": 83,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Idle-at-prompt work/review agents are never redriven: gpt-5.6-sol sessions stop at the composer mid-task and sit for hours",
      "rationale": "Triage: idle-at-prompt redrive is now deacon-lite's stuck-work-nudge routine; verify the composer-freeze detection gap against it. Rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2813",
      "rank": 104,
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
      "issue": "PAN-2668",
      "rank": 105,
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
      "rank": 106,
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
      "issue": "PAN-4269",
      "rank": 107,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "macOS conversations hang on 'Working…'/'waiting for transcript'; governor ruled out, root cause unknown (delivery or transcript find).",
      "rationale": "New since the prior run: conversations that never progress make Overdeck unusable on macOS, so importance is high, but the cause still needs a Mac repro, so it ranks in the high-bug band at the free rank 99 rather than with the pipeline-blocking criticals.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3811",
      "rank": 108,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "The PAN-3809 emergency strike prunes BuildKit unconditionally; inventory, bounded reclaim door and retention floor are still missing",
      "rationale": "New this pass. Code inspection at the strike head shows disk-pressure-patrol.ts shelling straight to docker builder prune --all --force, with no BuildKit bytes in the canonical inventory, no candidate through the resource reclaim door and no age or size floor. The partial strike is a fine urgent backstop, but closing PAN-3809 on it would quietly drop requirements 1-3. Ranked directly behind its parent so the completion work is not forgotten once the emergency lands. Dropped dependsOn PAN-3809 (closed since the prior run).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2179",
      "rank": 109,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "relaunch can leave a zombie agent",
      "rationale": "Triage: verify the no-kickoff zombie gap against the current liveness definition (stale work activity, not a mirror label). Rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2169",
      "rank": 110,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "kimi agent silently frozen at 100% ctx (no thrown overflow error) not caught by CONTEXT_OVERFLOW_PATTERNS",
      "rationale": "Triage: now deacon-lite's stuck-work-nudge routine; verify the ctx-saturation heuristic gap against that routine. Rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2734",
      "rank": 111,
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
      "issue": "PAN-3697",
      "rank": 112,
      "size": "XS",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deployed dashboard PATH omits Bun, so verification workers hit 'bun: not found' before the required install gate.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3633",
      "rank": 113,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike workspaces spawn without @types, so the contract's own typecheck gate fails and agents abort reporting a false red main.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4420",
      "rank": 114,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "npx @overdeck/core on native Windows serves 404 for every page: static root is built from a URL path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5543",
      "rank": 114,
      "size": "XS",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "overdeck up treats the install script's ~/.local/bin/overdeck CLI bin as the desktop app, so up never starts the dashboard properly.",
      "rationale": "New first-run bug on the recommended Linux install path (confirmed in src/cli/index.ts and scripts/install.sh): every install-script user's overdeck up launches the CLI as the desktop app and skips the real startup. Banded beside PAN-4420, the comparable Windows first-run break.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3099",
      "rank": 115,
      "size": "XS",
      "importance": "critical",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "--health-timeout 120 is enforced as 120ms and a false-failed check exits after killing the old server — nothing left listening.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-4418",
      "rank": 116,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "vault join fails on native Windows: core.autocrlf=true rewrites the VAULT-FORMAT marker; blocks Windows continue flow",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3040",
      "rank": 117,
      "size": "S",
      "importance": "critical",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan strike is monorepo-shaped end to end and fails immediately on polyrepo projects; same defect as PAN-3708.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3023",
      "rank": 118,
      "size": "S",
      "importance": "critical",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-planning auto-spawn logs 'attempt 1/3' and never retries after a transient Docker EOF, stranding the issue with no re-drive owner.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1618",
      "rank": 119,
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
      "issue": "PAN-3916",
      "rank": 120,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Session pointers go stale after rollover + crash recovery; issue view and pan tell confirmation track a dead transcript",
      "rationale": "Every path that starts a new Claude session for an existing agent must repoint session.id and state.json; today the operator loses their own conversation and pan tell reports false non-delivery.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3900",
      "rank": 121,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Docker bridge pool exhausted by orphaned workspace networks; pan start fails; bridge-pool patrol only warns",
      "rationale": "patrolDockerBridgePool survives the cut but is read-only; reclaiming unattached compose networks and calling docker teardown from every worktree-removal shape stops pan start from failing outright.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3793",
      "rank": 122,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "resolveIssuePullRequestRef probes only feature/ and strike/ names, so close-out cannot find a merged PR on a descriptive branch",
      "rationale": "New this pass. PAN-3790 merged cleanly from feature/muse-harness with green CI and a successful deploy, and pan close still reported row 4 missing because neither conventional branch existed; rows 1-3 then could not settle and rows 6/8 lost their merge anchor. Supervised work increasingly uses descriptive branches, so this will recur. The fix is contained: teach the canonical resolver to honour an explicit issue-record PR reference with linked-PR lookup as fallback.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2639",
      "rank": 123,
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
      "rank": 124,
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
      "rank": 125,
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
      "issue": "PAN-4184",
      "rank": 126,
      "size": "S",
      "importance": "high",
      "score": 81,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "--no-deacon on the host port is refused as a peer after the old server stops, so the escape hatch may leave no dashboard; fix unpicked",
      "rationale": "New issue, placed at free rank 118 beside PAN-3899 (rank 99) on the same restart/boot-gate surface: needs-refinement because the premise is unverified (\"very likely\"), the fix is an undecided two-option choice (support a Deacon-off primary vs refuse --no-deacon up front and correct the skill), and the body bundles a second defect (pan restart --now dropping a running reload's gate flags).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2511",
      "rank": 127,
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
      "issue": "PAN-2763",
      "rank": 128,
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
      "issue": "PAN-3579",
      "rank": 128,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace page Pull/Run/Open and palette activate send no CSRF token, so they 403 now; ~20 more bare-header mutations at risk.",
      "rationale": "Raised from 191: a 2026-11-19 comment found live breakage, not just latent risk. WorkspaceActionBand Pull, Save run command, Run and Files/Editor open hit CSRF-guarded workspace-registry routes without the token, and CommandPalette activate sends no headers, so core workspace-page actions fail for cookie sessions today.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2170",
      "rank": 129,
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
      "rank": 130,
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
      "issue": "PAN-4453",
      "rank": 131,
      "size": "XS",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "runtimes/codex.ts uses homedir() not OVERDECK_HOME; isolated homes write thread ids into the real ~/.overdeck",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2106",
      "rank": 132,
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
      "issue": "PAN-2880",
      "rank": 133,
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
      "rank": 134,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Polyrepo wrapper .gitignore misses .pan/ .devcontainer/ dev",
      "rationale": "Polyrepo wrapper .gitignore misses .pan/ .devcontainer/ dev — pan done cleanliness gate false-fails on Overdeck scaffolding.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2945",
      "rank": 135,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done rejects Overdeck-generated runtime in polyrepo wrapper repos (.devcontainer/, dev, .pan/review)",
      "rationale": "pan done rejects Overdeck-generated runtime (.devcontainer/, dev, .pan/review) in polyrepo wrapper repos.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2680",
      "rank": 136,
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
      "issue": "PAN-4419",
      "rank": 137,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [
        "PAN-4418"
      ],
      "why": "pan vault resume cannot spawn claude on native Windows (ENOENT, needs shell/.cmd resolution); --no-launch works",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3734",
      "rank": 138,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Completed swarm slot reuse can start a new item from a stale polyrepo branch — silent wrong-parent work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3621",
      "rank": 139,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start intermittently dies resolving a chunk graph spliced across two builds — importer from primary dist, path in the live generation.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3555",
      "rank": 140,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start without --fresh silently abandoned an intact 7.5MB warm session, violating the warm-by-default contract.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3498",
      "rank": 141,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "write-sequence pins in-pipeline ranks without renumbering, so the persisted sequence carries duplicate ranks and gaps.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3496",
      "rank": 142,
      "size": "XS",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "A review convoy member blocked on an operator AskUserQuestion about review depth; review agents must decide and record, not ask.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3081",
      "rank": 143,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "The agent git guard is PATH-based and an agent stripped it unprompted to get past a false block; a control the agent can remove isn't one.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2627",
      "rank": 144,
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
      "rank": 145,
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
      "rank": 146,
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
      "rank": 147,
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
      "rank": 148,
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
      "rank": 149,
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
      "rank": 150,
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
      "rank": 151,
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
      "rank": 152,
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
      "issue": "PAN-4302",
      "rank": 153,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "~19 files exec gh directly, bypassing runGh: spend is unattributed and keeps hitting GitHub during quota pause. Follow-up to PAN-4291",
      "rationale": "New follow-up split out of PAN-4291 (in pipeline at rank 2): it migrates the remaining direct gh callers to runGh so the quota ledger attributes spend and non-essential callers respect quota pauses. The file list and grep-based ACs are concrete, so condition is ok; it ranks just after PAN-2259 (GraphQL quota burn) because it completes the same quota-hardening line and needs PAN-4291 to land first.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2080",
      "rank": 154,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "External transports (email/Slack/push/TTS) still plausible; its stated dependency on the PAN-2079 Inbox spine is undercut by boot…",
      "rationale": "Triage: the idea survives but its dependency on the PAN-2079 spine (built atop boot reconciliation) is substantially undercut. Parent epic PAN-2075 is closed, so the contains edge is dropped. Rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5048",
      "rank": 155,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Needs-you drops an unanswered AskUserQuestion seconds after its phone push; the phone shows 'already answered' with no card.",
      "rationale": "The phone app's core job is answering pending questions, and this makes the push lead nowhere. Likely shares a cause with PAN-5028 (pending state cleared after the PAN-1520 deny hook).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1436",
      "rank": 156,
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
      "issue": "PAN-3556",
      "rank": 157,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "No per-agent spawn mutex: two flows allocated session identities 3s apart and the second pin orphaned the first transcript.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3553",
      "rank": 158,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "tmux list-panes -a exits 1 on a zero-session server, so the census reads unavailable post-reboot and conversations hang on 'Starting…'.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3535",
      "rank": 159,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "The drain/resume hold is re-derived from the caller's env each boot, so any restart from a clean shell silently drops it.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3429",
      "rank": 160,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory governor defers admissions but sheds nothing under HARD pressure; concurrent heavy gate runs aren't in the shed ladder.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3397",
      "rank": 161,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fresh convoy lanes freeze at 0 output before kickoff; PAN-3375's detector only covers warm resumes, so recovery is manual.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3325",
      "rank": 162,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "A fresh workspace ships an empty-but-present node_modules, so tooling silently resolves the parent repo's deps and gates go false-green.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3317",
      "rank": 163,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike agents are told to rebase, the launcher guard blocks it, and pan sync-main can't resolve a -strike workspace. Overlaps PAN-3306.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3284",
      "rank": 164,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "A workspace-confined agent wrote a doc edit into the primary main worktree — the PAN-2204 write-to-main hazard through a new door.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3270",
      "rank": 165,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "New workspaces arrive with empty node_modules and bun off the agent shell PATH, so the documented bun install remedy fails.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4487",
      "rank": 166,
      "size": "XS",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "cleanAgentState whitelist drops foreman, modelSpawnKey, workspaceId on every state.json write; add fields + round-trip test",
      "rationale": "New issue with a precise root cause and a one-line fix plus a named test. The whitelist silently discards three AgentState fields, so the MODEL inspector always shows a fallback spawn key and foreman ownership is lost on the first save. It touches the same whitelist PAN-4253 extends, so landing it first avoids a conflict and gives that slice a tested pattern.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3257",
      "rank": 167,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Crash-resume leaves a stale PTY socket and drops supervisorEnabled from state.json, so every supervisor delivery fails afterwards.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3129",
      "rank": 168,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "No symlink/TOCTOU containment on canonical writes under agent-controlled paths; a planted symlink redirects a server-side write.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3120",
      "rank": 169,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "A scheduler-yielded work agent makes operator MERGE hard-error on polyrepo and silently dead-end on single-repo.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4349",
      "rank": 170,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent-side GitHub reads prefer REST over GraphQL gh --json until PAN-4302 meters callers; protects the hourly quota",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3062",
      "rank": 171,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "The shared primary main worktree stacks several sessions' commits, so whoever pushes next ships everyone else's unverified work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3048",
      "rank": 172,
      "size": "XS",
      "importance": "high",
      "score": 78,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Pipeline auto-commit lands Overdeck's own .pan/drafts PRD into product feature branches; the exclusion list is duplicated and has drifted.",
      "rationale": "Triage: the old auto-committer is gone; verify .pan/drafts exclusion drift against whatever now commits .pan/ artifacts to feature branches (see PAN-3935 for the post-cut promotion bug). Rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3032",
      "rank": 173,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rebuild composes under overdeck-feature- while Traefik labels name myn-feature- devnet, and traefik attaches are runtime-only.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3833",
      "rank": 174,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feed renders assistant text emitted after tool calls as collapsed thinking rows; operator believes the agent never answered",
      "rationale": "Operator-facing correctness bug in the conversation parser: real answers hide as thinking rows. Small fix, high trust impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3902",
      "rank": 175,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Verification gates inherit OVERDECK_* env from the dashboard, so host boot state (e.g. OVERDECK_NO_RESUME) can red any branch",
      "rationale": "Gate subprocesses must run with a scrubbed OVERDECK_* env; otherwise host state produces non-reproducible reds that look like flakes.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4629",
      "rank": 176,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fresh npx machine cannot pan start: no gh auth token fallback for the GitHub tracker, and registration derives the wrong issue prefix.",
      "rationale": "New issue: on a fresh npx install with gh logged in, pan start fails with Tracker not configured, and project registration picked OVERDECK instead of PAN. Both block first-run onboarding outright; causes are verified and the acceptance tests are concrete.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3854",
      "rank": 177,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feature-workspace devcontainer stack 403s on POST /api/dashboard/session, blocking all in-browser mutation UAT",
      "rationale": "The test role's browser UAT runs against the workspace stack; without session bootstrap every mutation AC is unprovable. Likely missing trusted-origin/Traefik env in the feature stack.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4577",
      "rank": 178,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Operator's facts didn't follow them to a new Mac: no importer for Claude auto-memory. PAN-3957 merged, so W9-W11 are unblocked.",
      "rationale": "A 2026-10-25 field report shows the operator's Claude auto-memory facts stayed on the original machine when they set up a new Mac with npx, because this importer does not exist yet. That is live operator pain on the multi-machine onboarding path, next to PAN-4629 and PAN-4628, so it moves from 668 to 172 and from medium to high. Its blocker PAN-3957 closed as completed, so the work is unblocked.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3307",
      "rank": 179,
      "size": "XS",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "commitlint scope-enum lists 11 scopes, 14 real ones are missing, and it still names the removed beads scope — trains everyone to ignore it.",
      "rationale": "Re-ranked up. It carries the substrate-improvement label, which the ranking rules floor at high importance regardless of how small the change reads. The substance is modest — a stale commitlint scope-enum — but it warns on the majority of legitimate commits and trains every agent to ignore commitlint output, which quietly disarms a gate.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-5250",
      "rank": 180,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Idle workspace frontend and dev containers never stop while an agent lives; ~9 GB held by unviewed Vite containers.",
      "rationale": "New substrate item placed in a freed high-tier slot; it frees memory the governor and the live stream need.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2642",
      "rank": 181,
      "size": "XL",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost strategy: waste detection over budget policing",
      "rationale": "Epic — cost strategy: retire invented limits, land the progress-aware breaker, make dollars honest. Ranked by aggregate child impact; the breaker is the one real guard.",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-5649",
      "rank": 181,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [
        "PAN-5250"
      ],
      "why": "Browser half of PAN-5250 restart-on-demand (wake page, start-app action); PAN-5250 merged, so it can start now.",
      "rationale": "PAN-5250 merged on 2026-11-24, which clears this issue's only dependency; rank held directly behind it as medium-importance UI follow-up.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1868",
      "rank": 182,
      "size": "XS",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost-bleed circuit breaker: progress-aware, always-on guard against runaway agent spend",
      "rationale": "Cost-bleed circuit breaker — progress-aware, always-on guard against runaway spend; the one real guard the epic authorizes. Updated since the prior run (comment/label activity); body substance unchanged, rank held. Note: its costBleedMonitor is described as a deacon patrol — deacon-lite is the new home. Blocker PAN-2466 closed since the prior run; dependsOn pruned.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-4847",
      "rank": 183,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remote reap silently skips review request when a background writer dirties a tracked file; pipeline stalls at PR-open.",
      "rationale": "New issue placed in the open rank-177 slot: a silent pipeline stall (review never requested after Fly reap) that also blocks PAN-4696 FR-2; root cause is an unidentified background writer of .overdeck/context/codebase/concerns.md plus an over-strict porcelain dirty check in requestReviewThroughRoute.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1042",
      "rank": 184,
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
      "issue": "PAN-4844",
      "rank": 185,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Claude Code parser prices glm-*/qwen3* as Sonnet 4, ohmypi prices DashScope at $0; route both to custom rows.",
      "rationale": "New cost bug found while planning PAN-4827: two parsers mis-route GLM and Qwen models, so cost reports are wrong for those sessions. It is small, self-contained and independent, so it takes the free rank 179 near PAN-4827.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-570",
      "rank": 186,
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
      "issue": "PAN-2059",
      "rank": 187,
      "size": "XL",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog pickup gate",
      "rationale": "Epic — backlog pickup gate: operator Plan->Release row + AI Objection (5th state) + flywheel relevance-vetting; prevents bad/superseded work from burning agent time.",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2376",
      "rank": 188,
      "size": "XL",
      "importance": "high",
      "score": 77,
      "condition": "stale",
      "dependsOn": [],
      "why": "Epic: CI/CD reliability — all 21 named children are closed; needs an operator disposition (close or restate)",
      "rationale": "Epic — CI/CD reliability: flake policy, verification-to-merge convergence, strike/swarm merge-path hardening, deploy hygiene. Condition corrected from ok to stale: every child named in its phase table (PAN-2373, 2371, 2336, 2207, 2341, 2167, 2359, 2363, 2360, 2300, 2270, 2372, 2364, 2095, 2375, 2374, 2229, 2230, 2297, 2265) and the absorbed epic PAN-2198 are closed, so the epic tracks no open work and its body describes a pipeline that has since been cut and rebuilt. The prior pass carried ok in error; this is a correction, not a fresh delta. Rank, score, importance, and the operator-set blocked gate are untouched — only the operator can decide whether the remaining soak-based exit criteria justify keeping it open.",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-3775",
      "rank": 189,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "makeDbLive opens overdeck.db unmigrated; zero-table db poisons a vitest worker home and breaks later read-only audits.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3652",
      "rank": 190,
      "size": "XS",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "No workflow_dispatch on ci.yml / state-plane-branches.yml, so an unverified main tip can never be verified and DoD row 6 blocks close-out.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3541",
      "rank": 192,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review restart loops on the session-resume menu because eligibility ignores how the prior session ended; partial mechanical break landed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3463",
      "rank": 193,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "A legitimate empty-diff slot outcome can never pass item verify, so the slot wedges and blocks dispatch of remaining items forever.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3460",
      "rank": 194,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Per-item verify_commands that run the whole root suite make slot merge gates load-fragile and hold a patrol in flight for ~17 minutes.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3454",
      "rank": 195,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost hook rescans fork-copied parent history from byte 0 under the reviewer's id — fabricated cache-miss warnings and double-billed spend.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3432",
      "rank": 196,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Preemptive yield fans out: seven work agents paused to make room for one review convoy, then flood back oldest-first.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3306",
      "rank": 197,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Three layers disagree on how a strike rebases: the prompt instructs it, the launcher guard blocks it, sync-main resolves the wrong worktree.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3297",
      "rank": 198,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "After a dashboard restart, delivery calls a healthy agent a zombie while resume calls it healthy; both classifiers can't be right.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3274",
      "rank": 199,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "A test-role agent spawned and never ran a turn, holding an approved CI-green issue out of the merge gate behind a stale failed verdict.",
      "rationale": "Triage: a never-run test-role agent stranding its issue may still occur; verify against current test-dispatch/merge-gate. Rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3267",
      "rank": 200,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "GitLab merged-head oracle spawns one glab subprocess per repo × head, so pipeline membership refresh fails on every cycle.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5488",
      "rank": 200,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Plan dialog header Stop completes planning while footer Stop aborts to Todo; same label, opposite outcomes.",
      "rationale": "New UX bug where a user who means to cancel accepts an unfinalized plan instead; placed in the high band with small, well-located fixes.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5544",
      "rank": 200,
      "size": "S",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel author/assignee rail hardcodes login eltmon in skill, role and vision; non-maintainer installs skip or ungate issues.",
      "rationale": "New issue. The Flywheel's default-deny security rail only holds for the maintainer, so every other operator's loop either skips their own issues or acts ungated; the fix (render the operator's forge login at sync or read it from flywheel status) is small and well-scoped, so it ranks with the other Flywheel correctness work near PAN-4365.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3261",
      "rank": 201,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "The tmux delivery fallback answered a live session-resume menu because its own paste hid the menu from the detector — silent /compact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5548",
      "rank": 201,
      "size": "XS",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "CodeRabbit follow-up issues hard-code assignee eltmon; other operators' Flywheel gate never passes them. Sibling of PAN-5544.",
      "rationale": "New: same hard-coded-operator defect as PAN-5544 (rank 200) in advisory-followup.ts; small fix that makes CodeRabbit follow-ups work for non-maintainer installs, so it sits right after its sibling.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3256",
      "rank": 202,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "glab mr list runs with a polyrepo wrapper root as cwd, which is not a git repo, so MYN membership fails forge_unavailable every cycle.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4342",
      "rank": 203,
      "size": "M",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-review rounds resume every lane on its own round-1 findings; give each round one fresh critic lane (Deft method)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3174",
      "rank": 204,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Polyrepo UAT stacks 504: Traefik labels carry the old myn- prefix, Traefik isn't on the overdeck-* devnet, and the fe port is wrong.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4365",
      "rank": 206,
      "size": "S",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stale defaults: workhorses.expensive is Opus 4.8 and the flywheel role is a literal that ignores the slot; evals now unblocked",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2980",
      "rank": 207,
      "size": "XS",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "The pre-push file-size guard reads the shared working tree, so another session's uncommitted edits block an unrelated, guard-clean push.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5448",
      "rank": 208,
      "size": "S",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Left column gains a Files item that toggles the Files dock; Ctrl+Shift+E has no always-visible button. Operator-raised, spec complete",
      "rationale": "New operator-raised discoverability fix (epic PAN-5284). The body names files, test cases, docs and acceptance, so it is ready to build; it ranks in the medium UI tier because UI discoverability is a stated operator priority.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3769",
      "rank": 209,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Red main 707089c5→e4b280b3 blocked deploys ~14h: missing no-loss lock entry + stale OpenRouter expectation. Verify still reproducing.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3760",
      "rank": 210,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "permissionMode 'auto' undocumented as non-bypass, launcher can emit invalid --permission-mode, invalid values drop silently.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3629",
      "rank": 211,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "No sanctioned door to re-scope a live agent; the operator must violate pan tell doctrine or let the rejected design land.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3517",
      "rank": 212,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Convoy forks still miss the parent prompt cache in production — launch-injection byte drift plus resume dropping the cache-scope header.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3508",
      "rank": 213,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan reload deletes the generation the global pan link points at, so the CLI vanishes mid-deploy for anyone invoking from elsewhere.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3303",
      "rank": 214,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "An empty registered-projects 200 is treated as authoritative, latching Command Deck at 'Unknown project' until a manual page reload.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4364",
      "rank": 215,
      "size": "S",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "GPT-6 catalog: gpt-6-sol misclassed frontier and OpenAI tierModels still remap to GPT-5.6; prerequisites have closed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3196",
      "rank": 216,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Root-owned container residue makes close-out die on EACCES after passing every DoD row; same family as PAN-3570.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3186",
      "rank": 217,
      "size": "XS",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "One configured non-git member (auricle/infra) blanks pipeline membership for the whole project the resolver claims it can answer.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3185",
      "rank": 218,
      "size": "XS",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Racer (deacon auto-resume) was cut but the check-then-create gap in spawn.ts remains; pan start must report the live agent, not fail.",
      "rationale": "Rank held at 212: the rescope comment confirms the TOCTOU gap is still in spawn.ts even though the named racer was cut; the remaining spawner (retryDeferredHandoffs) makes it rarer, so score drops slightly. Moved one slot to 218 because rank 219 is pinned to in-pipeline PAN-5371.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5517",
      "rank": 219,
      "size": "M",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Tiered Execution settings save supervisor, call-out and replay options nothing acts on; PlanCard toggle hits a route deleted in PAN-3917.",
      "rationale": "New: Settings promise behavior that does not run and a per-issue toggle calls a deleted route. The ask (wire or remove each setting) is concrete, so it sits beside comparable medium Settings work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3179",
      "rank": 220,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "A UAT promote is complete at merge time with no production-reach check, so members read shipped while prod serves the old build.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3130",
      "rank": 221,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Identifier-joined write paths have no containment assertion, so a crafted issue or agent id could redirect a canonical write.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3047",
      "rank": 222,
      "size": "XS",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike-branch teardown uses --is-ancestor, which cannot see a squash merge, so all 96 strike/* branches survive as residue.",
      "rationale": "Rank held at 216. The blocker PAN-2828 closed as a duplicate of the already-fixed #2907, so the squash-aware containment check this issue was waiting on now exists and can simply be reused: verifyStrikeBranchMergedIntoMain (src/cli/commands/strike-merge-verification.ts:76) resolves merged-PR and content equivalence. The defect itself is unchanged and still live — localBranchMergedState at src/lib/lifecycle/teardown-workspace.ts:466 and the remote check at :529 both still gate on git merge-base --is-ancestor, which no squash merge can satisfy, so every strike branch is preserved as residue. It stays below the availability and merge-integrity tier because 96 stale branches are inert, but it is now an unblocked XS reuse rather than blocked work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3046",
      "rank": 223,
      "size": "XS",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan exits with ERR_UNHANDLED_REJECTION when the PostHog shutdown flush times out, so callers read a successful merge handoff as failure.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1711",
      "rank": 224,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard event-loop stalls under load force watchdog restarts; the root cause behind the PAN-3522 churn and the 0.5-1.5s API latencies.",
      "rationale": "Re-ranked up (prior rank 267, score 55). Since the last pass this became the root cause behind a whole cluster of new incidents — PAN-3522's watchdog restart-churn, PAN-2905's steady-state latency, and the PAN-3524 verification storm all present as event-loop starvation. The manifest also now flags it ready. Fixing the stalls removes the trigger for several downstream failures rather than one symptom.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3667",
      "rank": 225,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "CLIProxy has no cross-family remap, so every Anthropic-pinned subagent dies at spawn in a proxied session; stopgap is hand-written.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5435",
      "rank": 226,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "React Compiler burn-down for app shell, pages, hooks, lib: 67 skips, 100 memo sites. Do first; hooks feed all groups. Unblocked.",
      "rationale": "PAN-4561 (React 19 + compiler) merged on 2026-11-16, so this first burn-down group is now buildable and moves into the parent's freed slot at 226.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5532",
      "rank": 226,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Six dashboard UI bugs where text or filters disagree with code: Experimental copy, Cycle filter, No PR chip, Merging label, palette.",
      "rationale": "New, self-contained UI correctness batch found while planning PAN-5474; ranked with other medium dashboard fixes because each item misleads the operator but none blocks the pipeline.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2874",
      "rank": 228,
      "size": "M",
      "importance": "high",
      "score": 45,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Two of three defects are gone: strike verification now sets skipPlanChecklist, and the landing loop was deleted in the cut. Rescope.",
      "rationale": "Demoted from rank 64 (critical/92) because the closure of its blocker PAN-2828 and of PAN-3898 falsified most of the premise. Defect 1 — the verification gate demanding a vBRIEF checklist strikes never have — is fixed: src/dashboard/server/routes/workspaces/merge-strike.ts:36 sets skipPlanChecklist: true for request.kind === 'strike', and verification-runner.ts:775 honours it, so the incomplete-plan-items gate no longer fires for a strike. Defect 3 — the landing loop leaving strike_landing_state: 'recovering' after a transient fetch failure — describes deacon-strike-landing.ts, which the PAN-3917 cut deleted; no stored strike landing state remains to retry. Only defect 2 may survive: feedback delivery can still strand on feedback_delivery_needs_you (src/lib/cloister/review-verdict-feedback.ts:276) when the target agent has exited, although the strike carve-out removes the failure that used to trigger it. Held above the obsolete tail rather than sent to it, because that residual needs a rescope against the current code rather than a close.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5551",
      "rank": 228,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Emergency stop writes a flywheel pause nothing reads and its toast names a missing control; no CLI clears the Deacon freeze.",
      "rationale": "New: dead state plus a missing CLI clear path in the emergency-stop recovery flow; operator-facing safety control, ranked with the other medium dashboard-behaviour bugs.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3778",
      "rank": 229,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Server snapshot cap shipped in #4558 (closed). Resume-from-offset on resubscribe is the remaining open piece; now unblocked.",
      "rationale": "Rank held at 223. PAN-4558 closed as completed on 2026-10-20, so the server-side snapshot cap this issue depended on has landed and the dependency edge is removed. The remaining resume-from-offset work is now unblocked, but its impact is unchanged, so the rank and score stay where they were.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5555",
      "rank": 229,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "add-repo parses repo-groups.yaml by regex: block lists and hyphenated groups fail; auto-detect needs workspaces_dir.",
      "rationale": "New: progressive-polyrepo add-repo fails on the documented YAML shape and default workspaces folder; contained fix (use the yaml package), blocks accurate PAN-5482 docs.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4575",
      "rank": 230,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Kimi ACP cancel is sent with id:\"\" and rejected, so interrupts never stop Kimi; late chunks land after turn_completed. Unblocked.",
      "rationale": "Source-verified cause: effect-acp serializes every notification with an empty id, so session/cancel never reaches Kimi, the provider keeps generating and spending, and 318 late chunks render after turn_completed. Its prerequisite PAN-4563 (replay fixture and pinned host-replay test) merged in #4576, so the dependency is cleared; the rank stays at 224 because it already sat in the high tier with peers of equal score and nothing else about the issue changed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5552",
      "rank": 230,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan docs disable/enable: default session scope does nothing and project scope acts global; DOCS-RAG.md names wrong keys.",
      "rationale": "New: scope plumbing bug where the default flag silently no-ops and project scope disables docs everywhere; small, self-contained.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5454",
      "rank": 231,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Clients read welcome.tier and gate on capabilities; Account card and pan account status show the paid plan. PAN-4294 merged.",
      "rationale": "Billing PAN-4294 merged and closed 2026-11-16, so this is now unblocked; rank held because it was already placed ahead of the Anywhere tail.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5553",
      "rank": 231,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan artifacts share is a stub, printed /s/ wrapper URL has no route, and the briefing names an invalid command.",
      "rationale": "New: three artifact-command gaps (stub share, dead wrapper URL, wrong briefing line); the briefing fix is trivial, the rest needs an implement-or-hide decision.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5116",
      "rank": 232,
      "size": "S",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "restart-all closes the pane but the launcher ignores SIGHUP, so the old ACP host and agent child keep running; stop runtime first.",
      "rationale": "New bug found during PAN-5078 verification: a process leak on every ACP conversation restart-all. Clear root cause and fix; ranked beside other ACP and leaked-process bugs (PAN-4575, PAN-3510).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5549",
      "rank": 232,
      "size": "XS",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan restore never restores the agents folder that pan sync backs up; backups list it but restore skips it.",
      "rationale": "New: one-line mapping gap in restore.ts; cheap fix that makes the sync backup round-trip complete.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3510",
      "rank": 233,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent stop leaves detached docker-run test containers alive for hours, contending with other agents' quality gates.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4909",
      "rank": 234,
      "size": "S",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Mac set up with connect: Safari on localhost:3011 gets HTTP 401 from the loopback session mint, so the Mac's own dashboard won't load.",
      "rationale": "New since the prior run. A connect-set-up Mac refuses its own loopback session mint (HTTP 401), so the local dashboard is unusable without the token bootstrap; it breaks the Anywhere setup path like PAN-4897 and takes the free rank 227 near the other Anywhere setup bugs so no other node moves.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4616",
      "rank": 235,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "After PAN-4614 lands, check whether GitHub mergeable honors merge=union; if not, plan a merge-gate fallback",
      "rationale": "New issue: an observation follow-up to in-pipeline PAN-4614; ranked mid-tier because it only matters if GitHub ignores union, and any fallback touches the merge gate's trust boundary and needs its own plan.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4747",
      "rank": 236,
      "size": "S",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Two pan reloads built into the same generation slot 12s apart; restart lock taken over early, first build died on TS6053.",
      "rationale": "New issue: the restart lock let a second reload into a generation slot mid-build; no bad build went live, so it sits just below the Fly token bug and near the reload cluster (PAN-3508 at 206).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3355",
      "rank": 237,
      "size": "XS",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "sessionExists collapses 'no such session' and 'could not ask' into false, so callers read not-running when liveness is unknown.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3289",
      "rank": 238,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "A sequencer pass ran against an empty manifest while the read model held 1120 issues — a transiently empty read at spawn.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4348",
      "rank": 239,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Verification emits warn-first evidence of changed files outside every item's files_scope, so scope creep is visible",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3218",
      "rank": 240,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "No release-drift signal: an install-breaking fix sat merged and unpublished for ~9 hours with nothing surfacing it.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3210",
      "rank": 241,
      "size": "XS",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out teardown scopes by compose project while the guard scopes by working_dir, so an unprefixed dead init container blocks it.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3167",
      "rank": 242,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "krux and lexerra are permanently unreadable through the membership door: an App-not-installed 404 is typed as retryable forge_unavailable.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3113",
      "rank": 243,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Blocking agent-pane choice prompts show nothing in the conversation view; surface them as inline decision cards with keystroke delivery.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3108",
      "rank": 244,
      "size": "XS",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "dashboard.log reached 867MB with no rotation — disk cost and un-greppable incident logs exactly when they're needed.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3094",
      "rank": 245,
      "size": "XS",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done's merge fallback still force-pushes a fast-forwardable branch, so a rejected push leaves completion half-done.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3012",
      "rank": 246,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Archiving preserves the pointer, not the data: harnesses delete session JSONL on their own schedule and the conversation is unrecoverable.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3627",
      "rank": 247,
      "size": "XS",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "backlog-auto-trigger throws on a legitimately empty manifest, so a plain npx @overdeck/core in a non-project dir prints a stack trace.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3617",
      "rank": 248,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Three strike dispatches for PAN-3586 died with zero output while a sibling worked; may be stale — re-confirm before picking up.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4346",
      "rank": 249,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Byte ratchet on the always-loaded rules bundle (40 KB, no ceiling); seeded at current size, growth forbidden",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3276",
      "rank": 250,
      "size": "XS",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Needs-you rows for pane questions and permission prompts are click-dead, so the list that exists to route the operator routes nowhere.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3235",
      "rank": 251,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Render and answer agent pane-choice menus on the decision card; PAN-3228 shipped the core and CLI, the dashboard UX remains.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4203",
      "rank": 252,
      "size": "L",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Operator-requested pan replan + right-click Replan: API-archive stale branch, verify, reset, comment, auto-replan from main.",
      "rationale": "Its only blocker PAN-4198 merged (PR #4220) and closed on 2026-09-27, so the Replan menu entry is now unblocked and takes the parent's freed rank 246.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3789",
      "rank": 253,
      "size": "L",
      "importance": "medium",
      "score": 58,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "MCP servers configured in standalone Codex never reach Overdeck conversations; no setup, auth or lifecycle story across harnesses",
      "rationale": "New this pass. initCodexHome() rewrites the managed config.toml on every launch and only emits servers passed through opts.mcpServers, so an isolated CODEX_HOME conversation sees none of the operator’s configured servers — this blocked a live MYN task whose repo instructions require Linear MCP. Real gap, but the ask spans provisioning, authentication, lifecycle visibility and cross-harness parity with no PRD, so it is marked needs-refinement and ranked in the enhancement tier rather than the substrate tier.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3175",
      "rank": 254,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge-train ordering derives conflicts from file overlap alone, so semantically dependent members batch in any order and break the schema.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3015",
      "rank": 255,
      "size": "L",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Claude Code is the only harness still driven by keystroke injection; a pull-based monitor inbox would retire the whole hardening stack.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3518",
      "rank": 256,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-3517"
      ],
      "why": "Re-review resumes re-bill the whole cold history; make reviewResumeDecision TTL- and size-aware. Needs design sign-off.",
      "rationale": "Re-derived github-ref dependency this pass: the body states it depends on #3517's convoy-scope header on fresh spawns. Rank unchanged - the cross-reference is not new, the prior pass simply missed it.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3445",
      "rank": 257,
      "size": "XS",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "projects.yaml TCP lock ports overlap the OS ephemeral range, so an unrelated socket makes an uncontended config write fail.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3332",
      "rank": 258,
      "size": "S",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "A detached slash-command spawn died in 150ms while the UI kept saying 'running in the background'; the activity must own its outcome.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4426",
      "rank": 259,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard controls for Deft Directive detection and managed mode over the PAN-3943 library; blocker has closed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4345",
      "rank": 260,
      "size": "XS",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Terse gate-integrity rule (fix the work, never the gate) plus a Rule Authority note in rule authoring",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3013",
      "rank": 261,
      "size": "XS",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Role-spawn wrote 26 session-scoped hook paths into the durable ~/.claude/settings.json; they fail on every Linear tool call forever.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3771",
      "rank": 262,
      "size": "M",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation search silently empty end-to-end: palette flag off by default, FTS scan manual-only, no summaries.",
      "rationale": "PAN-4243 (the dashboard wedge that forced search off) closed as completed; rank unchanged, the search pipeline gaps in this issue still stand.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4530",
      "rank": 263,
      "size": "XS",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel skill: define 'pipeline clear', go idle with conversation open, and never stop on a stuck pipeline",
      "rationale": "Operator decision 2026-10-04 with replacement text drafted in the body. Skill-text only, but it stops the loop from going quiet on a stuck pipeline, which otherwise reads the same as a clear one.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3533",
      "rank": 264,
      "size": "L",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "No per-project resource partitioning, so one project's docker stacks and installs starve another project's pipeline and the dashboard.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3107",
      "rank": 265,
      "size": "S",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "OOM spikes are unattributable after the fact; productize the machine-local memory-attribution census stopgap.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-4512",
      "rank": 266,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Tier escalation config is shown but nothing fires it since the Cut; choose a trigger, persist tierOverrides, re-dispatch",
      "rationale": "PAN-4257 (its blocker) closed, so the pure decideEscalation exists again. Trigger choice is still open in the body, so condition is needs-refinement; Settings currently implies escalation runs.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5597",
      "rank": 266,
      "size": "M",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Order books page rework: show the live book, simpler build/run. Body is a placeholder; PRD and mockup pending.",
      "rationale": "New issue. The body is still a placeholder awaiting its PRD, so it is needs-refinement; it ranks with other medium UI-discoverability work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1666",
      "rank": 267,
      "size": "XL",
      "importance": "medium",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline Throughput Hardening",
      "rationale": "Epic — pipeline throughput hardening; most keystone children closed, remaining open work is coalescing review-spawn noise.",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-1556",
      "rank": 268,
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
      "issue": "PAN-4510",
      "rank": 269,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Show effort on issue-view agent rows, conversation rows and Agents-page conversation entries; split from closed PAN-4259",
      "rationale": "Its blocker PAN-4259 closed and supplied the shared label helper, so this display-only follow-up is unblocked. Medium-low value: effort is already visible in the composer chip.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2190",
      "rank": 270,
      "size": "L",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Decompose routes/workspaces/merge-ops.ts (1,925 lines)",
      "rationale": "Decompose merge-ops.ts (1,925 lines) — new god file from the workspaces split; supervised handoff only.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2233",
      "rank": 271,
      "size": "L",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "decompose merge-agent.ts (1,414 lines) into focused modules",
      "rationale": "Decompose merge-agent.ts (1,414 lines) into focused modules; supervised handoff only.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2186",
      "rank": 272,
      "size": "S",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rescoped: after a merge the pending auto-merge row must clear and tracker labels must match the merged PR. Label-retry half is PAN-3557.",
      "rationale": "Rank changed from 400 to 266: the 2026-09-26 rescope comment relocates both halves to the merge-train cooldown queue (auto-merge-scheduler.ts) and postMergeLifecycle in merge-agent.ts, which gives a concrete goal, so condition moves to ok; the substrate-improvement label sets a high-importance floor.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4632",
      "rank": 273,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Markdown chip 'Open in File Manager' xdg-opens the file in its MIME app and sticks as the left-click default; drop it, repair stored pref.",
      "rationale": "New issue with a concrete fix and checkable acceptance criteria; it repairs a dashboard default that silently breaks every later markdown-chip click, and the replacement 'Open containing folder' item already landed, so it ranks with peer medium-sized UX bugs.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2241",
      "rank": 274,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "complete-planning is not serialized or idempotent per issue (spec tmp-rename 500s, bead delete-recreate thrash)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2242",
      "rank": 275,
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
      "rank": 276,
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
      "issue": "PAN-4926",
      "rank": 277,
      "size": "XS",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan down SIGTERMs the smee pidfile PID without verifying it is smee; a reused PID kills an unrelated process. XS guard + test.",
      "rationale": "New since prior run: a small safety fix with an exact recipe (reuse the isSmeeCommand cmdline guard), placed in the free rank 269 slot.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2243",
      "rank": 278,
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
      "issue": "PAN-2202",
      "rank": 279,
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
      "issue": "PAN-2237",
      "rank": 280,
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
      "rank": 281,
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
      "issue": "PAN-4811",
      "rank": 282,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Lanes on a new Fly VM plus gauntlet.fly.max_vms cap; PAN-4743 landed the Fly target door, so this is now unblocked.",
      "rationale": "Moved up from rank 277 into the vacated PAN-4743 slot: its only dependency PAN-4743 closed as completed on 2026-11-02, so startFlyTarget exists and lane provisioning can start.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5079",
      "rank": 283,
      "size": "S",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan task claim/cancel/done write any id, so a typo leaves a stray row in the committed continue file an agent can't remove.",
      "rationale": "Pipeline-integrity bug: the continue file gates pan done, and the role prompt forbids hand edits, so a typo can wedge completion. The fix copies show's existing check into the write verbs.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5446",
      "rank": 284,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "7 CodeRabbit findings on merged PAN-4590 sast gate; 2 Major: dirty scans not bound to tree, incomplete scans reported as scanned",
      "rationale": "New follow-up to the merged PAN-4590 Semgrep gate. Two findings are correctness issues in an advisory-by-default gate, so it ranks medium, ahead of the low-importance Semgrep UI children.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4778",
      "rank": 285,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace-image CI never published: wrong Fly app, fly not on PATH, no FLY_API_TOKEN (operator). Fly VMs run a June image.",
      "rationale": "New, found while planning PAN-4682; sits next to it because both fix the Fly image path, and until it ships Fly VMs miss the #4652/#4296 Dockerfile changes. Workflow edits need an SSH push and the secret needs an operator.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4817",
      "rank": 286,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [
        "PAN-4778"
      ],
      "why": "Fly app's cached image predates pan serve --no-open, so every new Fly VM crashes and rolls back; blocks live Fly verification.",
      "rationale": "New issue filed 2026-11-02 during PAN-4743's live verification: registry.fly.io/pan-workspaces:latest is the June image, so pan serve rejects --no-open and provisioning rolls the VM back. It is the visible symptom of PAN-4778 (the image CI never publishes), so it takes the free rank 279 directly behind PAN-4778 with no other node moving; a one-off manual image push can clear it sooner, but that needs operator Fly credentials.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2211",
      "rank": 287,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "writeSwarmSlotCompletion has no production caller; pan done in a slot workspace must record it. Swarm is dormant (Cut D11).",
      "rationale": "Rank held at 280; triage sharpened the fix to one missing caller; siblings PAN-2212/2213 closed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2210",
      "rank": 288,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rewritten pan done has no slot handling: a slot agent takes the issue-level PR/review path. Must record slot completion only.",
      "rationale": "Rank held at 281; triage confirms the risk is sharper post-Cut because pan done has no slot branch at all.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2201",
      "rank": 289,
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
      "issue": "PAN-2646",
      "rank": 290,
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
      "issue": "PAN-2755",
      "rank": 291,
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
      "rank": 292,
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
      "rank": 293,
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
      "rank": 294,
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
      "issue": "PAN-2495",
      "rank": 295,
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
      "rank": 296,
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
      "rank": 297,
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
      "issue": "PAN-1558",
      "rank": 298,
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
      "issue": "PAN-1766",
      "rank": 299,
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
      "issue": "PAN-4853",
      "rank": 300,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "SageOx dashboard views (session tab, context trace, project panel); blocked by PAN-4852; session-to-issue mapping is a checkpoint",
      "rationale": "Its blocker PAN-4852 has closed, so the dependency is cleared; rank holds because nothing else about the issue changed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2266",
      "rank": 301,
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
      "rank": 302,
      "size": "M",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1538",
      "rank": 303,
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
      "rank": 304,
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
      "rank": 305,
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
      "rank": 306,
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
      "issue": "PAN-463",
      "rank": 307,
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
      "rank": 308,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Per-role/conversation effort config; likely superseded by merged PAN-4249 resolver and its S-slices, confirm or close",
      "rationale": "PAN-4249 merged a single effort resolver with role/sub-role/tier effort, so this older request now carries duplicate risk; condition set to needs-refinement, rank kept.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1424",
      "rank": 309,
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
      "rank": 310,
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
      "rank": 311,
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
      "rank": 312,
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
      "issue": "PAN-4863",
      "rank": 313,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Manual AC-10 check of Anywhere connect on a real systemd VPS; needs a release shipping `pan connect` and a human-provisioned VPS.",
      "rationale": "New issue split out of in-pipeline PAN-4774: Fly VMs lack systemd as PID 1, so AC-10 (connect survives logout and reboot) must run on a real VPS against the first release that ships `pan connect`. It is an operator-run verification step, so it takes free rank 307 beside the Anywhere epic and moves no other node.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1246",
      "rank": 314,
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
      "rank": 315,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Flywheel: respect issue dependencies before autopicking work",
      "rationale": "Triage: the flywheel is now a loop skill driven by order books / backlog sequence; the dependency-awareness ask may still apply to its pick logic. Rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1357",
      "rank": 316,
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
      "issue": "PAN-1915",
      "rank": 317,
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
      "issue": "PAN-4886",
      "rank": 318,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Live relay check on Fly unrun three times: device codes expire unapproved. Needs an operator present to approve one code.",
      "rationale": "A third run on 2026-11-04 failed on the same blocker (two device codes expired unapproved), so it stays at its rank; it needs a scheduled operator window, not more agent attempts.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1435",
      "rank": 319,
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
      "rank": 320,
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
      "rank": 321,
      "size": "M",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-4297",
      "rank": 322,
      "size": "L",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hosted encrypted vault on overdeck.ai in tester mode; account service built 2026-10-02, billing no longer a prerequisite",
      "rationale": "Billing PAN-4294 merged and closed 2026-11-16; this never depended on it (tester mode), and the storage add-on PAN-5456 waits on this issue, so rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2350",
      "rank": 323,
      "size": "L",
      "importance": "high",
      "score": 69,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Epic rebaselined 2026-09-28; account service and share-service slice 1 built 2026-10-02. Children carry the order.",
      "rationale": "Rank and operator gate held. Children PAN-4645, PAN-4654 and PAN-4650 (conversations across machines) closed as completed on 2026-11-01; remaining children keep their order.",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-1217",
      "rank": 324,
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
      "issue": "PAN-2079",
      "rank": 325,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Inbox spine: boot reconciliation (producer #1) is gone; may still be worth pursuing for pending AUQ, cost alerts and other producers",
      "rationale": "Labelled substrate-improvement, so the label floor makes it at least high. Blocker PAN-2077 closed and parent epic PAN-2075 closed. Triage: boot reconciliation, the epic's first producer, is deleted, but the general Inbox-spine idea may still be worth pursuing for other producers (pending AUQ, cost alerts). Lifted from the stale tail; needs a re-scope before pickup. Blocker PAN-2077 closed since the prior run; dependsOn pruned.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-4204",
      "rank": 326,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [
        "PAN-4203"
      ],
      "why": "Sync-main conflict error dumps every file path; show the count, a Replan button, and Open workspace only for few conflicts.",
      "rationale": "New issue split from PAN-4198 (part 4). It depends explicitly on PAN-4203 because its main button calls the Replan endpoint, so it sits in the first free slot after PAN-4203. Scope is small and fully located (server message, route payload, two frontend callers, CLI hint), so condition is ok.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1219",
      "rank": 327,
      "size": "M",
      "importance": "high",
      "score": 69,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Promote across-cycle review state to first-class data (cycle SHA, prior findings) instead of prompt-derived",
      "rationale": "Triage: the record anchor is gone but convergence still reads round artifacts; the SHA-derivation fragility may still apply. Rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1451",
      "rank": 328,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift)",
      "rationale": "Triage: planning artifacts now live in .pan/ on the feature branch; verify remaining ACs against that final model. Rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1452",
      "rank": 329,
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
      "issue": "PAN-1553",
      "rank": 330,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Investigate Claude Code Fast mode support (and fast-tier pricing)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1504",
      "rank": 331,
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
      "rank": 332,
      "size": "L",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR: 93% bypass rate",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-5058",
      "rank": 333,
      "size": "XL",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Parked, in planning: TLS passthrough relay at <name>.mcp.overdeck.ai so hosted bots reach /mcp without Tailscale Funnel.",
      "rationale": "Architecture-labeled and in the planning pipeline, so at least high; parked by the operator pending the relay add-on. Takes the slot freed by its parent PRD's issue PAN-4927.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1479",
      "rank": 334,
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
      "issue": "PAN-5490",
      "rank": 334,
      "size": "M",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [
        "PAN-5058"
      ],
      "why": "MCP relay S-A: hostname registry, relay tickets in account service, wire contract. First slice; waits on PAN-5058 PRD.",
      "rationale": "New sibling slice of PAN-5058 (relay add-on). Its body says it cannot be planned until the PAN-5058 PRD is on main, so it ranks directly behind PAN-5058 in the slice build order (S-A, then S-B/S-C, S-D, S-E/S-F/S-G).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2950",
      "rank": 335,
      "size": "L",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Refactor god files back under file-size ceilings after the UX overhaul",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-5491",
      "rank": 335,
      "size": "L",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [
        "PAN-5058",
        "PAN-5490"
      ],
      "why": "MCP relay S-B: SNI passthrough relay service on Fly (services/mcp-relay); never decrypts. Needs S-A (PAN-5490).",
      "rationale": "New sibling slice of PAN-5058 (relay add-on). Its body says it cannot be planned until the PAN-5058 PRD is on main, so it ranks directly behind PAN-5058 in the slice build order (S-A, then S-B/S-C, S-D, S-E/S-F/S-G).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2720",
      "rank": 336,
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
      "issue": "PAN-5492",
      "rank": 336,
      "size": "L",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [
        "PAN-5058",
        "PAN-5490"
      ],
      "why": "MCP relay S-C: machine tunnel client and TLS listener for public /mcp; one public-ingress predicate. Needs S-A (PAN-5490).",
      "rationale": "New sibling slice of PAN-5058 (relay add-on). Its body says it cannot be planned until the PAN-5058 PRD is on main, so it ranks directly behind PAN-5058 in the slice build order (S-A, then S-B/S-C, S-D, S-E/S-F/S-G).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2650",
      "rank": 337,
      "size": "S",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shed-stack half is moot (slot merges verify on host); remaining: pan swarm recover path for a stuck ready-to-merge slot.",
      "rationale": "Rank held at 333 under the substrate-improvement floor; triage cut the scope to one recovery command, so size drops from L to S.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-5493",
      "rank": 337,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [
        "PAN-5058",
        "PAN-5492"
      ],
      "why": "MCP relay S-D: ACME TLS-ALPN-01 certificates on the machine; key never leaves it. Needs S-C (PAN-5492).",
      "rationale": "New sibling slice of PAN-5058 (relay add-on). Its body says it cannot be planned until the PAN-5058 PRD is on main, so it ranks directly behind PAN-5058 in the slice build order (S-A, then S-B/S-C, S-D, S-E/S-F/S-G).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2358",
      "rank": 338,
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
      "issue": "PAN-5494",
      "rank": 338,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [
        "PAN-5058",
        "PAN-5491",
        "PAN-5492",
        "PAN-5493"
      ],
      "why": "MCP relay S-E: Settings switch, enable flow, loopback end-to-end test and user docs. Needs S-B, S-C and S-D.",
      "rationale": "New sibling slice of PAN-5058 (relay add-on). Its body says it cannot be planned until the PAN-5058 PRD is on main, so it ranks directly behind PAN-5058 in the slice build order (S-A, then S-B/S-C, S-D, S-E/S-F/S-G).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2334",
      "rank": 339,
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
      "issue": "PAN-5495",
      "rank": 339,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [
        "PAN-5058",
        "PAN-5493"
      ],
      "why": "MCP relay S-F: Google Trust Services fallback CA via EAB when Let's Encrypt rate-limits. Needs S-D (PAN-5493).",
      "rationale": "New sibling slice of PAN-5058 (relay add-on). Its body says it cannot be planned until the PAN-5058 PRD is on main, so it ranks directly behind PAN-5058 in the slice build order (S-A, then S-B/S-C, S-D, S-E/S-F/S-G).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2193",
      "rank": 340,
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
      "issue": "PAN-5496",
      "rank": 340,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [
        "PAN-5058",
        "PAN-5493"
      ],
      "why": "MCP relay S-G: daily Certificate Transparency watch for the relay hostname; ships with S-E. Needs S-D (PAN-5493).",
      "rationale": "New sibling slice of PAN-5058 (relay add-on). Its body says it cannot be planned until the PAN-5058 PRD is on main, so it ranks directly behind PAN-5058 in the slice build order (S-A, then S-B/S-C, S-D, S-E/S-F/S-G).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1984",
      "rank": 341,
      "size": "XS",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up)",
      "rationale": "Re-derived cross-reference this pass: the body opens 'Follow-up to #1983' and says #1983's code already landed, so it is narrative history, not a blocker - recorded as an informs edge, not dependsOn. Rank unchanged.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-5602",
      "rank": 341,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [
        "PAN-5058",
        "PAN-5494"
      ],
      "why": "Live Grok Bot and Muse checkpoints over the MCP relay, moved from PAN-5058. Blocked by relay S-E (PAN-5494); needs operator sign-ins.",
      "rationale": "New issue carved out of PAN-5058; it is the last step of the relay chain, so it ranks right after the relay slices it depends on.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1913",
      "rank": 342,
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
      "rank": 343,
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
      "rank": 344,
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
      "rank": 345,
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
      "issue": "PAN-807",
      "rank": 346,
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
      "rank": 347,
      "size": "M",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-tenant workspace isolation with ACLs",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-471",
      "rank": 348,
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
      "rank": 349,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate remaining REST polling endpoints to Effect RPC",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-578",
      "rank": 350,
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
      "rank": 351,
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
      "issue": "PAN-4195",
      "rank": 352,
      "size": "M",
      "importance": "medium",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Every pan call costs ~0.5s/230MB from eager command imports; lazy-load command modules, target --version <100ms",
      "rationale": "New issue (2026-09-25). Agents and hooks invoke pan constantly, so a 0.5 s, 230 MB floor per call adds latency to every agent turn and memory pressure on the host. The fix (lazy action imports, bundle/compile-cache tuning, a startup regression check) is well scoped with a measurable target, so condition is ok; placed in a free slot among score-63 medium work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2839",
      "rank": 353,
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
      "rank": 354,
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
      "issue": "PAN-2792",
      "rank": 355,
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
      "rank": 356,
      "size": "S",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "done.test.ts asserts a hardcoded URL without stubbing env, so it fails in any agent shell with OVERDECK_DASHBOARD_URL set and looks lik…",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2738",
      "rank": 357,
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
      "rank": 358,
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
      "rank": 359,
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
      "issue": "PAN-4236",
      "rank": 360,
      "size": "S",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "GPT-5.6 luna/sol rows in cost.ts disagree with catalog and OpenAI list prices; reconcile and add a cost.ts-vs-catalog parity test",
      "rationale": "New bug: wrong GPT-5.6 price rows misstate spend for codex agents; small, well-scoped fix with a parity test, ranked with nearby cost-accuracy work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2691",
      "rank": 361,
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
      "issue": "PAN-4306",
      "rank": 362,
      "size": "M",
      "importance": "medium",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "Move phase/role/cleanup telemetry from activity.entry to activity.detailed so it stops evicting news; blocked by PAN-4300",
      "rationale": "New issue split out of in-pipeline PAN-4301 with verified emit sites and ACs; ranked in the medium band because it waits on PAN-4300 (in pipeline) and is feed hygiene, not substrate.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3701",
      "rank": 363,
      "size": "L",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Four separate first-party LLM client stacks; consolidate onto effect/unstable/ai LanguageModel + ExecutionPlan. PRD written.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3090",
      "rank": 364,
      "size": "M",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Simple issue page opens with a 55KB raw kickoff prompt and hides the pending question the operator actually has to answer.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-4552",
      "rank": 365,
      "size": "M",
      "importance": "medium",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fresh-host setup errors still say 'edit config'/'run X'; audit each to auto-fix or one click, and find other first-launch dialogs",
      "rationale": "New since the prior run: a follow-up to the three fresh-WSL2-host fixes in v0.66.0, ranked in the first-run reliability band beside PAN-2572 because unfixed setup hints and hidden first-launch dialogs block new hosts before any pipeline work can start.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2670",
      "rank": 366,
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
      "rank": 367,
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
      "rank": 368,
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
      "issue": "PAN-2649",
      "rank": 369,
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
      "issue": "PAN-2580",
      "rank": 370,
      "size": "S",
      "importance": "medium",
      "score": 61,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan tell to codex (GPT) conversations; PAN-5095 (closed) added app-server delivery, so verify whether this is fixed.",
      "rationale": "Rank unchanged; the informing issue PAN-5095 closed with Codex app-server delivery, so this may already be resolved and needs a re-check.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2572",
      "rank": 371,
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
      "rank": 372,
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
      "issue": "PAN-2554",
      "rank": 373,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "clicking a project doesn't update the browser URL",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2550",
      "rank": 374,
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
      "rank": 375,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan restart --health-timeout parses seconds as milliseconds",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2546",
      "rank": 376,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan tell is codex-conversation-unaware; PAN-5095 (closed) added app-server delivery, so verify whether this is fixed.",
      "rationale": "Rank unchanged; the informing issue PAN-5095 closed with Codex app-server delivery, so this may already be resolved and needs a re-check.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4303",
      "rank": 377,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Steer busy Codex app-server turns via turn/steer; verify first whether turn/start already steers. Needs PAN-4292's steerKind.",
      "rationale": "New issue split from in-pipeline PAN-4292; it cannot start until PAN-4292 adds HarnessBehavior.steerKind, and its first step is an open verification question, so it sits in the free rank 374 slot among comparable medium conversation-delivery fixes.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3003",
      "rank": 378,
      "size": "XS",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Generated launcher.sh files omit the OVERDECK_AGENT_ID export the PTY supervisor requires, so manual re-launch dies instantly.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2501",
      "rank": 379,
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
      "rank": 380,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pane-detected waits (rate-limit/session-resume) surface as 'needs you' but cannot be answered from the dashboard",
      "rationale": "Condition changed: PAN-3113, PAN-3234 and PAN-3235 were filed since the last pass and cover the same ground concretely — pane-choice detection, health wiring, and an answerable decision card. This issue is likely subsumed; re-scope it to whatever those three do not cover, or close it as superseded. Rank preserved.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2491",
      "rank": 381,
      "size": "M",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate @xenova/transformers to @huggingface/transformers to eliminate silent npx install failures from sharp 0.32 postinstall",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2489",
      "rank": 382,
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
      "issue": "PAN-2465",
      "rank": 383,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done's PR lookup fails at MYN polyrepo root",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2454",
      "rank": 384,
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
      "rank": 385,
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
      "issue": "PAN-2416",
      "rank": 387,
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
      "issue": "PAN-4250",
      "rank": 388,
      "size": "XS",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stale dated CONVERSATION_TITLE_MODEL literal throws UnknownModelError when titleModel config is unset; one-line fix plus audit",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2395",
      "rank": 389,
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
      "rank": 390,
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
      "rank": 391,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "every supervisor.log line written twice",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-5372",
      "rank": 392,
      "size": "XS",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "First split in a Stage deck remounts the open pane, silently dropping an unsaved editor draft; fix with a stable key per paneId.",
      "rationale": "New issue: small, well-located data-loss bug in PaneLayoutView, ranked with the other medium XS correctness fixes in the free rank-392 slot.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3661",
      "rank": 393,
      "size": "XS",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Secure review-mode dispatch dropped the HTTP-200 semantic-rejection surface; two frontend tests fail locally while CI stays green.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3288",
      "rank": 394,
      "size": "XS",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dev-checkout preflight: after a git pull that adds a dep, the CLI dies with ERR_MODULE_NOT_FOUND instead of saying 'run bun install'.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3164",
      "rank": 395,
      "size": "XS",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "probeUatStack reports readiness from container count, so the UI offers 'Open UAT frontend' while the API is still resolving Maven deps.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3121",
      "rank": 396,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "The failed-send outbox never reconciles against the transcript, so a delivered message keeps a Retry twin that would double-send.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3014",
      "rank": 397,
      "size": "XS",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Background title/about spawns use --bare, which now skips credential reads, so every one fails 'Not logged in' with empty stderr.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5436",
      "rank": 398,
      "size": "L",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "React Compiler burn-down for components/chat: 44 skips in 30 files, then drop 163 manual memo sites. PAN-4561 has merged.",
      "rationale": "PAN-4561 merged on 2026-11-16, so the blocking dependency is gone; rank unchanged because PAN-5435 (shared hooks) should land first.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5438",
      "rank": 399,
      "size": "L",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "React Compiler burn-down for Command Deck, Stage, frame, dock: 56 skips, 237 memo sites. PAN-4561 has merged.",
      "rationale": "PAN-4561 merged on 2026-11-16, so the blocking dependency is gone; rank unchanged because PAN-5435 (shared hooks) should land first.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5366",
      "rank": 400,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation page cannot show whether per-turn memory injection reaches it; add a state route and a status-line part.",
      "rationale": "Its dependency PAN-5359 merged, so it is now unblocked; rank is unchanged.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3944",
      "rank": 401,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Main fix landed (host-backed targets skip Herdr agent.prompt); remaining: buffer bracketed paste in the app-server host, placeholder guard",
      "rationale": "The root-cause fix is on main with a regression test; what is left are two optional hardening follow-ups. Needs a re-scope to those.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3829",
      "rank": 402,
      "size": "L",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Managed Claude launch home: overlay hooks/settings/plugins/auth without touching native ~/.claude (draft at handoff/20260909/main)",
      "rationale": "New this run: medium/58 — Managed Claude launch home: overlay hooks/settings/plugins/auth without touching native ~/.claude (draft at handoff/20260909/main).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2280",
      "rank": 403,
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
      "rank": 404,
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
      "issue": "PAN-2069",
      "rank": 405,
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
      "rank": 406,
      "size": "XS",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "full frontend vitest suite runs in no CI path",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1912",
      "rank": 407,
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
      "issue": "PAN-4208",
      "rank": 408,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "#4205 follow-ups: Effect-free config read for telemetry to hit <100ms pan --version; CI import test for lazy command targets",
      "rationale": "New issue (2026-09-25), filed from the #4205 review. #4205 cut pan --version from 560 to 180 ms but missed the PAN-4195 target of under 100 ms; item 1 closes that gap by keeping effect out of the telemetry config read. Item 2 adds CI coverage that lazy loading removed, so a broken import in tell/start/done fails CI instead of at run time. Scope is concrete with three numbered tasks, so condition is ok; placed just below PAN-4195 in a free slot among score-58 medium work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1846",
      "rank": 409,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "unbounded log growth",
      "rationale": "Triage: deacon-lite's 5 routines produce far less log volume than the 40-routine loop; verify growth/rotation is still a live concern. Rank held.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1830",
      "rank": 410,
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
      "issue": "PAN-1816",
      "rank": 411,
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
      "rank": 412,
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
      "rank": 413,
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
      "rank": 414,
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
      "rank": 415,
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
      "rank": 416,
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
      "issue": "PAN-3516",
      "rank": 417,
      "size": "XS",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Repo .claude/skills holds stale duplicates of pan-handoff, pan-flywheel and okf, so overdeck-dev sessions load outdated skill text.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3455",
      "rank": 418,
      "size": "XS",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "cliproxy --version exits 2, so the up-to-date check always returns false and every ensure re-downloads the pinned release.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3117",
      "rank": 419,
      "size": "XS",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "A deterministic 400 renders as the generic 'Failed to send' bubble with a Retry that can never succeed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3036",
      "rank": 420,
      "size": "XS",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pane-idle detection reads a completed strike's idle composer as a pending question, so a finished strike shows '! INPUT'.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3016",
      "rank": 421,
      "size": "M",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Operator ask: every view should be URL-addressable; cockpit tabs, stage panes and several drawers are still local state.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3890",
      "rank": 422,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "opencode provider stream errors (rate limit) are invisible in the feed and never retried; first message dies silently",
      "rationale": "New this run: medium/56 — opencode provider stream errors (rate limit) are invisible in the feed and never retried; first message dies silently.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3822",
      "rank": 423,
      "size": "L",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "PRD landed (12 items, FR-1..14): link PRs to conversations via branch detection + explicit override; unblocks PAN-3920",
      "rationale": "Promoted 468→409: body now carries a full PRD (12 work items, FR-1..14) so it is plan-ready, scope grew to L, and it unblocks PAN-3920 (agents page PR context).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5028",
      "rank": 424,
      "size": "M",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "list_pending_input loses a conversation's AskUserQuestion after the PAN-1520 deny hook, contrary to the existing test's contract.",
      "rationale": "Hosted bots and the phone rely on this list; probably the same root cause as PAN-5048, so whichever lands first should check the other.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5386",
      "rank": 425,
      "size": "XS",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "CodeRabbit follow-up for PAN-5361 (PR #5373): 1 Major finding, baseline burst can hide an idle regression in bare-host smoke",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1673",
      "rank": 426,
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
      "issue": "PAN-5515",
      "rank": 426,
      "size": "XS",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "CodeRabbit Major on PR #5513: release.yml may notarize an ad-hoc-signed macOS helper when the API key exists but no cert.",
      "rationale": "Rank kept; its context PR (PAN-5463, macOS computer-use helper) merged, so the dependency is dropped and the fix is now unblocked.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5227",
      "rank": 427,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Closed-issue reaper re-checks every issue's state every 60 s, spending ~25% of the GitHub App REST bucket while idle.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5439",
      "rank": 428,
      "size": "L",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "React Compiler burn-down for explorer, God View, conversations, workspace, project: 40 skips, 132 memo sites.",
      "rationale": "PAN-4561 merged on 2026-11-16, so the blocking dependency is gone; rank unchanged because PAN-5435 (shared hooks) should land first.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1669",
      "rank": 429,
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
      "rank": 430,
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
      "rank": 431,
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
      "rank": 432,
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
      "issue": "PAN-3901",
      "rank": 433,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "test-skip gate has no audited exemption for opt-in live suites (skipIf on env/binary); allowlist row with justification",
      "rationale": "New this run: medium/55 — test-skip gate has no audited exemption for opt-in live suites (skipIf on env/binary); allowlist row with justification.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3852",
      "rank": 434,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project creation follow-ups: SSH-port repo URLs, dotted repo names, partial-registration retry, non-duplicate 409 mapping",
      "rationale": "New this run: medium/55 — Project creation follow-ups: SSH-port repo URLs, dotted repo names, partial-registration retry, non-duplicate 409 mapping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5437",
      "rank": 435,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "React Compiler burn-down for components/Settings: 60 skips in 31 files, 27 memo sites. PAN-4561 has merged.",
      "rationale": "PAN-4561 merged on 2026-11-16, so the blocking dependency is gone; rank unchanged because PAN-5435 (shared hooks) should land first.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3862",
      "rank": 436,
      "size": "L",
      "importance": "medium",
      "score": 55,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "/agents-v2 machine session explorer over Herdr + all tmux servers; local first, remote via the PAN-3762 environment model",
      "rationale": "Triage: verify whether /agents-v2 was built during the terminal-backend work or remains open. Rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1572",
      "rank": 437,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Settings permission-mode can desync from the resolved mode; body cites the removed DSP flag and a renamed symbol — rewrite first",
      "rationale": "Rank, size, score and importance unchanged; only the condition moves. The 2026-09-24 touch is metadata (no new comment, no body edit), but verifying the prior pass's claim showed it was wrong: `resolvePermissionModeSync` does not exist and no code emits `--dangerously-skip-permissions` any more — every remaining hit in src/ is a comment or a docstring. The hazard the issue describes is still live in renamed form: `config.claude.permissionMode` still defaults to 'bypass' (settings-api.ts:793) and `getClaudePermissionFlags` (claude-permissions.ts:79) still emits `--permission-mode bypassPermissions` for it, so Settings can still disagree with the resolved mode and all three asks stand. The body needs a rewrite to the current flag and symbol names before anyone works it, which is what needs-refinement records.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4627",
      "rank": 438,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Homebrew Claude Code installs get a copy-only upgrade banner; make the brew plan runnable and auto-upgrade outdated runnable installs.",
      "rationale": "New issue: a convenience fix for the PAN-4359 upgrade banner on Homebrew installs plus automatic upgrades; useful but not blocking, so it sits with medium-tier dashboard polish next to PAN-4360.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1571",
      "rank": 439,
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
      "rank": 440,
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
      "issue": "PAN-5312",
      "rank": 441,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Quality-gate admission: a head that can never fit alone serializes every gate behind it.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5241",
      "rank": 442,
      "size": "L",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spill work agents to linked machines, then Fly, when this machine is full, up to operator caps.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1530",
      "rank": 443,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Investigate: state.json with model='gpt-5.5' (a model that doesn't exist)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1461",
      "rank": 444,
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
      "rank": 445,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory extraction still failing; the live symptom PAN-4370 closed and PAN-4374 adds a working provider; layout half remains",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1446",
      "rank": 446,
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
      "issue": "PAN-5180",
      "rank": 447,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Tab-open REST burst (~45 requests) delays every client 1.0-1.4 s; uncached prerequisite and status probes.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5562",
      "rank": 447,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan cost today/week/month/report read dead per-day files and print $0; budgets never accrue; Costs page Event Count wrong.",
      "rationale": "New bug found while planning the costs docs (PAN-5475): four concrete defects with code paths and expected fixes; banded with medium dashboard fixes.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5576",
      "rank": 447,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Moonshine, the default dictation provider, has no sidecar on npm installs; pan install builds only in a source checkout.",
      "rationale": "New: default composer dictation fails for every npm install user, so it ranks with the other npm-install breakages.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5264",
      "rank": 448,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Attribute the app-rest GitHub caller (1,422 untraced App REST calls/hour), then cut the largest path.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5340",
      "rank": 449,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "A Preview link to another Markdown file should open it in Preview, not Edit. Follows PAN-5337.",
      "rationale": "Rank kept; its only dependency PAN-5337 closed, so the dependsOn entry is removed and it is now unblocked.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5440",
      "rank": 450,
      "size": "L",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "React Compiler burn-down for all remaining components: 78 skips in 42 files, 288 memo sites. Largest group; do last.",
      "rationale": "PAN-4561 merged on 2026-11-16 (adding Modal.tsx to this group's baseline); unblocked but stays last of the burn-down groups by design.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1445",
      "rank": 451,
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
      "issue": "PAN-5557",
      "rank": 451,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan up on Linux treats the overdeck CLI in ~/.local/bin as the desktop app, prints a false launch and skips its own startup path.",
      "rationale": "New bug found while planning PAN-5473; misleading output but no outage, so banded beside the desktop-app docs work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3616",
      "rank": 452,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planned deploy restarts show the alarm-toned Reconnecting banner; use the lifecycle signal for calm 'updating' copy.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5556",
      "rank": 452,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Desktop app tray status, six notification switches, Open Workspace menu and Linux launch-at-login are dead controls; fix or hide.",
      "rationale": "New bug found while planning PAN-5473; four dead desktop controls, banded beside the desktop-app docs work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2982",
      "rank": 453,
      "size": "XS",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Nothing runs a skill's own selftest when sync-sources/skills/** changes; a convoy passed a PR with its selftest red.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5322",
      "rank": 454,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "CodeRabbit follow-up on PR #5319: unguarded identifier.toUpperCase(), modal focus, needs-you rows that open nothing.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5317",
      "rank": 455,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "CodeRabbit follow-up on PR #5127: route live Codex app-server sends correctly; no replayable mail for keyed sends.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5565",
      "rank": 455,
      "size": "XS",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "CodeRabbit follow-up on merged PAN-5541: close only the answered request; keep seeded queries fresh in a test.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2981",
      "rank": 456,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "The conversation search index never prunes deleted sessions, so Ctrl-K offers zombie hits that 404 on open.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-5560",
      "rank": 456,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan docs reindex ignores docs.* config and, from an npm install, silently overwrites a full index with a partial corpus.",
      "rationale": "New bug found while writing PAN-5482 docs; self-contained CLI fix with clear expected behavior, banded with docs-adjacent medium work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2976",
      "rank": 457,
      "size": "L",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Generalize the ACP harness to any capability-passing ACP CLI: named adapters plus a config-declared custom-agent escape hatch.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1444",
      "rank": 458,
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
      "issue": "PAN-2469",
      "rank": 459,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Assembly landed (mergeReadySlots + finalization); remaining: alarm when all slots merged but no review requested. Swarm dormant.",
      "rationale": "Demoted from 277 to 443: most of the assembly owner landed and pan swarm is dormant post-Cut (foreman is the default parallel path), leaving only a safety-net alarm.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1433",
      "rank": 460,
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
      "rank": 461,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace-spawned dashboards must never claim the canonical dashboard port",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-5582",
      "rank": 461,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "11 CodeRabbit doc findings on merged PAN-5500 PR #5581; 1 Major: push-notifications must enable token sign-in before manual Serve.",
      "rationale": "New issue: advisory CodeRabbit follow-up on Anywhere docs pages from PAN-5500; docs-only fixes, ranked beside the in-flight PAN-5500 audit that touches the same pages.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1392",
      "rank": 462,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "docs/prds/active→completed archive step is superseded by .pan/drafts and .pan/specs on the feature branch",
      "rationale": "Triage: the archive-planning step this describes is superseded; demoted to stale.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4151",
      "rank": 463,
      "size": "L",
      "importance": "medium",
      "score": 46,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-3822"
      ],
      "why": "Deferred remainder of PAN-3822/#4067: GitLab MR sync, PR page + search, handoff link copy, diffstat, link-dialog a11y, sync throttle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1330",
      "rank": 464,
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
      "issue": "PAN-4971",
      "rank": 465,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Viewer header shows only host + count; roster of all participants with host/controller marked. Frontend-only, payload exists.",
      "rationale": "New issue filed by the PAN-4482 acceptance sweep; placed beside PAN-4482 since it closes the PAN-658 FR-6/AC-7 gap that sweep found.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1226",
      "rank": 466,
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
      "rank": 467,
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
      "rank": 468,
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
      "issue": "PAN-3354",
      "rank": 469,
      "size": "XS",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "The archive write door accepts kind=main, hiding a project's singleton workspace with no unarchive affordance in the UI.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3178",
      "rank": 470,
      "size": "XL",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Make worktrees and diffs first class: +/- badge, dedicated Changes surface, conversation worktrees. PRD and mockup exist.",
      "rationale": "A 2026-10-03 comment adds a requirement to diff two arbitrary refs in a local repo with no remote or PR; scope grows but impact relative to the backlog is unchanged, so rank 455 holds.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-5571",
      "rank": 470,
      "size": "XS",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Archived (N) expander never renders: list fetch omits includeArchived, so archived workspaces vanish with no UI way back.",
      "rationale": "New issue; ranked beside PAN-3354 (archive door with no unarchive path), a related small archive-visibility bug.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3017",
      "rank": 471,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "The issue-page UAT panel renders only inline actions, so restart/rebuild/stop are unreachable outside the rail's context menu.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5174",
      "rank": 472,
      "size": "XS",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flaky CI test: share/rate-limit.test.ts flips 201/429 under CI timing; quarantine or make deterministic.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3873",
      "rank": 473,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "GitHub event delivery: support gh webhook forward alongside smee with guided setup, settings exposure, and docs",
      "rationale": "New this run: medium/52 — GitHub event delivery: support gh webhook forward alongside smee with guided setup, settings exposure, and docs.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5346",
      "rank": 474,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auth docs misstate #overdeck_token delivery, the Origin rule and 401 troubleshooting; PAN-5344 fix has landed.",
      "rationale": "Its only dependency, PAN-5344, closed as completed, so the dependency edge is dropped; rank holds with the other medium docs-accuracy work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1150",
      "rank": 475,
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
      "issue": "PAN-5486",
      "rank": 475,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bot integration core pins are hand-typed and stale (0.74/0.77); stamp them at release and fix Grok Bot docs.",
      "rationale": "New; stale pins ship connectors that predate one-paste connect, so it bands with medium integration fixes.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1149",
      "rank": 476,
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
      "rank": 477,
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
      "rank": 478,
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
      "rank": 479,
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
      "rank": 480,
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
      "rank": 481,
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
      "issue": "PAN-3938",
      "rank": 482,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Run Muse Spark under Claude Code via cliproxy — only the paid Zen model is routable; free tier is OpenCode-client gated; needs credit…",
      "rationale": "Operator decision needed on paying for Zen credit before this is worth wiring; the free model cannot be reached outside the OpenCode client.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5464",
      "rank": 482,
      "size": "L",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Video skill set: Remotion, HyperFrames, OpenMontage, video-use packs + 'video' group; fixes LFS extraction. PRD on main.",
      "rationale": "New issue. Ships four known skill packs and a pack-group alias, and fixes two real skill-pack gaps on the way: the Git LFS smudge that breaks HyperFrames extraction, and repos whose only skill is a root SKILL.md. A full PRD with verified research, seven work items and acceptance criteria landed on main, so it is workable and ranks with mid-tier medium features.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-933",
      "rank": 483,
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
      "issue": "PAN-5465",
      "rank": 484,
      "size": "L",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add skill packs to a live conversation: /reload-plugins hot apply, resume fallback, CLI, MCP tool, dashboard modal. PRD on main.",
      "rationale": "New issue. Lets an operator or agent add skill packs to a running conversation without losing context, proven by a 2026-11-17 spike that /reload-plugins rebuilds the skill list in place. The PRD on main covers the route, launcher change, CLI, MCP tool and dashboard modal (FR-1 to FR-9), so it is workable; it ranks just after PAN-5464 because its --group support waits on that issue.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-932",
      "rank": 484,
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
      "issue": "PAN-5497",
      "rank": 485,
      "size": "S",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [
        "PAN-5464",
        "PAN-5465"
      ],
      "why": "Follow-up: accept pack groups in pan skills add, add_skills and the Add skills dialog; PAN-5464 and PAN-5465 merged.",
      "rationale": "Unblocked: PAN-5464 (#5507) and PAN-5465 (#5509) both merged on 2026-11-17, so it can start; rank and score hold, since the merge changes readiness, not impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-927",
      "rank": 485,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rewrite containerize route: dead code, orphan processes, no pending-op tracking",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-900",
      "rank": 486,
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
      "rank": 487,
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
      "rank": 488,
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
      "issue": "PAN-681",
      "rank": 489,
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
      "issue": "PAN-3732",
      "rank": 490,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codex handoff serializes a large rollout twice (~286MB peak RSS on 50MB); serialize once or stream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3700",
      "rank": 491,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan acp serve would let Zed and other ACP clients drive Overdeck conversations through canonical doors. PRD written.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3290",
      "rank": 492,
      "size": "XS",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "xBRIEF items can carry empty metadata.traces, so docs items sit unanchored in the requirement traceability graph.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3132",
      "rank": 493,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "xBRIEF v0.9 agentic dispatch fields are half-adopted as a behavior accident; make difficulty/filesScope/verifyCommands a contract.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3909",
      "rank": 494,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "One agents read door (operator-directed); the cut deleted the agents table and made liveness.ts canonical — re-scope what remains",
      "rationale": "Triage: the agents SQLite table is gone but read-model.ts agentsById may still be a second door beside AgentsResolver; verify before treating as resolved. Rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2659",
      "rank": 495,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "acquireRecordLock survives for the planning auto-start consent lock; an ownerless lock after a crash is never reclaimed.",
      "rationale": "Rank changed from 833 to 479: the rescope comment shows fs-lock.ts was not deleted and still guards auto-spawn-consent, so the crash-orphan hazard is live and the stale verdict is reversed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3831",
      "rank": 496,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Model picker: gray out models whose provider has no API key or subscription login (per-provider readiness resolver)",
      "rationale": "New this run: medium/50 — Model picker: gray out models whose provider has no API key or subscription login (per-provider readiness resolver).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4779",
      "rank": 497,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Docs on main: 2 MDX parse errors hide pages from Mintlify + 15 broken vision.mdx links; mint broken-links can't gate",
      "rationale": "New issue: small, well-scoped docs fix with mechanical ACs; placed in a free medium-tier slot beside comparable XS/S doc hygiene work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-538",
      "rank": 498,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan reload freshness guard must also verify the frontend bundle",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1164",
      "rank": 499,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation diff summaries update live over WebSocket (drop 5s polling)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3563",
      "rank": 500,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan unstick is gone; verify whether a spawned-but-never-briefed role agent can still read as running forever under liveness.ts",
      "rationale": "Triage: pan unstick is gone, but the invisible zombie role agent (prompt never delivered, state says running) is a liveness-detection gap that may persist under deacon-lite/liveness.ts. Raised from the tail to medium.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1041",
      "rank": 501,
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
      "rank": 502,
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
      "issue": "PAN-3770",
      "rank": 503,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codex conversations never show the working spinner mid-turn; parser marks every agent_message instantly complete.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4568",
      "rank": 504,
      "size": "XS",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codex sub-agent turn start shows thread: not sub: label; adoption lands one frame late. PAN-4563 replay test has landed.",
      "rationale": "Cosmetic pane mislabel of a Codex sub-agent turn start; owner turn state stays correct. Its prerequisite PAN-4563 (replay fixture and test) merged in #4576, so the dependency is cleared; rank is unchanged because the issue stays low-impact cosmetic work beside PAN-3770.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3731",
      "rank": 505,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restart-gate banner gives no feedback after approval; dead-requester approvals read as a broken button.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3530",
      "rank": 506,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Four God View components poll on 30s timers instead of the documented /ws/rpc event contract.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3131",
      "rank": 507,
      "size": "L",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support xBRIEF planRef sharding so a 1.1MB/227-item plan stops making every finalize failure whole-plan-fatal.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3061",
      "rank": 508,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deterministic start-vs-swarm recommendation at plan-finalize, derived from plan shape plus recorded outcomes.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3057",
      "rank": 509,
      "size": "S",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Compaction tracking is gone; remaining bug = GPT-5.6 context window declared twice (372K vs 150K); verify separately",
      "rationale": "Triage: Overdeck no longer tracks compaction state, so the \"invisible to every recovery path\" half no longer applies; the double-declared context window is an independent bug. Score trimmed; rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3892",
      "rank": 510,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate review follow-ups deferred from PAN-3845 (minor findings, config clear-sentinel); split into workable items",
      "rationale": "New this run: medium/48 — Substrate review follow-ups deferred from PAN-3845 (minor findings, config clear-sentinel); split into workable items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4918",
      "rank": 511,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Six Anywhere UI bugs seen while filming: Codex keeps Claude model, Zen models listed first, chip wrap, Pull-here state, no remote archive.",
      "rationale": "New issue filed 2026-11-03 with six concrete, evidenced UI defects; ranked beside other Anywhere polish (PAN-4906) since a handoff polish pass already covers part of it.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-863",
      "rank": 512,
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
      "rank": 513,
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
      "rank": 514,
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
      "rank": 515,
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
      "rank": 516,
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
      "rank": 517,
      "size": "XS",
      "importance": "medium",
      "score": 47,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Cancel no longer clears beads or a record; a Recover workflow now means reopening the tracker issue and re-planning",
      "rationale": "Triage: recover = reopen + re-plan under the derived model. Rank held.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-532",
      "rank": 518,
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
      "rank": 519,
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
      "rank": 520,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Annotated live preview: Codex-style annotate-the-app feedback delivered to agents",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2626",
      "rank": 521,
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
      "issue": "PAN-5231",
      "rank": 522,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Explorer: retrying Send through pipeline after a partial failure creates a second issue and branch.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5575",
      "rank": 522,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "TTS Voice Map and Utterance Templates offer 10 event keys nothing emits; mapped voices and templates never apply.",
      "rationale": "New: inert TTS settings keys found while planning PAN-5481; ranked with the other voice bugs.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5204",
      "rank": 523,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Voice: mixed 16/24 kHz sample rates on /ws/voice, and dictation turns leak into AutoPreso as errors.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5574",
      "rank": 523,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings TTS Rate is sent to the Qwen3-TTS daemon, which ignores it; fix in the daemon or remove the control.",
      "rationale": "New: a dead TTS setting found while planning PAN-5481; ranked with the other voice bugs.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2625",
      "rank": 524,
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
      "issue": "PAN-5577",
      "rank": 524,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings Voice input device, output device and volume are saved to localStorage but nothing reads them.",
      "rationale": "New: three inert Voice settings rows found while planning PAN-5481; ranked with the other voice bugs.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2608",
      "rank": 525,
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
      "rank": 526,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lanes)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2566",
      "rank": 527,
      "size": "L",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Triage list of genuine Traycer capability gaps; a container for child issues, not directly workable.",
      "rationale": "Marked as an epic this pass: the body states plainly that it tracks gaps and that each item pursued gets its own child issue, so it is a container rather than work. It has no checkbox task list, so no contains edges are asserted. Rank preserved. Planning set to skip so the container is never picked up as work.",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2565",
      "rank": 528,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging",
      "rationale": "Body updated since the last pass; no delta justified a rank change.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3735",
      "rank": 529,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Sandboxed pan CLI reports 'dashboard down, run pan up' when the real cause is no network; sends agents down the wrong path.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3335",
      "rank": 530,
      "size": "XS",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "A pasted screenshot can't be viewed anywhere in the dashboard: thumbnail has no click handler and the sent form is a file-link chip.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3054",
      "rank": 531,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Benchmark matrix, redesigned 2026-09-29 as E6 of the model-routing PRD; its medians feed PAN-4364 and PAN-4367",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2977",
      "rank": 532,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [
        "PAN-2976"
      ],
      "why": "Settings surface that detects installed ACP CLIs, renders the capability checklist, and guides login without a manual terminal.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2557",
      "rank": 533,
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
      "rank": 534,
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
      "issue": "PAN-2521",
      "rank": 535,
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
      "rank": 536,
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
      "issue": "PAN-3772",
      "rank": 537,
      "size": "XS",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conv view renders Claude Code's synthetic 'no visible output' nudge as an operator message; should read as plumbing.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3853",
      "rank": 538,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Review synthesizer self-declared an operator override; that override door was deleted by the cut — verify on the PR-review path",
      "rationale": "New this run: medium/45 — Review synthesizer self-declared an operator override; that override door was deleted by the cut — verify on the PR-review path.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3830",
      "rank": 539,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "OpenCode provider: curate picker models via Settings favorites (OpenRouter pattern) instead of listing every discovered model",
      "rationale": "New this run: medium/45 — OpenCode provider: curate picker models via Settings favorites (OpenRouter pattern) instead of listing every discovered model.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4924",
      "rank": 540,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "linked-machines.mdx promises switch model for running conversations; dashboard disables it. Fix docs or add the control.",
      "rationale": "New issue since the prior run: a docs-versus-UI mismatch found while filming the Anywhere video; it takes free rank 523 beside the related composer model-switching work (PAN-2626) so no other node moves.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4367",
      "rank": 541,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Replace inherited capability scores for Sonnet 5.5, GPT-6 Sol/Luna with measured ones; eval harness has closed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2443",
      "rank": 542,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "OpenTelemetry GenAI semconv",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2442",
      "rank": 543,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent Client Protocol (ACP) as Overdeck's structured control plane",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2409",
      "rank": 544,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "enforce the workspace boundary",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-5145",
      "rank": 545,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "CLIProxy oauth-model-alias hides gpt-6-sol, gpt-5.6-terra and gpt-5.6-luna by their own ids on claude-code.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5201",
      "rank": 546,
      "size": "XL",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Speaker-aware STT: diarizing engines (Speechmatics, AssemblyAI, Muse, Voxtral, NeMo) and one VoiceSettings contract.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2392",
      "rank": 547,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Standing Crew survives; panel becomes a cost view from cost_events + tier-metrics; verdict/escalation columns need a new source.",
      "rationale": "Rank held; triage confirmed the tier feature is live but the verdict/escalation data sources were cut, so it still needs refinement.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2335",
      "rank": 548,
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
      "rank": 549,
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
      "issue": "PAN-3767",
      "rank": 550,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Model switch could hang at 'Saving…'; onError toast landed, remaining work is reproducing the hang on a healthy server.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3615",
      "rank": 551,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "TTS silent 9+ days from four stacked failures; three already fixed, only follow-ups remain — rescope to what is left.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3558",
      "rank": 552,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Subagent rail shows no model or provider, so mixed-model orchestration needs a transcript open per row to see what it is running.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3469",
      "rank": 553,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "NewProjectModal violates the PAN-3410 page-not-modal doctrine; migrate the create-project flow to a routed page.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3333",
      "rank": 554,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Model pickers show $/1M, which says nothing under a subscription; show relative plan-quota drain among sibling models.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3058",
      "rank": 555,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship named crew presets that populate the whole tiered_execution block so operators don't hand-build the crew table.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2288",
      "rank": 556,
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
      "rank": 557,
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
      "issue": "PAN-2031",
      "rank": 558,
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
      "issue": "PAN-2026",
      "rank": 559,
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
      "rank": 560,
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
      "issue": "PAN-4366",
      "rank": 561,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Plan the Haiku 4.5 successor and give workhorse:cheap a consumer or drop it; gated on E4 summary-faithfulness",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5314",
      "rank": 562,
      "size": "S",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "CodeRabbit follow-up on PR #5313 (CLIProxy pool): body-read timeout, cache-miss coalescing, reset timestamps.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5267",
      "rank": 563,
      "size": "S",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "CodeRabbit follow-up on PR #5266: escalation limit and caching transient GraphQL errors as missing issues.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2004",
      "rank": 564,
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
      "rank": 565,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3739",
      "rank": 566,
      "size": "S",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "cost-reconcile re-warns every model-less codex subthread rollout on every sweep; log flood grows without bound.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4393",
      "rank": 567,
      "size": "XS",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "ac-eval-fixtures requires observable:false >= 8 but honest labeling of all specs yields 6; lower the floor",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1985",
      "rank": 568,
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
      "rank": 569,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Finish local-domain rename: pan.localhost → overdeck.localhost",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1967",
      "rank": 570,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Flywheel must re-validate (re-plan) pre-cutover plans before implementing them",
      "rationale": "Triage: references the earlier rename and old vBRIEFs; pan start's planning gate already re-plans stale specs — verify the concern against that flow. Rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1965",
      "rank": 571,
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
      "rank": 572,
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
      "rank": 573,
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
      "rank": 574,
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
      "rank": 575,
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
      "rank": 576,
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
      "rank": 577,
      "size": "XS",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval data",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1844",
      "rank": 578,
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
      "issue": "PAN-5202",
      "rank": 579,
      "size": "XL",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [
        "PAN-5201"
      ],
      "why": "Flux: experimental live meeting page capturing open items, ticket proposals and diagrams. Depends on PAN-5201.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5141",
      "rank": 580,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reviewer pairing code: multi-day, reusable, restart-safe code so app store review can pair unattended.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1840",
      "rank": 581,
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
      "rank": 582,
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
      "issue": "PAN-1776",
      "rank": 583,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hot-updatable message delivery: version-stamped supervisors + server-side delivery logic",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3706",
      "rank": 584,
      "size": "L",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Broadsheet shipped typography only; color, surface, elevation and texture still on Ledger values, so it doesn't read like Subspace.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3539",
      "rank": 585,
      "size": "XS",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "OOMPolicy=continue fix landed with the issue; re-scope to whatever hardening remains or close it out.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3502",
      "rank": 586,
      "size": "XS",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "tiered-crews blendedCost expectation stale vs pricing catalog; likely already fixed by the PAN-3532 cherry-pick — verify.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-4409",
      "rank": 587,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck integration on OKF v0.2.0 (injector trust tiers, new verbs); blocked on external eltmon/okf#9",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4410",
      "rank": 588,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [
        "PAN-4409"
      ],
      "why": "Migrate eltmon/overdeck-knowledge to OKF v0.2 and refresh stale concepts; last link in the OKF chain",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2978",
      "rank": 589,
      "size": "S",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [
        "PAN-2976",
        "PAN-2977"
      ],
      "why": "Opt-in per-agent install recipes for ACP CLIs from the setup UI; deliberately separated for its supply-chain trust decision.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4878",
      "rank": 590,
      "size": "XS",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Delete dead ox curl installer in prereqs registry; PAN-4852 builds ox from the pinned fork commit, so ~/.local/bin/ox is never used.",
      "rationale": "Its blocker PAN-4852 has closed, so the dependency is cleared; rank holds because nothing else about the issue changed.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1754",
      "rank": 591,
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
      "rank": 592,
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
      "rank": 593,
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
      "rank": 594,
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
      "issue": "PAN-1691",
      "rank": 595,
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
      "rank": 596,
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
      "rank": 597,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harden Fly remote workspaces + pan workspace move; work-agent spill policy now specified in PAN-5241.",
      "rationale": "Rank unchanged; a 2026-11-14 comment moves the spill-to-remote policy into PAN-5241, which now informs this issue.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1667",
      "rank": 598,
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
      "rank": 599,
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
      "rank": 600,
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
      "rank": 601,
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
      "rank": 602,
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
      "rank": 603,
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
      "issue": "PAN-5309",
      "rank": 604,
      "size": "S",
      "importance": "low",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "CodeRabbit minor findings on the PAN-5283 Flywheel page redesign; verify each against main before fixing.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5308",
      "rank": 605,
      "size": "S",
      "importance": "low",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "CodeRabbit findings on the PAN-5282 CLIProxy v8 upgrade: config-write ordering, Windows upgrade staging.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1623",
      "rank": 606,
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
      "rank": 607,
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
      "rank": 608,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "BrowserPane half only; the FilesPane half is superseded by the PAN-5183 file explorer, whose children have all closed.",
      "rationale": "Rank unchanged; a 2026-11-13 comment narrows this issue to the BrowserPane, since PAN-5183 replaced the FilesPane design.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1545",
      "rank": 609,
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
      "rank": 610,
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
      "rank": 611,
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
      "issue": "PAN-1490",
      "rank": 612,
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
      "issue": "PAN-1485",
      "rank": 613,
      "size": "S",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Remaining scope after #4655 auto-settle: day-10 archive + favorite clearing; close-or-keep is an operator call.",
      "rationale": "Rank unchanged; a 2026-11-02 comment confirms PAN-4655 delivers idle auto-settle, so only day-10 archive and favorite clearing remain (size M→S, score trimmed), still needs-refinement pending the operator close decision.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5578",
      "rank": 613,
      "size": "XS",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan-tts SKILL.md and EXTERNAL-EVENT-STREAM.md cite a private sidecar, port 3000, 2048-dim embeddings, stale catalog.",
      "rationale": "Rank unchanged; PAN-5481 (voice.mdx) closed, so that dependency is removed and the link target now exists.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1473",
      "rank": 614,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1443",
      "rank": 615,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "stale",
      "dependsOn": [],
      "why": "Specs live directly under .pan/specs now; only check that no stale legacy files remain under docs/prds/",
      "rationale": "Triage: no active/completed migration step exists any more; reduced to a one-line check for leftover legacy files.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1442",
      "rank": 616,
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
      "issue": "PAN-1432",
      "rank": 617,
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
      "rank": 618,
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
      "rank": 619,
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
      "rank": 620,
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
      "issue": "PAN-4360",
      "rank": 621,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add pan claude upgrade and offer the Claude Code upgrade in pan install / pan sync; PAN-4359 has closed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1060",
      "rank": 622,
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
      "rank": 623,
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
      "issue": "PAN-1037",
      "rank": 624,
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
      "rank": 625,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-949",
      "rank": 626,
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
      "issue": "PAN-3157",
      "rank": 627,
      "size": "XS",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rescoped: Awareness rail should show conv-flywheel as the Flywheel with its last tick (derive-status.ts) and link to /flywheel.",
      "rationale": "Rank held at 601: the rescope comment names the concrete data source (deriveFlywheelStatus/findLastTick) and target route, so condition moves from needs-refinement to ok.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5067",
      "rank": 628,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Skill overrides: bad-YAML issue file is overwritten on write (data loss), license detection gaps, Pi ignores --pack silently.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4908",
      "rank": 629,
      "size": "S",
      "importance": "low",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Other remote-not-enabled messages name no file and the dead verb 'pan remote setup'; reuse PAN-4905's remoteEnabledHint().",
      "rationale": "Its blocker PAN-4905 closed on 2026-11-03, so the remoteEnabledHint() helper exists; rank holds at 604 and the issue is now unblocked.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5130",
      "rank": 630,
      "size": "S",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan project add gains --issue-prefix for any tracker; --linear-team becomes a deprecated alias. Follow-up to closed PAN-51.",
      "rationale": "New small CLI ergonomics follow-up to the now-closed PAN-51 docs issue; clear spec, low blast radius, ranked with other medium score-36 items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-947",
      "rank": 631,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: project management actions in unified sidebar",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-938",
      "rank": 632,
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
      "rank": 633,
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
      "rank": 634,
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
      "rank": 635,
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
      "rank": 636,
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
      "issue": "PAN-4308",
      "rank": 637,
      "size": "S",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settle reaped Fly remote transcripts into the Session Vault; PAN-4295 auto-reap landed, still blocked by PAN-2609 (engine).",
      "rationale": "Dependency PAN-4295 closed; PAN-2609 remains, so rank unchanged.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3322",
      "rank": 638,
      "size": "XS",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "launcher-generator.ts's file-size ceiling sits 126 lines above the real file, handing back the regrowth the ratchet exists to prevent.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-678",
      "rank": 639,
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
      "rank": 640,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets",
      "rationale": "Triage: now covered by deacon-lite's API-error nudge routine; verify against that routine specifically. Rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-654",
      "rank": 641,
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
      "rank": 642,
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
      "rank": 643,
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
      "rank": 644,
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
      "rank": 645,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Investigate thinking effort levels for agents",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-607",
      "rank": 646,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Evaluate Ultimate Bug Scanner (UBS) for verification gate",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-606",
      "rank": 647,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Evaluate MCP Agent Mail for inter-agent communication and file reservations",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-548",
      "rank": 648,
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
      "rank": 649,
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
      "rank": 650,
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
      "rank": 651,
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
      "rank": 652,
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
      "rank": 653,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Adopt remaining Effect patterns",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1126",
      "rank": 654,
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
      "issue": "PAN-5154",
      "rank": 655,
      "size": "L",
      "importance": "low",
      "score": 30,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "GitHub account, token and host per owner (work accounts, GHES). Not scheduled; needs a PRD first.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1066",
      "rank": 656,
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
      "issue": "PAN-3441",
      "rank": 657,
      "size": "L",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "God View 'River' WebGL pipeline visualization fed by the live hook-event stream; PRD and mockup exist.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2968",
      "rank": 658,
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
      "rank": 659,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "stale",
      "dependsOn": [],
      "why": "Superseded by OKF v0.2: drafts plus human verify replace the PR gate (eltmon/okf#6); semantic pass is eltmon/okf#7",
      "rationale": "Condition changed to stale because the 2026-09-29 OKF v0.2 trust model supersedes the PR-gated design this issue assumes; rank is unchanged.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2936",
      "rank": 660,
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
      "issue": "PAN-4373",
      "rank": 661,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Optional Jev relevance filter for prompt-time memory injection candidates; both prerequisites have closed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2868",
      "rank": 662,
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
      "rank": 663,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Expose Codex app-server conversation controls in the dashboard",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2679",
      "rank": 664,
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
      "rank": 665,
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
      "rank": 666,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add opt-in Observation-first conversation view",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2635",
      "rank": 667,
      "size": "XS",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "pay down the 152-error src/dashboard/server typecheck debt",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-5066",
      "rank": 668,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project skills in .pan/skills skip the CLI workspace fallback, never refresh, lose to bundled skills, and never reach Codex/Pi.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3443",
      "rank": 669,
      "size": "L",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "God View 'Spectrum Deck' visualizer concept with mockup and PRD; pure exploration, no substrate impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4350",
      "rank": 670,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Re-dispatch budget for foreman items; issue itself flags an unresolved conflict with the no-stored-state rule",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4003",
      "rank": 671,
      "size": "L",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Parked: delete the ohmypi/omp harness, keep Pi; obsoletes 10 open ohmypi issues and shrinks PAN-3958's CH-7 scope",
      "rationale": "New this run (opened 2026-09-23). Operator has already decided OMP is going away, so the 10 open ohmypi: issues are dead weight until this lands; ranked just under PAN-3958 because both are parked on the same scheduling call, and the deletion is smaller and fully decided.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4368",
      "rank": 672,
      "size": "S",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Operator-run checklist: verify Sonnet 5.5 across switch-model, fork and compaction (model-locked thinking blocks)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2622",
      "rank": 673,
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
      "rank": 674,
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
      "rank": 675,
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
      "rank": 676,
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
      "rank": 677,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Claude Code Traffic Inspector",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2505",
      "rank": 678,
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
      "rank": 679,
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
      "rank": 680,
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
      "issue": "PAN-4769",
      "rank": 681,
      "size": "XS",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Two-sentence wording fix in features/skill-packs.mdx; PAN-4759 created the page and closed, so this is unblocked.",
      "rationale": "Rank held: dependency PAN-4759 (the skill-packs page) closed as completed, so this wording fix is now unblocked.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3940",
      "rank": 682,
      "size": "XL",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Parked epic: event-driven plugin/hook system on pipeline-notifier + hygiene-scheduler; do not pick up until the journal has soaked",
      "rationale": "Epic container, parked by design until the post-cut event chain has soaked; never picked up directly. No child issues filed yet, so no contains edges.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": true
    },
    {
      "issue": "PAN-5608",
      "rank": 682,
      "size": "S",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Orders routes resolve .pan from raw project.path, CLI via issue_routing; latent split for routed projects. Never fired yet.",
      "rationale": "Rank unchanged: its prerequisite PAN-5598 merged 2026-11-23, so the dependency is cleared; still a latent split that no registered project triggers.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2424",
      "rank": 683,
      "size": "L",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic: the Order Book",
      "rationale": "Flagged isEpic this pass: the title is 'Epic: the Order Book' and the body is a four-phase container, not directly workable. Its phases are not yet split into child issues, so it carries no contains edges. Operator-owned gate=blocked and planning=skip preserved verbatim; rank unchanged.",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2406",
      "rank": 684,
      "size": "S",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remaining scope: findAllWorkspacePaths must also enumerate -strike-wt and named-suffix worktrees; gaps 1 and 3 are moot.",
      "rationale": "Rank held at 657; triage narrowed the scope to one enumeration gap, so condition moves to ok and size to S.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2394",
      "rank": 685,
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
      "issue": "PAN-4823",
      "rank": 686,
      "size": "XL",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic: Capacitor phone client for Anywhere without Tailscale; 15 children filed (#4828-4843); OD-1 settled; PAN-4774 done.",
      "rationale": "PAN-4774 (Anywhere release AC run) closed as completed, so that dependency is removed; rank held because the phone-app epic is feature work that still ranks below substrate items.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": true
    },
    {
      "issue": "PAN-2353",
      "rank": 687,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1b: Hermes external-agent bridge (scoped API + Fly 6PN)",
      "rationale": "Rank 663->661 (slot swap within the Anywhere set) to follow PAN-2350's 2026-09-28 recommended order; no other node moved.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-5518",
      "rank": 688,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "roles.<role>.harness validates but no pipeline spawn reads it; CLI help says it is a default. Needs honor-or-retire decision first.",
      "rationale": "New: misleading config and help text, but the body leaves open whether to honor or retire the key, so it is needs-refinement and ranked with decision-first work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3133",
      "rank": 689,
      "size": "S",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Evaluation spike for TRON encoding of prompt-bound xBRIEF payloads; savings are modest today since agents get a bounded slice.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-5082",
      "rank": 690,
      "size": "XL",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Move every MCP surface to SDK v2 for the 2026-07-28 spec while keeping 2025-11-25 clients; time it on PAN-5083 data.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3011",
      "rank": 691,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [
        "PAN-465"
      ],
      "why": "Add poolside Laguna S 2.1 as a model target; the honest hardware note says it will not fit this machine's GPU.",
      "rationale": "PAN-1641 (the Ollama path) closed as completed, so only the hosted-path dependency on PAN-465 remains; rank unchanged because the hardware limit still applies.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2282",
      "rank": 692,
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
      "rank": 693,
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
      "rank": 694,
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
      "rank": 695,
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
      "rank": 696,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [
        "PAN-1592"
      ],
      "why": "Composer: a failed first send leaves the text in BOTH the composer box and the retry outbox",
      "rationale": "Re-derived github-ref dependency this pass: the body names #1592 as the outbox reload-durability prerequisite. Rank unchanged - the cross-reference is not new.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2082",
      "rank": 697,
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
      "rank": 698,
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
      "rank": 699,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "stale",
      "dependsOn": [],
      "why": "Conversation view does not surface terminal command responses",
      "rationale": "Condition stale: crossed the 90-day age line with no body or comment activity since 2026-06-24, and it describes conversation-view delivery feedback in a path the Herdr terminal-backend work has now largely rebuilt — PAN-3921 (route conversations and pan handoff through the terminal backend) merged 2026-09-24, while PAN-3962 is still open. Rank unchanged at 674: staleness alone does not justify a move, it sits deep in the tail at low importance, and the rebuild means the issue must be re-read against the new conversation path before anyone works it.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2006",
      "rank": 700,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Run definition",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-5487",
      "rank": 700,
      "size": "XS",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan scope --help says it moves xBRIEF files; the code rewrites status fields in place. Reword 5 descriptions.",
      "rationale": "New help-text cleanup; low impact, so it bands with low work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3919",
      "rank": 701,
      "size": "S",
      "importance": "low",
      "score": 25,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Review the universal effort-high default and supervisor effort discretion; explicitly an operator decision, no work authorized",
      "rationale": "New this run: low/25 — Review the universal effort-high default and supervisor effort discretion; explicitly an operator decision, no work authorized.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5550",
      "rank": 701,
      "size": "XS",
      "importance": "low",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan reload --force is a no-op and help plus core-commands.mdx still claim a deploy-window bypass; remove or define it.",
      "rationale": "New: dead flag and stale help text left from the deploy-window removal; cosmetic, ranked with other low help-text fixes.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2005",
      "rank": 702,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog Sequencer: Pickup Forecast",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2002",
      "rank": 703,
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
      "rank": 704,
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
      "rank": 705,
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
      "rank": 706,
      "size": "L",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2672",
      "rank": 707,
      "size": "S",
      "importance": "low",
      "score": 25,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Transcript half reported fixed; parent-stays-ended half moved to PAN-4485. Verify on current build, then close.",
      "rationale": "Demoted from 362: the 2026-10-02 comment moves the remaining scope to PAN-4485 and PAN-4485 reports the transcript half fixed, so only a verify-and-close remains.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1958",
      "rank": 708,
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
      "issue": "PAN-1907",
      "rank": 709,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-selectable + validate every…",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1895",
      "rank": 710,
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
      "rank": 711,
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
      "rank": 712,
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
      "rank": 713,
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
      "issue": "PAN-1646",
      "rank": 714,
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
      "rank": 715,
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
      "issue": "PAN-1592",
      "rank": 716,
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
      "rank": 717,
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
      "issue": "PAN-1533",
      "rank": 718,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fork-into-worktree from conversation branch chip",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1483",
      "rank": 719,
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
      "rank": 720,
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
      "rank": 721,
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
      "rank": 722,
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
      "rank": 723,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Create a new issue directly from a kanban column",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1222",
      "rank": 724,
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
      "rank": 725,
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
      "issue": "PAN-4352",
      "rank": 726,
      "size": "XS",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Operator verification: skill packs in a managed interactive Claude Code launch now that PAN-4334 has shipped",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1153",
      "rank": 727,
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
      "issue": "PAN-4298",
      "rank": 728,
      "size": "XL",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-1676"
      ],
      "why": "Anywhere paid tier: run agents on hosted Fly capacity; tenant isolation, credentials, metering open; PAN-1676 unbuilt",
      "rationale": "Billing PAN-4294 merged and closed 2026-11-16 and is dropped from dependsOn; PAN-1676 and the open design questions remain, so rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1152",
      "rank": 729,
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
      "issue": "PAN-1135",
      "rank": 730,
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
      "rank": 731,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "Deacon-patrol tie-in for TLDR supervision is gone; would need its own liveness check",
      "rationale": "Triage: the daemon-resurrection hook this piggybacked on is gone. Stale at the tail.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1123",
      "rank": 732,
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
      "rank": 733,
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
      "issue": "PAN-4248",
      "rank": 734,
      "size": "L",
      "importance": "medium",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "List, pull and delete local Ollama models (size, store, in-use) in CLI, dashboard and doctor; PAN-1641 sidecar has merged.",
      "rationale": "Its only blocker, the PAN-1641 Ollama sidecar, closed as completed, so it moves into the freed rank 711 slot ahead of other local-model work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1117",
      "rank": 735,
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
      "rank": 736,
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
      "rank": 737,
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
      "rank": 738,
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
      "rank": 739,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound",
      "rationale": "Rank shifted from 711 to 710: the prior run collided it with the in-pipeline pin PAN-1641 at rank 711; moved into the adjacent vacant slot.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3971",
      "rank": 740,
      "size": "L",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck-native artifact pages (pan artifact publish + state door + dashboard listing); body says backlog only, Claude artifacts work today",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3768",
      "rank": 741,
      "size": "XS",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan handoff --title already implemented and landed (678f6b389e5); open only pending close-out.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3034",
      "rank": 742,
      "size": "XS",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix already landed on main (strike/slot workspace names and live tmux now seed the session tree); open pending close-out.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2983",
      "rank": 743,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "Superseded by the OKF v0.2 redesign: write modes and drafts (eltmon/okf#6) and the advisory semantic pass (eltmon/okf#7)",
      "rationale": "Condition changed to stale because the accepted OKF v0.2 redesign covers both deferred capabilities in eltmon/okf; rank is unchanged.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3824",
      "rank": 744,
      "size": "XS",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Image-only report: default view on Windows breaks the model selector; needs a written repro and expected behavior",
      "rationale": "New this run: low/20 — Image-only report: default view on Windows breaks the model selector; needs a written repro and expected behavior.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3823",
      "rank": 745,
      "size": "XS",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Image-only report titled \"pan sync issue\"; needs the command, output text, and expected behavior",
      "rationale": "New this run: low/20 — Image-only report titled \"pan sync issue\"; needs the command, output text, and expected behavior.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1049",
      "rank": 746,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Spike: evaluate Tauri v2 desktop shell",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-984",
      "rank": 747,
      "size": "XS",
      "importance": "low",
      "score": 19,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Evaluate context-mode MCP server as session continuity + search layer",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-5431",
      "rank": 748,
      "size": "XS",
      "importance": "low",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "CodeRabbit minor follow-up on PR #5429 (PAN-5424): RELEASING.md direct vs transitive deps wording; native path in a test assertion.",
      "rationale": "New CodeRabbit follow-up with two Minor findings (one doc wording, one test path); placed in a free low-tier slot beside comparable minor follow-ups.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5629",
      "rank": 748,
      "size": "XS",
      "importance": "low",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "3 Minor CodeRabbit findings on merged PAN-5599 PR #5627: order-book docs wording and a post-backfill detail snapshot.",
      "rationale": "New advisory CodeRabbit follow-up with three Minor findings (two docs, one route snapshot); placed beside comparable minor follow-ups.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-962",
      "rank": 749,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Post-PAN-946: vBRIEF lifecycle follow-up plan",
      "rationale": "Triage: xBRIEF already ships file-based specs/continues under .pan/; verify remaining checklist items against the write-xbrief skill. Rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-961",
      "rank": 750,
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
      "issue": "PAN-5365",
      "rank": 751,
      "size": "S",
      "importance": "low",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "MCP memory_add gains a source param now that PAN-5360 shipped; the supersedes-on-agent-surface decision is still open.",
      "rationale": "Its dependency PAN-5360 merged, so it is unblocked, but the supersedes policy is still an open decision, so it stays needs-refinement at the same rank.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-943",
      "rank": 752,
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
      "rank": 753,
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
      "rank": 754,
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
      "rank": 755,
      "size": "L",
      "importance": "low",
      "score": 19,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-833",
      "rank": 756,
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
      "rank": 757,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActivity",
      "rationale": "Triage: references the pre-rename hook pipeline; verify against liveness.ts, which now owns state.json exclusively. Rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4347",
      "rank": 758,
      "size": "S",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done appends continue.json decisions to the PR body so significant decisions outlive the workspace",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-797",
      "rank": 759,
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
      "issue": "PAN-4275",
      "rank": 760,
      "size": "S",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prove a local Ollama model can finish a real work-agent task; gemma4:12b made zero tool calls. PAN-1641 has merged.",
      "rationale": "PAN-1641 closed as completed, which removes the merge blocker; rank unchanged because the open question is model capability, not the sidecar.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2836",
      "rank": 761,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Placement presets now belong on eltmon/okf#4 after the OKF v0.2 redesign; migrate verb collides; re-scope or move upstream",
      "rationale": "Moved down from 331 because the OKF v0.2 redesign moved init into eltmon/okf, so this overdeck issue needs re-scoping against eltmon/okf#4 before it is workable here.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-790",
      "rank": 762,
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
      "rank": 763,
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
      "rank": 764,
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
      "rank": 765,
      "size": "L",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Redesign workspace inspector panel: sidebar layout is cramped and wrong",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3456",
      "rank": 766,
      "size": "XS",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Already fixed in 4117c9a777 with a regression test; open only pending close-out.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-774",
      "rank": 767,
      "size": "XS",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unify launch UX and release pipeline for 1.0",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-773",
      "rank": 768,
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
      "rank": 769,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Auto-resume ladder paths it names are gone; terminal-stack consistency now means the Herdr/tmux contract in TERMINAL-BACKENDS.md",
      "rationale": "Triage: the respawn/recovery paths named are gone; stale at the tail.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-771",
      "rank": 770,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Investigate Vercel Sandbox execution backend support",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-769",
      "rank": 771,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [
        "PAN-750"
      ],
      "why": "Phase-transition history no longer accumulates in a record; a churn metric would be rebuilt from PR review cycles or the pipeline journal",
      "rationale": "Triage: the stored history is gone; stale at the tail.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-765",
      "rank": 772,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Preserve trailing zeros in cost displays",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-764",
      "rank": 773,
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
      "issue": "PAN-4425",
      "rank": 774,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deft fork work in eltmon/directive (env off switch, external-orchestrator mode); outside the overdeck pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-752",
      "rank": 775,
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
      "rank": 776,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Historical Metrics Data Persistence",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-750",
      "rank": 777,
      "size": "L",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Complete Metrics Page Redesign",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-749",
      "rank": 778,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Research and borrow best features from gstack",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-747",
      "rank": 779,
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
      "rank": 780,
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
      "rank": 781,
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
      "rank": 782,
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
      "rank": 783,
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
      "issue": "PAN-701",
      "rank": 784,
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
      "rank": 785,
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
      "rank": 786,
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
      "issue": "PAN-624",
      "rank": 787,
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
      "rank": 788,
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
      "rank": 789,
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
      "rank": 790,
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
      "rank": 791,
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
      "rank": 792,
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
      "rank": 793,
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
      "rank": 794,
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
      "rank": 795,
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
      "rank": 796,
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
      "rank": 797,
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
      "rank": 798,
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
      "rank": 799,
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
      "rank": 800,
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
      "rank": 801,
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
      "rank": 802,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Planning-agent --effort; likely covered by merged PAN-4249 resolver and PAN-4258 (plan effort), confirm or close",
      "rationale": "PAN-4249 merged a single effort resolver with role/sub-role/tier effort, so this older request now carries duplicate risk; condition set to needs-refinement, rank kept.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-476",
      "rank": 803,
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
      "rank": 804,
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
      "rank": 805,
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
      "rank": 806,
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
      "rank": 807,
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
      "issue": "PAN-2348",
      "rank": 808,
      "size": "XS",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: migrate STATE-STORAGE-AUDIT.md content to living docs, then delete",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2346",
      "rank": 809,
      "size": "XS",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh AGENT_TYPES_INDEX.md to the post-Cut taxonomy in ROLES.md (xBRIEF items, foreman, conv-flywheel, worker role).",
      "rationale": "Rank held; triage gave a concrete refresh target, so condition moves to ok.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2345",
      "rank": 810,
      "size": "XS",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: rewrite pan-done.md against done.ts + done-preflight.ts; fix continue path; point MERGE link at MERGE-WORKFLOW.md.",
      "rationale": "Rank held; triage gave concrete source files and link targets, so condition moves to ok.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2344",
      "rank": 811,
      "size": "XS",
      "importance": "low",
      "score": 10,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "docs: rewrite KANBAN-MODEL.md for the current pipeline; relabeled needs-rescope, so scope must be restated before work.",
      "rationale": "Rank held; the issue was relabeled needs-rescope, so condition moves to needs-refinement until the rewrite scope is restated.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2343",
      "rank": 812,
      "size": "XS",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: rewrite MISSION-CONTROL.md: state label from deriveStateLabel, membership, liveness.ts; review_status table is gone.",
      "rationale": "Rank held; triage named the current label sources the rewrite must describe.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2073",
      "rank": 813,
      "size": "XS",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Desktop App",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2071",
      "rank": 814,
      "size": "XS",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Hooks system",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2068",
      "rank": 815,
      "size": "XS",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for Caveman (agent output compression)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2067",
      "rank": 816,
      "size": "XS",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for RTK (Bash output compression)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1684",
      "rank": 817,
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
      "rank": 818,
      "size": "XS",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1474",
      "rank": 819,
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
      "rank": 820,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "End-to-end review and consolidation of all project documentation",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-674",
      "rank": 821,
      "size": "XS",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add glossary of Panopticon domain terms",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-634",
      "rank": 822,
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
      "issue": "PAN-2908",
      "rank": 823,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Make overdeck not suck",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-106",
      "rank": 824,
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
      "issue": "PAN-262",
      "rank": 825,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "stale",
      "dependsOn": [],
      "why": "Refactor post-merge lifecycle into composable, idempotent operations",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-176",
      "rank": 826,
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
      "issue": "PAN-334",
      "rank": 827,
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
      "rank": 828,
      "size": "XS",
      "importance": "medium",
      "score": 49,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Approval is now a PR review or the dashboard MERGE button; verify whether the agent detail pane already surfaces MERGE post-cut",
      "rationale": "Triage: the stored approve action is gone; may already be satisfied by the MERGE button. Rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-304",
      "rank": 829,
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
      "issue": "PAN-245",
      "rank": 830,
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
      "rank": 831,
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
      "issue": "PAN-4332",
      "rank": 832,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Interop: continue t3code sessions in Overdeck and back via native transcripts; PAN-2609 Phase A has closed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-113",
      "rank": 833,
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
      "rank": 834,
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
      "issue": "PAN-294",
      "rank": 835,
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
      "rank": 836,
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
      "rank": 837,
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
      "rank": 838,
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
      "rank": 839,
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
      "rank": 840,
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
      "rank": 841,
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
      "rank": 842,
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
      "rank": 843,
      "size": "L",
      "importance": "medium",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "e2e command for full workflow integration test",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-38",
      "rank": 844,
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
      "rank": 845,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "stale",
      "dependsOn": [],
      "why": "Support external PR selection for merge-agent",
      "rationale": "Rank 825->826: resolves a duplicate rank shared with a pinned in-workspace issue; impact assessment unchanged.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3248",
      "rank": 846,
      "size": "XS",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "Stale: targets the deploy patrol (pan reload is the new home) deleted by the PAN-3917 cut (ca15def); re-triage or close",
      "rationale": "Demoted from rank 42: the component this issue targets (the deploy patrol (pan reload is the new home)) was deleted by the PAN-3917 cut on main; the issue needs re-triage against the new tree or closure.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3244",
      "rank": 847,
      "size": "S",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "Stale: targets the deploy-patrol deploy window deleted by the PAN-3917 cut (ca15def); re-triage or close",
      "rationale": "Rank 828->829: resolves a duplicate rank shared with a pinned in-workspace issue; impact assessment unchanged.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2775",
      "rank": 848,
      "size": "S",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Stale: targets boot-correlated reaping (boot reconciliation) deleted by the PAN-3917 cut (ca15def); re-triage or close",
      "rationale": "Triage: heartbeat-dead handling and sweep/reap logic changed substantially; verify boot-correlated false reaps against liveness-reconcile / closed-issue-reap. Rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5033",
      "rank": 849,
      "size": "XS",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "OpenClaw Connect a bot snippet omits hooks.allowConversationAccess, so the needs-you summary stays off with no message.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3505",
      "rank": 850,
      "size": "XS",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Stale: targets the flywheel state write door deleted by the PAN-3917 cut (ca15def); re-triage or close",
      "rationale": "Triage: flywheelRunId and the main-push guard both still exist; verify the allowlist bug against current logic. Rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5043",
      "rank": 851,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Commit the phone-app iOS Simulator harness (Miniflare connect stand-in, stub account service, rig steps) built twice by hand.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5065",
      "rank": 852,
      "size": "L",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Opt-in mode where a project's agents and gates stop seeing ~/.overdeck.env keys the project did not list.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3321",
      "rank": 853,
      "size": "XS",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "Stale: targets pan unstick deleted by the PAN-3917 cut (ca15def); re-triage or close",
      "rationale": "Demoted from rank 490: the component this issue targets (pan unstick) was deleted by the PAN-3917 cut on main; the issue needs re-triage against the new tree or closure.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-736",
      "rank": 854,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "stale",
      "dependsOn": [],
      "why": "Retired: work-types.ts, WorkTypeRouter and models.overrides are all gone (#4174); per-subagent routing needs a fresh roles.* design",
      "rationale": "Demoted 609→835, medium→low and ok→stale because #4174 (PAN-4131) merged this run and retired models.overrides, while PAN-1048 had already deleted src/lib/work-types.ts, WorkTypeRouter.getModel and Settings/WorkTypeTable.tsx — every component this issue's body names is gone on origin/main, so the underlying per-subagent routing want would have to be re-specified against roles.<role>.model before it is workable.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-762",
      "rank": 855,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "stale",
      "dependsOn": [],
      "why": "Premise gone: models.overrides is a retired, ignored key since #4174, so there are no overrides left to warn about",
      "rationale": "Demoted 750→836 and ok→stale because #4174 (PAN-4131) merged this run and made models.overrides retired and ignored (merge.ts logs one warning and drops it), so the override mechanism this issue asks Overdeck to warn about no longer exists.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-299",
      "rank": 856,
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
      "rank": 857,
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
      "rank": 858,
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
      "rank": 859,
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
      "rank": 860,
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
      "rank": 861,
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
      "rank": 862,
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
      "issue": "PAN-228",
      "rank": 863,
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
      "rank": 864,
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
      "rank": 865,
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
      "rank": 866,
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
      "rank": 867,
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
      "rank": 868,
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
      "rank": 869,
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
      "rank": 870,
      "size": "L",
      "importance": "low",
      "score": 11,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-155: Redesign health page with Stitch (system overview, timeline, costs)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-146",
      "rank": 871,
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
      "rank": 872,
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
      "issue": "PAN-44",
      "rank": 873,
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
      "issue": "PAN-2070",
      "rank": 874,
      "size": "XS",
      "importance": "low",
      "score": 9,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Likely done: PAN-5470 shipped features/flywheel.mdx for the loop skill; verify and close.",
      "rationale": "Rank held; PAN-5470, which superseded this issue, closed, so this is a close candidate once the page is confirmed on main.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3536",
      "rank": 875,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Subsumed by PAN-4003 (OMP harness removal): pan tell can not reach ohmypi conversations; fix dies with the harness",
      "rationale": "PAN-4003 (opened 2026-09-23) names this issue as a close-as-won't-do or fold-in candidate under the standing operator decision to drop the Oh My Pi harness, so it must not be picked up on its old rank until PAN-4003 is scheduled and decides its fate. gate and planning preserved verbatim.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2027",
      "rank": 876,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Subsumed by PAN-4003 (OMP harness removal): routing kimi-k2 through ohmypi needs a different home once OMP is gone",
      "rationale": "PAN-4003 (opened 2026-09-23) names this issue as a close-as-won't-do or fold-in candidate under the standing operator decision to drop the Oh My Pi harness, so it must not be picked up on its old rank until PAN-4003 is scheduled and decides its fate. gate and planning preserved verbatim.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2035",
      "rank": 877,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Subsumed by PAN-4003 (OMP harness removal): Copilot provider routing via omp",
      "rationale": "PAN-4003 (opened 2026-09-23) names this issue as a close-as-won't-do or fold-in candidate under the standing operator decision to drop the Oh My Pi harness, so it must not be picked up on its old rank until PAN-4003 is scheduled and decides its fate. gate and planning preserved verbatim.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2034",
      "rank": 878,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Subsumed by PAN-4003 (OMP harness removal): end-to-end test for ohmypi tool-call rendering",
      "rationale": "PAN-4003 (opened 2026-09-23) names this issue as a close-as-won't-do or fold-in candidate under the standing operator decision to drop the Oh My Pi harness, so it must not be picked up on its old rank until PAN-4003 is scheduled and decides its fate. gate and planning preserved verbatim.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2033",
      "rank": 879,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Subsumed by PAN-4003 (OMP harness removal): ohmypi message-delivery latency benchmark",
      "rationale": "PAN-4003 (opened 2026-09-23) names this issue as a close-as-won't-do or fold-in candidate under the standing operator decision to drop the Oh My Pi harness, so it must not be picked up on its old rank until PAN-4003 is scheduled and decides its fate. gate and planning preserved verbatim.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2032",
      "rank": 880,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Subsumed by PAN-4003 (OMP harness removal): local Ollama review role via omp",
      "rationale": "PAN-4003 (opened 2026-09-23) names this issue as a close-as-won't-do or fold-in candidate under the standing operator decision to drop the Oh My Pi harness, so it must not be picked up on its old rank until PAN-4003 is scheduled and decides its fate. gate and planning preserved verbatim.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2030",
      "rank": 881,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Subsumed by PAN-4003 (OMP harness removal): version-pin the ohmypi extension",
      "rationale": "PAN-4003 (opened 2026-09-23) names this issue as a close-as-won't-do or fold-in candidate under the standing operator decision to drop the Oh My Pi harness, so it must not be picked up on its old rank until PAN-4003 is scheduled and decides its fate. gate and planning preserved verbatim.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2029",
      "rank": 882,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Subsumed by PAN-4003 (OMP harness removal): ohmypi-parser thinking_tokens capture",
      "rationale": "PAN-4003 (opened 2026-09-23) names this issue as a close-as-won't-do or fold-in candidate under the standing operator decision to drop the Oh My Pi harness, so it must not be picked up on its old rank until PAN-4003 is scheduled and decides its fate. gate and planning preserved verbatim.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2028",
      "rank": 883,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Subsumed by PAN-4003 (OMP harness removal): per-provider cost grouping keyed on omp",
      "rationale": "PAN-4003 (opened 2026-09-23) names this issue as a close-as-won't-do or fold-in candidate under the standing operator decision to drop the Oh My Pi harness, so it must not be picked up on its old rank until PAN-4003 is scheduled and decides its fate. gate and planning preserved verbatim.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2024",
      "rank": 884,
      "size": "XS",
      "importance": "low",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Subsumed by PAN-4003 (OMP harness removal): ohmypi conversation Tools-toggle",
      "rationale": "PAN-4003 (opened 2026-09-23) names this issue as a close-as-won't-do or fold-in candidate under the standing operator decision to drop the Oh My Pi harness, so it must not be picked up on its old rank until PAN-4003 is scheduled and decides its fate. gate and planning preserved verbatim.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2883",
      "rank": 885,
      "size": "M",
      "importance": "high",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Appears already fixed: resolveIssuePullRequestRef probes strike/<id> at pull-requests.ts:209, which is exactly the fix. Verify and close.",
      "rationale": "Demoted from rank 65 because clearing the closed PAN-2828 dependency prompted a reread, and the fix has landed: src/lib/overdeck/pull-requests.ts:200-209 probes feature/<id> then strike/<id>, so a strike PR resolves and close-out's deploy row gets its mergedAt. The issue body itself records this under 'Fix (landed)' with live verification across six strikes. Nothing here is workable; it needs an operator verification and a close, not an agent.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2995",
      "rank": 886,
      "size": "XS",
      "importance": "high",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Same defect as PAN-2828, closed as a duplicate of the fixed #2907; verifyStrikeBranchMergedIntoMain already checks PR-merge and content.",
      "rationale": "Demoted from rank 201. PAN-2995 and the just-closed PAN-2828 describe one defect — pan done --strike refusing a squash-merged strike on branch ancestry. PAN-2828's closing comment names #2907/#2915/#3343 as the fix, and the code matches: src/cli/commands/strike-merge-verification.ts:76 falls through ancestry, then a merged-PR lookup by headRefOid, then git cherry, then content equivalence, and src/cli/commands/done.ts:318-320 calls it on the strike path with done.test.ts coverage. The substrate-improvement label keeps importance at the high floor, but impact toward shipping is nil, so it ranks in the verify-and-close tail.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4555",
      "rank": 887,
      "size": "XS",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Date-gated: start on/after 2026-12-01. Raise gemini-4-argon and gemini-4-carbon pricing rows to list rates.",
      "rationale": "Rank held at the tail: a new comment adds the Gemini 4 Carbon rows (PAN-5586) to the scope, but the change is still only correct on or after 2026-12-01.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-5449",
      "rank": 888,
      "size": "M",
      "importance": "low",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unblocked: PAN-4590 sast gate merged. A skipped sast scan renders as a green pass; add skipped state + findings list.",
      "rationale": "PAN-4590 merged on 2026-11-16, so this issue is now startable. The live gate shows a skipped scan as a pass, so it takes the freed rank 888, ahead of the pinned Semgrep children.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5434",
      "rank": 889,
      "size": "M",
      "importance": "low",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codex apply_patch post-edit Semgrep scan; needs a hooks.json composer shared with SageOx. PAN-4591 merged; live Codex probe first.",
      "rationale": "PAN-4591 (Semgrep in-session) merged on 2026-11-16, so this deferred slice is unblocked and takes the parent's freed slot at 889.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5453",
      "rank": 890,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "One-time $3 Creem 'Extra 50 GB relay' product, per-account relayCapBytes and a live entitlement push to connect. Billing landed.",
      "rationale": "Billing PAN-4294 merged and closed 2026-11-16, so this is unblocked; value still waits on relay users hitting the allowance, so rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5455",
      "rank": 891,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "SIGNUP_MODE invite|open switch for overdeck.ai plus abuse limits; opening sign-up is the operator's launch call. Billing landed.",
      "rationale": "Billing PAN-4294 merged and closed 2026-11-16, so this is unblocked; the operator's launch decision still gates its value, so rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4593",
      "rank": 892,
      "size": "L",
      "importance": "low",
      "score": 30,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Semgrep Platform/Guardian tier; operator decisions (offer Guardian? contact Semgrep first?) still open — refine before work.",
      "rationale": "PAN-4590 merged 2026-11-16, so its dependency was removed; rank unchanged because operator decisions are still open.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5022",
      "rank": 893,
      "size": "L",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Phone app: relay notification preferences to offline machines via the directory, and drop muted pushes on the phone.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5021",
      "rank": 894,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "PAN-5100 landed phone telemetry with conflicting decisions; re-scope to any remaining gap or close as superseded.",
      "rationale": "Rank shared slot 867 with in-pipeline PAN-5078 in the prior run; moved to the free slot 866 with no change in impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5029",
      "rank": 895,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Grok Build Tailscale reach can't work: pan mcp serve verifies tokens only against its own machine. Needs a design choice.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4842",
      "rank": 896,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Phone app W-DOC: phone-app.mdx and updates to Anywhere, push, tailscale and service docs; finished last.",
      "rationale": "PAN-4774 (Anywhere release AC run) closed as completed, so that dependency is removed; rank held because the phone-app epic is feature work that still ranks below substrate items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4851",
      "rank": 897,
      "size": "S",
      "importance": "low",
      "score": 15,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Open question: opt-in Overdeck reviewer for Deft-pipeline issues; operator says low priority, do not plan or start without them",
      "rationale": "Rank kept at the bottom: PAN-4820 closed so the dependency is dropped, but the operator still parks this undecided low-priority question.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-4887",
      "rank": 898,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Phone app: let phone credentials reach linked machines (fleet Needs-you, linked-conv proxy, /ws/linked); PAN-4835 merged.",
      "rationale": "PAN-4835 merged in #4894, which clears its only dependency; rank held because the Anywhere phone epic is low-impact relative to substrate work above it.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5207",
      "rank": 899,
      "size": "L",
      "importance": "low",
      "score": 15,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-5202"
      ],
      "why": "Parked by the operator: Flux meeting bots for Zoom, Teams, Meet, Slack as a paid integration. Do not start.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5456",
      "rank": 900,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-4297"
      ],
      "why": "+100 GB hosted vault add-on; billing model (Creem per-unit vs variants) undecided; needs hosted vault PAN-4297 first.",
      "rationale": "Billing PAN-4294 merged and closed 2026-11-16 and is dropped from dependsOn; it still waits on PAN-4297 and an open billing choice, so rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5181",
      "rank": 901,
      "size": "XS",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix shipped in PR #5179 (merged 2026-11-13); the body says it closes on merge. Verify and close.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5305",
      "rank": 902,
      "size": "XS",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Main build break already fixed: needsYou.ts imports from needsYouRows and main CI is green. Verify and close.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5444",
      "rank": 903,
      "size": "XS",
      "importance": "low",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Two Minor CodeRabbit findings left on merged PR #5443: semgrep repo rules resolve from event cwd; hook tests not isolated from Docker.",
      "rationale": "New this pass: advisory CodeRabbit follow-up to merged PAN-4591, ranked with the other minor-finding follow-ups.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-5405",
      "rank": 904,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "CodeRabbit follow-up on PR #5403: changes-query refetch after turns, Send menu keyboard/scheduling guard, tab-menu focus.",
      "rationale": "New CodeRabbit follow-up from the merged PAN-5295 PR; one Major and four Minor frontend findings, ranked with comparable follow-ups.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2423",
      "rank": 905,
      "size": "XS",
      "importance": "low",
      "score": 15,
      "condition": "stale",
      "dependsOn": [],
      "why": "Likely fixed: rebuild now uses the PAN-3049 resolver (docker.ts:181) and reap has no hardcoded prefix; confirm and close.",
      "rationale": "Demoted: a 2026-11-23 comment and a code check show both the rebuild and reap hardcodes are gone, so only an operator close remains.",
      "gate": "auto",
      "planning": "auto"
    }
  ],
  "edges": [
    {
      "from": "PAN-1166",
      "to": "PAN-2351",
      "type": "unblocks",
      "source": "operator",
      "confidence": 1
    },
    {
      "from": "PAN-1592",
      "to": "PAN-2083",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1666",
      "to": "PAN-1556",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1676",
      "to": "PAN-2424",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1676",
      "to": "PAN-4298",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1711",
      "to": "PAN-2905",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-1711",
      "to": "PAN-3522",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-1824",
      "to": "PAN-2421",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-1824",
      "to": "PAN-4705",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.4
    },
    {
      "from": "PAN-1983",
      "to": "PAN-1984",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.5
    },
    {
      "from": "PAN-2079",
      "to": "PAN-2080",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2211",
      "to": "PAN-2210",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2259",
      "to": "PAN-2880",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2259",
      "to": "PAN-4302",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2331",
      "to": "PAN-2639",
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
      "to": "PAN-2932",
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
      "from": "PAN-2350",
      "to": "PAN-1676",
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
      "to": "PAN-3862",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2350",
      "to": "PAN-4297",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2350",
      "to": "PAN-4298",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2350",
      "to": "PAN-4308",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2350",
      "to": "PAN-4332",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2350",
      "to": "PAN-4418",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2350",
      "to": "PAN-4419",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2350",
      "to": "PAN-4420",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2350",
      "to": "PAN-5453",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2424",
      "to": "PAN-5597",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
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
      "to": "PAN-277",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2580",
      "to": "PAN-3536",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2580",
      "to": "PAN-4303",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.4
    },
    {
      "from": "PAN-2626",
      "to": "PAN-4924",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
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
      "to": "PAN-106",
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
      "to": "PAN-2079",
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
      "to": "PAN-570",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2706",
      "to": "PAN-2695",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2775",
      "to": "PAN-2758",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2905",
      "to": "PAN-2259",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
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
      "from": "PAN-2977",
      "to": "PAN-2978",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2982",
      "to": "PAN-2983",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-3015",
      "to": "PAN-3630",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3032",
      "to": "PAN-3174",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.85
    },
    {
      "from": "PAN-3040",
      "to": "PAN-3708",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-3054",
      "to": "PAN-3061",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3054",
      "to": "PAN-4364",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3054",
      "to": "PAN-4367",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3062",
      "to": "PAN-3250",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3062",
      "to": "PAN-3505",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3081",
      "to": "PAN-3096",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3100",
      "to": "PAN-3084",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3107",
      "to": "PAN-3108",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-3113",
      "to": "PAN-2492",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3113",
      "to": "PAN-3234",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.85
    },
    {
      "from": "PAN-3113",
      "to": "PAN-3235",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.85
    },
    {
      "from": "PAN-3118",
      "to": "PAN-3043",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3129",
      "to": "PAN-3130",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.85
    },
    {
      "from": "PAN-3186",
      "to": "PAN-3256",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3234",
      "to": "PAN-3235",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-3248",
      "to": "PAN-3244",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3256",
      "to": "PAN-3267",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3270",
      "to": "PAN-3325",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3278",
      "to": "PAN-3274",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3289",
      "to": "PAN-3627",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3306",
      "to": "PAN-3317",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-3325",
      "to": "PAN-3697",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3354",
      "to": "PAN-5571",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.4
    },
    {
      "from": "PAN-3454",
      "to": "PAN-3517",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3460",
      "to": "PAN-3463",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-3502",
      "to": "PAN-4236",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3517",
      "to": "PAN-3518",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-3524",
      "to": "PAN-1711",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3524",
      "to": "PAN-1824",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3532",
      "to": "PAN-3502",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-3541",
      "to": "PAN-3543",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.7
    },
    {
      "from": "PAN-3557",
      "to": "PAN-2186",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3560",
      "to": "PAN-3563",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.85
    },
    {
      "from": "PAN-3563",
      "to": "PAN-3560",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3566",
      "to": "PAN-2706",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3566",
      "to": "PAN-3274",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3566",
      "to": "PAN-3563",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3657",
      "to": "PAN-4240",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.4
    },
    {
      "from": "PAN-3657",
      "to": "PAN-5637",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-3657",
      "to": "PAN-5638",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.4
    },
    {
      "from": "PAN-3771",
      "to": "PAN-2981",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3822",
      "to": "PAN-4151",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3822",
      "to": "PAN-4151",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3830",
      "to": "PAN-3831",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3853",
      "to": "PAN-3854",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-3935",
      "to": "PAN-3048",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-3946",
      "to": "PAN-3944",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3952",
      "to": "PAN-3234",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-3952",
      "to": "PAN-3944",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-4003",
      "to": "PAN-2024",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-4003",
      "to": "PAN-2027",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-4003",
      "to": "PAN-2028",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-4003",
      "to": "PAN-2029",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-4003",
      "to": "PAN-2030",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-4003",
      "to": "PAN-2032",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-4003",
      "to": "PAN-2033",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-4003",
      "to": "PAN-2034",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-4003",
      "to": "PAN-2035",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-4003",
      "to": "PAN-2282",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.85
    },
    {
      "from": "PAN-4003",
      "to": "PAN-3536",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-4003",
      "to": "PAN-4555",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.5
    },
    {
      "from": "PAN-4203",
      "to": "PAN-4204",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-4208",
      "to": "PAN-4195",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-4217",
      "to": "PAN-4219",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.9
    },
    {
      "from": "PAN-4217",
      "to": "PAN-4229",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.9
    },
    {
      "from": "PAN-4241",
      "to": "PAN-4240",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-4297",
      "to": "PAN-5456",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-4344",
      "to": "PAN-4345",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-4345",
      "to": "PAN-4346",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-4349",
      "to": "PAN-4302",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-4360",
      "to": "PAN-4627",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-4364",
      "to": "PAN-3667",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-4367",
      "to": "PAN-1852",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-4409",
      "to": "PAN-4410",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-4418",
      "to": "PAN-4419",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-4512",
      "to": "PAN-5517",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-4544",
      "to": "PAN-5381",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.4
    },
    {
      "from": "PAN-4552",
      "to": "PAN-2416",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-4552",
      "to": "PAN-2625",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.35
    },
    {
      "from": "PAN-4553",
      "to": "PAN-4390",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.9
    },
    {
      "from": "PAN-4553",
      "to": "PAN-4554",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-4586",
      "to": "PAN-3952",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-465",
      "to": "PAN-3011",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-4666",
      "to": "PAN-5013",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-4675",
      "to": "PAN-3557",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-4675",
      "to": "PAN-4547",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-4705",
      "to": "PAN-4746",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-4710",
      "to": "PAN-4554",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-4747",
      "to": "PAN-3508",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-4778",
      "to": "PAN-4817",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-4817",
      "to": "PAN-4811",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-4823",
      "to": "PAN-4842",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-4823",
      "to": "PAN-4887",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-4887",
      "to": "PAN-4842",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-5029",
      "to": "PAN-5058",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-5048",
      "to": "PAN-5028",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-5058",
      "to": "PAN-5490",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-5058",
      "to": "PAN-5491",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-5058",
      "to": "PAN-5492",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-5058",
      "to": "PAN-5493",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-5058",
      "to": "PAN-5494",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-5058",
      "to": "PAN-5495",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-5058",
      "to": "PAN-5496",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-5058",
      "to": "PAN-5602",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-5201",
      "to": "PAN-5202",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-5202",
      "to": "PAN-5207",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-5204",
      "to": "PAN-5201",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-5227",
      "to": "PAN-5264",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-5241",
      "to": "PAN-1676",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-5250",
      "to": "PAN-5312",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.3
    },
    {
      "from": "PAN-5250",
      "to": "PAN-5649",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-5263",
      "to": "PAN-5264",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.4
    },
    {
      "from": "PAN-5435",
      "to": "PAN-5436",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-5435",
      "to": "PAN-5437",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-5435",
      "to": "PAN-5438",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-5435",
      "to": "PAN-5439",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-5435",
      "to": "PAN-5440",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-5446",
      "to": "PAN-5449",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-5464",
      "to": "PAN-5465",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-5464",
      "to": "PAN-5497",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-5465",
      "to": "PAN-5497",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-5486",
      "to": "PAN-5602",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-5490",
      "to": "PAN-5491",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-5490",
      "to": "PAN-5492",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-5491",
      "to": "PAN-5494",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-5492",
      "to": "PAN-5493",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-5492",
      "to": "PAN-5494",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-5492",
      "to": "PAN-5602",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-5493",
      "to": "PAN-5494",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-5493",
      "to": "PAN-5495",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-5493",
      "to": "PAN-5496",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-5494",
      "to": "PAN-5602",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-5532",
      "to": "PAN-2344",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-5537",
      "to": "PAN-3566",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-5544",
      "to": "PAN-5548",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-5560",
      "to": "PAN-5552",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-5567",
      "to": "PAN-5566",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-5575",
      "to": "PAN-5578",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-5633",
      "to": "PAN-5567",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.4
    },
    {
      "from": "PAN-5633",
      "to": "PAN-5636",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-5637",
      "to": "PAN-5638",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-5637",
      "to": "PAN-5640",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-5637",
      "to": "PAN-5641",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-5638",
      "to": "PAN-5641",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-5640",
      "to": "PAN-5641",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-5652",
      "to": "PAN-3355",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-5652",
      "to": "PAN-5013",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-5652",
      "to": "PAN-5641",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.4
    },
    {
      "from": "PAN-5652",
      "to": "PAN-5657",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-750",
      "to": "PAN-769",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    }
  ]
}
```
