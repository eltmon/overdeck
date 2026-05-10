# Flywheel State — Run 2026-05-10 (early, post-Run-15+)

## Active Pipeline

| Issue | Phase | Root Cause / Blocker | Auto-Requeues | Runs Stuck | Notes |
|---|---|---|---|---|---|
| PAN-977 | In Review (reviewing) | — | 0 | 0 | Opus 4.7 work agent (switched from gpt-5.5 to break review-loop). Coordinator + reviewers running this run. |
| PAN-913 | In Review (reviewing) | — | 0 | 0 | Verification passed (HEAD=997a3383); coordinator + reviewers dispatched this run. PR #916. |
| PAN-945 | In Review (pending) | bug label, reviewStatus=pending after my pan tell | 0 | 1 | Cleared cross-contaminated untracked files; told agent to pan done. PR #1045 CI green. |
| PAN-1044 | In Review (failed) | Agent idle after CHANGES_REQUESTED | 0 | 1 | gpt-5.5 work agent at empty `❯` prompt. Needs nudge or context-cap handoff. |
| PAN-1048 | In Review (failed) | Agent idle, ctx 83% — close to context cap | 0 | 1 | gpt-5.5; context approaching limit. May need handoff to fresh session. |
| PAN-1055 | In Review (failed) | Agent idle with `/clear to save 144.6k tokens` prompt | 0 | 1 | gpt-5.5 with bloated context. |
| PAN-457 | In Review (failed) | Agent dead (no tmux pane) — was reopened from false-merge | — | 1 | Substantive work on branch (24 lib/17 CLI/23 dashboard files, 56 commits). Needs respawn. |

## Cycling Alerts

None at the recurring threshold (Runs Stuck ≥ 2). All four failed-review issues flagged 1 run each — if the same set is still failed-review next run, escalate to alerts.

## Infrastructure Gaps

| Gap | Severity | Notes |
|---|---|---|
| Test-agent MiniMax auth failure | High | Open from prior run |
| Specialist paste verification failure causing coordinator hangs | High | Saw one occurrence this run on agent-pan-913 paste |
| Closed-issue resources persist (specialist registry, review-status, workspace dirs) | High | Specialist registry: **Resolved (Run 16)** via `pruneSpecialistRegistryEntriesForIssue` (`330a54ba4`); review-status DB cleanup still pending |
| Workspace directory drift (`feature-1034` vs `feature-pan-1034`) | Medium | **Resolved (Run 16)** — teardown sweeps all variants (`eb5292e16`) |
| Anthropic-direct launcher drops state.json model override | High | **Resolved (Run 16)** — `claude --agent` now also passes `--model` (`959f09d2d`) |
| Merge status drift (PAN-1027) | Resolved | (Run 15) Replaced regex squash detection with GitHub API |
| review-temp stash leak across rounds | Resolved | (Run 15) Drop-then-create in `ensureReviewTempStash` |
| close-out closes unmerged PRs | Resolved | (Run 15) `closeGitHubDirect`/`closeGitHubPr` refuse non-merged PRs |
| Resume launcher missing DSP | Resolved | (Run 15) Resume now reads `resolvePermissionMode()` |
| Deacon idle-nudge cancels active Bash | Resolved | (Run 15) `isAgentIdleForNudge` requires `state==='idle'` or `'uninitialized'` only |
| Invalid Bash(rm:**) deny patterns block agent input | Resolved | (Run 15) Valid `:*`-trailing syntax + auto-scrub legacy |
| Manual-respawn TUI dialog (Channels confirmation) | Resolved | (Run 16) Root cause was Anthropic-launcher model gap (above); `dismissDevChannelsDialog` already runs in canonical start path |
| Inspector lacks Tests row + cycle counter | Resolved | (Run 16) PAN-1031 — InspectorPanel renders `ReviewPipelineSection` (`22bfc2292`) |

## Pattern Ledger

| Failure Signature | Root Cause | Fix Applied |
|---|---|---|
| `Bash(...) ⎿ Interrupted` after `continue` | Three-layered: (a) Settings Warning dialog from invalid `Bash(rm:**)` patterns; (b) deacon nudging mid-tool when state===active + heartbeat stale; (c) permission prompts on resume without DSP | Run 15: `156e0f204`, `9865808f9`, `754460d78` |
| Issue closed but PR open + unmerged | Squash-merge regex matched any `(PAN-XXX)` trailer in unrelated commits → false `mergeStatus=merged` | Run 15: deacon queries GitHub PR API for `mergedAt`/`mergeCommit` (`54505cce2`) |
| Review-temp stash accumulation per issue | `ensureReviewTempStash` overwrote `reviewTempStashRef` without dropping prior round's stash | Run 15: drop-then-create ordering (`cfced34b1`) |
| Coordinator hangs after "Paste verification failed" | Open — needs per-specialist timeout | Not fixed |
| Reviewer says "no Write tool available" | `pan-review-agent.md` had `permissionMode: plan` and lacked Write in tools list | Run 15: switched to `default` mode + added Write (`6043ca8c0`) |
| Reviewer feedback never reaches agent (`.pan/feedback/` empty) | `appendFeedbackEntryForIssue` threw on malformed vBRIEF, aborting `writeFeedbackFile` | Run 15: continue-state write made best-effort + spec auto-recovery from `plan.status` |
| `pan close` leaves orphan tmux/agent dirs/checkpoint refs | Teardown patterns missed canonical names + checkpoint prune wired into legacy `close-out.ts` only | Run 15: `54f91445c` (tmux patterns) + `4ff26c85e` (checkpoint prune in workflows path) |
| Deacon repeatedly logs `Per-project test-agent stuck, force-killing <session>` for closed issue | Specialist registry compound keys (`test-agent:PAN-NNN`) not garbage-collected when issue closes | Run 16: teardown calls `pruneSpecialistRegistryEntriesForIssue` (`330a54ba4`) + one-time backfill removed 22 stale entries |
| Workspace directory orphan after close-out (`feature-1034` not swept) | `findWorkspacePath` short-circuited at first canonical match; legacy unprefixed name never tried | Run 16: `findAllWorkspacePaths` + teardown iterates all variants (`eb5292e16`) |
| Anthropic-direct launcher silently runs frontmatter model instead of state.json model | `getAgentRuntimeBaseCommand` set `modelFlag=''` for Anthropic + `--agent`; switch-model overrides ignored | Run 16: always emit `--model` alongside `--agent` (`959f09d2d`) |

## Skill Gaps

| Desired Capability | Priority |
|---|---|
| Per-specialist timeout in coordinator with graceful abort | High |
| Auto-cleanup of workspaces with no agent activity > 1 week | Medium |
| One-button "reopen + rebase + redrive" for false-merged issues | Medium |
| Backfill cleaner: clear review-status DB entries for closed issues (separate from specialist registry) | Medium — would close the PAN-951 "Re-dispatched test for closed issue" loop |
| Context-cap handoff: when agent crosses ctx 80%, auto-spawn fresh session with continue.json | Medium — PAN-1048 hit ctx 83% this run |
| Handoff for dead agents (no tmux pane) — currently requires manual `pan start` | Medium — PAN-457 needs this |
