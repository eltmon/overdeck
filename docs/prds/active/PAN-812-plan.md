# PAN-812: Upgrade beads to v1.0.2 and integrate new features

## Status: Investigation Complete

## Problem Statement

Panopticon is running beads v0.62.0 (released 2026-03-22). Latest upstream is v1.0.2 (released 2026-04-15) — 8 releases behind. Our beads skill is v0.43.0, severely outdated. Agents are making repeated `bd` command mistakes due to stale documentation, wasting tokens and producing incorrect results.

### Agent Mistake Patterns (from transcript audit)

| Mistake | Count | Root Cause |
|---------|-------|------------|
| `bd claim` → "unknown command" | 12 errors / 16 attempts | Upstream docs incorrectly list `bd claim` as a command; skill lacks warning |
| `bd close` blocked by deps → use `--force` | 55 instances | No guidance to check `bd dep tree` before closing |
| Confusing `pan` vs `bd` commands | 148+ errors | No clear separation in agent docs |
| `bd gate create --await ...` | Multiple | `ASYNC_GATES.md` documents a subcommand that does not exist |
| `bd move` / `bd refile` | Unknown | Commands removed in v1.0.2, docs not updated |

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Upgrade target | beads v1.0.2 | Latest stable; 8 releases of bug fixes and features |
| Skill version | v1.0.0 (new major) | Breaking changes from v0.43.0 warrant major bump |
| Gate integration | Phase 2 (after upgrade) | Requires custom type registration and framework changes |
| Batch integration | Phase 1 (with upgrade) | Low risk, high value for bulk operations |
| Rules audit | Phase 3 (post-upgrade) | New feature, needs validation in Panopticon context |
| Backward compat | Verify `.beads/` databases open cleanly | v1.0.2 uses Dolt under the hood; schema may have evolved |
| `bd claim` handling | Remove all references, add red warning | Command never existed; `bd update <id> --claim` is correct |
| Sync semantics | Standardize on `bd sync` | `AGENTS.md` currently says `bd dolt push` in one place and `bd sync` in another |

## Investigation Findings

### 1. Beads Version Gap

| Component | Current | Target | Gap |
|-----------|---------|--------|-----|
| beads CLI | v0.62.0 | v1.0.2 | 8 releases |
| beads skill | v0.43.0 | v1.0.0 (planned) | 57 minor versions |
| Required CLI | v0.34.0+ (skill says) | v0.62.0+ | Skill underspecified |

### 2. `bd gate` Mechanics (Correct)

**Creation:**
```bash
# Register custom type (one-time per project)
bd config set types.custom '["gate"]'

# Create a gate
bd create "Approve production deploy" --type gate
```

**Monitoring:**
```bash
bd gate list              # Open gates
bd gate list --all        # Include closed
bd gate show <id>         # Details
bd gate check             # Auto-evaluate and close resolved gates
bd gate check --dry-run   # Preview
```

**Resolution:**
```bash
bd gate resolve <id> --reason "Approved by Steve"   # Human approval
bd gate resolve <id> --reason "CI passed"             # Manual close
```

**Gate types:**
| Type | Auto-resolve? | Mechanism |
|------|---------------|-----------|
| `human` | No | Requires `bd gate resolve` |
| `timer` | Yes | When timeout reached |
| `gh:run` | Yes | When GitHub Actions run succeeds/fails |
| `gh:pr` | Yes | When PR merged/closed |

**Blocking behavior:**
- Gates are issues with `type=gate` that other issues depend on
- `bd ready` excludes issues blocked by open gates
- `bd close` fails with "gate condition not satisfied (use --force to override)"
- `bd gate check` evaluates conditions and auto-closes resolved gates

### 3. `bd batch` Mechanics

**What it does:** Run multiple write operations in a single Dolt transaction.

**Syntax:**
```bash
# From file
bd batch -f commands.txt

# From stdin
cat <<'EOF' | bd batch
close bd-abc
close bd-def
close bd-ghi
EOF
```

**Supported commands:** `close`, `update`, `create`, `dep add`, `dep remove`

**Benefits:** Atomic (all succeed or all roll back), one DOLT_COMMIT, faster than N separate calls.

**Panopticon use case:** `done-preflight.ts` currently loops over beads and closes them one-by-one. `bd batch` can close all beads for an issue atomically.

### 4. `bd rules audit/compact` Mechanics

**`bd rules audit`:**
```bash
bd rules audit                    # Scan .claude/rules/ for contradictions
bd rules audit --threshold 0.8    # Stricter matching
```

**`bd rules compact`:**
```bash
bd rules compact --auto           # Merge related rules automatically
bd rules compact --dry-run        # Preview
```

**Panopticon use case:** Run during `pan sync` to catch conflicting agent instructions (e.g., one rule says "use `bd claim`", another says "use `bd update --claim`").

### 5. Skill/Doc Issues Catalog

| Issue | Location | Wrong Content | Correct Content |
|-------|----------|---------------|-----------------|
| `bd claim` | `skills/beads/SKILL.md` (via upstream) | Lists `bd claim` | `bd update <id> --claim` |
| `bd gate create` | `skills/beads/resources/ASYNC_GATES.md` | `bd gate create --await human:...` | `bd create "Title" --type gate` |
| `bd move`/`refile` | `skills/beads/SKILL.md` | References these commands | Removed in v1.0.2 |
| Sync vs push | `AGENTS.md` | Says `bd dolt push` AND `bd sync` | Standardize on `bd sync` |
| Blocker guidance | All skill docs | No mention | Add: "Check `bd dep tree` before closing" |
| Version req | `skills/beads/SKILL.md` | "Requires v0.34.0+" | "Requires v0.62.0+" |

## Architecture

### Current Beads Integration Points

```
Panopticon Framework
├── CLI
│   └── pan admin beads          → bd admin compact --days N
│   └── pan install              → installs bd (currently v0.62.0)
├── Workspace Lifecycle
│   └── done-preflight.ts        → bd list --status open -l "${issueId}"
│   └── vbrief/beads.ts          → bd init --prefix, bd create
│   └── AGENTS.md (injected)     → bd ready, bd show, bd update --claim, bd close, bd sync
├── Cloister / Triggers
│   └── triggers.ts              → bd list --json -l ${issueId} --status closed
├── Skills (synced to ~/.claude/skills/)
│   └── beads/SKILL.md           → v0.43.0 (outdated)
│   └── beads-panopticon-guide/  → PAN-XXX filtering patterns
│   └── beads/resources/         → ASYNC_GATES.md (wrong), AGENTS.md, etc.
└── Templates
    └── claude-md/sections/beads.md  → Injected into workspace CLAUDE.md
```

### Proposed New Integration Points

```
Panopticon Framework (Post-Upgrade)
├── CLI
│   └── pan admin beads          → bd admin compact --days N
│   └── pan install              → installs bd v1.0.2+
│   └── pan doctor               → NEW: bd doctor --fix
├── Workspace Lifecycle
│   └── done-preflight.ts        → bd batch -f /tmp/close-commands.txt
│   └── vbrief/beads.ts          → bd init --prefix, bd create
│   └── AGENTS.md (injected)     → Updated commands, blocker guidance
├── Cloister / Triggers
│   └── triggers.ts              → bd list --json -l ${issueId} --status closed
│   └── gate coordination        → NEW: bd gate check before waking next specialist
├── Skills (synced to ~/.claude/skills/)
│   └── beads/SKILL.md           → v1.0.0 (updated)
│   └── beads-panopticon-guide/  → Updated patterns
│   └── beads/resources/         → Fixed ASYNC_GATES.md, added BATCH.md, RULES.md
└── Templates
    └── claude-md/sections/beads.md  → Updated with blocker guidance, batch, gate basics
```

## Files to Modify

### Skills & Documentation

| File | Changes |
|------|---------|
| `skills/beads/SKILL.md` | Bump version to v1.0.0; fix `bd claim` → `bd update --claim`; remove `bd move`/`refile`; update version req to v0.62.0+; add `bd batch` reference; add blocker guidance |
| `skills/beads/resources/ASYNC_GATES.md` | Rewrite: remove `bd gate create`, document correct `bd create --type gate` flow; add `bd gate check`; add `bd gate resolve`; add custom type registration |
| `skills/beads/resources/BATCH.md` | NEW: Document `bd batch` syntax, supported commands, atomicity guarantees |
| `skills/beads/resources/RULES.md` | NEW: Document `bd rules audit` and `bd rules compact` |
| `skills/beads-panopticon-guide/SKILL.md` | Update version reference; add PAN-XXX batch example; add gate patterns |
| `templates/claude-md/sections/beads.md` | Add blocker guidance (`bd dep tree` before close); mention `bd batch` for bulk ops; clarify `bd sync` |
| `AGENTS.md` | Standardize on `bd sync` (remove `bd dolt push`); add gate quick-ref; add batch quick-ref |

### Panopticon Framework Code

| File | Changes |
|------|---------|
| `src/lib/work/done-preflight.ts` | Use `bd batch` for bulk-close instead of one-at-a-time loop |
| `src/lib/vbrief/beads.ts` | Verify `bd init --prefix` still works with v1.0.2; handle any schema changes |
| `src/cli/commands/beads.ts` | Add `bd doctor --fix` to `pan admin beads doctor` subcommand |
| `src/cli/commands/install.ts` | Update beads install version to v1.0.2 |
| `src/lib/cloister/triggers.ts` | No changes (existing `bd list` calls should still work) |

### Optional Integration (Phase 2+)

| File | Changes |
|------|---------|
| `src/lib/cloister/specialists.ts` | Create gates between specialist handoffs (review → test → merge) |
| `src/dashboard/server/routes/issues.ts` | Add gate status to issue detail endpoint |
| `src/dashboard/frontend/src/components/IssueDetail.tsx` | Display open gates requiring user action |

## Implementation Sequence

```
Phase 1: Upgrade beads CLI and verify compatibility
┌─────────────────────────────────────────────────────────────┐
│ 1a. Install beads v1.0.2 locally                              │
│ 1b. Verify existing .beads/ databases open without errors     │
│ 1c. Update pan install to fetch v1.0.2                        │
│ 1d. Run bd doctor --fix on panopticon-cli repo                │
└─────────────────────────────────────────────────────────────┘
                              │
                              v
Phase 2: Update skills and documentation
┌─────────────────────────────────────────────────────────────┐
│ 2a. Rewrite beads/SKILL.md (v1.0.0)                           │
│ 2b. Fix ASYNC_GATES.md                                        │
│ 2c. Create BATCH.md and RULES.md                              │
│ 2d. Update beads-panopticon-guide                             │
│ 2e. Update templates/claude-md/sections/beads.md              │
│ 2f. Update AGENTS.md                                          │
│ 2g. Sync skills to ~/.claude/skills/                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              v
Phase 3: Update Panopticon framework code
┌─────────────────────────────────────────────────────────────┐
│ 3a. Refactor done-preflight.ts to use bd batch                │
│ 3b. Add pan admin beads doctor subcommand                     │
│ 3c. Verify vbrief/beads.ts compatibility                      │
│ 3d. Update install.ts version pin                             │
└─────────────────────────────────────────────────────────────┘
                              │
                              v
Phase 4: Test and validate
┌─────────────────────────────────────────────────────────────┐
│ 4a. Create test beads, deps, gates in a scratch repo          │
│ 4b. Verify bd batch closes beads atomically                   │
│ 4c. Verify bd gate check auto-closes timer gates              │
│ 4d. Run full pan work flow on a test issue                    │
│ 4e. Check bd rules audit on .claude/rules/                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              v
Phase 5: Optional gate integration (Phase 2+)
┌─────────────────────────────────────────────────────────────┐
│ 5a. Design gate points in specialist pipeline                 │
│ 5b. Implement gate creation in review-agent completion        │
│ 5c. Implement gate waiting in test-agent spawn                │
│ 5d. Dashboard gate visualization                              │
└─────────────────────────────────────────────────────────────┘
```

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| `bd batch` partial failure | Entire transaction rolls back; none of the commands apply |
| `bd gate check` with no gates | No-op, exits 0 |
| `bd doctor --fix` on clean repo | No changes, exits 0 |
| Upgrade from v0.62.0 with existing gates | Gates stored as regular issues; `bd gate list` may not find them if type not registered |
| `bd close` on issue with gate dependency | Fails with "gate condition not satisfied"; agent must resolve gate or use `--force` |
| `bd rules audit` with no `.claude/rules/` | Warning or no-op depending on beads behavior |
| Agent still uses `bd claim` after skill update | Skill explicitly says "NEVER use `bd claim` — command does not exist" |

## Out of Scope

- Cross-project gate dependencies (bead gates removed in v1.0.2)
- Automatic gate polling (use `bd gate check` explicitly, not a daemon)
- beads web UI integration
- Replacing GitHub Issues with beads (strategic decision already made to use both)
- Custom gate types beyond human/timer/gh:run/gh:pr

## Acceptance Criteria

- [ ] beads v1.0.2 installed and `bd --version` reports v1.0.2
- [ ] Existing `.beads/` databases open without migration errors
- [ ] `skills/beads/SKILL.md` updated to v1.0.0 with corrected commands
- [ ] `ASYNC_GATES.md` documents correct gate creation (`bd create --type gate`)
- [ ] `BATCH.md` and `RULES.md` created and synced
- [ ] No references to `bd claim`, `bd move`, or `bd refile` in any Panopticon skill/doc
- [ ] `done-preflight.ts` uses `bd batch` for bulk close
- [ ] `pan admin beads doctor` runs `bd doctor --fix`
- [ ] `AGENTS.md` and `templates/claude-md/sections/beads.md` standardized on `bd sync`
- [ ] Blocker guidance added to all agent-facing docs: "Check `bd dep tree` before closing"
- [ ] Test flow completes successfully on a scratch issue

## Testing Notes

- Test `bd batch` with 3+ beads: verify all close or none close
- Test `bd gate check --dry-run` on a repo with no gates
- Test `bd doctor --fix` on panopticon-cli repo
- Test backward compat: open an old `.beads/` database with v1.0.2
- Test agent docs: grep all skill files for `bd claim`, `bd move`, `bd refile` — should return zero matches
- Test `done-preflight.ts` on a workspace with multiple open beads

## Beads Tasks

| Beads ID | Title | Difficulty | Blocked By |
|----------|-------|------------|------------|
| `pan-569-xlj` | Investigation: beads v1.0.2 features | — | — (done) |
| `panopticon-812a` | Install beads v1.0.2 and verify compat | simple | — |
| `panopticon-812b` | Update beads skill to v1.0.0 | medium | 812a |
| `panopticon-812c` | Fix ASYNC_GATES.md and add BATCH.md/RULES.md | medium | 812a |
| `panopticon-812d` | Update beads-panopticon-guide | simple | 812b |
| `panopticon-812e` | Update AGENTS.md and CLAUDE.md template | simple | 812b |
| `panopticon-812f` | Refactor done-preflight.ts to use bd batch | simple | 812a |
| `panopticon-812g` | Add pan admin beads doctor | simple | 812a |
| `panopticon-812h` | Full test flow validation | medium | 812b–812g |
| `panopticon-812i` | Design gate integration for specialists (Phase 2) | complex | 812h |

**Ready to start (no blockers):**
- `panopticon-812a` - Install and verify (simple)

**Parallelization:**
- Phase 1: `812a` (install/verify)
- Phase 2: After `812a` → `812b`, `812c`, `812f`, `812g` can run in parallel
- Phase 3: After `812b` + `812c` → `812d`, `812e`
- Phase 4: After `812b–812g` → `812h` (validation)
- Phase 5: After `812h` → `812i` (gate integration design)

## References

- Issue: https://github.com/eltmon/panopticon-cli/issues/812
- Beads repo: https://github.com/gastownhall/beads
- Current beads skill: `skills/beads/SKILL.md`
- Panopticon beads guide: `skills/beads-panopticon-guide/SKILL.md`
- ASYNC_GATES.md: `skills/beads/resources/ASYNC_GATES.md`
- done-preflight.ts: `src/lib/work/done-preflight.ts`
- beads CLI command: `src/cli/commands/beads.ts`
- vBRIEF beads integration: `src/lib/vbrief/beads.ts`
- Agent onboarding: `AGENTS.md`
- CLAUDE.md template: `templates/claude-md/sections/beads.md`
