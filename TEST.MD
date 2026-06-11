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
  removes so you can compare the soft green vs soft maroon bands side by side.
- 2026-06-08: Re-saved the theme (muted tones) to force a hot-reload. This line's
  band is the live test of whether the running session re-applied
  custom:panopticon (#1c3d24 green / #43222a maroon).
- 2026-06-09: Mixed-edit smoke test — this block adds, changes, and deletes lines
  in one diff so you can see all three band types stacked together.
- 2026-06-09: UPDATED this line — the old "fresh add" text was rewritten in place,
  so it should render as a removed band immediately above a green added band.
- 2026-06-09: Line A REWRITTEN in place — only these few words changed, so the
  intra-line word emphasis should pop as a darker patch at the new 32% fill.
- 2026-06-09: Diff-contrast bump landed — the @pierre/diffs add/remove bands now
  fill at 32% over the background (was a barely-there 8%), so this green run
  should read boldly against the plain context lines around it.
- 2026-06-09: Second fresh addition, stacked below, to show a solid block of green.
- 2026-06-09: Third fresh addition — note the old "Brand-new line B" line was
  deleted here, so you also get a red removal band to compare green vs red.
- 2026-06-09: OSC 11 spawn-stamp test — this edit was made from a PRE-FIX session
  (dark-themed Claude on a light pane), so these bands still render dark here.
- 2026-06-09: New diff test line — REWRITTEN to exercise the word-level emphasis,
  which now sits at 0.40/0.45 alpha above the boosted line fill.
- 2026-06-09 (evening): REAL contrast fix landed (4fa4e5a1f) — the two morning
  "boost" commits were double-diluted no-ops; line fills now mix 30% accent in
  light mode and 34% in dark via the library's --mix-light/--mix-dark knobs.
- 2026-06-09 (evening): This green run should now read unmistakably green in BOTH
  themes — and the deleted "Open a NEW conversation" block above gives you the
  matching red band to compare.
- 2026-06-09 (evening): Pop this diff out too — the popout now shows "Loading
  diff…" while summaries fetch instead of the bogus "No completed turns yet."
