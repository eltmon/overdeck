# PAN-6: Add Subagent Templates for Common Orchestration Patterns

## Overview

Create 8 subagent templates for common orchestration patterns with full convoy integration and skills-based orchestration for parallel code review with automatic synthesis.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Usage Model | Task tool delegation + Convoy integration | Subagents work both ways: auto-delegation via Task tool AND convoy orchestration |
| Scope | All 8 agents + orchestration skill | Full implementation with convoy integration |
| Source Location | `repo/agents/` | Mirror skills pattern: `repo/agents/` -> `~/.panopticon/agents/` -> `~/.claude/agents/` |
| Sync Approach | Full SYNC_TARGETS integration | Modify paths.ts, sync.ts for consistency with skills/commands pattern |
| Synthesis Flow | Skills-based orchestration | A skill (`pan-code-review`) spawns reviewers via Task, waits, then spawns synthesis |
| Convoy Integration | Yes - in this PR | Convoy can specify subagent templates for parallel work |
| Output Location | `.claude/reviews/` | Each reviewer writes timestamped findings; synthesis agent reads all files |
| Constraints | No MCP servers | Don't add MCP server functionality |

## Architecture

### File Structure

```
repo/agents/                         # SOURCE OF TRUTH (committed)
├── code-review-correctness.md       # Logic errors, edge cases
├── code-review-security.md          # OWASP Top 10, vulnerabilities
├── code-review-performance.md       # Algorithms, N+1, memory
├── code-review-synthesis.md         # Combines findings, writes report
├── planning-agent.md                # Research and plan creation
├── codebase-explorer.md             # Fast read-only exploration
├── triage-agent.md                  # Issue categorization
└── health-monitor.md                # Stuck detection, log analysis

repo/skills/
├── pan-code-review/                 # NEW: Orchestration skill
│   └── SKILL.md                     # Spawns 3 reviewers + synthesis
└── [existing skills...]

~/.panopticon/agents/                # Runtime copy (from `pan init`)
└── [copied on install/update]

~/.claude/agents/                    # Target (from `pan sync`)
└── [symlinked from ~/.panopticon/agents/]
```

### Sync Flow

```
pan init / npm postinstall
    └── copies repo/agents/* to ~/.panopticon/agents/

pan sync
    └── symlinks ~/.panopticon/agents/* to ~/.claude/agents/*
```

### Convoy Integration

The convoy system (`pan convoy`) will be extended to support subagent templates:

```bash
# Current (issue-based):
pan convoy create "Code Reviews" --issues MIN-1,MIN-2,MIN-3

# New (template-based):
pan convoy create "Code Review" --template code-review --files "src/**/*.ts"

# Creates:
# - agent-<convoy-id>-correctness (uses code-review-correctness.md)
# - agent-<convoy-id>-security (uses code-review-security.md)
# - agent-<convoy-id>-performance (uses code-review-performance.md)
# - agent-<convoy-id>-synthesis (waits, then uses code-review-synthesis.md)
```

### Skills-Based Orchestration (pan-code-review)

The `pan-code-review` skill orchestrates the full review pipeline:

```markdown
---
name: pan-code-review
description: Orchestrated parallel code review with automatic synthesis
---

# Pan Code Review

When invoked:
1. Determine scope (git diff, specific files, or glob pattern)
2. Spawn three parallel reviewers via Task tool:
   - code-review-correctness
   - code-review-security
   - code-review-performance
3. Each writes findings to `.claude/reviews/<timestamp>-<type>.md`
4. When all complete, spawn code-review-synthesis to combine findings
5. Present unified report to user
```

### Code Changes Required

**1. agents/ directory** - Create 8 subagent templates
- Each with YAML frontmatter (name, description, model, tools, permissionMode)
- Body contains specialized review instructions

**2. paths.ts** - Add agents to SYNC_TARGETS
```typescript
export const SYNC_TARGETS = {
  claude: {
    skills: join(CLAUDE_DIR, 'skills'),
    commands: join(CLAUDE_DIR, 'commands'),
    agents: join(CLAUDE_DIR, 'agents'),  // NEW
  },
  // ... same for codex, cursor, gemini
};
```

**3. sync.ts** - Add agents sync logic
- Extend `SyncPlan` interface with `agents: SyncItem[]`
- Add agents planning in `planSync()`
- Add agents execution in `executeSync()`

**4. sync command** - Handle agents in dry-run and execution
- Display agents in dry-run output
- Include agents in backup directories
- Report agents in sync results

**5. init command** - Copy agents from package to ~/.panopticon/agents/
- Similar to how skills are copied

**6. convoy.ts / convoy command** - Add template-based convoy support
- New `--template` flag that maps to subagent templates
- Template defines which subagents to spawn
- Synthesis agent waits for others to complete

**7. pan-code-review skill** - Orchestration skill
- Coordinates parallel review via Task tool
- Manages shared output directory
- Triggers synthesis when all reviews complete

## Subagent Specifications

### 1. code-review-correctness.md
- **Model**: haiku (cost-efficient)
- **Tools**: Read, Grep, Glob, Write (write to reviews dir)
- **Focus**: Logic errors, edge cases, null handling, type safety
- **Output**: `.claude/reviews/<timestamp>-correctness.md`

### 2. code-review-security.md
- **Model**: sonnet (needs deeper reasoning)
- **Tools**: Read, Grep, Glob, Write
- **Focus**: OWASP Top 10, injection, auth issues, data exposure
- **Output**: `.claude/reviews/<timestamp>-security.md`

### 3. code-review-performance.md
- **Model**: haiku (pattern matching)
- **Tools**: Read, Grep, Glob, Write
- **Focus**: Algorithms, N+1 queries, memory leaks, caching
- **Output**: `.claude/reviews/<timestamp>-performance.md`

### 4. code-review-synthesis.md
- **Model**: sonnet (synthesis requires reasoning)
- **Tools**: Read, Write, Glob
- **Focus**: Combine findings, prioritize, write unified report
- **Input**: Reads from `.claude/reviews/*.md`
- **Output**: Final report to user or `.claude/reviews/<timestamp>-synthesis.md`

### 5. planning-agent.md
- **Model**: sonnet (complex reasoning)
- **Tools**: Read, Grep, Glob, WebFetch
- **permissionMode**: plan (read-only exploration)
- **Focus**: Codebase research, execution plan creation

### 6. codebase-explorer.md
- **Model**: haiku (fast, cheap)
- **Tools**: Read, Grep, Glob, Bash (read-only commands)
- **permissionMode**: plan
- **Focus**: Architecture discovery, pattern finding

### 7. triage-agent.md
- **Model**: haiku (classification)
- **Tools**: Read, Grep, Glob
- **Focus**: Issue categorization, complexity estimation

### 8. health-monitor.md
- **Model**: haiku (log analysis)
- **Tools**: Bash, Read (tmux, logs)
- **Focus**: Stuck detection, intervention suggestions

## Convoy Template System

### Template Definition

Templates define which subagents to spawn for a convoy type:

```typescript
// src/lib/convoy-templates.ts
interface ConvoyTemplate {
  name: string;
  description: string;
  agents: {
    role: string;
    subagent: string;  // references agents/*.md
    parallel: boolean;
    dependsOn?: string[];  // synthesis depends on others
  }[];
}

const CODE_REVIEW_TEMPLATE: ConvoyTemplate = {
  name: 'code-review',
  description: 'Parallel code review with synthesis',
  agents: [
    { role: 'correctness', subagent: 'code-review-correctness', parallel: true },
    { role: 'security', subagent: 'code-review-security', parallel: true },
    { role: 'performance', subagent: 'code-review-performance', parallel: true },
    { role: 'synthesis', subagent: 'code-review-synthesis', parallel: false, dependsOn: ['correctness', 'security', 'performance'] },
  ],
};
```

### Convoy CLI Changes

```bash
# New flags for convoy create:
pan convoy create <name>
  --template <template-name>  # Use subagent template
  --files <glob-pattern>      # Files to review (for code-review)
  --branch <branch>           # Branch to compare against

# Example:
pan convoy create "Review PR #123" --template code-review --files "src/**/*.ts"
```

### Convoy Execution

1. Create convoy with template config
2. Start parallel agents (correctness, security, performance)
3. Each agent runs its subagent template via `claude --agent <subagent>`
4. When parallel agents complete, start synthesis agent
5. Synthesis reads `.convoy/` or `.claude/reviews/` directory
6. Report completion to user

## Implementation Phases

### Phase 1: Core Subagents (Foundation)
1. Create `repo/agents/` directory
2. Create all 8 subagent templates
3. Test that Claude Code recognizes them when copied to `~/.claude/agents/`

### Phase 2: Sync Integration
4. Update paths.ts - add agents to SYNC_TARGETS
5. Update sync.ts - add agents to SyncPlan and sync logic
6. Update sync command - handle agents in output
7. Update init command - copy agents from package

### Phase 3: Orchestration Skill
8. Create `pan-code-review` skill
9. Implement Task tool spawning logic
10. Manage shared output directory
11. Coordinate synthesis triggering

### Phase 4: Convoy Integration
12. Create convoy-templates.ts with template definitions
13. Add `--template` flag to convoy create
14. Implement template-based agent spawning
15. Handle dependency ordering (synthesis waits)
16. Update convoy status to show template info

### Phase 5: Documentation & Testing
17. Update README with subagent docs
18. Create usage examples
19. Test full parallel review flow
20. Test convoy template flow

## Testing Plan

1. **Unit Tests**
   - Test `planSync()` includes agents
   - Test `executeSync()` creates agent symlinks
   - Test convoy template resolution
   - Test dependency ordering

2. **Integration Tests**
   - `pan sync --dry-run` shows agents
   - `pan sync` creates symlinks
   - `pan convoy create --template code-review` spawns correct agents
   - Synthesis waits for parallel agents

3. **E2E Testing**
   - Run `/pan-code-review` on real code
   - Verify all 3 reviews + synthesis
   - Test convoy flow end-to-end

## Dependencies

```
Phase 1: Core Subagents (no deps)
    │
    └──► Phase 2: Sync Integration (needs Phase 1)
            │
            └──► Phase 3: Orchestration Skill (needs Phase 2)
                    │
                    └──► Phase 4: Convoy Integration (needs Phase 2)
                            │
                            └──► Phase 5: Docs & Testing (needs all)
```

## Out of Scope

- MCP server functionality
- Auto-triggering reviews on git push (future: FPP hooks)
- Multiple convoy templates beyond code-review (can add later)
- Custom user templates (can add later)

## Open Questions

1. **Convoy vs Task delegation** - When user says "review my code", should it auto-detect if convoy is needed (large diff) vs simple Task delegation (small diff)?
   - **Proposed**: Start simple - user explicitly chooses `/pan-code-review` for orchestrated, or let Claude delegate to individual reviewers for quick checks.

2. **Review output format** - Should reviews be Markdown or structured JSON for easier parsing?
   - **Proposed**: Markdown for human readability. Synthesis agent parses markdown structure.

3. **Concurrent convoy limit** - Should we limit parallel convoys?
   - **Proposed**: Respect existing `maxParallel` setting from convoy config.

## References

- Issue: https://github.com/eltmon/panopticon-cli/issues/6
- PRD Section: "Parallel Agent Execution (Convoys via Skills)"
- PRD Section: "Part 7: Stuck Detection and Health Monitoring"
- Claude Code Subagent Docs: https://docs.anthropic.com/en/docs/claude-code/sub-agents
- Existing skill: `pan-subagent-creator` for subagent creation guidance
- Existing convoy system: `src/cli/commands/convoy.ts`, `src/lib/convoy.ts`
