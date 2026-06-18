# Opus Plan Audit — PAN-1200 epic (4 plans)

Auditor: Opus 4.7
Date: 2026-05-25
Subjects: `.pan/specs/2026-05-25-PAN-{1201,1203,1204,1205}-*.vbrief.json`

## Summary

Three structural problems dominate the punch list. **(1) PAN-1203 and PAN-1204 both extend `sync-sources/hooks/user-prompt-submit-hook` (the single Claude Code `UserPromptSubmit` registration) and neither references the other** — without a shared composition contract they will fight for stdout-ordering and double-inject, regressing the PAN-1052 memory-injection path that hook already owns. **(2) PAN-1204's plan assumes a typed `observationType` discriminant for `compliance.miss`** records, but `packages/contracts/src/memory.ts` shows `MemoryObservation` has no such field — only `actionStatus: string | null` and `tags: string[]` — so the bead acceptance criteria as written would let the agent invent a schema field that doesn't exist. **(3) PAN-1201's reopened plan was scoped down to dashboard+plural-CLI gaps**, but it does not include any bead reconciling its `~/.overdeck/context/global.md` + `<project>/.pan/context/project.md` + `<workspace>/.pan/context/workspace.md` path contract with PAN-1204's new `~/.overdeck/session-context.md` write target, and the original PRD's `--append-system-prompt-file workspace.md` launcher contract is not on either plan. Without an explicit owner the launcher injection of *both* files (briefing + workspace) will be designed twice and shipped neither way.

Below: per-plan punch list, then epic-level findings.

---

## PAN-1201 — Hybrid context distribution

The scope was deliberately narrowed at replan to the two surfaces the issue was reopened for (plural `pan projects` group + dashboard Context page). That narrowing is correct, but it leaves several PRD acceptance criteria unowned by either the existing main branch *or* this spec.

### CRITICAL (must amend before wave 2)

- **new bead — `context-launcher-briefing-integration`**: The PRD acceptance criterion *"Workspace `workspace.md` is auto-assembled at `pan workspace create` time"* is implied to already be on main per the auto-decision, but PAN-1204's `harness-briefing-injection` bead adds a *second* `--append-system-prompt-file ~/.overdeck/session-context.md` argument alongside the workspace one. `src/lib/launcher-generator.ts:482` only threads a single `appendSystemPromptFile`. Neither plan extends it to multi-file. File a bead in 1201 to extend `LauncherGeneratorConfig` to accept `appendSystemPromptFiles: string[]` and have 1204's `harness-briefing-injection` depend on it. Without this, 1204 will silently overwrite 1201's workspace.md injection.
- **`context-dashboard-routes` ac2**: the allowlist enumerates `~/.overdeck/context/global.md`, `<project>/.pan/context/project.md`, `<workspace>/.pan/context/workspace.md` correctly — but the PRD also describes a `<projectRoot>/.overdeck/context/` path (line 44). The auto-decision pinned `.pan/context/` for project/workspace, which is right per PAN-967, but the resulting drift from the PRD must be documented in `context-docs-regression.ac1` or future devs will reintroduce the `.overdeck/` path.

### HIGH

- **`cli-projects-alias.ac1` and `ac2`** are testable but the bead has no explicit test bead listed in its `subItems` — verification is deferred to `context-final-verification.ac1` which only checks `--help`. Add a unit test for both the plural and singular dispatch in a new bead or extend `context-dashboard-tests` to cover CLI registration.
- **Missing PRD-mandated bead — `context-validate-cli`**: PRD line 218 *"`pan context validate` catches unclosed Mustache blocks and unknown harness names"*. The spec mentions the existing `pan context` group inherits validate, but no bead verifies validate still works after the new plural `projects` group is added or after Monaco render changes. Add a regression test bead.
- **`context-dashboard-tests.ac1`** says "save requests cannot escape the context layer allowlist" — strengthen to require path-traversal fuzz inputs (`../../../etc/passwd`, symlinked targets, URL-encoded `..%2F`) — vague "allowlist" criteria will let a passing test land that does not actually defend the route.

### LOW

- `plural-command-copy` is a "find and replace doc copy" bead with three ACs that all say the same thing. Either collapse to one AC or split into per-file ACs naming each touched doc.
- `context-final-verification.ac3` requires "isolated Playwright browser/profile" but does not specify which profile or how to provision it. Reference `tests/e2e/playwright.config.ts` (if it exists) or call out that an ephemeral `--user-data-dir` is required.

### Cross-plan integration risks

- **vs PAN-1204**: launcher multi-file (above).
- **vs PAN-1203**: `~/.overdeck/config.yaml` schema. PAN-1201 adds a `context.*` section (PRD lines 189-204); PAN-1203 adds `docs.*`; PAN-1204 adds `compliance.*`. None of the specs reference a shared schema-merge bead. If three agents land `src/lib/config-yaml.ts` migrations independently, last-write-wins on the YAML normalizer.
- **vs PAN-1205**: `pan.localhost` vs `artifacts.pan.localhost` lives in PAN-1205 Traefik changes. PAN-1201 docs may reference `overdeck.localhost/context` (per `context-docs-regression`); confirm the actual path is `pan.localhost/context`. Add `context-docs-regression.ac4` to enforce this.

---

## PAN-1203 — Overdeck docs RAG

This plan is the most internally coherent of the four. Wave 1 dependency on `docs-config` blocking five downstreams is appropriate. The main gaps are around hook composition and the embedding-model build dependency.

### CRITICAL (must amend before wave 2)

- **`docs-hook-injection` does not own the composition contract**. The narrative says "Extend `sync-sources/hooks/user-prompt-submit-hook`" but PAN-1204's `prompt-briefing-refresh` *also* extends the same script (via `/api/memory/inject` extension). Without a shared bead defining stdout-section ordering (memory → briefing-update → docs), the two plans will collide. **Amendment**: add a shared bead `hook-composition-contract` that owns the script's section-emission protocol, then have both `docs-hook-injection` and `prompt-briefing-refresh` declare it as `foundationFor`. See epic-level beads below.
- **`docs-index-builder.ac2`** says "Build scripts generate and ship `dist/docs-index.sqlite` without first-run model downloads at install or query time" — but the PRD calls for *local* `gte-small` (30MB ONNX). Build-time embeddings still need an ONNX runtime in the build environment. Add a sub-AC: "Build-time embedding generation declares its ONNX/native dependency in `package.json` `devDependencies` and is gated behind `EMBEDDINGS_PROVIDER`; CI builds verify the dependency is reproducible."
- **`pi-docs-injection.ac3`** is the right escape hatch, but the bead has no concrete "what to do with a blocker" path. Add an AC: "If Pi blocker is hit, the work agent files a follow-up issue against `mariozechner/pi-coding-agent` and links it from `verification.ac3` before marking complete." Otherwise the agent will silently skip the AC.

### HIGH

- **No bead for the `<overdeck-docs>` block placement in the existing memory-injection response.** The hook today emits the memory-inject response verbatim (`printf '%s\n' "$INJECT_CONTEXT"`). The plan needs a bead that either (a) extends `/api/memory/inject` server-side to accept docs context and return it merged, or (b) makes the bash hook do a second curl. The current `docs-hook-injection` narrative is ambiguous about which.
- **`docs-budget-telemetry.ac4`** mentions "session-id present and missing hook payloads" — good. But neither this bead nor `docs-hook-injection` enumerate which session identifier they will use. Claude Code emits `session_id` in the JSON; Pi has its own. The bead should commit to a single canonical key in telemetry.
- **`docs-cli` needs a `pan docs budget-check` / `pan docs budget-bump` pair** that the PRD's hook script (lines 165, 175 of the PRD) explicitly invokes. The bead's ACs list `query/reindex/disable/enable/status` but not these two. Add them — without them, the hook breaks.

### LOW

- `docs-corpus.ac3` lists "rule frontmatter" — the existing rules in `.claude/rules/` have no frontmatter. Either clarify "PAN-1201 may add a `scope:` frontmatter, plan for both shapes" or drop it.
- `verification.ac4` enforces "below the size budget" — name the budget (50MB per PRD line 215).
- Add a bead to update `docs/DOCS-RAG.md` per `docs-docs.ac1`; today that document doesn't exist and the bead conflates "update existing" with "create new."

### Cross-plan integration risks

- Hook composition (above) — paired with PAN-1204.
- Config schema merge — paired with PAN-1201 + PAN-1204 (see epic-level findings).
- `pan install` is touched by `docs-install-materialization` and by the PAN-1204 implicit briefing setup. Confirm `src/cli/commands/install.ts` has a single edit-owner per phase.

---

## PAN-1204 — Home tab + briefing + compliance

The most ambitious of the four (17 beads, 4 subsystems). Several beads have correct ACs but the compliance-write subsystem has a foundational schema mismatch.

### CRITICAL (must amend before wave 2)

- **`compliance-stop-audit.ac2`** mandates `writeObservation` writes `compliance.miss` "with triggerPhrase(s), firstToolCall, agentRole, agentHarness, sessionId, and timestamp." But `MemoryObservation` (`packages/contracts/src/memory.ts:22-42`) has these fields and only these: `id, timestamp, projectId, workspaceId, issueId, runId, sessionId, agentRole, agentHarness, gitBranch, sourceTranscriptOffset, actionStatus, narrative, summary, files, tags, tokens, model`. There is **no** `observationType` / no `triggerPhrases` / no `firstToolCall` field. The planner has implicitly invented a schema. **Amendment**: rewrite ac2 to specify the actual mapping — `tags: ['compliance', 'miss', ...triggerSlugs]`, `actionStatus: 'compliance.miss'`, `summary: human-readable miss description`, `narrative: JSON-encoded { triggerPhrases, firstToolCall }`. Without this, the agent will either add `triggerPhrases` to the Schema (breaking PAN-1052 contracts) or invent a sidecar table.
- **`compliance-advisory-warning.ac1`** depends on querying "current-session compliance.miss" — but the same schema gap means there's no indexed way to find these. Either ac2 above must specify a tag-based query (`tags ⊇ ['compliance', 'miss']` filtered by `sessionId`) or this bead needs a sidecar marker store (e.g., `~/.overdeck/compliance/session-misses.jsonl`). The plan implies the former but does not commit. Add a `compliance-storage-strategy` decision to the spec narrative or a new bead.
- **`harness-briefing-injection`** + PAN-1201's launcher — the bead says "Claude Code launches include `--append-system-prompt-file ~/.overdeck/session-context.md` … without removing workspace context files." `src/lib/launcher-generator.ts` currently supports exactly one `appendSystemPromptFile`. The bead doesn't reference the file or the upstream change. See PAN-1201 cross-plan note — file a shared bead.
- **`prompt-briefing-refresh` collides with `docs-hook-injection`** on the same hook script. Both narratives say "extend the existing UserPromptSubmit memory injection path" — but neither references the other plan, and there's no shared bead defining stdout-section ordering. **Amendment**: see epic-level `hook-composition-contract`.

### HIGH

- **`briefing-writer.ac1`** "approximately 500ms debounce" — name a concrete value (`DEBOUNCE_MS = 500`) and require it be exported as a constant so the test can import it. "Approximately" + magic numbers is a CLAUDE.md anti-pattern.
- **`registry-classification.ac1`** says the classifier "does not blocking user-visible issue creation on failure" — good intent, but `pan issue create` is synchronous CLI today. Specify whether the classifier runs in-process (and fails open) or via a queued worker (and lags by N seconds). Also: the cost mention "~$0.001 per issue" in the PRD assumes Haiku, but Overdeck's config policy is *no `--model`* (CLAUDE.md). The bead should resolve via `agents.classification.model` config key, not hardcode Haiku.
- **`home-route-shell.ac2`** moves `/` to Home and `/pipeline` to Pipeline. This is a routing breaking change — every external bookmark + every dashboard skill reference to `/` currently expects the existing default. Add an AC: "All in-repo references to the prior default route are updated, and dashboard-issued links continue to resolve."
- **`compliance-stop-audit` depends on a Stop hook that emits turn-level data**. The current Stop hook at `sync-sources/hooks/stop-hook` emits agent-level events, not full turn records with `toolCalls[0]`. The bead has no AC that says "Stop hook payload contract must expose `lastUserMessage` and `toolCalls`." Add an AC; otherwise the implementer will discover the gap mid-bead.
- **No test bead for the briefing wrapper file content** — only `briefing-assembler.ac5` snapshots output. Add an integration test that spawns a Claude Code session and inspects `--append-system-prompt-file` arguments via the launcher generator's test surface.

### LOW

- `home-registry-panel.ac4` "Panel errors are localized to the registry card" — name an error boundary component (React `ErrorBoundary`) or specify the swallow-and-log strategy.
- `compliance-cli.ac2` "where existing memory CLI filters make that practical" — too vague. Drop or commit to specific filter flags.
- `home-route-tests.ac4` says "isolated Playwright browser/profile" — same comment as 1201, name the mechanism.

### Cross-plan integration risks

- **PAN-1203 hook collision** (above).
- **PAN-1201 launcher multi-file** (above).
- **PAN-1052 observation schema invention** (above, critical).
- **`pan install` overlap** with 1203 install-materialization.

---

## PAN-1205 — HTML artifacts

The most complete plan structurally. Dependencies are clean (DAG-shape: `contracts → store + validator → publish → CLI + serve + API → tab + thumb → e2e`). Concerns are mostly around security review depth and the Traefik change.

### CRITICAL (must amend before wave 2)

- **`raw-artifact-serving.ac3`** prescribes CSP `default-src 'self' 'unsafe-inline' data: https:` (from PRD line 134) but the bead ac says "self, inline artifact code, data URLs, and HTTPS assets while preventing access to dashboard-origin cookies and storage." That's a CSP *and* a cookie-isolation requirement. Cookie isolation comes from the separate origin, not CSP. **Amendment**: split into two ACs — (a) CSP header exact value, (b) Playwright assertion that an iframe at `artifacts.pan.localhost/a/<slug>` cannot read cookies set on `pan.localhost`. Today these are conflated and the test will be ambiguous.
- **`artifact-traefik-origin`** modifies the Traefik dynamic template. Per workspace-container rules and the `single-deacon-invariant`, any Traefik change has to be tested in *both* a fresh host install and a workspace devcontainer that comes up via the template. Add an AC: "Workspace devcontainer template at `infra/.devcontainer-template/docker-compose.devcontainer.yml.template` is updated if and only if the artifact subdomain needs to resolve from inside the container." Likely it doesn't — but commit to "no" explicitly so a future agent doesn't add a mount.

### HIGH

- **`artifact-validation-library.ac2`** lists the regex set from the PRD. The Anthropic key pattern in the PRD is `sk-ant-(api03|admin01)-[A-Za-z0-9_-]{86,}` — this is correct as of 2026, but the AC doesn't say "test each pattern against a known-positive and a known-negative fixture." Tighten: "Each PRD regex has ≥1 positive and ≥1 negative fixture in `tests/fixtures/artifacts/secrets/`."
- **`artifact-thumbnail-cache.ac1`** requires Playwright browser context per artifact. The dashboard server already imports Playwright for UAT (per `mcp.json`). Confirm the thumbnail generator runs in a *headless* Chromium and *not* the user's profile — add explicit AC.
- **No bead handles cleanup/retention.** The PRD mentions `unsharedAt` preserves files; what about *deleted* artifacts? If `~/.overdeck/artifacts/index.sqlite` grows unbounded, this becomes a future cleanup issue. Add a low-priority bead `artifact-retention-policy` or explicitly defer to Phase 2 in the spec narrative.
- **`workspace-artifacts-api.ac3` says "existing dashboard auth/CSRF protections"** — but the dashboard's auth model for local-only operation is "trust localhost + internal token." For a publicly-shareable artifact URL (Phase 2 tunneling), the unshare endpoint becomes a remote-exploitable surface. Add an AC pinning v1 unshare to localhost-only origin checks.
- **`artifact-e2e-verification.ac4`** "Concurrent create/publish tests prove two artifacts do not collide on slug" — slug generation is 8-char base32 = 32^8 ≈ 1e12 keys, collisions are astronomically rare but the AC needs to commit to the collision-retry strategy (`UNIQUE` constraint + retry N times) tested by mocking the random source.

### LOW

- `artifacts-cli-read-commands.ac4` mentions "platform opener without blocking tests" — name `xdg-open` and a test stub.
- `dashboard-artifacts-tab.ac4` lists frontend tests; add explicit coverage of the unshare action propagating to the cache.
- The autoDecision pinning `~/.overdeck/artifacts/index.sqlite` separate from `panopticon.db` is right, but the spec doesn't have a migration bead for "what happens when the index file is missing/corrupt on dashboard boot" — add to `artifact-index-store` ACs.

### Cross-plan integration risks

- **vs PAN-1201**: config schema. PAN-1205 reads `traefik.domain` (already on main per `src/lib/config.ts:205`), no schema change. Confirms no conflict.
- **vs PAN-1204**: the Home tab does not surface artifacts yet (correctly — artifacts go in the workspace drawer). No conflict.
- **vs PAN-1203**: none. Artifacts and docs RAG operate on disjoint subsystems.

---

## Cross-Plan / Epic-Level Findings

### Integration risks not localizable to one plan

1. **`sync-sources/hooks/user-prompt-submit-hook` is shared, modified by 1203 and 1204.** Today the script POSTs to `/api/memory/inject` and emits the response. Both plans add a second emission. Without a shared composition contract, the section ordering and double-injection prevention are undefined.
2. **`~/.overdeck/config.yaml` schema is modified by 1201 (`context.*`), 1203 (`docs.*`), 1204 (`compliance.*`)**. Three independent agents editing `src/lib/config-yaml.ts` will produce three independent normalizers and one will land first; the others will rebase-conflict. The work-agent rebase flow can handle that, but the design quality is poor — better to land one bead first that establishes the section-extension pattern.
3. **`src/lib/launcher-generator.ts` `appendSystemPromptFile` is single-valued.** PAN-1204 needs to pass *two* files (workspace.md from 1201 + session-context.md from 1204). Whichever ships second will silently overwrite the other in the launcher template. **No spec owns this.**
4. **`MemoryObservation` schema invention by PAN-1204** (above). PAN-1052 is on main and stable; new free-form fields would either break the schema or get silently ignored by the read model.
5. **`pan install` is modified by 1203 (docs-index materialization) and 1204 (briefing setup) and 1205 (Traefik artifacts route).** Three concurrent edits to one file.

### Suggested epic-level beads

- **`epic/hook-composition-contract`** (parent of `docs-hook-injection` and `prompt-briefing-refresh`): Define the `<overdeck-memory>` → `<overdeck-briefing-update>` → `<overdeck-docs>` stdout section ordering; define idempotency (each section emits at most once per turn); update `sync-sources/hooks/user-prompt-submit-hook` to compose these from a single shell function `pan_compose_injection`. Both downstream beads depend on this.
- **`epic/launcher-multi-append`** (parent of PAN-1201 workspace injection and PAN-1204 briefing injection): Extend `LauncherGeneratorConfig.appendSystemPromptFile: string` → `appendSystemPromptFiles: string[]` in `src/lib/launcher-generator.ts`. Order: workspace.md first, session-context.md second. Tests assert the concatenated `--append-system-prompt-file` args appear in expected order.
- **`epic/config-yaml-namespace`** (parent of 1201, 1203, 1204 config sections): Land a single PR that extends `src/lib/config-yaml.ts` with empty stubs for `context`, `docs`, `compliance` namespaces and their TypeScript types. Then each downstream plan fills in its own section without conflicting.
- **`epic/compliance-observation-schema`** (parent of PAN-1204 compliance subsystem): Decide whether `compliance.miss` (a) reuses `MemoryObservation` with `tags: ['compliance', 'miss']` + `actionStatus: 'compliance.miss'`, or (b) gets a sidecar JSONL store at `~/.overdeck/compliance/misses.jsonl`. Author this decision into the spec narrative or a new bead before `compliance-stop-audit` starts.
- **`epic/install-touchpoints`** (parent of all three installer changes): Audit `src/cli/commands/install.ts` for the touch surface across 1203/1204/1205 and serialize. Optionally introduce a `registerInstallStep(name, fn)` pattern so each subsystem registers itself.

---

## Ready-to-Run Amendments

The beads below are additive and safe to run immediately. They do **not** modify the existing immutable specs; they extend the dependency DAG via new beads.

```bash
# Hook composition shared contract — blocks 1203's docs-hook-injection and 1204's prompt-briefing-refresh
cd workspaces/feature-pan-1203 && bd create -t feature "hook-composition-contract — define UserPromptSubmit stdout section ordering and idempotency" \
  --priority critical \
  --tags hooks,cross-plan \
  --description "Owns sync-sources/hooks/user-prompt-submit-hook section layout: <overdeck-memory> → <overdeck-briefing-update> → <overdeck-docs>. Add pan_compose_injection helper. Each section emits at most once per turn. Required by PAN-1203 docs-hook-injection and PAN-1204 prompt-briefing-refresh."

# Launcher multi-file extension — blocks PAN-1204 harness-briefing-injection
cd workspaces/feature-pan-1201 && bd create -t feature "launcher-multi-append — extend LauncherGeneratorConfig to accept multiple --append-system-prompt-file" \
  --priority critical \
  --tags launcher,cross-plan \
  --description "src/lib/launcher-generator.ts currently supports one appendSystemPromptFile. Change to appendSystemPromptFiles: string[], emitting one --append-system-prompt-file per entry in the order given. Update existing callers. Add tests that verify two-file ordering (workspace.md first, session-context.md second)."

# Compliance observation schema decision — blocks PAN-1204 compliance-stop-audit
cd workspaces/feature-pan-1204 && bd create -t decision "compliance-observation-schema — pick MemoryObservation tags vs sidecar JSONL for compliance.miss" \
  --priority critical \
  --tags memory,schema,cross-plan \
  --description "MemoryObservation has no observationType field. Either (a) reuse it with tags:['compliance','miss'] + actionStatus:'compliance.miss', or (b) sidecar at ~/.overdeck/compliance/misses.jsonl. Decide before compliance-stop-audit starts."

# Config schema stub — informs 1201 + 1203 + 1204
cd workspaces/feature-pan-1201 && bd create -t feature "config-yaml-namespace-stubs — pre-land empty context/docs/compliance config sections" \
  --priority high \
  --tags config,cross-plan \
  --description "Land a single small PR adding empty stub interfaces for context, docs, compliance config namespaces to src/lib/config-yaml.ts so the three downstream plans don't rebase-collide. Each section can be filled in by its respective plan."

# Path-traversal fuzz for PAN-1201 dashboard routes
cd workspaces/feature-pan-1201 && bd create -t test "context-routes-traversal-fuzz — defend allowlist against ../, symlinks, URL-encoded escapes" \
  --priority high \
  --tags security,dashboard \
  --description "context-dashboard-tests.ac1 says 'cannot escape allowlist' — strengthen to require explicit fuzz inputs: ../../../etc/passwd, symlinked targets, URL-encoded ..%2F, absolute paths outside the allowlist. Test must verify the route rejects each."

# Anthropic key + secret regex fixture coverage for PAN-1205
cd workspaces/feature-pan-1205 && bd create -t test "secret-scanner-fixture-corpus — positive+negative fixtures for every PRD regex" \
  --priority high \
  --tags security,artifacts \
  --description "artifact-validation-library.ac2 lists patterns but doesn't enforce coverage. Add tests/fixtures/artifacts/secrets/{positive,negative}/ with at least one file per pattern (AWS, GH PAT, GH OAuth, GH fine-grained, Anthropic, OpenAI, Slack, private key, .env-style)."

# CSP vs cookie-isolation split for PAN-1205
cd workspaces/feature-pan-1205 && bd create -t test "raw-artifact-csp-vs-origin-isolation — separate CSP header test from cookie-isolation test" \
  --priority high \
  --tags security,artifacts \
  --description "raw-artifact-serving.ac3 conflates CSP and cookie isolation. Split: (a) HTTP integration test asserting Content-Security-Policy header equals expected exact value; (b) Playwright test setting cookie on pan.localhost, loading /s/<slug>, asserting iframe at artifacts.pan.localhost/a/<slug> cannot read document.cookie or localStorage."

# Pi blocker escalation for PAN-1203
cd workspaces/feature-pan-1203 && bd create -t followup "pi-docs-injection-blocker-escalation — concrete escalation path if Pi has no prompt-submit API" \
  --priority high \
  --tags pi,blocker \
  --description "pi-docs-injection.ac3 says 'agent reports a blocker' but doesn't specify the path. If Pi blocks, file a follow-up issue against mariozechner/pi-coding-agent (or our fork), link it from verification.ac3, and mark this bead complete with a deferred-acceptance note."

# docs budget-check/budget-bump CLI subcommands for PAN-1203
cd workspaces/feature-pan-1203 && bd create -t feature "docs-budget-cli-subcommands — pan docs budget-check and budget-bump" \
  --priority high \
  --tags docs,cli \
  --deps docs-cli \
  --description "The PRD hook script invokes 'pan docs budget-check' and 'pan docs budget-bump' but docs-cli ACs only list query/reindex/disable/enable/status. Add these two subcommands or refactor the hook to inline the budget logic via pan docs query --budget-aware."
```

## Verdict

- **PAN-1201**: AMEND-THEN-PROCEED. Scope narrowing is correct, but the launcher multi-file gap and missing PRD acceptance reconciliation are blockers for the epic-level coherence even if not for this plan in isolation.
- **PAN-1203**: AMEND-THEN-PROCEED. Hook composition contract and the missing `budget-check`/`budget-bump` CLI subcommands are wave-1 blockers (downstream hook bead will fail without them).
- **PAN-1204**: PAUSE-AND-REPLAN around compliance schema. The `compliance.miss` observation invention is a foundational design hole that will burn implementation effort. Decide the schema first (sidecar vs tags) and amend `compliance-stop-audit` + `compliance-advisory-warning` ACs before letting the work agent touch them. Rest of the plan (Home tab, registry, briefing) is PROCEED with the launcher and hook-composition amendments.
- **PAN-1205**: PROCEED with the three test-strengthening amendments above. The plan is structurally sound; the amendments tighten security ACs and add coverage but do not change the design.

Closing note: all four plans have a common shape — broad scope, vague-but-testable ACs, and an implicit "the work agent will figure out the integration." The epic-level beads above explicitly own the integration so the work agents don't have to negotiate it inline.
