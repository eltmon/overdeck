# Docs Screenshots — Light & Dark

Every screenshot in the Mintlify docs site ships **two variants**: one captured
in light mode, one in dark mode. The docs site shows whichever matches the
reader's theme.

## Naming convention

A screenshot named `<name>` is stored as a pair:

```
<name>-light.png
<name>-dark.png
```

Dashboard screenshots live in `images/<section>/`; the `introduction` page's
hero images live in `docs/`.

## Capturing both variants

Use the capture script — it drives a headless browser against the running
dashboard and writes both variants in one run:

```bash
# Dashboard must be running: pan up
node scripts/capture-doc-shot.mjs <route> <output-basename> [options]
```

Examples:

```bash
# Board view -> images/specialists/01-board-hero-{light,dark}.png
node scripts/capture-doc-shot.mjs /board images/specialists/01-board-hero --wait 4000

# Costs page, full scrollable page
node scripts/capture-doc-shot.mjs /costs images/specialists/09-costs --full-page

# A single panel, by CSS selector
node scripts/capture-doc-shot.mjs /agents images/agents-card --selector ".agent-card"
```

The script seeds `localStorage['panopticon.ui.theme']` before each navigation,
so the page renders in the requested theme from first paint. Run
`node scripts/capture-doc-shot.mjs` with no arguments for the full option list.

Dashboard routes are defined in `TAB_PATHS` in
`src/dashboard/frontend/src/App.tsx` (`/board`, `/command-deck`, `/agents`,
`/costs`, `/health`, `/metrics`, …).

## Showing a screenshot in an MDX page

Import the `ThemedImage` snippet once per page, then use it instead of a
markdown image:

```mdx
import { ThemedImage } from "/snippets/themed-image.mdx";

<ThemedImage
  light="/images/specialists/01-board-hero-light.png"
  dark="/images/specialists/01-board-hero-dark.png"
  alt="Panopticon kanban board with specialists running"
/>
```

If a dark variant does not exist yet, omit `dark` — `ThemedImage` falls back to
the light image in both modes, so a screenshot can land before its dark
variant is captured. Backfill the dark variant when the view can be captured in
the right state.

## Rule

When you add or replace a screenshot in the docs, capture **both** variants and
embed it with `<ThemedImage>`. Never commit a plain `![](...)` screenshot —
single-mode images look broken against the opposite theme.
