# STATE.md — PAN-482: Slash Command Menu in Mission Control Composer

## Problem

When typing in the Mission Control conversation composer (Lexical editor), pressing `/` triggers the global search overlay instead of inserting the character. Users cannot type slash commands or paths in the chat.

## Root Cause

**`App.tsx` line 268** — global `keydown` handler checks only for `INPUT` and `TEXTAREA` tag names:

```typescript
const inInput = ['INPUT', 'TEXTAREA'].includes(target.tagName);
if (e.key === '/' && !inInput) {
  setIsSearchOpen(true);
}
```

The Lexical `contenteditable` editor is a `<div>` with `contenteditable="true"`, so it doesn't match those tag names. The check fails, and `/` triggers global search even when the composer is focused.

## Solution

Two-part fix:

### Part 1: Fix global search hotkey (App.tsx)
Update the `inInput` check to include `contenteditable` elements so `/` doesn't trigger global search when the user is typing in any text input:

```typescript
const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
```

### Part 2: Add slash command menu (ComposerPromptEditor.tsx)
When the user types `/` in the composer, show a command menu with available slash commands (e.g., `/model`, `/context`, etc.).

Implementation approach:
- Register a `keydown` listener in `ComposerPlugin` that detects `/`
- When `/` is detected, show a floating menu below the cursor
- Menu is positioned using `getBoundingClientRect()` of the selection
- Typing filters the command list
- Enter or click selects a command
- Escape or clicking outside closes the menu
- Selected command text replaces the `/...` prefix in the editor

## Affected Files

- `src/dashboard/frontend/src/App.tsx` — fix `inInput` check
- `src/dashboard/frontend/src/components/chat/ComposerPromptEditor.tsx` — add slash menu

## Complexity

**Simple** — Part 1 is a one-line fix. Part 2 is a new UI component (floating menu) ~100-150 lines.

## Out of Scope

- Slash commands in non-composer contenteditable elements (Mission Control only)
- Backend changes
- Database migrations
