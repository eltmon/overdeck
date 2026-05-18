# Roles: Panopticon's Agent Definition Primitive

**Source of truth for what an agent does, harness-independent.**

A Role is a markdown file in `roles/` that tells an agent what to do. The role primitive replaced five overlapping "agent type" enums (`PanopticonAgentType`, `SpecialistType`, `LauncherAgentType`, `WorkTypeId`, `ActivitySource`) with a single concept owned by one file per role.

See [PAN-1048](./prds/planned/PAN-1048-role-primitive.md) for the migration's motivation.

---

## The five roles

| Role | File | Purpose |
|------|------|---------|
| `plan` | `roles/plan.md` | Read issue, research codebase, write vBRIEF, create beads |
| `work` | `roles/work.md` | Claim beads, write code, commit per bead, self-inspect (Jidoka) |
| `review` | `roles/review.md` | Read manifest, gather convoy findings, approve or request changes |
| `test` | `roles/test.md` | Run project test suite + Playwright UAT, report failures |
| `ship` | `roles/ship.md` | Rebase, resolve conflicts, run verification, prep for merge |

A **Run** is a process playing a role: `(role, model, harness)`. Runs are ephemeral — they spawn, do one role's worth of work, update the tracker, and exit. There is no long-lived agent holding state.

---

## `verifying_on_main` phase

A merged issue is not done. After the human Merge button lands the prepared branch, Panopticon moves the issue into canonical state `verifying_on_main` and applies the GitHub label `verifying-on-main`. This phase keeps the issue open and visible while operators run post-merge UAT against `main`.

Role responsibilities during this phase:

| Role | Behavior |
|------|----------|
| `ship` | Prepares the branch for the human Merge button. It does not close the issue or tear down the workspace. |
| merge handoff | `postMergeLifecycle()` marks `mergeStatus: "merged"`, applies `verifying-on-main`, frees runtime resources, and preserves workspace/state/vBRIEF/branches. |
| `work` / `plan` | Remain paused so the operator can unpause for regression follow-up if verification fails. |
| `review` / `test` | Their sessions may be killed after merge; the merged code is now evaluated on `main`, not by reusing pre-merge role sessions. |
| close-out | `pan close <id>` or the dashboard Close Out action performs the final vBRIEF completion, archival, optional teardown/branch deletion, tracker close, and review-status clearing. |

If `close_out.auto=true`, Deacon may run close-out automatically after `close_out.auto_delay_minutes`; otherwise close-out is an explicit operator ceremony.

---

## Sub-roles

A sub-role is a configuration slot under a role, not a separate pipeline stage. Today's sub-roles:

| Role | Sub-roles | Shape |
|------|-----------|-------|
| `work` | `inspect`, `inspect-deep` | Harness-agnostic prompt templates. The orchestrator's `pan inspect` CLI spawns a separate run with the prompt inlined; nothing lives in `.claude/agents/`. |
| `review` | `security`, `correctness`, `performance`, `requirements` | Harness-agnostic prompt templates the orchestrator inlines into each convoy spawn message. See `roles/review-<subRole>.md`. |

All sub-roles share the same delivery shape: **workflow-injected prompts orchestrated by Panopticon**, never ambient subagents auto-discovered by Claude Code. The prompts live in Panopticon's own files and are inlined at spawn time. This is a deliberate choice — see "Why no ambient subagents" below.

---

## File shapes you will see

There are three on-disk shapes that interact with the Panopticon agent system. They are easy to confuse, so the distinctions matter:

### 1. Role file — `roles/*.md`

The harness-agnostic source of truth for what one agent role does. The body of the file is the role's prompt; if it has YAML frontmatter, the frontmatter is the Claude Code rendering hint (permissions, tools, hooks, default model).

Under the Claude Code harness, the agent runner invokes `claude --agent roles/<role>.md` and Claude parses the frontmatter to set up the run. Under Pi or any future harness, the same body is the role's content; the frontmatter is informational.

For a Role with no Claude-specific frontmatter (the review convoy sub-roles), the file is a pure prompt template. The orchestrator reads it and inlines the body into the spawn message — no `--agent` flag, no auto-discovery.

**Source of truth. Never deleted. Lives in the repo.**

### 2. Panopticon pipeline agent — `agents/pan-*-agent.md`

Claude Code subagent definitions used by Panopticon's pipeline. These are committed under `agents/` in the panopticon-cli repo and synced to every devroot's `<devroot>/.claude/agents/` by `pan install` / `pan sync`. From there, `mergeSkillsIntoWorkspace()` copies them into each workspace's `.claude/agents/` so Claude Code can load them when a pipeline run uses the `--agent` flag.

These agent definitions still exist for legacy spawn paths; the role primitive will eventually replace them. They are not the same thing as Role files — `agents/pan-review-agent.md` is the legacy Claude Code subagent that drove the old reviewer; `roles/review.md` is the current Role.

### 3. Claude Code subagent — `.claude/agents/*.md`

Files that Claude Code auto-discovers and exposes via the in-session `Agent` tool. **Panopticon deliberately ships nothing here.** The directory exists in worktrees only as a sync target the harness may write to, but the Panopticon repo's `.claude/agents/` is empty and stays empty.

When a role needs a subagent (codebase exploration, general-purpose work), it uses Claude Code's **built-in subagent types** (`Explore`, `general-purpose`), not a custom file. Built-ins inherit the parent's model and routing context properly — including `ANTHROPIC_BASE_URL` for CLIProxy-routed sessions — and avoid the model-pinning hazards that custom subagent files exhibit.

---

## Why no ambient subagents

We learned this the hard way. Ambient subagents under `.claude/agents/` cause two problems for a multi-harness, multi-provider system like Panopticon:

1. **They leak into every session.** Anything in `.claude/agents/` is callable from any Claude Code session in that workspace. A work agent in mid-implementation can ambiently invoke a subagent the workflow never intended to expose at that moment. Workflow-injected prompts, in contrast, only appear when the orchestrator inlines them at the right point.
2. **They hardcode model assumptions that don't survive provider routing.** A custom subagent with `model: haiku` in frontmatter fails when the parent runs via CLIProxy serving gpt-5.5 — the harness doesn't always thread provider routing through to the subagent call, so the subagent hits a provider error. Built-in subagents (`Explore`, `general-purpose`) inherit the parent's model and routing cleanly; custom subagent files do not, reliably.

The same logic applies to review convoy reviewers — they're harness-agnostic prompt templates the orchestrator inlines, never `.claude/agents/` files. That decision predates this one and was the original motivation; we generalized the policy.

**Practical consequence:** when a role needs subagent help, write the prompt into the role's own message (or use a built-in subagent type), don't add a file under `.claude/agents/`.

---

## How a run actually gets the right instructions

For each role, the runtime chain looks like this:

```
Cloister decides to spawn (role, subRole?)
  │
  ▼
spawnRun(issueId, role, { subRole, prompt })
  │
  ▼
getRoleRuntimeBaseCommand(model, agentName, role, harness, subRole)
  │       │
  │       └─ roleAgentDefinitionPath(role, subRole)
  │            • Top-level role     → "roles/<role>.md"  (Claude --agent flag)
  │            • Review sub-role    → null               (no --agent; prompt is inlined)
  │            • Pi harness         → ignored            (Pi reads prompt from stdin)
  │
  ▼
launcher script writes the command + spawn prompt to tmux
  │
  ▼
First user message = the spawn prompt
  │
  • For top-level roles, the spawn prompt is short (identifiers, paths,
    pointers); the role file's body is the system prompt.
  • For review convoy sub-roles, the spawn prompt CONTAINS the body of
    roles/review-<subRole>.md (read from packageRoot at spawn time).
```

The orchestrator that inlines convoy templates is `src/lib/cloister/review-agent.ts:buildConvoyPrompt()`. It reads `packageRoot/roles/review-<subRole>.md` and embeds the body inside a spawn message that also supplies the per-run identifiers (output file path, context manifest path).

---

## Adding a new role or sub-role

Pick the shape that matches the use case before you start writing.

**Adding a top-level role** (new pipeline stage):
1. Create `roles/<name>.md` with Claude-compatible frontmatter (`name`, `description`, `model`, `permissionMode`, `tools`, `hooks`) and the role's prompt body.
2. Add the role to the `Role` type in `src/lib/agents.ts` (or wherever the central role enum lives).
3. Wire it through `resolveModel()`, the reactive scheduler, and any lifecycle transitions.
4. Add coverage in `src/lib/__tests__/role-definitions.test.ts`.

**Adding a subagent invoked from within a session** (Jidoka-style gate, or codebase exploration):
1. **Do NOT add a file under `.claude/agents/`** — see "Why no ambient subagents" above.
2. Use Claude Code's built-in subagent types (`Explore`, `general-purpose`) when the role needs subagent help. They inherit the parent's model and routing context.
3. If the use case truly needs a custom prompt, write the prompt into the calling role's message (workflow-injected pattern) rather than adding an ambient subagent file.

**Adding a convoy-style sub-role** (workflow-orchestrated prompt template):
1. Create `roles/<role>-<subRole>.md` with the prompt body only — no frontmatter.
2. Have the orchestrator read the file from `packageRoot/roles/` and inline the body into each spawn message for that sub-role.
3. Do not pass `--agent` for the sub-role from `getRoleRuntimeBaseCommand` — return `null` from `roleAgentDefinitionPath`.
4. Add coverage in `src/lib/__tests__/role-definitions.test.ts` asserting the file exists with no frontmatter and instructs the manifest/output-file contract.

When in doubt: the workflow-injected pattern is the default for **everything** Panopticon orchestrates. `.claude/agents/` stays empty.
