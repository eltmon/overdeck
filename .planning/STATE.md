# PAN-539: Image Paste Support in Activity View Conversation

## Status: In Progress

## Current Phase
Implementing bead panopticon-cli-3ta: prepend uploaded image paths on send and clear image state after successful submission in `src/dashboard/frontend/src/components/chat/ComposerFooter.tsx`.

## Completed Work
- [x] panopticon-cli-7c8: Added upload-image route with MIME validation, temp-file naming, and async writes in `src/dashboard/server/routes/conversations.ts` (commit: 94004849)
- [x] panopticon-cli-a9c: Added async startup cleanup timer for stale `panopticon-paste-*` temp files in `src/dashboard/server/main.ts` (commit: d4fb58bb)
- [x] panopticon-cli-m3x: Added paste/drop image ingestion, optimistic upload state, and conversation upload requests in `src/dashboard/frontend/src/components/chat/ComposerFooter.tsx` (commit: 39170e46)
- [x] panopticon-cli-5bu: Added thumbnail strip with filename, upload/error status, and remove button in `src/dashboard/frontend/src/components/chat/ComposerFooter.tsx` and mission-control styles (commit: 40a5d176)
- [ ] panopticon-cli-3ta: Added `@/tmp/...` prefix injection, upload-in-progress blocking, and pending image cleanup after successful send in `src/dashboard/frontend/src/components/chat/ComposerFooter.tsx` (commit: pending)

## Remaining Work
- [ ] Close beads that are currently blocked by reversed dependency metadata (`panopticon-cli-7c8`, `panopticon-cli-m3x`, `panopticon-cli-3ta`) once final send-path bead lands.
- [ ] Run lint/tests and browser verification for the complete image-paste flow, then push and call `pan done`.

## Key Decisions
- Upload endpoint lives in `src/dashboard/server/routes/conversations.ts`, not an agent route, because `ComposerFooter` already targets conversation-specific message APIs.
- Uploaded images should live in `os.tmpdir()` under `panopticon-paste-{uuid}.{ext}` so Claude can read absolute paths without polluting the workspace.
- Server-side image handling must stay fully async (`fs/promises.writeFile`) to preserve dashboard event-loop responsiveness.

## Specialist Feedback
- None for PAN-539 yet.
