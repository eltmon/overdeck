---
name: pan-docs
description: Find information in Panopticon documentation using the docs index
author: Panopticon
version: 1.0.0
triggers:
  - panopticon docs
  - find in panopticon docs
  - where is documentation for
  - panopticon documentation
  - pan docs
  - docs
allowed-tools:
  - Read
  - Grep
  - Glob
---

# Pan-Docs Skill — Documentation Finder

**Purpose:** Help agents quickly find information in Panopticon documentation by using the master documentation index.

---

## Workflow

When a user asks about Panopticon documentation or needs to find information:

### Step 1: Read the Documentation Index
```bash
Read docs/INDEX.md
```

The index contains:
- **Category organization**: Documents grouped by topic (Getting Started, Architecture, Configuration, etc.)
- **Topic Quick-Find**: Keyword mappings to relevant documents

### Step 2: Use Topic Quick-Find
Search the "Topic Quick-Find" section for keywords related to the user's question.

**Example queries:**
- "How do I configure API keys?" → Look for **"API keys"** → CONFIGURATION.md
- "How do agents work?" → Look for **"agent"** → AGENTS.md, SPECIALIST_WORKFLOW.md
- "How do I set up DNS?" → Look for **"DNS"** → DNS_SETUP.md
- "What are work types?" → Look for **"work types"** → WORK-TYPES.md

### Step 3: Read the Identified Document(s)
Use the Read tool to read the identified documentation file(s).

```bash
Read docs/CONFIGURATION.md
```

### Step 4: Return Answer with Source References
Provide the answer and **always include source file references**:

**Example response:**
> API keys are configured via environment variables in `.env` or `~/.panopticon/.env`. You can set:
> - `ANTHROPIC_API_KEY` for Claude/Anthropic
> - `MOONSHOT_API_KEY` for Kimi
> - `OPENROUTER_API_KEY` for OpenRouter
>
> **Source:** docs/CONFIGURATION.md (lines 45-67)

---

## Tips

- **Always check INDEX.md first** — Don't guess which file contains the information
- **Use multiple keywords** — If one keyword doesn't work, try related terms
- **Read multiple files if needed** — Some topics span multiple documents
- **Provide file paths** — Help users find the source for deeper reading

---

## Common Questions & Answers

| Question | Keywords | Document(s) |
|----------|----------|-------------|
| "How do I install Panopticon?" | install, setup | README.md |
| "How do I configure models?" | model routing, smart selection | CONFIGURATION.md, WORK-TYPES.md |
| "How do specialists work?" | specialist, handoff | SPECIALIST_WORKFLOW.md |
| "How do I set up workspaces?" | workspace, Docker | README.md, DNS_SETUP.md |
| "How do I contribute?" | contribution, contributing | CONTRIBUTING.md |
| "How does cost tracking work?" | cost, billing | cost-tracking.md |
| "What are beads?" | beads, tasks | CLAUDE.md |
| "How do I commit changes?" | commit, git commit | CLAUDE.md |

---

## When Documentation Is Missing

If you search the index and **cannot find** relevant documentation:

1. Check if the topic is covered under a different name in Topic Quick-Find
2. Use Grep to search all documentation for keywords:
   ```bash
   Grep --pattern "your keyword" --path docs/ --glob "*.md" --output-mode files_with_matches
   ```
3. If still not found, inform the user: *"I couldn't find documentation on [topic] in the current docs. The available categories are: [list categories from INDEX.md]"*

---

## Skill Maintenance

This skill relies on `docs/INDEX.md` being up-to-date. When documentation changes:

- New files → Add to INDEX.md
- New topics → Add keywords to Topic Quick-Find
- Renamed/moved files → Update INDEX.md paths
- Deleted files → Remove from INDEX.md

See: `update-panopticon-docs` skill for documentation maintenance guidelines.
