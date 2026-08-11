# Gauntlet domains — evidence, areas, automatic failures

Pick the row matching THING, adapt freely. The point of this file: every
domain has a CHECK (how the critic inspects the work), a starter area split,
an automatic-failure list, and a storefront-test phrasing. Non-visual domains
replace "screenshot" with the domain's capturable evidence.

## Game / rich visual UI

- **CHECK:** Playwright screenshots at 1920×1080 across the key states
  (spawn, mid-action, celebration, error), on an account with realistic data.
- **Areas:** world/rendering · game-feel animation · UI system & motion ·
  onboarding · presentation of the core loop · sound design · music ·
  performance.
- **Auto-fails:** emoji as art · default/system fonts · unstyled native
  controls · flat untextured surfaces with no lighting response · dead-on-
  click surfaces · error-after-the-fact UX (offer then reject) · uncanny-
  middle photorealism · two shots that read as different games.
- **Storefront test:** "If this appeared on the same store page as the
  reference, would a player believe it is a shipped, commercially published
  game?"

## Web app / product UI

- **CHECK:** Playwright screenshots at 1920×1080 + mobile width, across real
  user flows (empty state, populated, error, loading, success).
- **Areas:** design system & tokens · core flow A · core flow B · empty/error/
  loading states · motion & micro-interactions · accessibility · performance.
- **Auto-fails:** default browser styling anywhere · unstyled focus rings ·
  layout shift on load · dead-end states with no next action · stock toasts
  for moments that deserve staging · inconsistent spacing rhythm.
- **Storefront test:** "Next to the reference's marketing screenshots, would
  a buyer believe this is the same tier of product?"

## CLI / developer tool

- **CHECK:** Captured terminal sessions (real invocations, real output,
  success + error + `--help`), asciinema or scripted transcript + screenshot.
- **Areas:** command surface & help text · output design (color, tables,
  spinners) · error messages & recovery hints · exit codes & pipe behavior ·
  docs/README · performance (startup, large input).
- **Auto-fails:** stack traces leaked to users · wall-of-text help · no
  `--help` for any verb · colors that break on light terminals · silent
  failure (exit 0, nothing happened) · inconsistent flag naming.
- **Storefront test:** "Shown both tools' real transcripts, would a developer
  pick this one as the professionally maintained tool?"

## API / backend service

- **CHECK:** Real request/response transcripts (curl -v or HTTPie), OpenAPI
  render, error catalog exercised live, latency numbers under stated load.
- **Areas:** resource model & naming · error design · docs & examples ·
  authn/authz behavior · observability · performance & limits.
- **Auto-fails:** inconsistent naming across resources · 500s for user error
  · errors without actionable messages · undocumented behavior the client
  must guess · missing pagination on list endpoints.
- **Storefront test:** "Given both APIs' docs and live responses, would an
  integrating engineer call this one a commercial-grade API?"

## Library / SDK

- **CHECK:** A consumer test app's real usage, rendered API docs, README
  quickstart timed end-to-end, type/error behavior at the boundaries.
- **Areas:** API surface & naming · docs & quickstart · error taxonomy ·
  types & ergonomics · test coverage of the contract · bundle/perf cost.
- **Auto-fails:** quickstart that doesn't run as written · leaked internal
  types · error classes users can't catch selectively · breaking the stated
  semver contract.
- **Storefront test:** "Would an engineer skimming both READMEs believe this
  one is the safe dependency to bet on?"

## Performance pass

- **CHECK:** Benchmark output (cold + warm, p50/p95/p99), flamegraphs,
  before/after on the same machine, under stated load. Numbers, not vibes.
- **Areas:** the hot path · memory footprint · startup · I/O & caching ·
  regression guard (the benchmark becomes CI).
- **Auto-fails:** benchmark that doesn't isolate the change · claimed wins
  without reproducible numbers · a win on one path that regresses another
  unmeasured · micro-benchmarks that don't reflect real load.
- **Storefront test:** "Presented with both benchmark suites, would an
  engineer believe this result and reproduce it?"

## Writing / docs / content

- **CHECK:** The rendered pieces side by side with the reference's, read by
  the critic with labels stripped; timed comprehension check ("which one do
  you understand faster?").
- **Areas:** structure & information architecture · voice & register ·
  examples & code samples · visuals/diagrams · navigation & discoverability.
- **Auto-fails:** jargon the target reader can't define · examples that
  don't run · a wall of text where a table/diagram carries the point ·
  inconsistent terminology for the same concept.
- **Storefront test:** "Stripped of branding, which piece would the target
  reader finish and act on?"

## Asset-heavy passes (audio, video, 3D, images)

- **CHECK:** The generated assets played/viewed in situ (wired into the
  product), plus a media-manifest.json so the progress page can play them.
- **Rules worth restating** (from run #1): generation prompts must describe
  audible/visible results, not mood adjectives ("soft/tiny" yields near-
  silence — put gentleness in the engine's gain, not the prompt); strip
  leading silence before trimming to a duration budget; never hard-trim a
  musical phrase; peak-normalize audio to −3 dBFS; verify the license clause
  of every purchased/stock asset for the distribution form.
