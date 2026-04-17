# Terminal Interaction Layers

Panopticon terminal interaction crosses four distinct layers. Bugs like duplicate context menus or trackpad gestures escaping into the chat UI happen when ownership is ambiguous. This document defines which layer owns which interaction so terminal behavior stays predictable.

## The four layers

### 1. Browser / app shell
The outer browser and host UI own page-level behavior only:
- browser default context menu
- page scroll
- non-terminal keyboard shortcuts
- outer application widgets like chat composer history

This layer must **not** handle gestures that begin on the terminal surface.

### 2. Panopticon terminal wrapper (`XTerminal.tsx`)
The React wrapper in `src/dashboard/frontend/src/components/XTerminal.tsx` owns browser-facing interaction policy for the terminal surface:
- intercept right-click and show the Panopticon context menu
- contain wheel / trackpad gestures so they never escape to the browser or app shell
- manage clipboard affordances, settings UI, and wrapper-level event policy
- decide what reaches xterm.js vs what is blocked at the browser boundary

If the browser or Claude shell reacts to a gesture that started over the terminal pane, the wrapper layer is leaking the event.

### 3. xterm.js
xterm.js owns terminal-surface rendering and client-side terminal interaction mechanics:
- text rendering
- selection behavior
- viewport behavior inside the terminal canvas/DOM
- forwarding terminal input and wheel semantics to the remote PTY path

xterm.js should receive terminal gestures only after the wrapper layer has already decided they belong to the terminal surface.

### 4. Remote PTY app (`tmux` + attached TUI)
The remote PTY side owns terminal application semantics:
- shell / Claude Code / fullscreen TUI behavior
- tmux pane history and copy-mode behavior
- application keybindings and mouse reporting inside the PTY

In managed tmux mode, tmux must not open a competing browser-facing context menu. Panopticon owns that UI.

## Ownership rules

### Right-click / context menu
- **Owner:** Panopticon wrapper
- **xterm.js:** receives terminal interaction only if needed after wrapper policy
- **tmux/PTy:** must not show its own popup menu in managed mode
- **browser:** default menu must be suppressed on terminal right-click

### Wheel / two-finger scroll
- **Owner at browser boundary:** Panopticon wrapper
- **Terminal-facing semantics:** xterm.js and the remote PTY path
- **Browser/app shell:** must never reinterpret the gesture as page scroll or chat-entry history navigation while the pointer is over the terminal

### Text selection
- **Owner:** xterm.js, with Panopticon wrapper policy assist where needed
- Panopticon may adapt browser events so selection still works under tmux mouse-reporting mode

### Terminal history vs page/app scrolling
- **Terminal history:** xterm.js + tmux/PTy path
- **Page/app scrolling:** browser/app shell
- The wrapper is responsible for ensuring terminal gestures stay in the terminal lane and page gestures stay outside it.

## Managed tmux policy

Managed tmux exists so Panopticon can guarantee stable terminal behavior independent of user dotfiles. In this mode:
- mouse support stays enabled
- tmux right-click popup menus are explicitly disabled
- Panopticon’s wrapper context menu is the only browser-visible menu for the terminal surface

## Debugging checklist

If terminal interactions feel wrong, check ownership in this order:
1. Did the browser/app shell react? If yes, the wrapper leaked the event.
2. Did Panopticon show the wrong menu or fail to suppress the default one? Wrapper bug.
3. Did xterm render/selection/viewport behavior go wrong after the wrapper contained the event? xterm integration bug.
4. Did tmux or the attached TUI reinterpret the event incorrectly after it reached the PTY? tmux/app-side bug.
