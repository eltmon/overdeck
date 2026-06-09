# TEST.MD — agent scratch file

This is a deliberate **test / scratch file**. It is not part of the product,
the build, or any pipeline. It exists so agents (and humans) have a safe,
throwaway place to exercise things that need a real file change to observe.

## What to use it for

Use this file whenever you need a harmless diff to look at — especially for
verifying **how changes render**, such as:

- Terminal-view diff rendering (the red/green diff bands in a tmux/Claude Code
  pane viewed through the dashboard).
- Light-mode vs dark-mode rendering of the terminal and conversation views.
- Conversation-mode diff panels (`/conv/<id>` → "View diff").
- Anything else where you just need *a* change to produce *a* diff.

## How to use it

Edit it freely — add a line, change a line, remove a line. The content does not
matter; the **diff it produces** is the point. Append a dated note below if you
like, or just scribble. Nothing here is sacred and nothing depends on it.

Revert or leave your edits as you see fit — this file is meant to churn.

## Scratch area

<!-- Add throwaway edits below this line -->

- 2026-06-08: Created to verify the terminal pane stays dark in dashboard light
  mode (Claude Code's diff bands render correctly on a pinned-dark pane).
- 2026-06-08: Reverted the pin — terminal now follows the dashboard theme, and a
  per-pane dark/light toggle button (sun/moon, top-right) lets you flip an
  individual Claude terminal so its diff bands stay readable in light mode.
- 2026-06-08: This very edit is the diff to eyeball — added/removed lines should
  render cleanly in whatever theme the terminal pane is currently set to.
- 2026-06-08: Hardened the conversation diff view against a first-paint light
  flash in dark mode (pinned color-scheme from our side). This edit's diff is the
  one to review in the conversation diff panel — it should be dark in dark mode,
  light in light mode, with no flash on open or theme toggle.
- 2026-06-08: Testing a custom Claude Code theme (custom:panopticon) that mutes
  the harsh full-width diffAdded/diffRemoved bands. The green/red bands behind
  THESE lines in the Claude terminal should now read as soft, low-saturation
  tints rather than vivid blocks. Tunable live via ~/.claude/themes/panopticon.json.
- 2026-06-08: Fresh diff to eyeball the muted theme. The lines below mix adds and
  removes so you can compare the soft green vs soft maroon bands side by side:
    added line one   (soft dark-green band)
    added line two   (soft dark-green band)
    a settled line with no band at all for contrast
    removed-looking line A   (soft dark-maroon band when this block is edited)
  If these still look like harsh vivid blocks, the theme didn't reload — tell me
  and I'll dig in. If they're too subtle, say "more contrast" and I'll bump them.
