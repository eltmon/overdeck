# PAN-539: Image Paste Support in Activity View Conversation

## Status: Planning Complete

## Problem

Users cannot share images (screenshots, diagrams) with the Claude Code agent running inside the conversation panel. The activity view's `ComposerFooter` only accepts plain text. Users who want to reference a screenshot must manually upload it and type a file path — friction that breaks flow.

## Approach

Claude Code's `Read` tool handles image paths natively: when a message contains `@/absolute/path.png`, Claude reads the bytes and attaches them as a vision content block. No X11 clipboard manipulation needed. This lets us implement image paste entirely via the existing `load-buffer + paste-buffer` text injection path.

**Flow:**
1. User pastes (Ctrl+V) or drops an image onto the `ComposerFooter`
2. Browser converts image to base64 and immediately POSTs to `/api/conversations/:name/upload-image`
3. Server saves to OS temp dir (`/tmp/panopticon-paste-{uuid}.{ext}`)
4. Thumbnail preview appears in the composer with a × button
5. On submit: message is prefixed with `@/tmp/panopticon-paste-{uuid}.ext\n` lines before user text
6. Claude Code reads the `@path`, base64-encodes the bytes, sends as vision block
7. Server cleanup: a 5-min TTL interval purges stale temp files

## Key Decisions

### Endpoint location: conversations.ts, NOT agents.ts
The issue spec proposes `/api/agents/:agentId/upload-image`, but `ComposerFooter` sends messages to `/api/conversations/:name/message`. The upload endpoint should live alongside the message endpoint in `conversations.ts` as `/api/conversations/:name/upload-image`. The conversation record has `cwd` and `tmuxSession` available if needed for context.

### Image storage: OS temp dir
Saving to `os.tmpdir()` (typically `/tmp`) keeps images off the user's workspace. Claude Code can read any absolute path — `cwd` co-location is not required. Same pattern as `sendKeysAsync()` which already uses tmpdir for tmux buffer files.

### Paste interception: wrapper div, not Lexical plugin
Lexical captures paste events internally. Attaching `onPaste` on the `<div>` *around* `ComposerPromptEditor` and calling `e.preventDefault()` only when an image item is detected avoids fighting Lexical internals. Text paste falls through normally.

### Upload timing: optimistic on paste (not deferred to submit)
Image uploads to the server immediately when pasted. The thumbnail appears right away. If upload fails, an error badge replaces the thumbnail. This avoids a blocking delay when the user hits Enter.

### Request format: JSON with base64
Consistent with the existing `mission-control.ts` upload pattern. No multipart parsing library needed.

### Scope
- **In scope**: `ComposerFooter` (used in `ConversationPanel` across both AgentSection/activity view and standalone conversations)
- **Out of scope**: GodView ActionBar (agent messages), KanbanBoard composer (per issue spec)
- Side effect: paste support lands everywhere `ConversationPanel` appears, not just activity view — this is correct and desirable behavior

## Files Changed

| File | Change |
|------|--------|
| `src/dashboard/server/routes/conversations.ts` | New `POST /api/conversations/:name/upload-image` endpoint |
| `src/dashboard/server/main.ts` | Register 5-min cleanup interval for temp paste files |
| `src/dashboard/frontend/src/components/chat/ComposerFooter.tsx` | Paste/drop handlers, image state, thumbnail preview, `@path` injection on submit |

## Architecture Notes

- Cleanup interval uses `glob` or `readdir` on tmpdir filtered by `panopticon-paste-` prefix
- TTL: delete files older than 5 minutes
- Cleanup must be `async` (no sync FS in server code)
- Upload endpoint must use `fs/promises.writeFile` (no `writeFileSync`)
- Multiple images: each gets its own `@path` line, prepended in order of paste
- Preview: small thumbnail image + filename + × button row above the editor
- After send: revoke all `URL.createObjectURL()` URLs, clear images state
