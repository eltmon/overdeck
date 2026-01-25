# PAN-66: Review Skills Inside Agents

## Status: PLANNING COMPLETE

## Summary

Document all skills available to agents and update GitHub issue PAN-66 with the compiled list.

## Decision Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Output format | Names + descriptions | User preference - detailed enough to be useful, not exhaustive |
| Skill source | Skill tool definition | Most accurate reflection of what's actually available |
| Categorization | By purpose/domain | Makes the list navigable |

## Deliverable

Update GitHub issue PAN-66 with a categorized list of all available skills.

---

## Skills Available to Agents

### Panopticon Workflow (pan-*)

| Skill | Description |
|-------|-------------|
| pan-plan | Interactive planning workflow with AI-assisted discovery |
| pan-setup | First-time configuration wizard for Panopticon |
| pan-install | Guide through installing Panopticon prerequisites |
| pan-quickstart | Quick start guide combining installation, setup, and first workspace |
| pan-up | Start Panopticon dashboard and services |
| pan-down | Stop Panopticon dashboard and services gracefully |
| pan-restart | Restart the Panopticon dashboard (frontend and API server) |
| pan-status | Check running agents, workspaces, and system health |
| pan-health | Check Panopticon system health |
| pan-diagnose | Troubleshoot common Panopticon issues |
| pan-logs | View and analyze agent and system logs |
| pan-config | View and edit Panopticon configuration |
| pan-projects | Add, remove, and manage Panopticon-managed projects |
| pan-docker | Docker template selection and configuration for workspaces |
| pan-network | Traefik, local domains, and platform-specific networking setup |
| pan-tracker | Configure issue tracker integration (Linear, GitHub, GitLab) |
| pan-help | Overview of all Panopticon commands and capabilities |
| pan-sync | Sync Panopticon skills to Claude Code and other AI tools |
| pan-issue | Create workspace and spawn autonomous agent for an issue |
| pan-tell | Send a message to a running agent |
| pan-kill | Stop a running agent |
| pan-approve | Approve agent work and merge merge request |
| pan-rescue | Recover work from crashed or stopped agents |
| pan-convoy-synthesis | Synthesize results from parallel agent work in a convoy |
| pan-code-review | Orchestrated parallel code review with automatic synthesis |
| pan-skill-creator | Guide for creating and distributing Panopticon skills |
| pan-subagent-creator | Create custom Claude Code subagents with isolated context |

### Development Workflow

| Skill | Description |
|-------|-------------|
| feature-work | Standard workflow for implementing new features with testing |
| bug-fix | Systematic approach to investigating and fixing bugs |
| refactor | Safe refactoring approach with test coverage first |
| release | Step-by-step release process with versioning |
| dependency-update | Safe approach to updating dependencies |
| incident-response | Structured approach to production incidents |
| onboard-codebase | Systematic approach to understanding a new codebase |
| work-complete | Checklist for agents to properly complete work and signal readiness |

### Code Quality

| Skill | Description |
|-------|-------------|
| code-review | Comprehensive code review covering correctness, security, performance |
| code-review-security | Deep security analysis focusing on OWASP Top 10 |
| code-review-performance | Deep performance analysis focusing on algorithms and resources |

### Design & UI

| Skill | Description |
|-------|-------------|
| stitch-design-md | Analyze Stitch projects and synthesize semantic design system |
| stitch-react-components | Convert Stitch designs into modular Vite and React components |
| web-design-guidelines | Review UI code for accessibility and UX best practices |
| react-best-practices | React and Next.js performance optimization guidelines |

### AI Self-Monitoring (Not User-Invoked)

| Skill | Description |
|-------|-------------|
| knowledge-capture | Triggers when AI detects confusion or corrected mistakes |
| refactor-radar | Detects architectural debt causing repeated AI mistakes |

### Utilities

| Skill | Description |
|-------|-------------|
| beads | Git-backed issue tracker for multi-session work with dependencies |
| session-health | Detect and clean stuck Claude Code sessions |
| skill-creator | Guide for creating effective Claude Code skills |
| send-feedback-to-agent | Send findings from specialist agents back to issue agents |

### Work Command Aliases

These are alternative invocation patterns for common operations:

- work-status, work-tell, work-approve, work-pending, work-issues, work-plan, work-issue
- work:plan, work:triage, work:list, work:tell, work:issue, work:kill, work:pending, work:status, work:approve
- pan:health, pan:down, pan:help, pan:sync, pan:up

### Miscellaneous

| Skill | Description |
|-------|-------------|
| test-specialist-workflow | Test the full specialist handoff pipeline |
| damage-control | Lock/Unlock Pattern Editing |
| test-all | Run all backend and frontend tests, generate markdown report |
| resources | Show system resource breakdown (RAM, CPU, Docker containers) |
| claude-hud:setup | Configure claude-hud as your statusline |
| claude-hud:configure | Configure HUD display options |
| ralph-wiggum:ralph-loop | Start Ralph Wiggum loop in current session |
| ralph-wiggum:help | Explain Ralph Wiggum technique and available commands |

---

## Implementation Tasks

1. Copy the skills list above to GitHub issue PAN-66
2. Format appropriately for GitHub markdown rendering

---

## Notes

- Skills are defined in `~/.panopticon/skills/` and symlinked to `~/.claude/skills/`
- The Skill tool definition in the system prompt is the authoritative source for available skills
- Some skills are AI-initiated (knowledge-capture, refactor-radar) and don't appear in user-invocable lists
