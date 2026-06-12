# PAN-1803 — Make codex work agents persistent interactive TUI sessions (claude-code pattern)

Branch `feature/pan-1803`. Read GitHub issue PAN-1803 first
(`gh issue view 1803`) — it has the full diagnosis and acceptance criteria.
This is THE keystone fix; everything about codex work agents depends on it.

## The problem in one line

Codex work agents launch as `codex exec` (one-shot — runs one turn, exits).
The lifecycle expects a PERSISTENT session, so the agent gets marked
`orphaned: tmux session missing at boot` the moment it finishes. One-shot is a
deliberately-rejected architecture. Make codex work agents live and persistent,
exactly like claude-code work agents.

## Study the reference FIRST (do not skip)

claude-code work agents are the battle-tested template. Before changing
anything, read and understand:
- `src/lib/launcher-generator.ts`:
  - `buildNonConversationCommand(config, useExec=true)` — the claude path:
    interactive `claude --permission-mode auto --model ...` wrapped via
    `wrapWithSupervisor`. The session STAYS ALIVE.
  - `buildCodexCommand` — current codex path. The `codexMode==='tui'` branch
    (`codex -c project_doc_max_bytes=0` under the supervisor) is how
    **conversations** already run codex persistently — proof codex can do this.
    The `else` branch is the one-shot `codex exec` you are replacing for work.
  - `wrapWithSupervisor` — PTY-supervisor wrapping (note: it returns cmd
    unchanged for `harness==='pi'`; codex DOES wrap).
- `src/lib/agents.ts`:
  - `getCodexLauncherFields` — hardcodes `codexMode:'exec'` (the bug).
  - The prompt-delivery block (search `resolvedHarness !== 'codex'` ~line 3607
    and the codex rollout/thread-id capture ~line 3564): codex work agents
    currently SKIP tmux delivery because exec embeds the prompt inline. You
    must route codex-TUI work agents through tmux/supervisor delivery instead.
  - How claude-code delivers: `waitForReadySignal` (SessionStart hook →
    ready.json) then `deliverInitialPromptWithRetry`. Codex won't fire that
    hook — you need a codex-TUI readiness check.
  - `waitForPiAgentReady` / the conversation `waitForPiTuiReady` (in
    conversations.ts) — readiness-by-capture-pane patterns to model a
    `waitForCodexTuiReady` on.

## The change (mirror claude-code, minimal surface)

1. **Launcher (`buildCodexCommand`):** for WORK agents emit interactive codex,
   NOT exec: `codex -m <model> -s <toCodexSandboxValue(sandbox)> -c approval_policy=never --skip-git-repo-check`,
   wrapped via `wrapWithSupervisor`. Do NOT embed the prompt inline (it is
   delivered post-readiness, step 3). Add a work-tui codex mode (e.g.
   `codexMode:'work-tui'`) or branch on role — keep CONVERSATIONS on their
   existing tui path unchanged, and keep `project_doc` behavior appropriate for
   work agents (the kickoff prompt is self-contained; the per-agent
   CODEX_HOME/AGENTS.md from initCodexHome carries standing rules).
2. **Launcher fields (`getCodexLauncherFields`):** stop hardcoding
   `codexMode:'exec'` for work. Preserve `initCodexHome(codexHome)` (PAN-1799)
   and the codexHome/sessionDir fields.
3. **Delivery (`agents.ts`):** route codex work agents through tmux/supervisor
   kickoff delivery after a new `waitForCodexTuiReady(agentId)` (capture-pane
   for the codex prompt line; model on the pi/claude readiness waits). Remove
   codex from the `!== 'codex'` skip so it joins the delivery path. Set
   `state.kickoffDelivered` like the other harnesses.
4. **Resume:** keep `waitForCodexRollout` + thread-id capture. Verify the
   resume path also uses interactive codex (`codex resume`/`-c experimental_resume`
   as appropriate — check `codex resume --help`), NOT `codex exec resume`. If
   resume is hard, it is acceptable to land fresh-session persistence first and
   note resume as a follow-up — but the FRESH path must be fully persistent.
5. **Lifecycle:** once the session persists, the `orphaned: tmux session
   missing at boot` path should stop firing for codex. Verify with the
   acceptance test; if a codex-specific readiness gate is needed in
   `work-agent-lifecycle.ts`, add it.

## Acceptance (LIVE test — unit tests alone are insufficient)

Use a scratch/low-risk issue with a workspace (or PAN-1787, which is Planned
with 24 beads). `pan start <id> --model gpt-5.5 --harness codex --fresh`:
1. After the kickoff turn completes, the tmux session `agent-<id>` is STILL
   ALIVE 3+ minutes later (`tmux -L panopticon has-session`), status running,
   NOT orphaned/stopped.
2. `pan tell <id> "respond with the word ALIVE"` delivered after it goes idle
   is received and answered (check the pane).
3. It closes a bead and proceeds without the process exiting.
4. `gh issue view 1803` acceptance bullets all hold.
Plus: `npm run typecheck`, `npm run lint` green; existing codex conversation
tests (`conversations-supervisor`, `conversations-switch-model`) stay green;
`launcher-generator.test.ts` updated for the new codex work command and green.

## Rules

- Commit per logical unit, conventional lower-case subjects ≤100 chars.
- Never stash / checkout another branch / rewrite history. Verify
  `git branch --show-current` = `feature/pan-1803` first.
- Async tmux primitives only; no execSync in server-reachable code.
- Pipeline bypass: NO pan done / review / inspect / merge — operator reviews.
- You may `pan start`/`pan kill` codex agents on a SCRATCH issue to test, but do
  NOT touch other agents' workspaces or the shared tmux server founder.
- The currently-running shared tmux server must not be killed (PAN-1798).
- Final: comment root-cause + change summary on #1803, push feature/pan-1803,
  STOP and summarize — anomalies first.
