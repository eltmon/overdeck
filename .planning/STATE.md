# PAN-913: Auto-detect expired Codex auth and spawn re-authentication flow

## Status: In Progress

## Current Phase
Implementing bead pan-748p — Create async checkCodexAuthStatus() utility (backend async utility for JWT-based Codex auth status checking)

## Completed Work
- [x] pan-748p: Created async checkCodexAuthStatus() utility in src/lib/codex-auth.ts (commit: 7df8256)
- [x] pan-pv1p: Added burned refresh token detection from CLIProxy logs to codex-auth.ts (commit: eb6ea6d)
- [x] pan-d8lw: Added GET /api/settings/codex-auth endpoint (commit: 764e42f)

## Remaining Work
- [ ] pan-bkrg: Add POST /api/settings/codex-reauth endpoint
- [ ] pan-d8lw: Add GET /api/settings/codex-auth endpoint
- [ ] pan-bkrg: Add POST /api/settings/codex-reauth endpoint
- [ ] pan-7edh: Add Codex auth check to spawn guardrails
- [ ] pan-gig7: Create useCodexAuthStatus polling hook
- [ ] pan-muvx: Create CodexAuthBanner frontend component
- [ ] pan-k8l7: Show Codex auth type and status in Settings page
- [ ] pan-ya4z: Add re-auth completion detection and token re-bridging
- [ ] pan-30ci: Auto-retry blocked spawn after successful re-auth
- [ ] pan-ppl8: Document Codex auth requirements and re-auth flow

## Key Decisions
- Detection strategy: JWT expiry (primary) + CLIProxy log tailing (secondary, best-effort)
- Re-auth UX uses existing terminal panel infrastructure via tmux session
- Frontend holds retry state (no server-side queue for blocked spawns)
- Server routes must use async I/O only (fs/promises, no readFileSync/execSync)

## Specialist Feedback
- None yet
