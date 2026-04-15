# PAN-539: Image Paste Support in Activity View Conversation

## Status: In Progress

## Current Phase
Implementing bead panopticon-cli-m3x: add paste/drop ingestion and optimistic upload state in `src/dashboard/frontend/src/components/chat/ComposerFooter.tsx`, then commit it before closing the bead.

## Completed Work
- [x] panopticon-cli-7c8: Added upload-image route with MIME validation, temp-file naming, and async writes in `src/dashboard/server/routes/conversations.ts` (commit: 94004849)
- [x] panopticon-cli-a9c: Added async startup cleanup timer for stale `panopticon-paste-*` temp files in `src/dashboard/server/main.ts` (commit: d4fb58bb)
- [ ] panopticon-cli-m3x: Added paste/drop image ingestion, optimistic upload state, and conversation upload requests in `src/dashboard/frontend/src/components/chat/ComposerFooter.tsx` (commit: pending)

## Remaining Work
- [ ] panopticon-cli-5bu: Render thumbnail strip with remove/upload-state UI in `src/dashboard/frontend/src/components/chat/ComposerFooter.tsx`
- [ ] panopticon-cli-3ta: Prefix submitted messages with `@/tmp/...` lines and clear image state after send

## Key Decisions
- Upload endpoint lives in `src/dashboard/server/routes/conversations.ts`, not an agent route, because `ComposerFooter` already targets conversation-specific message APIs.
- Uploaded images should live in `os.tmpdir()` under `panopticon-paste-{uuid}.{ext}` so Claude can read absolute paths without polluting the workspace.
- Server-side image handling must stay fully async (`fs/promises.writeFile`) to preserve dashboard event-loop responsiveness.

## Specialist Feedback
- None for PAN-539 yet.
