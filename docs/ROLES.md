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

## Sub-roles

A sub-role is a configuration slot under a role, not a separate pipeline stage. Today's sub-roles:

| Role | Sub-roles | Shape |
|------|-----------|-------|
| `work` | `inspect`, `inspect-deep` | Claude Code subagents the work role invokes via the `Agent` tool at Jidoka gates. See `.claude/agents/inspect.md` and `inspect-deep.md`. |
| `review` | `security`, `correctness`, `performance`, `requirements` | Harness-agnostic prompt templates the orchestrator inlines into each convoy spawn message. See `roles/review-<subRole>.md`. |

The two shapes serve different needs. Inspect sub-roles fire on demand from within a Claude Code session, so they're Claude Code subagents the harness loads ambient. Review convoy sub-roles fire as separate runs orchestrated by Panopticon, so the prompt belongs in Panopticon's own files and is delivered as part of the workflow.

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

Files that Claude Code auto-discovers and exposes via the in-session `Agent` tool. In a Panopticon-managed project, this directory is a **sync target, never a source of truth.** Contents come from `agents/` (top-level panopticon source) via `mergeSkillsIntoWorkspace()`, with project-template overlays on top.

Anything you put in `.claude/agents/` becomes ambient — any Claude Code session running in that workspace can call it as a Task subagent. That makes it the right place for tools you want broadly available (inspect gates, codebase explorer) and the wrong place for prompts you want delivered only at a specific moment in a workflow (review convoy reviewers).

---

## Why review convoy prompts live in `roles/`, not `.claude/agents/`

Convoy reviewer prompts are role content, not Claude Code subagents. Three properties of `roles/review-<subRole>.md` matter:

1. **Harness-agnostic.** Pi, Codex, and any future harness can run a convoy reviewer because the prompt is just text the orchestrator hands the runtime.
2. **Workflow-injected, not auto-discovered.** Work agents in project workspaces never see the convoy prompts in their tree, so a work agent cannot ambiently spawn a reviewer subagent on itself.
3. **Orchestrator-owned.** The prompts live in panopticon-cli (Panopticon's own install). They are not synced into project workspaces. Behavior changes ship with code and are reviewed under the same gates.

Placing these files under `.claude/agents/` makes them auto-discoverable subagents that Claude Code parses for frontmatter — exactly the coupling and ambient exposure we want to avoid.

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

**Adding a Claude Code subagent invoked from within a session** (Jidoka-style gate):
1. Create `.claude/agents/<name>.md` with the standard Claude subagent frontmatter (`name`, `description`, `tools`, optional `model`).
2. Reference the subagent from the calling role's prompt with the `Agent` tool's `subagent_type` parameter.

**Adding a convoy-style sub-role** (workflow-orchestrated prompt template):
1. Create `roles/<role>-<subRole>.md` with the prompt body only — no frontmatter.
2. Have the orchestrator read the file from `packageRoot/roles/` and inline the body into each spawn message for that sub-role.
3. Do not pass `--agent` for the sub-role from `getRoleRuntimeBaseCommand` — return `null` from `roleAgentDefinitionPath`.
4. Add coverage in `src/lib/__tests__/role-definitions.test.ts` asserting the file exists with no frontmatter and instructs the manifest/output-file contract.

When in doubt: the workflow-injected pattern is the default for anything Panopticon orchestrates from outside a session. Save `.claude/agents/` for tools that need to be ambient inside a session.
