# PAN-591: Karpathy LLM Guidelines — Prompt Hardening

## Problem Statement

Overdeck agents exhibit the same failure modes Andrej Karpathy described in his public post on LLM coding pitfalls: silent assumptions, over-engineered abstractions, drive-by refactoring, and vague success criteria. These aren't model failures — they're missing behavioral constraints. Adding targeted guidelines to the right prompts, for the right agents, reduces first-try review failures, decreases rework cycles, and produces cleaner diffs.

Source: `github.com/forrestchang/andrej-karpathy-skills` — codified from Karpathy's X post `2015883857489522876`.

## Requirements

### Must Have

- `templates/claude-md/sections/warnings.md` updated with Simplicity First + Surgical Changes (seen by all work agents via workspace CLAUDE.md)
- `src/lib/cloister/prompts/planning.md` updated with all 4 principles adapted to planning context
- `src/lib/cloister/prompts/work.md` updated with concise Surgical Changes reminder
- `src/lib/cloister/prompts/review.md` updated with Anti-Patterns Checklist from EXAMPLES.md
- Karpathy skill file added to `~/.claude/skills/karpathy-guidelines/SKILL.md` (synced via `pan sync`)
- Config gate for A/B: `experimental.karpathy_guidelines.enabled` in `config.yaml`
- Mustache optional blocks in each affected template; caller populates from config at workspace creation
- `karpathy_variant` stored in workspace metadata and cost events (reuse A/B infrastructure from PAN-611)

### Should Have

- `reference/prompts.mdx` updated to document the new optional variables in the affected templates

### Out of Scope

- Modifying `src/lib/cloister/prompts/test.md` or `merge.md` — Karpathy principles don't apply to test execution or merge operations
- Modifying the main session `CLAUDE.md` (the developer guidelines I see) — Simplicity First and Surgical Changes are already there verbatim
- Adding "Think Before Coding → ask" to any work agent context — directly contradicts autonomous execution mandate
- Adding "Goal-Driven Execution" to work.md — the bead + inspect loop already implements this structurally

## Design

### Principle Placement (precise, non-negotiable)

| Principle | warnings.md | work.md | planning.md | review.md |
|---|---|---|---|---|
| Think Before Coding | OMIT | OMIT | ✅ Full | ✅ As review lens |
| Simplicity First | ✅ Full | OMIT | ✅ Adapted | ✅ As review criterion |
| Surgical Changes | ✅ Full | ✅ Concise (3 bullets) | OMIT | ✅ As review criterion |
| Goal-Driven Execution | OMIT | OMIT | ✅ Adapted for vBRIEF AC | OMIT (AC gate covers it) |

**"Think Before Coding → ask" must never appear in work agent context.** `work.md` and `warnings.md` (rendered into workspace CLAUDE.md seen by work agents) must not contain any "if uncertain, ask" language. It contradicts the explicit autonomous execution mandate in `work.md` ("NEVER stop to ask for permission or options").

### warnings.md Changes

Add after the existing "Investigation First" section:

```markdown
## Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it in a comment or commit message — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless explicitly asked.

**The test:** Every changed line should trace directly to the issue you're working on.

> **Tradeoff:** These guidelines bias toward caution over speed. For trivial one-line fixes, use judgment.
```

These go inside the `{{#KARPATHY_GUIDELINES}}` optional block so A/B works.

### work.md Changes

Add a concise Surgical Changes block near the top of the bead workflow section:

```markdown
{{#KARPATHY_GUIDELINES}}
## Surgical Changes (Critical)

Touch only what the bead requires. Every changed line must trace to the bead you claimed.
- Don't improve adjacent code, comments, or formatting that isn't part of your bead.
- Match existing style even if you'd do it differently.
- Remove imports/vars that YOUR changes orphaned. Leave pre-existing dead code alone.
{{/KARPATHY_GUIDELINES}}
```

### planning.md Changes

Add after the "PLANNING ONLY — NO IMPLEMENTATION" section:

```markdown
{{#KARPATHY_GUIDELINES}}
## Planning Quality Guidelines

### Think Before Coding
Surface assumptions before committing to an approach. Use AskUserQuestion to resolve ambiguity.
- If multiple implementation approaches exist, present them with tradeoffs — don't pick silently.
- If the issue has unclear scope, name what's unclear and ask.
- State your architectural assumptions explicitly in STATE.md.

### Simplicity First
The plan should prefer the simplest approach that satisfies the issue.
- Don't add vBRIEF items for features beyond the stated scope.
- If a one-file change would work, don't plan a three-layer abstraction.
- Flag complexity: if an item feels like over-engineering, say so and ask.

### Goal-Driven Acceptance Criteria
Every vBRIEF acceptance criterion must be verifiable, not vague.
- ❌ "Implement caveman integration"
- ✅ "caveman hooks present in workspace .claude/settings.json after workspace creation"
- ❌ "Add config support"
- ✅ "`agents.caveman.enabled: false` in config.yaml prevents hook injection"

Transform every vBRIEF item's acceptance criteria into: "implement X such that Y is verifiably true."
{{/KARPATHY_GUIDELINES}}
```

### review.md Changes

Add an "Anti-Patterns Checklist" section after the acceptance criteria gate:

```markdown
{{#KARPATHY_GUIDELINES}}
## Anti-Patterns Checklist

Check the diff for these patterns. Each finding = request changes with file:line evidence.

### Drive-by Refactoring
Did the diff touch code not required by the issue? Signs:
- Reformatted whitespace, changed quote style, added type hints in files not related to the task
- Renamed variables or functions that weren't part of the change
- "Improved" adjacent functions while fixing an unrelated bug

Evidence required: `file.ts:L42 — changed single quotes to double quotes, not part of the issue.`

### Over-Abstraction
Did the diff introduce unnecessary complexity? Signs:
- Strategy pattern / ABC / Protocol for a single use case
- New interfaces, base classes, or factories where a function would do
- 200 lines where 30 would work

Evidence required: `src/foo.ts:L10-80 — DiscountStrategy ABC with two implementations for a single discount calculation.`

### Speculative Features
Did the diff add unrequested functionality? Signs:
- Caching added without a performance requirement
- Validation for inputs the system controls
- Configuration options for choices that were never going to vary
- Notification system, event hooks, or callbacks nobody asked for

Evidence required: `src/bar.ts:L55 — added Redis caching with no performance requirement in the issue.`

### Hidden Assumptions
Did the implementation silently pick scope, format, or behavior options? Signs:
- Assumed export format without asking
- Assumed which fields to include/exclude
- Picked one interpretation of an ambiguous requirement without surfacing the ambiguity

Evidence required: `exports all users with all fields — issue says "export user data" without specifying scope or fields.`

### Style Drift
Did the diff change code style while making functional changes? Signs:
- Mixed quote styles within a file after the edit
- Type hints added to some functions but not others in the same file
- Docstrings added to only the touched functions

Evidence required: `src/upload.ts:L12 — changed 'rb' to "rb", rest of file uses single quotes.`

> These anti-patterns are supplementary to the AC verification gate, not a replacement. AC gate failures block; anti-pattern findings request changes.
{{/KARPATHY_GUIDELINES}}
```

### Karpathy Skill File

Add `~/.claude/skills/karpathy-guidelines/SKILL.md` (verbatim from source repo with Overdeck-specific note prepended). Synced via `pan sync`. Review and planning agents can load it on demand for the full examples from EXAMPLES.md.

### Config Schema

```yaml
# ~/.overdeck/config.yaml
experimental:
  karpathy_guidelines:
    enabled: true      # true | false | ab_test
    warnings: true     # include in workspace CLAUDE.md warnings section
    work: true         # include surgical changes block in work agent
    planning: true     # include all 4 principles in planning agent
    review: true       # include anti-patterns checklist in review agent
```

### A/B Infrastructure

Reuses the framework built in PAN-611:
- `karpathy_variant: "enabled" | "disabled"` stored in workspace metadata
- Passed to cost event recorder
- Dashboard Experiments tab: group by `karpathy_variant`, show first-try review pass rate as primary metric (the whole point is reducing review failures)

### Mustache Variable Population

At workspace creation time, the caller passes `KARPATHY_GUIDELINES` as a truthy string (e.g. `"1"`) or empty string based on config. All affected templates already support optional blocks via Mustache. The `renderPrompt()` frontmatter `optional` list gains `KARPATHY_GUIDELINES` for `work.md`, `planning.md`, and `review.md`.

`warnings.md` uses `{{VARIABLES}}` replacement (the `loadSection()` function in `template.ts`) — needs to check whether Mustache is available there or use a simple `{{KARPATHY_GUIDELINES}}` conditional marker instead.

## Technical Notes

### Verification

After implementation, render a test workspace CLAUDE.md and verify:
1. Simplicity First and Surgical Changes appear
2. "Think Before Coding → ask" does NOT appear
3. The tradeoff caveat appears
4. The section is coherent alongside existing "Investigation First" and "NEVER Defer Work" sections — no contradictions

### Existing overlap (do not duplicate)

The main session CLAUDE.md (what I see, not agents) already has verbatim:
- "Don't add features, refactor code, or make 'improvements' beyond what was asked"
- "Don't add error handling, fallbacks, or validation for scenarios that can't happen"

These are NOT in workspace `warnings.md` or any agent prompt. Adding them to workspace context is purely additive.

## References

- Source repo: https://github.com/forrestchang/andrej-karpathy-skills (all 6 files read verbatim)
- Original Karpathy post: https://x.com/karpathy/status/2015883857489522876
- EXAMPLES.md: verbatim before/after code examples for all 4 principles (drive-by refactoring, style drift, over-abstraction, speculative features, hidden assumptions, test-first bug fixing)
- Related: PAN-611 (caveman) — implement first; provides A/B infrastructure this issue reuses
- PAN-307 (Superpowers prompt hardening) — separate issue, different source

## Open Questions

None — design is fully specified. Planning agent should be able to go directly to vBRIEF generation.
