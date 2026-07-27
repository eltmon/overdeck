# Concerns / hazards

Live landmines a change in this repo can step on. Verified 2026-06-13.

- **ToS policy gate** — `canUseHarnessSync()` (`src/lib/harness-policy.ts:69`) blocks
  Pi + Anthropic + subscription auth. Every harness resolution path must end by
  passing its winner through this gate; blocked ⇒ collapse to `claude-code`.
  Never bypass, never reorder around it.
- **Harness resolution is unified in `resolveHarness()`** (PAN-1787, landed
  3da6c9bc1) — `src/lib/harness-resolve.ts`. Precedence: explicit → roles[role].harness
  → providerHarnesses[provider] → built-in provider default → claude-code. Any value
  passed as `explicit` wins the whole chain, so spawn entry points must pass
  `undefined` (not a coalesced `'claude-code'`) when the user made no choice.
  PAN-1826 found `src/cli/commands/start.ts:709` doing `options.harness ?? 'claude-code'`
  (provider default silently bypassed on every flagless `pan start`) and the
  conversations route (`routes/conversations.ts:411 resolveAllowedHarness`) hard-defaulting
  claude-code without consulting the resolver.
- **Legacy `specialist_harnesses`** (PAN-636) — `model_selection.specialist_harnesses`
  in `src/lib/cloister/config.ts:157-163` + `router.ts getSpecialistHarness` is a
  deprecated alias at role-tier precedence (PAN-1787). Its only consumer,
  `specialists.ts buildSpecialistBaseCommand`, is dead code (no callers) — not a
  live spawn path.
- **JSONL resume across model/harness change** — `spawnMode: 'resume'`
  (`agents.ts:2647`, `resumeAgent` ~:4537) emits `--resume <sessionId>`
  (`launcher-generator.ts:427,529`). Resuming a session created under a different
  model/harness corrupts/loses context; PAN-1787 adds a guard (fresh session +
  continue.json re-onboarding instead). Compact recovery (PAN-1781) already
  forces fresh sessions — keep that behavior.
- **`postMergeLifecycle` idempotency** — guarded by
  `src/lib/cloister/in-flight-guard.ts` + its test. Weakening it reopens the
  PAN-328 infinite-loop (24k tracker calls). Keep the test green.
- **Polyrepo UAT: never gate on `repos.length`** (PAN-3093) — every generation
  reads back with at least one `repos` entry because monorepo rows synthesize
  one, and a polyrepo project with a single contributing repo still needs the
  per-repo path. Gate on the injected per-repo deps instead (`polyrepoGit` in
  `uat-promote.ts`, `removeRepoArtifacts` in `uat-generation-engine.ts`).
- **UAT anchors are compared by string equality** (PAN-3093) — the reconciler
  decides staleness by comparing an anchor it computes now against what
  assembly stored, so both sides must build anchors with the shared helpers in
  `src/lib/cloister/uat-polyrepo-engine.ts`. Member anchors order by `repoKey`
  because `mergeOrderInRepo` is knowable only to assembly; ordering on it makes
  every generation read stale and reassemble forever.
- **Polyrepo promote is resumable, not transactional** — phase A trial-merges
  every repo before anything is pushed, but a phase-B failure leaves earlier
  repos landed on purpose. Recovery is retry-with-skip via `promoted_at`; never
  force-push or rewind a member repo's main (one-way door). A retry that finds
  every repo landed must FINALIZE, not error — that is the crash window between
  the last push and finalization.
- **Read-only member repos are never UAT targets** (PAN-3093) — `required ===
  false` (from `readonly: true`) is enforced in the ready set, in
  `buildPolyrepoGitDeps`/`buildPolyrepoCleanupGit`, and re-checked against
  current config at promote time. Assembly pushes branches, promote pushes
  merges, and cleanup deletes remote branches, so every one of those is a write
  boundary.
- **Feature contributions carry the LOGICAL branch** (`feature/<issue>`), never
  `origin/…` — `GenerationGitDeps` validates with `safeBranchName(…, 'feature')`
  and resolves origin-first itself. Passing a remote-qualified ref makes every
  merge throw and every feature get held out.
- **A ready-set branch probe must FETCH first** — `git rev-parse origin/<b>`
  reads a local tracking ref and never contacts the remote, so a branch pushed
  from another machine reads as absent and its project never assembles.
- **`promoted_at` is not proof of "not landed"** — publish and stamp are two
  writes to two systems. Promote must ask git (`findLandedMerge`) whether a
  nominally pending repo is already contained in its target before classifying
  it, or a crash between the two wedges the batch as stale-base forever.
- **Stale `node_modules/.experimental-vitest-cache`** (vitest `fsModuleCache:
  true`) serves PRE-FIX transforms: a fix appears not to work, and an inert
  comment "fixes" it. If a change seems to have no effect, purge that directory
  before debugging the code. It also masks unrelated failures.
- **Polyrepo assembly is feature-atomic** — a feature applies to all its repos
  or none, rolled back with `checkout -B` to a captured head. Do NOT reintroduce
  rebuild-and-replay: it is O(repos x features²) heavyweight git and can hold the
  project's single-flight reconcile slot for hours.
- **Single Deacon invariant** — never mount `~/.overdeck` into workspace
  containers; `OVERDECK_DISABLE_DEACON=1` belt-and-suspenders.
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
- **Fly Machine rootfs resets on every start** — the rootfs is rebuilt from the
  image on stop/start and on `restart.on-failure`. The ephemeral tier mitigates this
  with a VM-side continuous commit+push heartbeat daemon plus per-bead push
  instructions; the durable tier mitigates it by mounting a persistent Fly volume at
  `/workspace`. Never run durable work without verifying the volume mount
  (PAN-1845).

<!-- last-verified: 2026-06-13 -->
