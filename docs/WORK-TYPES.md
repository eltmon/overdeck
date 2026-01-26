# Panopticon Work Types

A comprehensive breakdown of all controllable work types for model routing.

## 1. Issue Agent Phases (Main Work Agent)

| ID | Phase | Description |
|----|-------|-------------|
| `issue-agent:exploration` | Exploration | Understanding codebase, reading files, initial research |
| `issue-agent:planning` | Planning | Architecture design, approach selection |
| `issue-agent:implementation` | Implementation | Writing code, making changes |
| `issue-agent:testing` | Testing | Running tests, fixing failures, adding test coverage |
| `issue-agent:documentation` | Documentation | Writing docs, comments, README updates |
| `issue-agent:review-response` | Review Response | Addressing review feedback, fixing issues |

## 2. Specialist Agents (Long-Running)

| ID | Specialist | Description |
|----|------------|-------------|
| `specialist-review-agent` | Review Agent | Code review, quality checks, style enforcement |
| `specialist-test-agent` | Test Agent | Test execution, validation, coverage checks |
| `specialist-merge-agent` | Merge Agent | PR merging, conflict resolution, branch management |

## 3. Subagents (Task Tool)

| ID | Subagent Type | Description |
|----|---------------|-------------|
| `subagent:explore` | Explore | Codebase exploration, file search, pattern matching |
| `subagent:plan` | Plan | Architecture planning, design decisions |
| `subagent:bash` | Bash | Command execution, git operations, builds |
| `subagent:general-purpose` | General Purpose | Multi-step research tasks, complex queries |

## 4. Convoy Members (Parallel Review)

| ID | Member | Description |
|----|--------|-------------|
| `convoy:security-reviewer` | Security Reviewer | OWASP Top 10, vulnerabilities, auth issues |
| `convoy:performance-reviewer` | Performance Reviewer | Algorithms, resource usage, optimization |
| `convoy:correctness-reviewer` | Correctness Reviewer | Logic errors, edge cases, type safety |
| `convoy:synthesis-agent` | Synthesis Agent | Combines findings from parallel reviewers |

## 5. Pre-Work Agents

| ID | Agent | Description |
|----|-------|-------------|
| `prd-agent` | PRD Generation | Q&A-driven requirements gathering, PRD creation |
| `decomposition-agent` | Task Decomposition | PRD → Beads breakdown, story splitting, dependency mapping |
| `triage-agent` | Triage Agent | Issue prioritization, complexity estimation |
| `planning-agent` | Planning Agent | Initial feature planning, high-level architecture |

## 6. User-Facing (Main CLI)

| ID | Context | Description |
|----|---------|-------------|
| `cli:interactive` | Interactive CLI | User's direct conversation with Claude Code |
| `cli:quick-command` | Quick Commands | Simple queries, status checks, one-liners |

---

**Total controllable work types: 20**

## ID Naming Convention

- `specialist-*` — Long-running specialist agents (tmux sessions)
- `issue-agent:*` — Phases within a work agent session
- `subagent:*` — Task tool subagent types
- `convoy:*` — Parallel review convoy members
- `*-agent` — Standalone pre-work agents
- `cli:*` — User-facing CLI contexts

## Configuration

Model assignments for each work type can be configured in:
- `~/.panopticon/config.yaml` (global defaults)
- `.panopticon.yaml` (per-project overrides)

See [PAN-78](https://github.com/eltmon/panopticon-cli/issues/78) for claude-code-router integration.
