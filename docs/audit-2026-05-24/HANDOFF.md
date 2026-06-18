# Audit Handoff — Pass 3 (incomplete) — 2026-05-24

## Why this exists

The prior conversation (conv/2193) burned ~890K tokens / ~$80 trying to audit 80 PAN issues closed in the past 7 days. The conversation produced two completed audit passes and started a third. **The first two passes are NOT TRUSTED** because they were run by Claude (Opus 4.7) subagents that systematically accepted "proxy evidence" — shipped artifacts that approximated but did not satisfy the original AC.

The third pass uses **GPT-5.5 via CLIProxy + Playwright MCP** with stricter methodology. The first 5 results from pass-3 already produced 3 REOPENs on issues that pass-2 marked GOOD. Continue with pass-3 methodology; do not trust pass-1 or pass-2 verdicts.

## What the previous conversation accomplished (trustworthy)

These are code changes pushed to origin/main, verified working live:

1. **Bug A fix (commit d3d6bf70b)**: `pan flywheel report` now refuses to write while orchestrator session is alive. Tests in `src/cli/commands/__tests__/flywheel.test.ts`.
2. **Bug B fix (commit 54d74754d)**: `/api/settings/available-models` server endpoint now filters `MODEL_DEPRECATIONS`. Dropdown trimmed from 11 → 6 OpenAI models, verified live.
3. **Bug C fix (commit abddef3b2)**: Stuck-remediation patrol now covers the flywheel orchestrator (was filtered out by `role !== 'work'` check). Tests in `src/lib/cloister/__tests__/stuck-remediation.test.ts`.
4. **TTS hotfix preserved (commit 01c3448b1)**: Rescued from an orphaned interactive rebase.
5. **Rebase cleanup**: Aborted abandoned rebase, hard-reset main to origin/main, re-applied fixes cleanly. Host repo state is clean.
6. **Flywheel restart**: RUN-9 is currently running (orchestrator PID 2352341, model minimax-m2.7-highspeed). Note: pass-3 already found PAN-1189 is "infrastructure shipped but live RUN-9 stuck at ticks=1" — the flywheel substrate has known issues.

## What is filed (trustworthy)

23 follow-up / substrate issues filed during the conversation: **#1432–#1454**. The META issue **#1454** catalogs 9 systemic failure patterns from the audit. The PAN-913 false-positive auth-detection bug was added as a reopen comment on #913 (the standalone #1455 was closed as duplicate).

## What is REOPENED (trustworthy reopens — issues with confirmed broken behavior)

| Issue | Why |
|---|---|
| **PAN-1408** | graphify-out/ is gitignored, post-merge refresh returns `{skipped:'gitignored'}` 100% of the time. GRAPH_SUMMARY.md is 14 days stale. |
| **PAN-1192** | swarm default reads config not parent state.json; cost surprise still bites |
| **PAN-20** | closed as dup of #1102 but #1102 unbuilt; no UI for AskUserQuestion |
| **PAN-1103** | same; AND dedupe silently dropped the timeout/countdown AC |
| **PAN-1252** | "superseded by PAN-1249" claim false; close-out.ts has 22 execAsync + 22 Promise<; shipped Effect wrapper is thin `Effect.tryPromise` over still-Promise body |
| **PAN-1251** | merge-agent.ts (1618 LOC, runs at MERGE) has ZERO Effect.Effect< returns + 33 execAsync sites |
| **PAN-1249** | DoD lines 5+6 hard-fail; 64 src/lib files lack Effect imports, 59 still use execAsync (456 hits) |
| **PAN-913** | auth-detection has false-positive: dashboard reports valid while CLIProxy returns 401 on every call |

## What pass-3 has already added (trustworthy, additional reopens)

The first 5 pass-3 results (out of 12 dispatched in waves 1-2):

| Issue | Verdict | Why |
|---|---|---|
| **PAN-1391** | REOPEN | UI hardcodes `limit=50`, API caps at 100. 659 of 709 archived rows are silently invisible. Pass-2 marked this GOOD. |
| **PAN-1331** | STAYS-CLOSED | All 20 verbs covered, parity test in CI, 8 screenshots saved to `/tmp/audit-pass3/screenshots/PAN-1331-*.png` |
| **PAN-1379** | REOPEN | Phase 3a verified clean per its narrowed scope, but per-file sequencing requirement is unverifiable from main |
| **PAN-1050** | STAYS-CLOSED | Root-cause fix with regression test |
| **PAN-1313** | REOPEN | (read the result file at `/tmp/audit-pass3/results/PAN-1313.md`) |

7 of 12 dispatched returned 0 bytes — **Playwright contention** at 6-concurrent. Drop to 2-concurrent or serial.

## What does NOT yet have a trustworthy verdict

**ALL of the 49 issues that pass-2 marked GOOD** — except the 5 pass-3 has already re-audited. The fresh-context agent should treat the remaining 44 as "verdict unknown" and re-audit each with the pass-3 methodology before doing anything else.

Specifically: **70+ issues need pass-3 re-audit** if we extend distrust to all pass-1/pass-2 verdicts (80 total - 5 already re-audited - the few that pass-3 already reopened).

## Methodology that works (use this)

### Stack

- **Model**: GPT-5.5
- **Transport**: `claude --print --model gpt-5.5 --permission-mode bypassPermissions`
- **Env**: `ANTHROPIC_BASE_URL=http://127.0.0.1:8317` `ANTHROPIC_AUTH_TOKEN=overdeck-local-cliproxy-key`
- **Routing**: CLIProxy bridges to ChatGPT subscription OAuth
- **Tool access**: GPT-5.5 inherits Claude Code's full tool layer including Playwright MCP

### Critical prereqs

1. **CLIProxy must be running** (port 8317). Check: `pgrep -af cliproxy`.
2. **Codex OAuth token must be fresh**. Check `tail ~/.overdeck/cliproxy/cliproxy.log` for recent `refresh_token_reused`. If present, run `codex login` interactively. (This is PAN-913 — the dashboard says "valid" even when token is burned.)
3. **Don't trust `pan flywheel status` for run state**. PAN-1386 — orchestrator stops emitting `latest.json` mid-run.

### Prompt template
`/tmp/audit-pass3/prompt-template.md` — strict rules including:
- ORIGINAL issue body is the only source of ACs
- Proxy evidence = REOPEN
- Each AC needs reproducible evidence (file:line, command output, screenshot)
- Default REOPEN when in doubt

### Per-issue runner
`/tmp/audit-pass3/run-one.sh <issue-num>` — gathers context, dispatches one GPT-5.5 agent, captures result.

### Parallelism

**2-concurrent works. 6-concurrent fails (Playwright contention).** Use waves of 2 or serial. Each audit takes ~5 min. 70 audits × 5 min ÷ 2 = ~3 hours wall time.

### Screenshot capture

Agents save screenshots to `/tmp/audit-pass3/screenshots/PAN-XXXX-<view>.png`. To attach to GitHub: commit to `docs/audit-2026-05-24/`, push, reference via `https://raw.githubusercontent.com/eltmon/overdeck/main/docs/audit-2026-05-24/PAN-XXXX-<view>.png` in issue comments.

## Operating constraint

The user said: *"This isn't just about screenshots, the agents should be reviewing the code and only if they feel certain the issue should be working then they would take a screenshot."*

→ The prompt template already does this — agents read code FIRST and only verify with Playwright if the code-trace says behavior should work. Screenshots are confirmation, not exploration.

## What the next agent should do

1. **Read this file completely.**
2. **Verify the prereqs** (CLIProxy up, Codex token fresh).
3. **Re-audit ALL 80 closed issues** (not just the 49 pass-2 GOODs). Treat any pass-1/pass-2 verdict as untrusted.
4. **Run in pairs of 2** (or serial). Use `/tmp/audit-pass3/run-one.sh`.
5. **For each issue**: based on the audit result, either:
   - REOPEN with the agent's recommended comment
   - STAYS-CLOSED: post the agent's defensive comment to the issue (with screenshot links if any)
   - SCOPE-AMEND: post the amendment comment, leave closed
6. **Commit any screenshots** to `docs/audit-2026-05-24/` before posting comments that reference them.
7. **DO NOT trust the 49 GOOD verdicts from pass-2**. The 5 re-audited so far have 60% reopen rate.

## Cost projection

Pass-3 cost so far: ~$5 for the experiment (2 issues) + ~$15 for waves 1-2 (12 issues, 5 successful). Per-audit cost ~$0.50-1.00 on GPT-5.5.

Full re-audit of 80 issues: ~$40-80. Worth the cost if customer confidence is at stake.

## Followups for the meta retrospective (separate work)

The user noted that reviewer cycles seem to be sidestepped at merge — issues marked GOOD by code reviewers ship behavior that doesn't match AC. The META issue #1454 catalogs 9 failure patterns and proposes substrate fixes for each. **Pick 3-4 substrate fixes to prioritize** rather than file individually.

Also noted: a "swarm-lite" mechanism for dashboard visibility on audit-style parallel work (no PR branches, no workspaces, just visible agent rows in the project tree). This is a future enhancement, not blocking.

## File locations

- This handoff: `/tmp/audit-pass3/HANDOFF.md`
- Prompt template: `/tmp/audit-pass3/prompt-template.md`
- Per-issue runner: `/tmp/audit-pass3/run-one.sh`
- Pass-3 results so far: `/tmp/audit-pass3/results/PAN-*.md`
- Pass-3 screenshots: `/tmp/audit-pass3/screenshots/PAN-*.png`
- Conversation 2193 JSONL: `~/.claude/projects/-home-eltmon-Projects/f7a30243-2d6f-40ee-95df-3b7d9e6d7288.jsonl` (this conversation)

## The bigger picture

Customer confidence is at stake. 80 issues closed in 7 days, but at least ~30 (38% per pass-2's miss-corrected rate, possibly higher) have shipped behavior that doesn't match the original AC. The pattern is systemic — reviewers accept proxy evidence, scope is amended without operator sign-off, deferrals are documented in commit bodies but the issue still closes. **The fix is to re-audit honestly and reopen what's broken before customers find it.**
