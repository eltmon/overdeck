# Panopticon Work Types

A comprehensive breakdown of all controllable work types for model routing.

## Overview

Panopticon supports fine-grained model routing across 20+ work types. Each work type can be assigned a different model, allowing you to optimize for cost, speed, or quality based on the task.

**Total controllable work types: 23**

---

## 1. Issue Agent Phases (Main Work Agent)

The main work agent progresses through distinct phases, each with different model requirements.

| Work Type ID | Phase | Description | Primary Model | Budget Alternative | Rationale |
|--------------|-------|-------------|---------------|-------------------|-----------|
| `issue-agent:exploration` | Exploration | Understanding codebase, reading files, initial research | `gemini-3-flash-preview` (thinking: low) | `gemini-3-flash-preview` (thinking: minimal) | Fast scanning/triage; minimal works for pure grep-like discovery |
| `issue-agent:planning` | Planning | Architecture design, approach selection | `claude-opus-4-6` | `gemini-3-pro-preview` (thinking: high) | Strong architecture planning without burning Opus |
| `issue-agent:implementation` | Implementation | Writing code, making changes | `gpt-5.2-codex` | `gemini-3-pro-preview` (thinking: low) | Acceptable codegen when you want to keep everything Gemini-centric |
| `issue-agent:testing` | Testing | Running tests, fixing failures, adding test coverage | `gpt-5.2-codex` | `gemini-3-flash-preview` (thinking: medium) | Fast test/fix loops; Flash medium is good for iterative retries |
| `issue-agent:documentation` | Documentation | Writing docs, comments, README updates | `claude-sonnet-4-5` | `gemini-3-pro-preview` (thinking: low) | Solid technical writing with lower cost |
| `issue-agent:review-response` | Review Response | Addressing review feedback, fixing issues | `claude-sonnet-4-5` | `gemini-3-pro-preview` (thinking: medium) | Handles feedback and refactors with decent caution |

---

## 2. Specialist Agents (Long-Running)

Specialists are long-running agents in tmux sessions that handle specific workflow steps.

| Work Type ID | Specialist | Description | Primary Model | Budget Alternative | Rationale |
|--------------|------------|-------------|---------------|-------------------|-----------|
| `specialist-review-agent` | Review Agent | Code review, quality checks, style enforcement | `claude-sonnet-4-5` | `gemini-3-pro-preview` (thinking: medium) | Consistent long-running review behavior at lower cost |
| `specialist-test-agent` | Test Agent | Test execution, validation, coverage checks | `gpt-5.2-codex` | `gemini-3-flash-preview` (thinking: high) | High thinking helps debug failing tests quickly |
| `specialist-merge-agent` | Merge Agent | PR merging, conflict resolution, branch management | `gpt-4o` | `gemini-3-pro-preview` (thinking: low) | Conflict resolution + branch hygiene, Gemini Pro low is fine |

---

## 3. Subagents (Task Tool)

Subagents are spawned via the Task tool for specialized, isolated work.

| Work Type ID | Subagent Type | Description | Primary Model | Budget Alternative | Rationale |
|--------------|---------------|-------------|---------------|-------------------|-----------|
| `subagent:explore` | Explore | Codebase exploration, file search, pattern matching | `glm-4.7-flashx` | `gemini-3-flash-preview` (thinking: minimal) | Cheap, high-throughput pattern matching |
| `subagent:plan` | Plan | Architecture planning, design decisions | `gemini-3-pro-preview` (thinking: high) | `gemini-3-pro-preview` (thinking: low) | Same model, dial thinking down for cheaper/shorter plans |
| `subagent:bash` | Bash | Command execution, git operations, builds | `gpt-4o-mini` | `gemini-3-flash-preview` (thinking: low) | Quick shell orchestration and command intent |
| `subagent:general-purpose` | General Purpose | Multi-step research tasks, complex queries | `gpt-4o` | `gemini-3-pro-preview` (thinking: low) | Workhorse reasoning + tool routing without premium spend |

---

## 4. Convoy Members (Parallel Review)

Convoy agents run in parallel for comprehensive code review.

| Work Type ID | Member | Description | Primary Model | Budget Alternative | Rationale |
|--------------|--------|-------------|---------------|-------------------|-----------|
| `convoy:security-reviewer` | Security Reviewer | OWASP Top 10, vulnerabilities, auth issues | `claude-opus-4-6` | `gemini-3-pro-preview` (thinking: high) | Threat modeling + auth edge cases; Pro high is the Gemini pick |
| `convoy:performance-reviewer` | Performance Reviewer | Algorithms, resource usage, optimization | `gemini-3-pro-preview` (thinking: high) | `gemini-3-flash-preview` (thinking: high) | Performance review can often run on Flash high cheaply |
| `convoy:correctness-reviewer` | Correctness Reviewer | Logic errors, edge cases, type safety | `claude-sonnet-4-5` | `gemini-3-pro-preview` (thinking: high) | Correctness needs careful reasoning; Pro high is safer |
| `convoy:synthesis-agent` | Synthesis Agent | Combines findings from parallel reviewers | `claude-opus-4-6` | `gemini-3-pro-preview` (thinking: high) | Best Gemini substitute for synthesis across reviewers |

---

## 5. Pre-Work Agents

Planning now uses a single planning step that produces a vBRIEF plan (`plan.vbrief.json`). Cloister automatically converts the plan into beads via `createBeadsFromVBrief()`. The separate PRD, decomposition, and triage agents were removed in PAN-404.

| Work Type ID | Agent | Description | Primary Model | Budget Alternative | Rationale |
|--------------|-------|-------------|---------------|-------------------|-----------|
| `planning-agent` | Planning Agent | Feature planning, architecture, vBRIEF plan generation | `claude-opus-4-6` | `gemini-3-pro-preview` (thinking: high) | High-level planning substitute when Opus budget is red |

---

## 6. User-Facing (Main CLI)

Direct user interaction contexts.

| Work Type ID | Context | Description | Primary Model | Budget Alternative | Rationale |
|--------------|---------|-------------|---------------|-------------------|-----------|
| `cli:interactive` | Interactive CLI | User's direct conversation with Claude Code | `claude-sonnet-4-5` | `gemini-3-pro-preview` (thinking: low) | Daily driver chat with decent depth, cheaper |
| `cli:quick-command` | Quick Commands | Simple queries, status checks, one-liners | `gpt-4o-mini` | `gemini-3-flash-preview` (thinking: minimal) | Fastest/cheapest for one-liners and status checks |

---

## Configuration Presets

Panopticon provides three configuration presets for different budget scenarios:

### 1. Premium (Best Quality)
Uses top-tier models for all work types. Optimizes for quality and accuracy.
- **Cost**: Highest
- **Use case**: Critical production work, complex problems, quality-first projects

### 2. Balanced (Recommended)
Mixes premium models for critical tasks with cheaper alternatives for routine work.
- **Cost**: Moderate
- **Use case**: Daily development, most production work

### 3. Budget (Gemini-Leaning)
Uses Gemini models and cheaper alternatives wherever possible.
- **Cost**: Lowest
- **Use case**: High-volume work, experimentation, learning

---

## Fallback Strategy

When API keys for non-Anthropic providers are not configured:

1. **Primary fallback**: Use Anthropic models (claude-opus-4-6, claude-sonnet-4-5, claude-haiku-4-5)
2. **Model mapping**:
   - `gpt-*` models → `claude-sonnet-4-5`
   - `gemini-3-pro-preview` → `claude-sonnet-4-5`
   - `gemini-3-flash-preview` → `claude-haiku-4-5`
   - `o3-deep-research` → `claude-opus-4-6`
   - `glm-*` models → `claude-haiku-4-5`

This ensures Panopticon works out-of-the-box with just Claude API access.

---

## ID Naming Convention

- `specialist-*` — Long-running specialist agents (tmux sessions)
- `issue-agent:*` — Phases within a work agent session
- `subagent:*` — Task tool subagent types
- `convoy:*` — Parallel review convoy members
- `*-agent` — Standalone pre-work agents
- `cli:*` — User-facing CLI contexts

---

## Configuration Files

Model assignments for each work type can be configured in:

### Global Defaults
`~/.panopticon/config.yaml`

```yaml
models:
  preset: balanced  # premium | balanced | budget

  # Override specific work types
  overrides:
    issue-agent:implementation: gpt-5.2-codex
    specialist-review-agent: claude-opus-4-6

  # API keys for non-Anthropic providers
  api_keys:
    openai: sk-...
    google: ...
    zai: ...
```

### Per-Project Overrides
`.panopticon.yaml` in project root

```yaml
models:
  preset: premium  # Use premium models for this critical project

  overrides:
    convoy:security-reviewer: claude-opus-4-6  # Never compromise on security
```

---

## Integration with claude-code-router

Panopticon uses [claude-code-router](https://github.com/musistudio/claude-code-router) for multi-provider model routing. The router:

1. Manages API keys securely
2. Handles model-specific prompt formatting
3. Provides thinking level control for Gemini models
4. Falls back to Anthropic when providers are unavailable

See [PAN-78](https://github.com/eltmon/panopticon-cli/issues/78) for integration details.

---

## Planning and vBRIEF Conversion

Planning is now a single step that produces a vBRIEF plan with structured acceptance criteria:

| Phase | Responsibility | Agent | Model |
|-------|---------------|-------|-------|
| **Planning** | Architecture, approach, acceptance criteria, vBRIEF plan | `planning-agent` | claude-opus-4-6 (premium) or gemini-3-pro-preview (budget) |
| **Beads Conversion** | Automatic — vBRIEF items → beads with dependencies | Cloister (`createBeadsFromVBrief()`) | N/A (programmatic) |

The planning agent produces `plan.vbrief.json` with items, acceptance criteria, and dependency edges. Cloister automatically converts this into beads tasks, preserving the DAG structure. No separate decomposition or triage agents are needed.

---

## Implementation Status

- [x] Standardize all agents to use work type IDs
- [x] Implement preset configuration system
- [x] Add fallback strategy for missing API keys
- [ ] Update settings UI for work type management (blocked by PAN-118-6 migration task)
- [x] Decouple planning from decomposition
- [x] Add thinking level support for Gemini models (via claude-code-router)
- [x] Document model selection rationale

**Status**: Core functionality complete. Settings UI redesign pending Stitch integration.

**Tracking issue**: [PAN-118](https://github.com/eltmon/panopticon-cli/issues/118)
