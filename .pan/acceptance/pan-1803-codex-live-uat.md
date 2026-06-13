# PAN-1803 Codex Live UAT

Date: 2026-06-12

## Scratch Run

- Scratch issue/workspace: `PAN-18031`
- Agent: `agent-pan-18031`
- Command: `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1803/dist/cli/index.js start PAN-18031 --auto --local --host --yes --harness codex --model gpt-5.5 --fresh --force`
- Workspace: `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-18031`
- Model/harness: `gpt-5.5` / `codex`

## Evidence

- 2026-06-12T16:43:14Z: `state.json` showed `status: "running"`, `kickoffDelivered: true`, `harness: "codex"`, `codexMode: "work-tui"`.
- The Codex pane showed the short kickoff pointer to `/home/eltmon/.panopticon/agents/agent-pan-18031/kickoff.md`; no workspace `.pan/kickoff.md` handoff was used.
- 2026-06-12T16:46:30Z: `tmux -L panopticon ls` still showed `agent-pan-18031`, more than 3 minutes after launch, and `state.json` still showed `status: "running"` with `consecutiveFailures: 0`.
- 2026-06-12T16:49:18Z: the agent closed bead `workspace-eelfd` with reason `Verified existing Codex work-tui implementation and focused launcher/delivery/spawn coverage`.
- 2026-06-12T16:50:46Z: bead `workspace-eelfd` was confirmed `closed` via `bd -C /home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-18031 show workspace-eelfd --json`; `state.json` still showed the agent `running`.
- 2026-06-12T16:52:41Z: post-idle `pan tell` delivered: `UAT follow-up after idle: acknowledge this message briefly and do not start new work.`
- The Codex pane acknowledged: `Acknowledged. No new work started.`

## Notes

- Initial live run exposed that current Codex rejects the legacy `--skip-git-repo-check` flag. This branch removes that flag from Codex launcher generation before the successful run above.
- After the scratch agent completed `pan done`, `pan tell` used the fallback fresh-launch path because the work agent had no saved Codex session ID. The follow-up message still delivered and was acknowledged in the live Codex TUI.
