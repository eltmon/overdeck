---
type: reference
description: Chrome never delivers Ctrl+N/T/W (and Shift variants) or, on Linux,
  Ctrl/Alt+1..9 to pages; pick other dashboard shortcuts
updated: 2026-11-14
---

Chrome keeps Ctrl+N, Ctrl+T, Ctrl+W, Ctrl+Shift+N/T/W for itself in a normal tab, and on Linux also Ctrl+1..9 and Alt+1..8 (tab switching). A dashboard keydown handler never sees them, even in the capture phase. Playwright-injected keys bypass browser accelerators, so a passing Playwright test does not prove a binding works for a real user.

**Why:** the PAN-5284 mockup advertised Ctrl N and number-key tab switching; both would silently do nothing (or open a browser window).

**How to apply:** for app shortcuts use capture-phase handlers with keys Chrome does not reserve (PAN-5284 D-7: N outside inputs, Ctrl+Alt+1..9, Ctrl+Shift+E/G/F, Ctrl+P, Ctrl+K), and verify new bindings with real key events in the operator's Chrome, not only Playwright.
