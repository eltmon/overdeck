# Concerns / hazards

Live landmines a change in this repo can step on. Verified 2026-06-12.

- **ToS policy gate** — `canUseHarnessSync()` (`src/lib/harness-policy.ts:69`) blocks
  Pi + Anthropic + subscription auth. Every harness resolution path must end by
  passing its winner through this gate; blocked ⇒ collapse to `claude-code`.
  Never bypass, never reorder around it.
- **Harness resolution is duplicated** — inline chains exist at all five spawn
  sites (`agents.ts` ×3, `spawn-planning-session.ts:558-561`, dashboard start
  route). Until PAN-1787 lands a single `resolveHarness()`, edits must be made
  in lockstep at every site.
- **Legacy `specialist_harnesses`** (PAN-636) — `model_selection.specialist_harnesses`
  in `src/lib/cloister/config.ts:157-163` + `router.ts getSpecialistHarness` is a
  parallel harness config (`claude-code|pi` only, predates codex). PAN-1787 makes
  it a deprecated alias at role-tier precedence.
- **JSONL resume across model/harness change** — `spawnMode: 'resume'`
  (`agents.ts:2647`, `resumeAgent` ~:4537) emits `--resume <sessionId>`
  (`launcher-generator.ts:427,529`). Resuming a session created under a different
  model/harness corrupts/loses context; PAN-1787 adds a guard (fresh session +
  continue.json re-onboarding instead). Compact recovery (PAN-1781) already
  forces fresh sessions — keep that behavior.
- **`postMergeLifecycle` idempotency** — guarded by
  `src/lib/cloister/in-flight-guard.ts` + its test. Weakening it reopens the
  PAN-328 infinite-loop (24k tracker calls). Keep the test green.
- **Single Deacon invariant** — never mount `~/.panopticon` into workspace
  containers; `PANOPTICON_DISABLE_DEACON=1` belt-and-suspenders.
- **Dashboard runtime** — Node 22 + built `dist/` only (node-pty native addon
  dies under Bun; circular ESM imports die under tsx/Node source mode).
- **`execSync` freezes the server** — anything reachable from the dashboard event
  loop must use async exec/spawn (PAN-70: ~70 calls cleaned up). Note doctor's
  `checkCommand` (`src/cli/commands/doctor.ts`) is execSync-based — CLI-only, do
  not import it into server-reachable code.
- **tmux sync primitives are legacy debt** — `sendKeysSync` etc. exist but new
  callers must use async variants; raw `send-keys "text" C-m` drops Enter.
- **RTK output compression** — when `agents.rtk.enabled`, Bash output agents see
  may be compressed/garbled; trust exit codes over visual output.
- **Dead UI code** — `components/Settings/Provider/` (ProviderCard, ProviderPanel,
  ThinkingLevelSlider) is entirely unimported (references the Material Symbols
  font removed in a37f8c890). Slated for deletion in PAN-1787.
- **Per-workspace `.venv`** (TLDR) can be ~7.5GB each — don't copy/back up
  workspaces blindly.

<!-- last-verified: 2026-06-12 -->
