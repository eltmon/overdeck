# Roles: Overdeck's Agent Definition Primitive

**Source of truth for what an agent does, harness-independent.**

A Role is a markdown file in `roles/` that tells an agent what to do. The role primitive replaced five overlapping "agent type" enums (`OverdeckAgentType`, `SpecialistType`, `LauncherAgentType`, `WorkTypeId`, `ActivitySource`) with a single concept owned by one file per role.

See [PAN-1048](./prds/planned/PAN-1048-role-primitive.md) for the migration's motivation.

---

## The active role files

| Role | File | Purpose |
|------|------|---------|
| `plan` | `roles/plan.md` | Read issue, research codebase, write xBRIEF, create xBRIEF tasks. Instruction source: `roles/plan.md` (system prompt) plus `src/lib/cloister/prompts/planning.md` (issue inputs and plan formats); no other file instructs the planner. |
| `work` | `roles/work.md` | The foreman for the issue. Claims xBRIEF items, writes code, commits one item at a time with an `Item: <item-id>` trailer. When the plan has parallel waves, dispatches same-family workers as in-harness subagents and cross-family workers as terminal-backend panes via `pan spawn` — see the `pan-foreman` skill and [FOREMAN.md](./FOREMAN.md). |
| `strike` | `roles/strike.md` | Precision drop-in. Implements an isolated fix on `strike/<id>`, pushes the branch, and opens a PR against `main` that the operator merges. Bypasses the plan/work/review/test pipeline and server-side shipping. |
| `review` | `roles/review.md` | Read manifest, gather convoy findings, approve or request changes as a PR review |
| `test` | `roles/test.md` | Run project test suite + Playwright UAT, report failures |

### Conversation kickoff templates (not roles)

`roles/handoff.md`, `roles/handoff-external.md`, `roles/handoff-external-pi.md`,
and `roles/retrospective.md` live alongside the role files but are **not**
roles: the server reads them at request time and renders them into a
conversation's first message. They are never spawned as agents. Changing any
of them requires a `Prompt-Change:` commit trailer.

There is no spawned `ship` role file. Shipping is server-side: the dashboard runs
`rebaseFeatureBranch()`, computes merge readiness live from PR approvals, green
checks, and forge mergeability, and the human Merge button performs the final
GitHub squash. The `ship` token survives only as the merge-specialist identity
for model routing and historical activity attribution.

A **Run** is a process playing a role: `(role, model, harness)`. A run's *work* is scoped — it does one role's worth of work and records its verdict — but its *session* is not disposable. See the session-lifecycle policy below.

## Session lifecycle: warm by default (PAN-2579)

Role sessions are **warm by default**: they persist after recording their verdict, until issue close-out. A session for an issue's role should be absent only for two reasons:

1. **Reboot** — the machine or dashboard restarted and the session did not survive.
2. **Resource relief** — the memory governor evicted or yielded it to free capacity for a blocked part of the pipeline. See "Agent Auto-Resume Gates" in [PIPELINE-GATES.md](./PIPELINE-GATES.md).

Consequences:

- **Dispatch resumes before it spawns.** Every dispatch path (review request, re-review, test run, rework handoff) first looks for a live warm session for that role + issue and messages/resumes it; cold-spawning is the fallback for the absent case.
- **Review agents (and convoy sub-reviewers) stay warm after a verdict** so a re-review after a request-changes → fix cycle resumes reviewers that already hold context from the previous pass, cutting re-review latency.
- **Reviewer exit is reported by the supervisor, never inferred.** For supervisor-launched agents the PTY supervisor posts an `exited` lifecycle event, and the agent-liveness projection writes `stopped` from that observed fact — see `src/lib/agents/liveness.ts`, the single oracle for liveness everywhere.
- **Feedback goes agent-to-agent.** A reviewer's PR review comments reach the live work agent via `pan tell`; deacon-lite is a recovery backstop for a stuck agent, not the primary delivery path.
- **Idle-warm sessions are free capacity**, not load: they must not count against the advancing-role concurrency ceiling, and they are the first thing the governor sheds under memory pressure.

Health reporting follows the same lifecycle semantics. `warm` describes a reusable session lifecycle,
not a fault; idle and intentionally stopped sessions are neutral `idle`, and an agent awaiting operator
input is neutral `waiting` rather than stalled. A specialist is reclaimable/leaked only when its
lifecycle is `orphaned`; a warm or merely idle session is retained capacity and must not be labeled as a
leak.

> **Implementation status (2026-07-11, landed):** reap-on-verdict is gone — `pan specialists done` (CLI and HTTP route) records the verdict and leaves the session alive; the deacon's terminal/idle-terminal advancing reapers are removed (only MERGED-issue sessions still reap). `countRunningAgents()` excludes warm-idle advancing sessions from the ceiling, the memory governor sheds them first under HARD pressure, and the review dispatch guard distinguishes finished-idle (warm-reuse for a newer request) from actively-reviewing (PAN-1131). A full-review dispatch launches its in-scope convoy reviewers independently and in parallel, while the parent waits to synthesize their reports — see [REVIEW-AGENT-ARCHITECTURE.md](./REVIEW-AGENT-ARCHITECTURE.md).

---

## After merge

A merged issue is not done. After the human Merge button lands the prepared branch, the issue's derived state becomes `merged` (from the PR, not a stored field) and the tracker issue stays open while operators run post-merge UAT against `main`.

Role responsibilities during this phase:

| Role | Behavior |
|------|----------|
| server-side shipping | `rebaseFeatureBranch()` prepares the branch; merge readiness for the human Merge button is computed live from approvals, checks, and mergeability. No agent is spawned. |
| `work` / `plan` | Remain paused so the operator can unpause for regression follow-up if verification fails. |
| `review` / `test` | Their sessions may be killed after merge; the merged code is now evaluated on `main`, not by reusing pre-merge role sessions. |
| close-out | `pan close <id>` or the dashboard Close Out action performs the final xBRIEF completion, archival, optional teardown/branch deletion, and tracker close. |

`close_out.auto=true` lets deacon-lite's closed-issue reaper run close-out automatically after `close_out.auto_delay_minutes`; otherwise close-out is an explicit operator ceremony.

---

## Sub-roles

A sub-role is a configuration slot under a role, not a separate pipeline stage. Today's sub-role:

| Role | Sub-roles | Shape |
|------|-----------|-------|
| `review` | `security`, `correctness`, `performance`, `requirements` | Harness-agnostic prompt templates the orchestrator inlines into each convoy spawn message. See `roles/review-<subRole>.md`. |

All sub-roles share the same delivery shape: **workflow-injected prompts orchestrated by Overdeck**, never ambient subagents auto-discovered by Claude Code. The prompts live in Overdeck's own files and are inlined at spawn time. This is a deliberate choice — see "Why no ambient subagents" below.

---

## File shapes you will see

There are three on-disk shapes that interact with the Overdeck agent system. They are easy to confuse, so the distinctions matter:

### 1. Role file — `roles/*.md`

The harness-agnostic source of truth for what one agent role does. The body of the file is the role's prompt; if it has YAML frontmatter, the frontmatter is the Claude Code rendering hint (permissions, tools, hooks, default model).

Under the Claude Code harness, the agent runner invokes `claude --agent roles/<role>.md` and Claude parses the frontmatter to set up the run. Under Pi or any future harness, the same body is the role's content; the frontmatter is informational.

For a Role with no Claude-specific frontmatter (the review convoy sub-roles), the file is a pure prompt template. The orchestrator reads it and inlines the body into the spawn message — no `--agent` flag, no auto-discovery.

**Source of truth. Never deleted. Lives in the repo.**

### Role MCP servers

Top-level role files declare MCP servers in `mcpServers`, a YAML list of single-key maps. For example, `roles/test.md` declares Playwright as:

```yaml
mcpServers:
  - playwright:
      type: stdio
      command: npx
      args:
        - "-y"
        - "@playwright/mcp@0.0.78"
```

Executable npm MCP declarations must use an exact version. npm checks the package's registry-published integrity digest, and Codex skips mutable tags, ranges, and unversioned `npx` selectors.

Overdeck renders this declaration for each harness:

- **Claude Code** gets a generated `--mcp-config` JSON file and an `mcp__<name>` entry in `--allowedTools` (PAN-2090).
- **Codex** gets `[mcp_servers.<name>]` entries in the agent's `codex-home/config.toml`. Overdeck rewrites the entries on spawn, resume, and recovery so relaunching a role preserves its tools (PAN-2698).
- **ohmypi** cannot provision role MCP servers. Overdeck logs a spawn-time warning that names every unavailable server.

### 2. Overdeck pipeline agent — `agents/pan-*-agent.md`

Claude Code subagent definitions used by Overdeck's pipeline. These are committed under `agents/` in the overdeck repo and synced to every devroot's `<devroot>/.claude/agents/` by `pan install` / `pan sync`. From there, `mergeSkillsIntoWorkspace()` copies them into each workspace's `.claude/agents/` so Claude Code can load them when a pipeline run uses the `--agent` flag.

These agent definitions still exist for legacy spawn paths; the role primitive will eventually replace them. They are not the same thing as Role files — `agents/pan-review-agent.md` is the legacy Claude Code subagent that drove the old reviewer; `roles/review.md` is the current Role.

### 3. Claude Code subagent — `.claude/agents/*.md`

Files that Claude Code auto-discovers and exposes via the in-session `Agent` tool. **Overdeck deliberately ships nothing here.** The directory exists in worktrees only as a sync target the harness may write to, but the Overdeck repo's `.claude/agents/` is empty and stays empty.

When a role needs a subagent (codebase exploration, general-purpose work), it uses Claude Code's **built-in subagent types** (`Explore`, `general-purpose`), not a custom file. Built-ins inherit the parent's model and routing context properly — including `ANTHROPIC_BASE_URL` for CLIProxy-routed sessions — and avoid the model-pinning hazards that custom subagent files exhibit.

---

## Why no ambient subagents

We learned this the hard way. Ambient subagents under `.claude/agents/` cause two problems for a multi-harness, multi-provider system like Overdeck:

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
2. Add the role to the `Role` type in `src/lib/agents.ts` AND to the `isRole()` guard in the same file. `parseAgentState()` returns `null` for any agent whose role fails `isRole()`, which silently hides it from `listRunningAgents()` and the dashboard read model. The `Role` literal in `packages/contracts/src/types.ts` must also list the new role, and `VALID_ROLES` in `src/dashboard/server/read-model.ts` must accept it — otherwise `toRole()` strips it from snapshots before they reach the frontend. (PAN-1506: strike agents were invisible on the Agents page for exactly this reason — the literal was added to the contract and the role file shipped, but the runtime guards in `agents.ts` and `read-model.ts` were never updated.)
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

When in doubt: the workflow-injected pattern is the default for **everything** Overdeck orchestrates. `.claude/agents/` stays empty.
