# PAN-913: Auto-detect expired Codex auth and spawn re-authentication flow

## Status: Complete

## Current Phase
All beads implemented and committed.

## Completed Work
- [x] pan-748p: Created async checkCodexAuthStatus() utility in src/lib/codex-auth.ts (commit: 7df8256)
- [x] pan-pv1p: Added burned refresh token detection from CLIProxy logs to codex-auth.ts (commit: eb6ea6d)
- [x] pan-d8lw: Added GET /api/settings/codex-auth endpoint (commit: 764e42f)
- [x] pan-bkrg: Added POST /api/settings/codex-reauth endpoint (commit: 19c57ba)
- [x] pan-7edh: Added Codex auth check to spawn guardrails (commit: 90cb27d)
- [x] pan-ya4z: Added re-auth completion detection and token re-bridging (commit: adfa9ef)
- [x] pan-gig7: Created useCodexAuthStatus polling hook (commit: 29534b6)
- [x] pan-muvx: Created CodexAuthBanner frontend component (commit: b82b0de)
- [x] pan-k8l7: Show Codex auth type and status in Settings page (commit: 1e9b68b)
- [x] pan-30ci: Auto-retry blocked spawn after successful re-auth (commit: aa4fd22cf)
- [x] pan-ppl8: Document Codex auth requirements and re-auth flow (commit: 4117a42ab)

## Remaining Work
None.

## Key Decisions
- Detection strategy: JWT expiry (primary) + CLIProxy log tailing (secondary, best-effort)
- Re-auth UX uses existing terminal panel infrastructure via tmux session
- Frontend holds retry state (no server-side queue for blocked spawns)
- Server routes must use async I/O only (fs/promises, no readFileSync/execSync)

## Specialist Feedback
- None yet
- **[2026-04-29T00:01Z] verification-gate → FAILED** — `.planning/feedback/001-verification-gate-failed.md`
- **[2026-04-29T00:56Z] review-agent → COMMENTED** — `.planning/feedback/002-review-agent-commented.md`
