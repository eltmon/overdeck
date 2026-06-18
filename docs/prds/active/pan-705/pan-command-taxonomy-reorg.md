# Command Taxonomy Reorganization

## Problem

`pan` has accumulated commands organically and the top-level surface no longer maps to how users think about their work. Three concrete symptoms:

1. **`pan work` is a junk drawer.** It mixes lifecycle stages (`plan`, `issue`, `done`, `approve`, `close-out`), runtime controls (`tell`, `kill`, `recover`, `resume`), review-loop plumbing (`request-review`, `reset-review`, `reset-session`, `pending`), state queries (`shadow`, `cv`, `context`, `health`, `refresh`), and internal hooks (`hook`, `tldr`). A user has to know which bucket a command lives in before they can run it.

2. **Lifecycle is split across nesting levels.** `pan work plan <id>` creates a plan but `pan plan-finalize <id>` finalizes it — same verb, different depths. `pan inspect <id>` is top-level but `pan work done <id>` is nested. `pan status` is top-level but `pan work pending` is nested. There's no consistent rule.

3. **Plumbing crowds the happy path.** `cloister`, `specialists`, `beads`, `db`, `remote`, `migrate-config`, `sync-costs`, `config` all sit at the top level next to user-facing verbs like `status` and `up`. `pan --help` reads as "everything Overdeck can do" rather than "things you'd reach for today."

**Impact:**
- New users can't discover commands by guessing. Existing users rely on muscle memory that newcomers don't have.
- Docs and skills reference inconsistent paths, so rename churn is constant.
- Every new command triggers a mini-debate about where it should live, because there's no taxonomy to defer to.

## Decision

Reorganize the command surface around a **five-bucket taxonomy** with one explicit plumbing namespace:

1. **Issue lifecycle** — top-level verbs that take `<id>` as their object.
2. **Observation** — `pan status`, `pan show <id>`, `pan review`.
3. **Managed nouns** — `pan workspace`, `pan project`, `pan convoy`, `pan cost`, `pan test`.
4. **System/daemon + first-run** — `pan up`/`down`/`serve`, `pan init`/`install`/`setup`/`doctor`/`update`/`sync`/`backup`/`restore`.
5. **`pan admin`** — all plumbing (cloister, specialists, remote infra, db, beads, tracker, config, hooks, tldr, fpp, migrate-config).

**Key collapses:**
- `pan work shadow|cv|context|health|refresh` → `pan show <id>` with flags.
- `pan work reset-review` + `pan work reset-session` → `pan review reset <id>` with `--session` / `--cycles`.
- `pan plan-finalize` → `pan plan finalize` (subcommand under the same verb).
- `pan work list` + `pan work triage` → `pan issues`.
- `pan sync-costs` → `pan cost sync` only (drop the alias).

No muscle-memory aliases. Clean break. Documented migration table.

See [docs/QUICK-REFERENCE.md](../../QUICK-REFERENCE.md) for the full target surface, including the legacy→new migration table.

---

## Design principles

1. **Top-level verbs act on issues.** If the user's question is "advance this issue," they shouldn't have to pick the right sub-noun.
2. **Noun-first groups manage the noun itself.** `pan workspace destroy` is about the workspace. `pan wipe <id>` is about the issue.
3. **`pan admin` holds plumbing.** If a command is on the happy path, it's not admin — promote it out. Resist the temptation to dump commands there just because they're less common.
4. **One verb = one question.** `pan show <id>` collapses four old subcommands because "what's going on with this issue?" is a single question.
5. **Destructive commands confirm.** `wipe`, `destroy`, `emergency-stop`, `clear-queue` all require explicit confirmation — no behavior change, just a consistency rule.

---

## Target surface (summary)

Full detail in [QUICK-REFERENCE.md](../../QUICK-REFERENCE.md). Summary:

**Lifecycle verbs** (15): `issues`, `plan` (+ `plan finalize`), `start`, `tell`, `resume`, `recover`, `kill`, `sync-main`, `done`, `approve`, `inspect`, `close`, `reopen`, `wipe`.

**Observation** (3 groups): `status`, `show <id>` (with `--cv` / `--context` / `--health` / `--shadow` flags), `review` (`pending` / `request` / `reset`).

**Managed nouns** (5): `workspace`, `project`, `convoy`, `cost`, `test`.

**System** (3): `up`, `down`, `serve`.

**First-run/maintenance** (8): `init`, `install`, `setup`, `doctor`, `update`, `sync`, `backup`, `restore`.

**`pan admin`** (11 groups): `cloister`, `specialists`, `remote`, `db`, `beads`, `tracker`, `config`, `hooks`, `tldr`, `fpp`, `migrate-config`.

---

## Implementation plan

### Phase 1 — Scaffolding (non-breaking)

1. Introduce the new command registrations alongside the existing ones. Every new path invokes the same underlying handler as its legacy counterpart — no logic changes.
2. Add a shared `resolveIssueId()` helper so every lifecycle verb parses `<id>` the same way.
3. Add `--help` text for every new command, mirroring the old.
4. Land `docs/QUICK-REFERENCE.md` (this PR) and link from `docs/INDEX.md`.

**Exit criteria:** Both old and new invocations work. Tests pass. No user-visible change yet.

### Phase 2 — Collapse commands

5. **`pan show <id>`** — new file `src/cli/commands/show.ts`. Default view: compact summary (shadow state, current specialist, last heartbeat, most recent cv entry). Flags `--cv`, `--context`, `--health`, `--shadow`, `--json` scope the output. Handlers delegate to the existing shadow/cv/context/health code.
6. **`pan review`** — new file `src/cli/commands/review.ts`. Subcommands `pending`, `request <id>`, `reset <id>` (with `--session` / `--cycles`). Delegate to existing handlers.
7. **`pan issues`** — new file `src/cli/commands/issues.ts`. Merge the current `work list` and `work triage` into one command with `--triage` flag (or `issues triage` subcommand — decide during implementation).
8. **`pan plan`** — promote `work plan` + `plan-finalize` into a top-level `plan` command group with `plan <id>` (default, creates plan) and `plan finalize <id>` subcommand.

**Exit criteria:** New collapsed commands match legacy behavior 1:1 in integration tests.

### Phase 3 — Rename lifecycle verbs

9. Promote `work issue` → `start`, and strip the `work` prefix from `tell`, `resume`, `recover`, `kill`, `sync-main`, `done`, `approve`, `reopen`, `wipe`, `close-out` (→ `close`). `inspect` stays top-level.
10. Delete `work` as a command group. If it's still referenced anywhere, a stub handler prints the migration table and exits 1.

**Exit criteria:** `pan work` no longer exists. All lifecycle commands are top-level.

### Phase 4 — `pan admin` namespace

11. Create `pan admin` command group. Move `cloister`, `specialists`, `remote`, `db`, `beads`, `config`, `migrate-config` under it.
12. Create `pan admin tracker` subgroup. Move `linear-states` and `linear-cleanup` from `work` under it.
13. Create `pan admin hooks` (from `setup hooks`), `pan admin tldr` (from `work tldr`), `pan admin fpp` (from `work hook`).
14. Delete top-level entries for the migrated groups.

**Exit criteria:** `pan --help` shows ~28 top-level names. Plumbing is under `pan admin`.

### Phase 4.5 — Dashboard alignment

The dashboard is the other user-facing surface and must stay in lockstep with the CLI. Leaving it behind means users see "pan work …" hints in the UI while the CLI speaks the new verbs. Fix it all in this issue, not as a follow-up.

**HTTP routes:**

14a. Rename backend HTTP routes in `src/dashboard/server/routes/` to match the new verbs. `/api/work/*` → split into `/api/issues/*` (for lifecycle verbs like start/done/approve/close/reopen/wipe/tell/kill/resume/recover/sync-main/inspect), `/api/review/*` (pending/request/reset), `/api/show/*` (unified observation), and `/api/admin/*` (plumbing endpoints). Route handlers stay the same — this is a URL-level rename plus router wiring, not a logic change.
14b. Update `packages/contracts/` RPC types and the Effect RPC group definitions in `src/dashboard/server/ws-rpc.ts` to match the new verb names. Contract changes propagate to the frontend via the generated client.
14c. Update the frontend RPC client in `src/dashboard/frontend/src/` (Zustand store, `WsTransport.ts`, `EventRouter.tsx`) to call the renamed routes and subscribe to the renamed event names.
14d. Update integration tests in `src/dashboard/server/services/__tests__/` that hit the old route paths.

**UI strings:**

14e. Grep the frontend for hardcoded `pan work ...`, `pan cloister ...`, `pan plan-finalize`, etc. in shell hint components, copy-to-clipboard snippets, empty-state help text, onboarding flows, and the inspector panel. Replace with new verbs.
14f. Update kanban card action labels and inspector panel actions that trigger backend routes to use the new verb names in their UI copy and tooltips.

**First-launch announcement** (moved here from Phase 6):

14g. Add a one-time upgrade announcement banner on first dashboard launch after upgrade. Renders the migration table from QUICK-REFERENCE.md inline, dismissible, persisted to localStorage. Implemented as a component under `src/dashboard/frontend/src/components/upgrade-announcement/`.

**Exit criteria:** All `/api/work/*` routes removed. No frontend grep hits for legacy command strings. Dashboard integration tests green. First-launch announcement renders and dismisses correctly. `pan up && open https://pan.localhost` shows the announcement on first visit after upgrade.

### Phase 5 — Docs and tests

15. Update every doc in `docs/` that references an old command path. Priority order: `USAGE.md`, `INDEX.md`, all `PRD-*.md`, all `prds/active/*.md`.
16. Update hook scripts in `scripts/` and any Overdeck-installed shell aliases.
17. Add a snapshot test of `pan --help` output so future drift is caught.
18. Update the `pan doctor` check to flag any remaining legacy invocations in user config.

**Exit criteria:** No doc references a legacy command path. `pan doctor` is clean.

### Phase 5.5 — Claude Code skill alignment

The distributed skills (`pan sync` writes ~60 into `~/.claude/skills/`) are the other surface users touch via Claude Code slash commands. Today they drift from the CLI in three ways:

1. **No umbrella `/pan` skill.** Typing `/pan` in Claude Code returns "Unknown skill: pan" — there's no single entry point, just 60 siblings. Users who don't know the exact skill name dead-end.
2. **Skill names don't match the new CLI verbs.** `pan-work-kill`, `pan-plan-finalize`, `pan-tldr`, `pan-rescue` all map to commands that are moving or disappearing. Muscle memory breaks twice if we don't rename in lockstep.
3. **Skill descriptions are narrative.** Slash-menu fuzzy search finds skills by description text, so a user searching `/kill` might miss `pan-work-kill` because the description reads "Stop a running agent" instead of leading with `pan kill <id>`.

**Steps:**

19. **Create a top-level `pan` skill.**
    - When invoked bare (`/pan`): prints the six-bucket taxonomy from `QUICK-REFERENCE.md` as an index.
    - When invoked with args (`/pan start PAN-415`, `/pan show PAN-705`, `/pan admin cloister status`): dispatches to the matching CLI invocation.
    - Lives in the distributed skills set so `pan sync` ships it.
20. **Rename skills to match the new CLI verbs 1:1.**
    - Drop `pan-work-*` prefix: `pan-work-kill` → `pan-kill`, `pan-work-done` → `pan-done`, etc.
    - Collapse `pan-plan` + `pan-plan-finalize` → one `pan-plan` skill that takes a `finalize` subcommand.
    - Move plumbing under an `admin` namespace in the filename: `pan-cloister` → `pan-admin-cloister`, `pan-tldr` → `pan-admin-tldr`, `pan-rescue` → `pan-admin-rescue`, etc.
    - Delete skills whose commands are being dropped (legacy aliases, `sync-costs`, etc.).
21. **Keep ~8–10 high-traffic shortcuts flat.** `pan-status`, `pan-plan`, `pan-start`, `pan-show`, `pan-review`, `pan-done`, `pan-approve`, `pan-close`, `pan-issues`. These stay directly discoverable in the slash menu. The long tail (admin/plumbing) is reachable only via `/pan admin …` through the umbrella skill, so the slash menu stops being a wall of `pan-*`.
22. **Rewrite every skill description to lead with the literal CLI.** Format: `"pan <verb> <args> — one-line what it does"`. This makes fuzzy search work from both directions (by verb name or by description).
23. **Add a snapshot test** that locks the set of synced skill names so future drift is caught alongside `pan --help` drift.
24. **Update `pan sync`** to delete legacy skill files from `~/.claude/skills/` on next run so upgrading users don't end up with both old and new copies side-by-side.

**Exit criteria:**
- `/pan` in Claude Code opens the umbrella skill, not "Unknown skill."
- `/pan start PAN-415` works end-to-end via the umbrella.
- The ~8–10 flat shortcut skills are directly discoverable and their descriptions lead with the CLI.
- `pan sync` produces a clean slate — no legacy skill filenames on disk.
- Snapshot test locks the synced skill set.

### Phase 6 — Release

20. Bump minor version (this is a breaking change to command surface, but we're pre-1.0 so minor is fine).
21. CHANGELOG entry with the full migration table.
22. Verify the dashboard first-launch announcement from Phase 4.5 renders correctly after upgrade.

---

## Risks and mitigations

### Risk: breaking existing user scripts
**Mitigation:** Pre-1.0, clean break is acceptable per engineering philosophy (no backwards-compat shims). Ship the migration table prominently. The `pan doctor` check flags leftover legacy invocations in shell rc files and Claude skill configs.

### Risk: `pan show <id>` default view becomes a dumping ground
**Mitigation:** Design the default view explicitly as part of Phase 2 — not "print everything." Target ~15 lines: one line of shadow state, current specialist + last heartbeat, top 3 cv entries, health summary. Flags expand each section. If the default grows past 25 lines in review, it's wrong.

### Risk: Skill authors outside this repo
**Mitigation:** The skill distribution system (`pan sync`) means we own the canonical copies. Third-party skill authors will see the CHANGELOG. Pre-1.0, they're on notice.

### Risk: Incomplete rename creates a worse state than the current one
**Mitigation:** Each phase has explicit exit criteria. Don't start Phase N+1 until Phase N is complete. Phase 1 is non-breaking, so we can pause there if priorities shift without leaving the codebase half-migrated.

### Risk: Bikeshedding on verb names during review
**Mitigation:** The verbs in this PRD are final. `start` (not `spawn` or `run`), `close` (not `finish`), `show` (not `inspect` — that's taken). If there's a strong argument to change one, file it as a comment on this PRD before Phase 3 starts; don't re-open during implementation.

---

## Out of scope

- **Renaming the `pan` binary itself** or introducing alternative binary names.
- **Changing the config file format** (`~/.panopticon/config.yaml` schema stays as-is).
- **Changing how issue ids are parsed.** Deferred to the separate [`flexible-tracker-id-resolution`](./flexible-tracker-id-resolution.md) PRD, which addresses Rally-style dash-less IDs.
- **Translating the CLI to a TUI or interactive shell.**
- **Re-architecting the dashboard.** The dashboard UI *is* in scope (see Phase 4.5) for renaming routes, updating command strings, and adding the first-launch announcement — but component-level redesign, layout changes, or new views are not part of this issue.

---

## Acceptance criteria

- [ ] `pan --help` output matches the target surface from QUICK-REFERENCE.md
- [ ] `pan work` is fully gone (not even a stub at end of Phase 3)
- [ ] `pan show <id>` default view is ≤ 25 lines and covers shadow/specialist/heartbeat/cv
- [ ] `pan admin` groups all plumbing under one namespace
- [ ] All `docs/` files updated; no ripgrep hits for legacy paths in `docs/`
- [ ] Snapshot test locks `pan --help` output
- [ ] `pan doctor` flags legacy invocations in user shell rc
- [ ] All `/api/work/*` HTTP routes removed; backend routes match new verbs (`/api/issues/*`, `/api/review/*`, `/api/show/*`, `/api/admin/*`)
- [ ] `packages/contracts/` and frontend RPC client updated to new route names
- [ ] Dashboard integration tests green
- [ ] No frontend grep hits for legacy command strings (`pan work`, `pan cloister`, `pan plan-finalize`, etc.)
- [ ] Kanban card actions and inspector panel use new verb names in UI copy
- [ ] First-launch upgrade announcement renders migration table and persists dismissal to localStorage
- [ ] Umbrella `/pan` skill exists and dispatches subcommands (`/pan start PAN-415` works)
- [ ] All distributed skills renamed to match new CLI verbs 1:1
- [ ] ~8–10 flat shortcut skills; long-tail admin skills reachable only via umbrella
- [ ] Every skill description leads with the literal CLI invocation
- [ ] `pan sync` deletes legacy skill files on upgrade (clean slate)
- [ ] Snapshot test locks the synced skill set
- [ ] CHANGELOG entry with full migration table
- [ ] Dashboard first-launch announcement after upgrade
