# Handoff — fix the codex work-agent conversation view (PAN-1805), then triage

You are taking over from a long orchestration session. Your **first task** is
PAN-1805. Work on branch `feature/pan-1805` in this worktree. Read
`gh issue view 1805` first — it has the verified root cause and fix.

## Immediate task: PAN-1805 (codex work-agent conversation view is blank)

Codex work agents now run as persistent interactive sessions (landed tonight,
PAN-1803). But the Command Deck conversation view shows "No conversation data
available" for them, because the work-agent transcript resolver is claude-only.

**Verified root cause:** `resolveJsonlPath` (`src/dashboard/server/routes/jsonl-resolver.ts:156`)
calls `resolveClaudeSessionId` → null for codex → returns null. The codex
rollout JSONL exists on disk at
`~/.panopticon/agents/<agent-id>/codex-home/sessions/.../rollout-*.jsonl`.

**The pattern to copy:** the *conversation* panel already handles codex —
`resolveCodexSessionFile` (`src/dashboard/server/routes/conversations.ts:788`,
thread-id fast path + `findLatestRollout` lazy fallback) plus the existing
`src/dashboard/server/services/codex-conversation-parser.ts`. The work-agent
command-deck path (`src/dashboard/server/routes/command-deck.ts` ~line 326,
where `resolveJsonlPath(checkId, workspacePath)` is called and `transcript` /
`hasJsonl` are set) never got codex support because codex work agents didn't
exist until tonight.

**Do this:**
1. In `command-deck.ts` work-agent transcript resolution, when the agent's
   harness is codex, resolve + parse the codex rollout (reuse
   `resolveCodexSessionFile` / `findLatestRollout` + `codex-conversation-parser`)
   and populate the transcript the SessionPanel renders (`session.transcript`,
   see `src/dashboard/frontend/src/components/CommandDeck/SessionView/SessionPanel.tsx:341`).
   Verify the parsed codex format flows through to the frontend.
2. (Recommended) Add a non-blocking codex thread-id capture to `spawnAgent`
   (`src/lib/agents.ts`, after the kickoff-delivery block ~line 3680): codex
   work-tui writes its rollout only after the first prompt, so poll for it in a
   `void (async () => {...})()` background task (don't block spawn) and call
   `writeThreadId`. `spawnRun` has this but gates out work-tui at
   `agents.ts:3299`; `spawnAgent` has no capture at all. The lazy
   `findLatestRollout` fallback means the view works even without it, but
   capturing helps the fast path + resume.
3. **Live-verify:** there IS a running codex work agent right now,
   `agent-pan-1803` (harness codex, work-tui). After your fix + `npm run build`
   + dashboard restart (`pan restart`), open its conversation view (or hit the
   command-deck API) and confirm the transcript renders instead of "No
   conversation data available". The codex rollout for it is under
   `~/.panopticon/agents/agent-pan-1803/codex-home/sessions/`.

**Gates:** `npm run typecheck`, `npm run lint`, relevant tests (there's
`codex-conversation-parser.test.ts` and `command-deck` tests). Dashboard runs
Node 22 from `dist/` — `npm run build` before restarting. Push
`feature/pan-1805`; the operator reviews/merges (or, since this is
operator-directed pipeline-bypass work tonight, you may merge to main with
`--no-ff` after gates pass and a self-review — confirm with the operator first).

## Context you're inheriting (this session's state)

**Tonight's arc:** brought codex work agents from broken to working as
persistent interactive TUI sessions (the operator's hard requirement — one-shot
`codex exec` is a REJECTED architecture; see the `feedback_no_oneshot_agents`
memory). Five fixes merged to main: sandbox-token + codex-home (`163e63c01`),
pi provider-qualify (`fc17d1510`), `--fresh` catch-22 (`9857b1ac1`), persistent-
TUI foundation (`eb79b04cf`), and the completion trio — Settings-inheritance +
pre-trust (`5e05abc06`), readiness-by-real-prompt (`b0a223c72`), file-based
kickoff via `.pan/kickoff.md` (`31760795c`).

**Operator preferences (critical):**
- Operator is cost-sensitive — hand off decent-size work to gpt-5.5/codex; don't
  do large implementation yourself. (You're Fable 5 now.)
- Codex stays in the lineup — never propose dropping it.
- For codex WORK agents always use the persistent TUI path (now the default).
- `pan handoff` focus is ≤500 chars; put long briefs in a file (this pattern).
- A very long conversation can't be a handoff SOURCE ("Prompt is too long",
  PAN-1802) — fork from a short source and carry context in a doc like this.

## Second finding to surface (NOT necessarily yours to fix)

The PAN-1803 work agent (codex) successfully drove the full pipeline — did the
work, fixed tests, opened PR #1804, ran `pan review request`. BUT its **review
convoy is stalled**: the 5 review agents (`agent-pan-1803-review*`) run as
**gpt-5.5 over claude-code (CLIProxy)** — `codexMode: None`, ctx ~25%, minimal
output. That's the CLIProxy context-deadlock-prone combo the whole codex
migration aims to escape. This is a SEPARATE issue from PAN-1805 (reviews read
the PR diff, not the codex transcript). Flag it to the operator; consider
whether review/test roles should also move off gpt-5.5/claude-code. Do not
sink time into the CLIProxy deadlock — it's a known hard problem.

## Unresolved issues from this session (for your awareness)
PAN-1789 (codex conv status), PAN-1790 (handoff ergonomics, partial),
PAN-1793 (pi kickoff delivery), PAN-1798 (tmux-server-scope — code fixed,
live-defused), PAN-1799 (codex/pi boot — fixed; but `pan start` infinite-hang
sub-bug remains: stuck pan-start procs accumulate and contend the bd lock),
PAN-1800 (main CI red — a handoff agent worked it; verify it merged),
PAN-1801 (CI→agent feedback relay), PAN-1802 (handoff summary-too-long),
PAN-1803 (codex persistent agents — DONE), PAN-1805 (this), plus the
fleet bring-up is DOWN (only agent-pan-1803 + its review convoy up) — blocked
on the `pan start`-hang + bd-lock + slow docker-stack-rebuild thrash.
