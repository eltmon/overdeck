# Panopticon Documentation Index

**Master index of all Panopticon documentation organized by category.**

---

## Getting Started

| Document | Description |
|----------|-------------|
| [README.md](../README.md) | Project overview, installation, and quickstart guide |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Contribution guidelines and development setup |

---

## Architecture & Design

| Document | Description |
|----------|-------------|
| [AGENTS.md](../AGENTS.md) | Agent system architecture and lifecycle |
| [SPECIALIST_WORKFLOW.md](./SPECIALIST_WORKFLOW.md) | How worker and specialist agents interact |
| [PRD.md](./PRD.md) | Product requirements document for Panopticon |
| [PRD-CLOISTER.md](./PRD-CLOISTER.md) | Cloister lifecycle manager requirements |
| [PRD-REMOTE-WORKSPACES.md](./PRD-REMOTE-WORKSPACES.md) | Remote workspace requirements |

---

## Configuration

| Document | Description |
|----------|-------------|
| [CONFIGURATION.md](./CONFIGURATION.md) | Multi-model routing, API keys, presets, and provider configuration |
| [WORK-TYPES.md](./WORK-TYPES.md) | 23 work type definitions for smart model selection |
| [MODEL_RECOMMENDATIONS.md](./MODEL_RECOMMENDATIONS.md) | Optimal model assignments for different tasks |

---

## Infrastructure

| Document | Description |
|----------|-------------|
| [DNS_SETUP.md](./DNS_SETUP.md) | Local DNS resolution for development |
| [cost-tracking.md](./cost-tracking.md) | Event-sourced cost tracking system |

---

## Testing

| Document | Description |
|----------|-------------|
| [E2E_TEST_PLAN.md](./E2E_TEST_PLAN.md) | End-to-end test plan and coverage |
| [TESTING-PROVIDERS.md](./TESTING-PROVIDERS.md) | Provider testing guide |

---

## Agent Guidance

| Document | Description |
|----------|-------------|
| [CLAUDE.md](../CLAUDE.md) | Agent instructions (commit rules, messaging API, completion requirements) |

---

## UI/UX Design

| Document | Description |
|----------|-------------|
| [SETTINGS-UI-DESIGN.md](./SETTINGS-UI-DESIGN.md) | Settings page design and implementation |

---

## Planning (PRDs)

| Location | Description |
|----------|-------------|
| [docs/prds/active/](./prds/active/) | 13 active product requirement documents |
| [docs/prds/completed/](./prds/completed/) | 31 completed product requirement documents |

---

## Topic Quick-Find

**Search by keyword to find relevant documentation:**

### General Topics
- **"getting started"** → README.md, CONTRIBUTING.md
- **"install"** / **"setup"** → README.md, CONTRIBUTING.md, DNS_SETUP.md
- **"quickstart"** → README.md
- **"contribution"** / **"contributing"** → CONTRIBUTING.md

### Configuration & Models
- **"model routing"** / **"smart selection"** → CONFIGURATION.md, WORK-TYPES.md, MODEL_RECOMMENDATIONS.md
- **"API keys"** / **"environment variables"** → CONFIGURATION.md
- **"providers"** / **"Kimi"** / **"Anthropic"** → CONFIGURATION.md, TESTING-PROVIDERS.md
- **"work types"** → WORK-TYPES.md
- **"presets"** / **"overrides"** → CONFIGURATION.md
- **"model recommendations"** → MODEL_RECOMMENDATIONS.md

### Agent System
- **"agent"** / **"agents"** → AGENTS.md, SPECIALIST_WORKFLOW.md, CLAUDE.md
- **"lifecycle"** → AGENTS.md, PRD-CLOISTER.md
- **"specialist"** / **"specialists"** → SPECIALIST_WORKFLOW.md
- **"worker"** → SPECIALIST_WORKFLOW.md
- **"cloister"** → AGENTS.md, PRD-CLOISTER.md
- **"handoff"** / **"handoffs"** → SPECIALIST_WORKFLOW.md
- **"stuck detection"** → AGENTS.md, SPECIALIST_WORKFLOW.md
- **"merge"** / **"merge validation"** → PRD-CLOISTER.md (Merge Validation Pipeline section)
- **"rollback"** / **"revert"** / **"ORIG_HEAD"** → PRD-CLOISTER.md
- **"baseline"** / **"test baseline"** → PRD-CLOISTER.md
- **"review pipeline"** / **"specialist pipeline"** → PRD-CLOISTER.md, SPECIALIST_WORKFLOW.md

### Infrastructure
- **"workspace"** / **"workspaces"** → README.md, PRD-REMOTE-WORKSPACES.md
- **"Docker"** → README.md, DNS_SETUP.md
- **"DNS"** / **"domains"** → DNS_SETUP.md
- **"remote"** → PRD-REMOTE-WORKSPACES.md
- **"git"** / **"worktree"** → README.md, CLAUDE.md

### Monitoring & Cost
- **"cost"** / **"billing"** / **"tracking"** → cost-tracking.md, CONFIGURATION.md
- **"monitoring"** / **"heartbeat"** → AGENTS.md
- **"metrics"** → cost-tracking.md

### Testing
- **"test"** / **"testing"** → E2E_TEST_PLAN.md, TESTING-PROVIDERS.md
- **"E2E"** / **"end-to-end"** → E2E_TEST_PLAN.md
- **"coverage"** → E2E_TEST_PLAN.md

### Development
- **"skills"** → README.md, CLAUDE.md
- **"commit"** / **"git commit"** → CLAUDE.md
- **"messaging"** / **"messageAgent"** → CLAUDE.md
- **"completion"** / **"work complete"** → CLAUDE.md
- **"beads"** / **"tasks"** → CLAUDE.md

### UI/UX
- **"settings"** / **"settings page"** → SETTINGS-UI-DESIGN.md
- **"dashboard"** → README.md
- **"UI"** / **"frontend"** → SETTINGS-UI-DESIGN.md

### Planning
- **"PRD"** / **"requirements"** → PRD.md, prds/active/, prds/completed/
- **"roadmap"** / **"planning"** → prds/active/

---

## Documentation Maintenance

**When updating documentation:**
1. Update the relevant document(s)
2. If adding a new file, add it to this index under the appropriate category
3. If adding new topic coverage, add keywords to Topic Quick-Find section
4. Verify all links in this index remain valid

See also: `update-panopticon-docs` skill for documentation best practices.
