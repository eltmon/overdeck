# Complete Panopticon Documentation Index

Comprehensive index of all documentation files in the Panopticon project.

## Root Directory (`/home/eltmon/projects/panopticon/`)

### README.md
**Path**: `/home/eltmon/projects/panopticon/README.md`

**Purpose**: Main project overview, installation guide, quick start, feature highlights

**Update When**:
- New major features are added
- Installation process changes
- Quick start examples need updates
- Project scope or goals change

**Sections**:
- Project overview
- Features
- Installation
- Quick start
- Usage examples
- Architecture overview
- Contributing

---

### CLAUDE.md
**Path**: `/home/eltmon/projects/panopticon/CLAUDE.md`

**Purpose**: Guidance for Claude Code agents working on Panopticon

**Update When**:
- Agent workflows change
- New critical warnings needed
- Commit message format changes
- Agent communication patterns change
- Beads usage patterns evolve

**Key Sections**:
- Model tracking in commits
- Task tracking with beads
- Agent messaging API
- Completion requirements
- Never defer work policy
- Never bypass system under test

---

### CONTRIBUTING.md
**Path**: `/home/eltmon/projects/panopticon/CONTRIBUTING.md`

**Purpose**: Contribution guidelines for external developers

**Update When**:
- Development workflow changes
- New coding standards established
- PR process updates
- Testing requirements change

---

### AGENTS.md
**Path**: `/home/eltmon/projects/panopticon/AGENTS.md`

**Purpose**: High-level agent architecture documentation

**Update When**:
- New agent types added
- Agent communication patterns change
- Architecture decisions made

---

## Docs Directory (`/home/eltmon/projects/panopticon/docs/`)

### CONFIGURATION.md
**Path**: `/home/eltmon/projects/panopticon/docs/CONFIGURATION.md`

**Purpose**: Complete guide to configuring Panopticon's multi-model routing and API setup

**Update When**:
- New model providers added
- Configuration options change
- New presets defined
- API integration examples needed
- Provider fallback logic changes
- Third-party API support added (Kimi, etc.)

**Sections**:
- Quick start
- Configuration files (config.yaml, .env)
- Presets (premium, balanced, budget)
- Per-work-type overrides
- Provider management
- Fallback strategy
- Examples (multi-provider, budget, etc.)
- Using alternative LLM APIs with Claude Code
- Advanced configuration

---

### WORK-TYPES.md
**Path**: `/home/eltmon/projects/panopticon/docs/WORK-TYPES.md`

**Purpose**: Definitions of all 23+ work types and their model assignments

**Update When**:
- New work types added
- Work type categories change
- Model assignment logic updates
- Phase definitions change

**Content**:
- Work type taxonomy
- Category definitions (issue-agent, convoy, subagent, etc.)
- Model selection per work type
- Reasoning for assignments

---

### SETTINGS-UI-DESIGN.md
**Path**: `/home/eltmon/projects/panopticon/docs/SETTINGS-UI-DESIGN.md`

**Purpose**: Settings UI design and implementation guide

**Update When**:
- New settings added to UI
- UI layout changes
- Settings validation logic updates

---

## PRD Directory (`/home/eltmon/projects/panopticon/docs/prds/`)

### Active PRDs (`docs/prds/active/`)
**Path**: `/home/eltmon/projects/panopticon/docs/prds/active/`

**Purpose**: Planning documents for in-progress issues

**Update When**:
- New issues start planning phase
- PRD needs refinement during implementation

**Naming**: `pan-{issue-number}-plan.md` or `PAN-{issue-number}-plan.md`

---

### Completed PRDs (`docs/prds/completed/`)
**Path**: `/home/eltmon/projects/panopticon/docs/prds/completed/`

**Purpose**: Archived planning documents for reference

**Update When**:
- Issue completes and merges
- Move from active/ to completed/

---

## CLI Directory (`/home/eltmon/projects/panopticon/cli/`)

### Command Documentation
**Path**: `/home/eltmon/projects/panopticon/cli/`

**Purpose**: Command-specific documentation and help text

**Update When**:
- New CLI commands added
- Command signatures change
- Help text needs updates

---

## Features Directory (`/home/eltmon/projects/panopticon/features/`)

### Feature Documentation
**Path**: `/home/eltmon/projects/panopticon/features/`

**Purpose**: Feature-specific documentation and specifications

**Update When**:
- New features documented
- Feature requirements change

---

## Guides Directory (`/home/eltmon/projects/panopticon/guides/`)

### User Guides
**Path**: `/home/eltmon/projects/panopticon/guides/`

**Purpose**: Step-by-step guides for common tasks

**Update When**:
- New user workflows documented
- Existing guides need updates for new features

---

## Configuration Directory (`/home/eltmon/projects/panopticon/configuration/`)

### Configuration Examples
**Path**: `/home/eltmon/projects/panopticon/configuration/`

**Purpose**: Sample configuration files and templates

**Update When**:
- New configuration options available
- Example configurations needed for new features

---

## File Discovery

To discover all documentation files:

```bash
# Find all markdown files
find /home/eltmon/projects/panopticon -name "*.md" -type f | grep -E "(docs|README|CONTRIBUTING)" | sort

# Find all .mdx files (if using MDX)
find /home/eltmon/projects/panopticon -name "*.mdx" -type f | sort
```

## Common Documentation Patterns

### API Integration Documentation
Location: `docs/CONFIGURATION.md` (new section)
Pattern: See "Using Alternative LLM APIs with Claude Code"

### Feature Documentation
Location: `README.md` (overview) + `docs/` (details)
Pattern: High-level in README, comprehensive guide in docs/

### CLI Documentation
Location: `cli/` directory + inline help text
Pattern: README in CLI directory + command --help output

### Architecture Decisions
Location: `AGENTS.md` or new ADR in project root
Pattern: Context, Decision, Consequences format
