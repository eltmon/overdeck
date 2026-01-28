# Planning Session: PAN-34 - Terminal Copy/Paste Support

## Issue Summary
Enable full copy/paste support in the XTerminal component, including keyboard shortcuts, auto-copy on selection, right-click context menu, and official clipboard addon integration.

## Discovery Findings

### Current State
- **Component:** `src/dashboard/frontend/src/components/XTerminal.tsx`
- **Library:** xterm.js v6.0.0 with FitAddon
- **Selection:** Already working (theme has `selectionBackground` configured)
- **Missing:** No clipboard handling, no keyboard shortcuts, no context menu

### Usage Context
- XTerminal is used in PlanDialog to show live planning agent output
- Users need to copy text/code from agent output for reference
- Currently frustrating UX: selection works but copy/paste doesn't

### Dependencies
- Need to add: `@xterm/addon-clipboard` (official xterm.js clipboard addon)
- Already have: `@xterm/xterm@6.0.0`, `@xterm/addon-fit@0.11.0`

## Requirements (from discovery)

### ✅ Must-Have Features
1. **Keyboard shortcuts (Ctrl+C/V)**
   - Smart Ctrl+C: Copy if text selected, send interrupt signal if not
   - Ctrl+V: Paste from clipboard
   - Platform-aware: Support Cmd+C/V on Mac

2. **Selection auto-copy**
   - CONFIGURABLE (ON by default)
   - When enabled: selecting text automatically copies to clipboard
   - When disabled: requires explicit Ctrl+C to copy
   - Persisted in localStorage

3. **Right-click context menu**
   - Custom context menu with Copy/Paste actions
   - Only show "Copy" when text is selected
   - Paste option always available

4. **Clipboard addon integration**
   - Use `@xterm/addon-clipboard` for standardized handling
   - Leverage browser's `navigator.clipboard` API

### 🧪 Testing
- Unit tests with Vitest for clipboard logic and keyboard handlers
- Manual testing for browser integration

## Technical Approach

### 1. Add Clipboard Addon Dependency
```bash
npm install --save @xterm/addon-clipboard
```

### 2. Extend XTerminal Component

**Props to add:**
```typescript
interface XTerminalProps {
  sessionName: string;
  onDisconnect?: () => void;
  autoCopyOnSelect?: boolean; // Default: true
}
```

**Features to implement:**
- Load ClipboardAddon from `@xterm/addon-clipboard`
- Add keyboard event handler for smart Ctrl+C/V behavior
- Add right-click event handler for custom context menu
- Add selection event handler for auto-copy (when enabled)
- Store auto-copy preference in localStorage
- Create context menu component/UI

### 3. Smart Ctrl+C Logic
```typescript
// Pseudo-code
onKeyDown((event) => {
  if (event.ctrlKey && event.key === 'c') {
    if (terminal.hasSelection()) {
      // Copy selected text
      event.preventDefault();
      navigator.clipboard.writeText(terminal.getSelection());
    } else {
      // Let terminal handle (send interrupt signal)
    }
  }
})
```

### 4. Context Menu
- Custom React component (floating div)
- Position at mouse coordinates on right-click
- Options: "Copy" (if selection), "Paste"
- Close on click outside or on action
- Prevent browser's default context menu

### 5. Auto-Copy on Selection
```typescript
// When autoCopyOnSelect is enabled
terminal.onSelectionChange(() => {
  if (autoCopyOnSelect && terminal.hasSelection()) {
    navigator.clipboard.writeText(terminal.getSelection());
  }
});
```

### 6. Configuration UI
Add toggle in PlanDialog or XTerminal component:
- Checkbox: "Auto-copy on selection"
- Persisted in localStorage: `panopticon.terminal.autoCopyOnSelect`
- Default: `true`

## Files to Modify

1. **`src/dashboard/frontend/package.json`**
   - Add `@xterm/addon-clipboard` dependency

2. **`src/dashboard/frontend/src/components/XTerminal.tsx`**
   - Import and load ClipboardAddon
   - Add keyboard event handlers (Ctrl+C/V)
   - Add selection change handler (auto-copy)
   - Add right-click handler (context menu)
   - Add autoCopyOnSelect prop with localStorage persistence

3. **`src/dashboard/frontend/src/components/TerminalContextMenu.tsx`** (NEW)
   - Custom context menu component
   - Copy/Paste actions
   - Positioning logic

4. **Test files** (NEW):
   - `src/dashboard/frontend/src/components/XTerminal.test.tsx`
   - Unit tests for clipboard logic

## Edge Cases & Considerations

1. **Browser clipboard permissions**
   - `navigator.clipboard` requires secure context (HTTPS or localhost)
   - Handle permission denials gracefully
   - Fall back to `document.execCommand('copy')` if needed

2. **Ctrl+C conflict**
   - When no selection: let terminal handle (interrupt signal)
   - When selection exists: copy to clipboard
   - Platform differences: Ctrl on Windows/Linux, Cmd on Mac

3. **Context menu positioning**
   - Keep menu within viewport bounds
   - Handle terminal scrolling
   - Close on clicks outside

4. **Auto-copy performance**
   - Debounce selection changes to avoid excessive clipboard writes
   - Only copy when selection is finalized (not during drag)

5. **Paste safety**
   - Pasting into read-only terminal (planning view) - should still work for user input
   - Multi-line paste handling (xterm.js handles this)

## Breakdown into Sub-Tasks

### Task 1: Add clipboard addon dependency
**Difficulty:** `trivial`
**Files:** `package.json`
**Work:** Install `@xterm/addon-clipboard`

### Task 2: Load clipboard addon in XTerminal
**Difficulty:** `simple`
**Files:** `XTerminal.tsx`
**Work:** Import ClipboardAddon, instantiate, load into terminal

### Task 3: Implement smart keyboard shortcuts (Ctrl+C/V)
**Difficulty:** `medium`
**Files:** `XTerminal.tsx`
**Work:**
- Add keyboard event listeners
- Detect platform (Mac vs Windows/Linux)
- Implement smart Ctrl+C logic (copy if selection, else interrupt)
- Implement Ctrl+V paste logic
- Handle clipboard API permissions

### Task 4: Implement auto-copy on selection
**Difficulty:** `medium`
**Files:** `XTerminal.tsx`
**Work:**
- Add `autoCopyOnSelect` prop with default `true`
- Add selection change handler
- Debounce selection changes
- Store preference in localStorage
- Only copy when selection is finalized

### Task 5: Create context menu component
**Difficulty:** `medium`
**Files:** `TerminalContextMenu.tsx` (new), `XTerminal.tsx`
**Work:**
- Create TerminalContextMenu component
- Handle right-click events
- Position menu at cursor
- Implement Copy/Paste actions
- Handle viewport boundary constraints
- Close on click outside

### Task 6: Add configuration UI for auto-copy
**Difficulty:** `simple`
**Files:** `XTerminal.tsx` or `PlanDialog.tsx`
**Work:**
- Add checkbox/toggle for auto-copy setting
- Wire to localStorage
- Update prop when toggled

### Task 7: Write unit tests
**Difficulty:** `medium`
**Files:** `XTerminal.test.tsx` (new)
**Work:**
- Test keyboard event handlers
- Test clipboard interactions (mocked)
- Test auto-copy logic
- Test context menu behavior
- Test localStorage persistence

### Task 8: Manual testing & polish
**Difficulty:** `simple`
**Files:** All
**Work:**
- Test in running dashboard
- Verify Mac/Windows/Linux behavior
- Edge case testing
- UX polish

## Success Criteria

✅ **Functional:**
- [x] Ctrl+C copies when text is selected
- [x] Ctrl+C sends interrupt when no selection
- [x] Ctrl+V pastes from clipboard
- [x] Selection auto-copies (when enabled)
- [x] Right-click shows context menu with Copy/Paste
- [x] Auto-copy is configurable and persisted
- [x] Works on Mac (Cmd) and Windows/Linux (Ctrl)

✅ **Testing:**
- [x] Unit tests pass
- [x] Manual testing confirms all features work

✅ **Code Quality:**
- [x] No console errors
- [x] Clean error handling for clipboard permissions
- [x] Follows existing code patterns

## References

- [xterm.js clipboard addon](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-clipboard)
- [Browser Clipboard API](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API)
- Issue: https://github.com/eltmon/panopticon-cli/issues/34
