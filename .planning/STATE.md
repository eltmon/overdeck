# PAN-539: Image Paste Support in Activity View Conversation

## Status: In Progress

## Current Phase
Implementing bead panopticon-cli-7c8: add `POST /api/conversations/:name/upload-image` in `src/dashboard/server/routes/conversations.ts`, then commit it before closing the bead.

## Completed Work
- [ ] panopticon-cli-7c8: Added upload-image route skeleton plus MIME validation, temp-file naming, and async file writes in `conversations.ts` (commit: pending)

## Remaining Work
- [ ] panopticon-cli-a9c: Register async TTL cleanup for `panopticon-paste-*` temp files in `src/dashboard/server/main.ts`
- [ ] panopticon-cli-m3x: Add paste and drag-drop image capture in `src/dashboard/frontend/src/components/chat/ComposerFooter.tsx`
- [ ] panopticon-cli-5bu: Render thumbnail strip with remove/upload-state UI in `src/dashboard/frontend/src/components/chat/ComposerFooter.tsx`
- [ ] panopticon-cli-3ta: Prefix submitted messages with `@/tmp/...` lines and clear image state after send

## Key Decisions
- Upload endpoint lives in `src/dashboard/server/routes/conversations.ts`, not an agent route, because `ComposerFooter` already targets conversation-specific message APIs.
- Uploaded images should live in `os.tmpdir()` under `panopticon-paste-{uuid}.{ext}` so Claude can read absolute paths without polluting the workspace.
- Server-side image handling must stay fully async (`fs/promises.writeFile`) to preserve dashboard event-loop responsiveness.

## Specialist Feedback
- None for PAN-539 yet.
