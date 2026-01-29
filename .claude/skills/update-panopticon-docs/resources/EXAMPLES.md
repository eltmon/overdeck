# Common Documentation Update Patterns

Real-world examples of common documentation tasks in Panopticon.

## Pattern 1: Adding Third-Party API Integration

**Task**: Document how to use a new API provider (like Kimi) with Claude Code.

**Files to Update**:
1. `docs/CONFIGURATION.md` - Add comprehensive section
2. `CLAUDE.md` - Add quick reference (optional)

**Steps**:

1. **Read the target file**:
   ```
   Read /home/eltmon/projects/panopticon/docs/CONFIGURATION.md
   ```

2. **Find insertion point**:
   - Look for similar sections (other API configurations)
   - Choose logical placement (usually before "Getting Help")

3. **Draft new section** with:
   - Clear heading: "## Using [Provider] API with Claude Code"
   - Why use it (benefits)
   - Configuration steps (with correct env var names!)
   - Getting API keys
   - Persistent setup instructions
   - Verification steps
   - Resources/links

4. **Update Table of Contents**:
   - Add link to new section
   - Maintain alphabetical or logical order

5. **Example structure**:
   ```markdown
   ## Using Alternative LLM APIs with Claude Code

   Brief intro...

   ### Why Use Alternative APIs?
   - Bullet points

   ### Configuration
   ```bash
   export ANTHROPIC_AUTH_TOKEN=...
   ```

   ### Getting API Keys
   1. Step one
   2. Step two

   ### Persistent Setup
   ```bash
   # Add to ~/.bashrc
   ```

   ### Verification
   ```bash
   claude /status
   ```

   ### Resources
   - [Link 1](url)
   - [Link 2](url)
   ```

**Real Example**: See PAN-78 commit adding Kimi API documentation.

---

## Pattern 2: Documenting New Configuration Option

**Task**: Add new preset or override option to configuration.

**Files to Update**:
1. `docs/CONFIGURATION.md` - Main documentation
2. `docs/WORK-TYPES.md` - If new work type added

**Steps**:

1. **Identify category**:
   - New preset? → Update "Presets" section
   - New provider? → Update "Provider Management"
   - New override? → Update "Per-Work-Type Overrides"

2. **Add to appropriate section**:
   - Follow existing format exactly
   - Include table entries if applicable
   - Add example configurations

3. **Update examples**:
   - Add new example showing the option
   - Or update existing example to include it

4. **Verification**:
   ```bash
   # Test the configuration
   pan config show
   ```

**Example - New Preset**:
```markdown
### Enterprise Preset

**Goal**: Maximum reliability for production
**Cost**: Highest
**Use case**: Mission-critical deployments

**Model Selection**:
- **All work**: claude-opus-4-5
- **No fallbacks**: Requires ANTHROPIC_API_KEY

**Example**:
```yaml
models:
  preset: enterprise
```​
```

---

## Pattern 3: Updating Feature Documentation

**Task**: Document new Panopticon feature.

**Files to Update**:
1. `README.md` - High-level overview
2. Relevant file in `docs/` - Detailed guide
3. `CLAUDE.md` - Agent guidance (if relevant)

**Steps**:

1. **Update README.md**:
   - Add to Features section (bullet point)
   - Update usage examples if needed
   - Keep it brief (1-2 sentences)

2. **Create or update detailed doc**:
   - New feature category? Create new `docs/FEATURE-NAME.md`
   - Extends existing? Update relevant `docs/*.md`
   - Include:
     - Overview
     - Installation/setup
     - Usage examples
     - Configuration options
     - Troubleshooting

3. **Update CLAUDE.md** (if feature affects agents):
   - Add guidance for using the feature
   - Include any critical warnings
   - Update completion requirements if needed

**Example**:

*README.md*:
```markdown
### Features

- 🎯 **Specialized Convoy Reviews** - Parallel security, performance, and correctness analysis
- 🤖 **Auto-resume Agents** - Suspended agents wake up when messaged (PAN-80)  ← NEW
- 📊 **Multi-model Routing** - Choose models per work type
```

*CLAUDE.md*:
```markdown
## Agent Messaging API (CRITICAL)

**ALWAYS use the proper API for sending messages to agents.**

The `messageAgent()` function:
- **Auto-resumes suspended agents** (PAN-80) - New feature!  ← NEW
- **Saves to mail queue** - Crash recovery
- **Handles session IDs** - Resume support
```

---

## Pattern 4: Fixing Documentation Errors

**Task**: Correct outdated or incorrect information.

**Steps**:

1. **Identify scope**:
   - Single file? Update that file
   - Multiple references? Search and update all

2. **Search for references**:
   ```bash
   grep -r "old incorrect text" docs/
   ```

3. **Update all occurrences**:
   - Use Edit tool with exact old text
   - Ensure consistency across all files

4. **Verify fix**:
   ```bash
   git diff
   git grep "new correct text"
   ```

**Example**:

Incorrect: "Use ANTHROPIC_API_KEY for third-party APIs"
Correct: "Use ANTHROPIC_AUTH_TOKEN for third-party APIs"

```bash
# Find all occurrences
grep -r "ANTHROPIC_API_KEY.*third" docs/

# Update each file
Edit docs/CONFIGURATION.md
  old: "export ANTHROPIC_API_KEY=..."
  new: "export ANTHROPIC_AUTH_TOKEN=..."
```

---

## Pattern 5: Adding Architecture Decision Record

**Task**: Document significant architecture decision.

**Files**:
- Create new ADR in appropriate location
- Update index if exists

**Format**:
```markdown
# ADR-XXXX: Title of Decision

**Status**: Accepted | Proposed | Deprecated
**Date**: YYYY-MM-DD
**Deciders**: Who was involved

## Context

What is the problem or opportunity?

## Decision

What did we decide?

## Consequences

What are the implications?

### Positive
- Benefit 1
- Benefit 2

### Negative
- Tradeoff 1
- Tradeoff 2

## Alternatives Considered

1. Alternative 1 - Why rejected
2. Alternative 2 - Why rejected
```

---

## Pattern 6: Updating CLI Help Text

**Task**: Update command documentation when CLI changes.

**Files to Update**:
1. `cli/` directory - Inline help text
2. Command README if exists

**Steps**:

1. **Update help text in source**:
   ```typescript
   // cli/commands/work.ts
   .description('Manage work agents')  // ← Update this
   ```

2. **Update any README**:
   ```markdown
   ## Commands

   ### `pan work issue`

   Create workspace and spawn agent for an issue.
   ```

3. **Verify**:
   ```bash
   pan work --help
   ```

---

## Pattern 7: Documenting Breaking Changes

**Task**: Document breaking changes in configuration or API.

**Files to Update**:
1. `README.md` - Add migration section
2. `docs/CONFIGURATION.md` - Add migration notes
3. `CHANGELOG.md` - Document change (if exists)

**Steps**:

1. **Add breaking change notice**:
   ```markdown
   ## ⚠️ Breaking Changes in v2.0

   ### Configuration File Format

   The configuration format has changed from JSON to YAML.

   **Migration**:
   ```bash
   # Old format (~/.panopticon/settings.json)
   {
     "models": {
       "preset": "balanced"
     }
   }

   # New format (~/.panopticon/config.yaml)
   models:
     preset: balanced
   ```​

   **Automatic migration**:
   ```bash
   pan migrate-config
   ```​
   ```

2. **Add migration guide**:
   - Step-by-step instructions
   - Automatic migration command if available
   - Backwards compatibility notes

3. **Update examples**:
   - Replace old examples with new format
   - Mark old examples as deprecated

---

## Quick Reference Checklist

When updating documentation:

**Read First**:
```
[ ] Read the file completely before editing
[ ] Understand existing structure and patterns
[ ] Check Table of Contents if present
```

**Write Clearly**:
```
[ ] Follow existing formatting style
[ ] Use code blocks with language tags
[ ] Include working examples
[ ] Add verification steps
```

**Verify**:
```
[ ] Test all code examples
[ ] Check internal links
[ ] Update Table of Contents
[ ] Run git diff to review changes
```

**Common Files by Task**:
- API integration → `docs/CONFIGURATION.md`
- New feature → `README.md` + `docs/`
- Agent guidance → `CLAUDE.md`
- Config option → `docs/CONFIGURATION.md`
- CLI command → `cli/` + inline help
- Architecture → New ADR or `AGENTS.md`
