---
name: pan-computer-use
description: >-
  Read and operate a visible local desktop app (native apps, external browser windows) through
  `pan computer`: accessibility tree, clicks, typing, keys, scrolling, dragging and screenshots.
  Prefer a programmatic path (shell, files, git, HTTP, an existing CLI) whenever one can do the
  job; use this only when a visible window needs GUI control. Linux desktops only; needs
  computer_use.enabled.
triggers:
  - pan computer
  - computer use
  - desktop control
  - accessibility tree
allowed-tools:
  - Bash
  - Read
---

# Computer Use

Adapted from Orca's computer-use guide (MIT, Copyright (c) 2026 Lovecast Inc.).

Use this skill to drive a visible app window through `pan computer`. Prefer a programmatic path (shell, filesystem, git, HTTP, existing CLIs) whenever it can complete the task; use this skill only when a visible window needs GUI control those cannot reach.

## Preconditions

- Prefer `--json`.
- Do not push, submit forms, send messages, buy items, delete data, change account settings, or expose secrets unless the user explicitly asked for that action.
- If an app contains sensitive content, read only what the user requested.

```text
pan computer capabilities --json
```

## Core Loop

```text
pan computer list-apps --json
pan computer get-app-state --app gnome-calculator --json
pan computer click --app gnome-calculator --element-index 12 --json
```

Use the fresh state returned by each action for the next element index. Element indexes are short-lived and go stale after delays, navigation, focus changes, scrolling, window changes, or app re-rendering. In `--json` output, read the accessibility tree from `result.snapshot.treeText`; `elementCount` is only a count and must not be used to infer indexes.

## Reading State Cheaply

In a large window, look for one control with `get-app-state --query <text>`: it prints only elements whose line contains the text (case-insensitive), with their ancestors. `--max-elements <n>` caps how many elements are printed.

```text
pan computer get-app-state --app gnome-text-editor --query Downloads --json
```

When a tree is truncated, read a hidden subtree by passing the nearest shown ancestor's index as `get-app-state --element-index <n>`. Indexes printed under that read are for the subtree only, numbered from 0 again; the next action returns the whole window again.

```text
pan computer get-app-state --app gnome-text-editor --element-index 12 --json
```

## Waiting

Never `sleep` between actions. When the UI changes on its own after an action (a save finishes, a dialog opens, a button becomes clickable), wait for the change with `wait`. It returns as soon as the condition holds and prints the matching lines; it fails with `wait_timeout` if the condition does not hold in time (default 10 s, `--timeout <ms>` up to 120000).

```text
pan computer wait --app <app> --text "Saved" --json
pan computer wait --app <app> --enabled "Continue" --json
pan computer wait --app <app> --window-title "Save As" --json
```

- `--text <text>`: a tree line contains the text (case-insensitive, like `--query`).
- `--enabled <text>`: a line contains the text and none of the lines containing it is marked disabled. Use text only the intended control shows; a label that repeats the button text also has to be enabled.
- `--window-title <text>`: one of the app's windows has the text in its title, as `list-windows` reports it.

`wait` only reads the app; it never acts. The app or window may be missing at first; `wait` keeps checking until it appears.

## App Selectors

Use names from `list-apps`, or `pid:<number>` when a name is ambiguous.

```text
pan computer get-app-state --app gnome-calculator --json
pan computer get-app-state --app pid:12345 --json
```

For apps with multiple windows, run `list-windows` first and pass `--window-index <n>` to `get-app-state` and later actions until the target window changes.

## Commands

```text
pan computer capabilities --json
pan computer list-apps --json
pan computer list-windows --app <app> --json
pan computer get-app-state --app <app> --json
pan computer get-app-state --app <app> --restore-window --json
pan computer get-app-state --app <app> --query <text> --max-elements <n> --json
pan computer wait --app <app> --text <t> --timeout <ms> --json
pan computer click --app <app> --element-index <n> --json
pan computer click --app <app> --x <x> --y <y> --json
pan computer click --app <app> --element-index <n> --mouse-button right --click-count 2 --json
pan computer perform-secondary-action --app <app> --element-index <n> --action <name> --json
pan computer set-value --app <app> --element-index <n> --value "text" --json
pan computer type-text --app <app> --text "text" --json
pan computer type-text --app <app> --element-index <n> --text "text" --json
pan computer press-key --app <app> --key Return --json
pan computer hotkey --app <app> --key ctrl+shift+p --json
pan computer paste-text --app <app> --text "text" --json
pan computer scroll --app <app> --element-index <n> --direction down --json
pan computer drag --app <app> --from-element-index <n> --to-element-index <n> --json
pan computer drag --app <app> --from-x 100 --from-y 100 --to-x 300 --to-y 300 --json
pan computer release
```

Use `--no-screenshot` only when pixels are not needed. Use `--text-stdin` or `--value-stdin` for sensitive text so it does not land in shell history or argv.

```bash
printf '%s' "$SECRET" | pan computer set-value --app <app> --element-index <n> --value-stdin --json
```

## Action Rules

- Never report an unverified action as success. If it could have sent, submitted, bought, or deleted something, say the effect is unproven, and check a fresh `get-app-state` first.
- Prefer semantic actions: `set-value` for editable fields, `click` for controls, and `perform-secondary-action` only for the element's listed action names.
- After any UI-changing action, use the returned state or rerun `get-app-state` before choosing the next element index.
- Use `press-key` for single/navigation keys such as Return, Escape, Tab, and arrows. Use `hotkey` only for one modifier chord plus one key, such as `ctrl+a` or `ctrl+shift+p`.
- A chord that would quit, lock, log out or switch virtual terminals (`alt+F4`, `ctrl+alt+F2`, `super+l`, `ctrl+q`, …) is refused with `system_shortcut_blocked`. The error names what the shortcut would do; reach that goal another way, such as the window's own close button or menu item. Pass `--allow-system-shortcut` only when the user asked for that exact shortcut.
- Coordinates passed to `click`, `scroll` and `drag` are window-local; use coordinates from the latest screenshot or state for the same target window.

## Foreground Input on Linux

Clicks, scrolling, drags and keyboard input bring the target window forward. Do not pass `--restore-window` by default — tell the user first, since it takes over their screen, keyboard focus and pointer — and use it only when the window is not already in front or an action fails because it is not focused.

## Screenshots

`get-app-state` and actions request screenshots by default unless `--no-screenshot` is passed. A successful `--json` capture is saved as a PNG file; read it at `result.screenshot.path` with your file-reading or image tool. Coordinates passed to `click`, `scroll` and `drag` are window-local action coordinates, which may differ from screenshot pixels when `screenshot.scale` is not 1.

## App Notes

Browsers: for Chromium, Firefox and similar browser windows, set the address/search field directly with `set-value`, then press Return with `press-key`. Do not assume raw `type-text` went to the address bar.

For browser-hosted forms, verify the focused element after each field action. If a click or `set-value` does not change the focused receiver, use `press-key --key Tab` from a known focused field, or window-local coordinates from a fresh screenshot. Prefer `paste-text` into the verified focused field for longer text, then inspect the returned state before continuing.

## Overdeck

- **`desktop_busy`:** another agent or the operator holds the desktop. Don't retry in a loop. Report it and wait for the time named in the message, or ask the operator to run `pan computer release --force`.
- **`disabled`, `no_desktop_session` and `unsupported_platform`** are not retryable. Tell the user what the message says.
- **Use `--text-stdin` / `--value-stdin`** for anything sensitive.
- **Release when done:** run `pan computer release` when your GUI task is finished, so other agents can use the desktop.
- **Errors:**

  | Code | What to do |
  | --- | --- |
  | `disabled` | Not retryable. `computer_use.enabled` is off in `~/.overdeck/config.yaml`; only the operator can turn it on. |
  | `unsupported_platform` | Not retryable. This host is not Linux; computer use only works on Linux desktops. |
  | `no_desktop_session` | Not retryable. No `DISPLAY`/`WAYLAND_DISPLAY` resolved; this host has no logged-in desktop. |
  | `helper_missing_dependency` | Install the package the message names, then retry once. |
  | `helper_timeout` | The helper did not respond in time. Retry once; if it recurs, stop and report it. |
  | `helper_error` | The helper reported a specific failure (read its message). Adjust your command; do not retry unchanged. |
  | `desktop_busy` | Another holder has the desktop. Don't retry in a loop; report it and wait for the time in the message. |
  | `element_not_found` | The cached index is stale. Run `get-app-state` again and use a fresh index. |
  | `system_shortcut_blocked` | The chord would quit, lock, log out or switch VTs. Reach the goal another way, or pass `--allow-system-shortcut` only if the user asked for that exact shortcut. |
  | `invalid_argument` | Fix the command's flags; don't retry unchanged. |
  | `wait_timeout` | The condition never held. Run `get-app-state` to see what the app actually shows, then wait again with better text or a longer `--timeout`. |
