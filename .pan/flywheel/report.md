# Flywheel report (2026-11-22)

## Shipped this run (merged, deployed, closed)

- PAN-5585: mobile conversation layout (subagent rail is an overlay on narrow panes; top bar no longer overflows).
- PAN-5586: Gemini 4 models (`gemini-4-carbon`, `gemini-4-neon`, `gemini-4-hydrogen`), new Google tier mapping and deprecation remaps.
- PAN-5587: Antigravity harness (`agy acp`, API key and Agent Platform auth only, because the Antigravity terms forbid third-party OAuth use).
- PAN-5588: the quality-gate CPU bypass bound is counted per queue, not per head, so sustained outside CPU load no longer drains one gate every 10 minutes.
- PAN-5589: CPU pressure (PSI) alone no longer blocks gates while most cores are idle; contention needs at least 50% utilization.
- PAN-5595: the release workflow waits for npm to show each published version, explains a staged hold, and treats a "previously staged" 409 on rerun as already published.
- Releases 0.90.0 and 0.90.1 published to npm (`latest` = 0.90.1); both verified with a clean npx install.
- Outside Overdeck, at the operator's request: dfai recorders now run one video encode at a time on the medium preset (dfai commit 4388932e).

## In flight

None.

## Parked / waiting on the operator

PAN-4593 (Semgrep tier decisions, the only released issue), PAN-4294 Worker deploy, PAN-5342 live checks, PAN-5241 spillover settings, GitHub App Issues permission, author-gate bot decision, AAB upload, overdeck-landing#7, Grok retest. Open PRs #5387 (PAN-5385, Anywhere trickle ICE) and #5206 (PAN-5204, voice sample rate) wait on review; PAN-5385 is not released.

## Substrate fixes this run

PAN-5588, 5589, 5595.
