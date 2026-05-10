# Flywheel State — Run 2026-05-09 (late)

## Active Pipeline

| Issue | Phase | Root Cause / Blocker | Auto-Requeues | Runs Stuck | Notes |
|---|---|---|---|---|---|
| PAN-1024 | In Progress | — | — | — | gpt-5.4 work agent active, bypass perms on |
| PAN-1044 | In Progress | — | — | — | gpt-5.5 work agent active |
| PAN-1048 | In Progress | — | — | — | gpt-5.5 work agent active, ctx 82% — close to cap |
| PAN-1055 | Planning | Filed today: harness picker everywhere model is selected | 0 | 0 | gpt-5.5 work agent + review specialists running |
| PAN-1030 | Done (merged) | N/A | — | — | Landed by hand this session (1fcb8cb49) — awaiting-input indicator |
| PAN-1029 | Closed (no work shipped) | Harness picker UI not delivered — replaced by PAN-1055 | — | — | False-merged, kept closed; work redone in PAN-1055 |
| PAN-977 | In Progress | Reopened after false-merge — work agent rebasing + finishing | 0 | 0 | gpt-5.5 work agent re-spawned |
| PAN-945 | In Progress | Reopened after false-merge — work agent rebasing + finishing | 0 | 0 | gpt-5.5 work agent re-spawned |
| PAN-913 | Reopened, awaiting workflow | Reopened after false-merge — needs work agent | — | — | Branch restored, PR reopened |
| PAN-544 | Reopened, awaiting workflow | Reopened after false-merge — needs work agent | — | — | Branch restored, PR reopened |
| PAN-457 | Reopened, awaiting workflow | Reopened after false-merge — needs work agent | — | — | Branch restored, PR reopened |

## Cycling Alerts

None this run. Previously-cycling items resolved:
- Deacon idle-nudge interrupting active Bash → fixed (`9865808f9`)
- Resume launcher missing `--dangerously-skip-permissions` → fixed (`754460d78`)
- Settings Warning dialog from invalid deny patterns → fixed (`156e0f204`)

## Infrastructure Gaps

| Gap | Severity | Notes |
|---|---|---|
| Test-agent MiniMax auth failure | High | Open from prior run |
| Specialist paste verification failure causing coordinator hangs | High | Open from prior run |
| Merge status drift (PAN-1027) | Resolved | Replaced regex-based squash detection with GitHub API truth (`54505cce2`) |
| review-temp stash leak across rounds | Resolved | Drop-then-create in `ensureReviewTempStash` (`cfced34b1`) |
| close-out closes unmerged PRs | Resolved | `closeGitHubDirect`/`closeGitHubPr` refuse non-merged PRs (`cfced34b1`) |
| Resume launcher missing DSP | Resolved | Resume now reads `resolvePermissionMode()` (`754460d78`) |
| Deacon idle-nudge cancels active Bash | Resolved | `isAgentIdleForNudge` requires `state==='idle'` or `'uninitialized'` only (`9865808f9`) |
| Invalid Bash(rm:**) deny patterns block agent input | Resolved | Valid `:*`-trailing syntax + auto-scrub legacy (`156e0f204`) |

## Pattern Ledger

| Failure Signature | Root Cause | Fix Applied |
|---|---|---|
| `Bash(...) ⎿ Interrupted` after `continue` | (a) Settings Warning dialog from invalid `Bash(rm:**/...)` deny patterns blocking input; (b) deacon nudging mid-tool when `state==='active'` + heartbeat stale; (c) permission prompts on resume without DSP | All three fixed today (`156e0f204`, `9865808f9`, `754460d78`) |
| Issue closed but PR open + unmerged | Squash-merge regex `\(PAN-XXX[ )]` matched any `(PAN-XXX)` trailer in unrelated commits → false `mergeStatus=merged` → close-out swept | Deacon now queries GitHub PR API for `mergedAt`/`mergeCommit` (`54505cce2`); close-out gates on PR merge (`cfced34b1`) |
| Review-temp stash accumulation per issue | `ensureReviewTempStash` overwrote `reviewTempStashRef` without dropping prior round's stash | Drop-then-create ordering (`cfced34b1`) |
| Coordinator hangs after "Paste verification failed" | Open — needs per-specialist timeout | Not fixed |

## Skill Gaps

| Desired Capability | Priority |
|---|---|
| Per-specialist timeout in coordinator with graceful abort | High |
| Auto-cleanup of workspaces with no agent activity > 1 week | Medium |
| One-button "reopen + rebase + redrive" for false-merged issues | Medium (manual today; took 5 rebases per recovered issue) |
