# PAN-1884 — Migrate panopticon agent operational rules from memory into the scope:dev rule/role layer

**Status:** in progress on `main` (operator-authorized direct implementation, 2026-06-14).
**Scope:** immediate. Executed together with PAN-1883 and PAN-1877.
**Audit basis:** [`docs/STATE-STORAGE-AUDIT.md`](../../docs/STATE-STORAGE-AUDIT.md)

> **Executor note (read first).** Two distinct change classes — do not conflate them:
> **(A) tracked repo changes** (`sync-sources/rules/`, `roles/flywheel.md`, `docs/flywheel-brief.md`)
> are committed to git; **(B) local Claude memory mutation** (`~/.claude/projects/.../memory/*.md`)
> is **machine-local, NOT in the repo** — it is not captured by any git commit. "Commit immediately"
> applies to (A) only. Sequence: do (A), `pan sync`, verify, **commit (A)**; then do (B) and **report
> it separately**. Also: `pan sync` writes to `~/.claude/CLAUDE.md` and `~/.panopticon/context/*` —
> **outside the repo**; in a sandboxed harness this may need a permission grant. Treat a permission
> prompt as expected, not a code failure.

---

## Glossary

- **Memory** — `~/.claude/projects/<proj>/memory/*.md`. Local, machine-only; recalled as advisory
  background into ONE conversation. Does NOT govern work/review/flywheel agents. Not in git.
- **Rule layer (tracked):** `sync-sources/rules/<name>.md` (bundled rules, `scope: dev` or
  `universal`), and role files like `roles/flywheel.md` + the startup brief `docs/flywheel-brief.md`.
  `pan sync` renders bundled rules into `~/.claude/CLAUDE.md` (managed region), `pi-global.md`,
  `codex-global.md`.
- **scope:dev** — folds into the managed region only on a panopticon-cli checkout; never ships to
  projects that merely use Panopticon. **All new bundled rules here are `scope: dev`.**

---

## Requirements

- **FR-1** — Each qualifying memory (panopticon agent operational rule) is materialized as a
  `scope: dev` bundled rule under `sync-sources/rules/`, OR added to the flywheel instruction surfaces
  if it is flywheel-orchestrator-specific.
- **FR-2** — Flywheel-orchestrator rules are added to **both** `roles/flywheel.md` **and**
  `docs/flywheel-brief.md`, and existing contradictions between them (wakeup cadence; `pan close`) are
  settled in the same pass.
- **FR-3** — Memories already in the rule layer are slimmed to one-line pointers; the stale
  `planning_artifacts` memory is deleted and de-indexed from `MEMORY.md`.
- **FR-4** — Tracked repo changes (A) build, `pan sync`-render, and **commit immediately**; local
  memory mutation (B) is performed and **reported separately** (not implied to be in the git commit).
- **NFR-1** — Rules are tight (they cost context every dev session); condense the verbose memory prose.
  Match the voice of existing `sync-sources/rules/`.
- **NFR-2** — Scope guard: migrate ONLY panopticon-dev rules designed for/by agents. New bundled rules
  must NOT contradict existing bundled rules (see WI-1 wording cautions).

---

## Migration map

| Source memory | Target (class) | Action |
| --- | --- | --- |
| `feedback_no_oneshot_agents` | `sync-sources/rules/no-oneshot-agents.md` (A) | create |
| `feedback_no_actions_lost` | `sync-sources/rules/additive-refactor-no-loss.md` (A) | create |
| `feedback_facts_not_guessing` | `sync-sources/rules/facts-not-guessing.md` (A) | create |
| `feedback_explain_fully_no_jargon` | `sync-sources/rules/explain-fully-no-jargon.md` (A) | create |
| `feedback_self_verify_with_playwright` | `sync-sources/rules/self-verify-rendering.md` (A) | create |
| `feedback_no_inspection_policy` | `sync-sources/rules/no-inspection-policy.md` (A) | create |
| `feedback_handoff_not_pipeline_agents` | `sync-sources/rules/handoff-not-pipeline-agents.md` (A) | create |
| `project_red_main_empties_merge_gate` | `roles/flywheel.md` + `docs/flywheel-brief.md` (A) | add rule |
| `project_flywheel_admin_merge_red_main_trap` | `roles/flywheel.md` + `docs/flywheel-brief.md` (A) | add rule |
| `feedback_flywheel_heartbeat_cadence` | `roles/flywheel.md` + `docs/flywheel-brief.md` (A) | **fix cadence 1200→~1000** |
| `feedback_flywheel_launches_agents` | (already in `roles/flywheel.md`) (B) | slim memory → pointer |
| `feedback_flywheel_use_discretion` | (already in `roles/flywheel.md`) (B) | slim memory → pointer |
| `feedback_strike_default_harness` | (already a bundled rule) (B) | slim memory → pointer |
| `feedback_commit_frequency` | (already `commit-often-on-main`) (B) | slim memory → pointer |
| `feedback_planning_artifacts` | — (B) | **DELETE** (cites deleted `.planning/`, `docs/prds/active/`) + remove from `MEMORY.md` |

**Explicitly NOT migrated** (stay as memory — personal/interaction/historical): `feedback_ask_first`,
`feedback_be_decisive`, `feedback_investigate_before_fixing`, `feedback_workflow_token_cost`,
`feedback_agents_write_issues`, `feedback_claudish_integration`.

---

## Work items

### WI-1 — Create the seven `scope: dev` bundled rules (class A)

Create `sync-sources/rules/<name>.md` with `---\nscope: dev\n---` and a tight imperative body (read two
neighbors first per the rule-authoring rule). **Wording cautions (must not contradict existing rules):**

- **no-oneshot-agents.md** — "Work agents run as live interactive sessions, never one-shot/headless.
  Codex work agents MUST use the persistent TUI path, never `codex exec` (one-shot: runs one turn,
  exits, lifecycle marks it orphaned). One-shot was rejected long ago — it cost hundreds of hours.
  **If a reliable TUI work-agent path is not wired for codex, do NOT spawn — surface to the operator**
  rather than silently falling back to exec." (Executor: verify current codex work-agent reality
  before finalizing the last sentence — state what is true at execution time.)
- **handoff-not-pipeline-agents.md** — "When asked from within a conversation to 'spawn agents' to
  work on issues, use `pan handoff` (interactive, human-supervised *conversations*). This does NOT
  override the rule that **managed pipeline work/plan/review agents always run through `pan
  start`/`pan swarm`/`pan plan`** — it covers only ad-hoc conversation handoffs the operator wants to
  supervise directly. Tell handoff agents NOT to run `pan done`; worktree `--cwd` is fine."
- **additive-refactor-no-loss.md** — "Refactor plans for an existing surface must be additive/superset,
  never silent replacement. Enumerate everything the old surface exposes; verify each has a home in
  the new one. Any deletion/replacement gets a no-loss audit gate (a test) that blocks until every old
  item is accounted for. 'Is anything lost?' is answered by the audit, not by reasoning."
- **facts-not-guessing.md** — "On system-state questions (permissions, flags reaching a harness, why
  an agent behaves a way), verify and state facts — don't theorize. Ground claims in `git grep`,
  `strings`, `/proc/<pid>/cmdline`, the resolved config value. Distinguish code vs resolved config vs
  already-running process — a live process keeps its launch-time flags after a config change."
- **explain-fully-no-jargon.md** — "Operator-facing messages must stand alone. Define every pipeline
  term inline on first use (ready=1, verification gate, merge queue, advancing slot). Spell out
  consequences in full sentences. Never compress operator-facing output to save tokens, even at high
  context usage — durable docs may be terse, operator messages may not."
- **self-verify-rendering.md** — "Verify dashboard/terminal rendering yourself; don't ask the operator
  to eyeball it. Playwright screenshots are readable (`browser_take_screenshot` → PNG in repo root →
  `Read` it). For terminal ANSI, `tmux -L panopticon capture-pane -t <s> -e -p`. Preview in a
  throwaway `panopticon`-socket session, not by attaching to (and resizing) a live one."
- **no-inspection-policy.md** — "When the operator sets a no-inspection policy on an issue,
  `requiresInspection` must be false on every bead AND no `pan inspect` path may run — including
  PostToolUse hooks or other auto-triggers. If a bead would need inspection to pass, mark it blocked.
  Disable the auto-trigger path; don't rely on restraint."

### WI-2 — Add three flywheel rules to BOTH `roles/flywheel.md` AND `docs/flywheel-brief.md` (class A)

Both surfaces must agree (the brief is the startup scope contract; the role is the running prompt).

- **Heartbeat cadence — FIX the existing contradiction.** Current: `roles/flywheel.md` (~`:101`) and
  `docs/flywheel-brief.md` (~`:11`) both say `ScheduleWakeup(delaySeconds: 1200)`. **Change both to
  `~1000`** with the why: "runtime drift pushes 1200 → ~1251s, past the 20-min watchdog threshold that
  flags the orchestrator stuck; ~1000s leaves margin. Emit a status every tick even when state is
  identical; never widen to 1800/3600s."
- **Red main empties the merge gate** (add to both): "Each tick verify main CI **conclusion**, not
  just HEAD sha: `gh run list --branch main --workflow CI --limit 1 --json status,conclusion,headSha,url,createdAt`.
  Treat `status != completed` as NOT green; treat missing/unknown `conclusion` as NOT green. A green
  `Main HEAD: <sha>` line does NOT mean CI is green. When main is RED every feature PR inherits the
  failing `test` check, so nothing reaches `readyForMerge` and the gate looks empty. Red main is P0 —
  fix it first."
- **Never admin-merge while main is red** (add to both): "`gh pr merge --admin` bypasses the PR's
  required `test` check. Only do it when main is already GREEN (per the check above). If main is red, a
  PR's red `test` may be its OWN new failure, indistinguishable from inherited stale-red — fix main
  green first. Do not admin-merge a red PR merely because the operator wants progress; if main is green
  and the PR is red, inspect the PR failure and require explicit operator override for that specific
  failure. Reverting a squash-merge that broke main is clean (`git revert <sha>`)."

**Settle the `pan close` contradiction (in scope per review):** `docs/flywheel-brief.md` (~`:13`,
~`:97`) currently lists `pan close` under "do not run"; `roles/flywheel.md` (~`:90`, ~`:150`) **allows**
`pan close` for issues already merged and at `verifying-on-main`/`completed`. Update `docs/flywheel-brief.md`
to match the role's nuanced allowance (close-out of merged/verifying issues is part of the job; the
close-out's verify-merged gate is the safety net). Do not weaken the role.

### WI-3 — Slim already-promoted memories + delete the stale one (class B — local)

For `feedback_flywheel_launches_agents`, `feedback_flywheel_use_discretion`,
`feedback_strike_default_harness`, `feedback_commit_frequency`: replace the body with a one-line
pointer to the canonical rule file. **Delete** `feedback_planning_artifacts.md` and its `MEMORY.md`
index line. **This is local machine state — report it; it is NOT part of the git commit.**

### WI-4 — Sync, verify, commit (A); then mutate memory (B)

1. After WI-1 + WI-2: `pan sync`. Verify the new bundled rules rendered into `~/.claude/CLAUDE.md`
   (managed region), `~/.panopticon/context/pi-global.md`, `~/.panopticon/context/codex-global.md`.
   **(These paths are outside the repo — expect a possible permission prompt; not a code failure.)**
2. `git status --short`; stage and commit **only** the intended tracked files (`sync-sources/rules/*`,
   `roles/flywheel.md`, `docs/flywheel-brief.md`, and `MEMORY.md` IF it is tracked — verify; the
   memory `.md` bodies under `~/.claude/...` are NOT tracked). If a new rule introduces canonical
   terminology, update `docs/CONTEXT-LAYERS.md` in the same commit.
3. Then perform WI-3's local memory edits and report them separately in the completion summary.

---

## Acceptance criteria (1:1 with work items)

- **AC-1 (WI-1)** — Seven new `sync-sources/rules/*.md`, each `scope: dev`, tight, in the existing
  voice; `pan sync` renders them into the managed region. `no-oneshot-agents` and
  `handoff-not-pipeline-agents` are worded to NOT contradict the existing work-agents-via-pan rule.
- **AC-2 (WI-2)** — `roles/flywheel.md` AND `docs/flywheel-brief.md` agree on wakeup cadence (~1000),
  carry the red-main and admin-merge rules, and no longer contradict each other on `pan close`.
  `grep -n "1200" roles/flywheel.md docs/flywheel-brief.md` finds no stale cadence.
- **AC-3 (WI-3)** — the four memories are one-line pointers; `feedback_planning_artifacts.md` is gone
  and removed from `MEMORY.md`.
- **AC-4 (WI-4)** — rendered context files contain the new rules; the git commit contains **only**
  tracked repo files (verified via `git status --short` pre-commit); local memory edits are reported
  separately, not implied to be in git.
- **AC-5 (NFR-2)** — diff touches no non-panopticon or "Explicitly NOT migrated" memory.

---

## Related issues this addresses / relates to

- **Addresses the systemic root** behind [#1883](https://github.com/eltmon/panopticon-cli/issues/1883): operational rules that must govern agents
  were trapped in conversation memory. Once in `roles/flywheel.md` + `docs/flywheel-brief.md`, the
  red-main/admin-merge rules help the orchestrator avoid the traps that silently empty the merge gate
  — relating to [#1880](https://github.com/eltmon/panopticon-cli/issues/1880) and the red-main family ([#1824](https://github.com/eltmon/panopticon-cli/issues/1824), [#1783](https://github.com/eltmon/panopticon-cli/issues/1783)).
- **Sibling fixes** executed together: [#1883](https://github.com/eltmon/panopticon-cli/issues/1883), [#1877](https://github.com/eltmon/panopticon-cli/issues/1877).
