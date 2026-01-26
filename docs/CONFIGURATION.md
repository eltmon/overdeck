# Configuration Guide

Complete guide to configuring Panopticon's multi-model routing system.

## Table of Contents

- [Quick Start](#quick-start)
- [Configuration Files](#configuration-files)
- [Presets](#presets)
- [Per-Work-Type Overrides](#per-work-type-overrides)
- [Provider Management](#provider-management)
- [Fallback Strategy](#fallback-strategy)
- [Examples](#examples)
- [Precedence Rules](#precedence-rules)

---

## Quick Start

1. **Choose a preset** (in `~/.panopticon/config.yaml`):
   ```yaml
   models:
     preset: balanced  # premium | balanced | budget
   ```

2. **Add API keys** (in `~/.panopticon.env`):
   ```env
   ANTHROPIC_API_KEY=sk-ant-...
   OPENAI_API_KEY=sk-...
   GOOGLE_API_KEY=...
   ZAI_API_KEY=...
   ```

3. **Start using Panopticon** - it works!

---

## Configuration Files

Panopticon uses two configuration file types:

### Global Configuration: `~/.panopticon/config.yaml`

System-wide defaults applied to all projects.

**Location**: `~/.panopticon/config.yaml`

**Format**: YAML

**Example**:
```yaml
models:
  # Preset selection
  preset: balanced  # premium | balanced | budget

  # Provider enable/disable
  providers:
    anthropic: true   # Always enabled (required)
    openai: true      # Enabled (has API key)
    google: false     # Disabled (no API key or user preference)
    zai: false        # Disabled

  # Per-work-type overrides (optional)
  overrides:
    issue-agent:implementation: gpt-5.2-codex
    convoy:security-reviewer: claude-opus-4-5
    subagent:explore: glm-4.7-flashx

  # Gemini thinking levels (optional)
  thinking:
    issue-agent:exploration: minimal
    issue-agent:planning: high
    convoy:performance-reviewer: high
```

### Per-Project Configuration: `.panopticon.yaml`

Project-specific overrides in the project root directory.

**Location**: `.panopticon.yaml` (project root)

**Format**: YAML

**Example**:
```yaml
models:
  # Override preset for this project
  preset: premium  # Use premium models for critical work

  # Project-specific overrides
  overrides:
    # Never compromise on security, even in budget mode
    convoy:security-reviewer: claude-opus-4-5

    # Use Codex for implementation in this codebase
    issue-agent:implementation: gpt-5.2-codex
```

### API Keys: `~/.panopticon.env`

Sensitive API keys stored separately from configuration.

**Location**: `~/.panopticon.env`

**Format**: Shell environment variable syntax

**Example**:
```env
# Anthropic (required)
ANTHROPIC_API_KEY=sk-ant-api03-...

# OpenAI (optional)
OPENAI_API_KEY=sk-...

# Google (optional)
GOOGLE_API_KEY=...

# Z.AI (optional)
ZAI_API_KEY=...

# Linear (for issue tracking)
LINEAR_API_KEY=lin_api_...
```

---

## Presets

Presets provide curated model configurations optimized for different priorities.

### Premium Preset

**Goal**: Best quality and accuracy
**Cost**: Highest
**Use case**: Critical production work, complex problems, quality-first projects

**Model Selection**:
- **Critical thinking**: claude-opus-4-5
- **Code generation**: gpt-5.2-codex
- **Security**: claude-opus-4-5
- **Exploration**: gemini-3-flash-preview
- **Documentation**: claude-sonnet-4-5

**Example**:
```yaml
models:
  preset: premium
```

### Balanced Preset (Recommended)

**Goal**: Good quality at moderate cost
**Cost**: Moderate
**Use case**: Daily development, most production work

**Model Selection**:
- **Critical thinking**: claude-opus-4-5 or gemini-3-pro-preview
- **Code generation**: gpt-5.2-codex or gemini-3-pro-preview
- **Security**: claude-sonnet-4-5
- **Exploration**: gemini-3-flash-preview
- **Documentation**: claude-sonnet-4-5

**Example**:
```yaml
models:
  preset: balanced
```

### Budget Preset

**Goal**: Lowest cost, Gemini-leaning
**Cost**: Lowest
**Use case**: High-volume work, experimentation, learning

**Model Selection**:
- **Most work**: gemini-3-pro-preview or gemini-3-flash-preview
- **Security**: gemini-3-pro-preview (thinking: high)
- **Exploration**: glm-4.7-flashx
- **Documentation**: claude-haiku-4-5

**Example**:
```yaml
models:
  preset: budget
```

---

## Per-Work-Type Overrides

Override specific work types while keeping preset defaults for others.

### Available Work Types

See [WORK-TYPES.md](./WORK-TYPES.md) for the complete list of 23 work types.

**Categories**:
- `issue-agent:*` - Main work agent phases (6 types)
- `specialist-*` - Long-running specialists (3 types)
- `subagent:*` - Task tool subagents (4 types)
- `convoy:*` - Parallel review convoy (4 types)
- `*-agent` - Pre-work agents (4 types: prd, triage, planning, decomposition)
- `cli:*` - User-facing CLI contexts (2 types)

### Override Examples

**Example 1: Always use Opus for security**
```yaml
models:
  preset: budget  # Use cheap models everywhere...

  overrides:
    convoy:security-reviewer: claude-opus-4-5  # ...except security!
```

**Example 2: Use Codex for implementation**
```yaml
models:
  preset: balanced

  overrides:
    issue-agent:implementation: gpt-5.2-codex  # Prefer Codex for code generation
    issue-agent:testing: gpt-5.2-codex         # Also for testing
```

**Example 3: Gemini-only configuration**
```yaml
models:
  preset: budget

  overrides:
    issue-agent:planning: gemini-3-pro-preview
    issue-agent:implementation: gemini-3-pro-preview
    convoy:security-reviewer: gemini-3-pro-preview

  thinking:
    issue-agent:planning: high
    convoy:security-reviewer: high
```

**Example 4: Performance-focused**
```yaml
models:
  preset: balanced

  overrides:
    subagent:explore: glm-4.7-flashx  # Fast exploration
    cli:quick-command: gpt-4o-mini    # Fast CLI responses

  thinking:
    issue-agent:exploration: minimal  # Minimal thinking for speed
```

---

## Provider Management

Enable or disable entire model families.

### Provider Configuration

```yaml
models:
  providers:
    anthropic: true   # Always enabled (Panopticon requires Claude)
    openai: true      # Enable OpenAI models (gpt-*, o3-*)
    google: true      # Enable Google models (gemini-*)
    zai: false        # Disable Z.AI models (glm-*)
```

### When Providers are Disabled

If a work type is configured to use a disabled provider:
1. **Fallback** is applied automatically
2. **Warning** is logged
3. **Work continues** with Anthropic equivalent

**Example**:
```yaml
models:
  preset: premium  # Uses gpt-5.2-codex for implementation

  providers:
    openai: false  # OpenAI disabled (no API key)

# Result: gpt-5.2-codex → claude-sonnet-4-5 (fallback)
```

---

## Fallback Strategy

When API keys are missing or providers disabled, Panopticon falls back to Anthropic models.

### Fallback Mappings

| Original Model | Fallback Model | Reason |
|----------------|----------------|--------|
| `gpt-5.2-codex` | `claude-sonnet-4-5` | Similar capability tier |
| `gpt-4o` | `claude-sonnet-4-5` | Similar capability tier |
| `gpt-4o-mini` | `claude-haiku-4-5` | Budget tier |
| `o3-deep-research` | `claude-opus-4-5` | Premium tier |
| `gemini-3-pro-preview` | `claude-sonnet-4-5` | Similar capability tier |
| `gemini-3-flash-preview` | `claude-haiku-4-5` | Budget tier |
| `glm-4.7` | `claude-haiku-4-5` | Budget tier |
| `glm-4.7-flashx` | `claude-haiku-4-5` | Budget tier |

### Fallback Behavior

1. **Automatic**: No configuration needed
2. **Logged**: Warning messages show fallback usage
3. **Seamless**: Work continues without interruption
4. **Guaranteed**: Works with only ANTHROPIC_API_KEY configured

### Example Scenario

**Configuration**:
```yaml
models:
  preset: premium  # Uses gpt-5.2-codex for implementation
```

**Missing API key**: `OPENAI_API_KEY` not configured

**Result**:
```
Warning: Model gpt-5.2-codex requires openai API key - falling back to claude-sonnet-4-5
```

**Outcome**: Implementation phase uses `claude-sonnet-4-5` instead

---

## Examples

### Example 1: Default Setup (Balanced)

Use Panopticon with sensible defaults.

**~/.panopticon/config.yaml**:
```yaml
models:
  preset: balanced
```

**~/.panopticon.env**:
```env
ANTHROPIC_API_KEY=sk-ant-api03-...
```

**Result**: Works immediately with Claude models only. Falls back gracefully for all work types.

---

### Example 2: Multi-Provider (Premium)

Use all providers for maximum flexibility.

**~/.panopticon/config.yaml**:
```yaml
models:
  preset: premium

  providers:
    anthropic: true
    openai: true
    google: true
    zai: false  # Don't need Z.AI
```

**~/.panopticon.env**:
```env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
```

**Result**: Uses best model for each work type according to premium preset.

---

### Example 3: Budget-Conscious (Gemini-Heavy)

Minimize costs with Gemini models.

**~/.panopticon/config.yaml**:
```yaml
models:
  preset: budget

  providers:
    anthropic: true
    google: true
    openai: false  # Don't pay for OpenAI
    zai: false

  overrides:
    # Only use Claude for security
    convoy:security-reviewer: claude-opus-4-5

  thinking:
    # Dial up thinking for complex tasks
    issue-agent:planning: high
    convoy:security-reviewer: high
    convoy:performance-reviewer: high
```

**~/.panopticon.env**:
```env
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...
```

**Result**: Gemini for most work, Claude Opus only for security review.

---

### Example 4: Per-Project Override (Critical Project)

Override global defaults for a specific project.

**~/.panopticon/config.yaml** (global):
```yaml
models:
  preset: balanced  # Default for all projects
```

**.panopticon.yaml** (project root):
```yaml
models:
  preset: premium  # This project is critical

  overrides:
    # Extra emphasis on quality
    convoy:security-reviewer: claude-opus-4-5
    convoy:correctness-reviewer: claude-opus-4-5
    issue-agent:implementation: gpt-5.2-codex
```

**Result**: This project uses premium models, other projects use balanced.

---

### Example 5: Custom Thinking Levels (Gemini)

Fine-tune Gemini thinking for cost/quality tradeoffs.

**~/.panopticon/config.yaml**:
```yaml
models:
  preset: budget  # Use Gemini everywhere

  thinking:
    # Minimal thinking for fast exploration
    issue-agent:exploration: minimal
    subagent:explore: minimal

    # High thinking for critical tasks
    issue-agent:planning: high
    convoy:security-reviewer: high
    decomposition-agent: high

    # Medium thinking for balanced tasks
    issue-agent:implementation: medium
    specialist-review-agent: medium
```

**Result**: Optimized Gemini usage - fast where possible, careful where needed.

---

## Precedence Rules

When multiple configuration sources exist, Panopticon resolves model selection in this order:

### Resolution Order

1. **Per-project override** (`.panopticon.yaml` in project root)
2. **Global override** (`~/.panopticon/config.yaml` overrides section)
3. **Preset default** (`~/.panopticon/config.yaml` preset selection)
4. **Fallback** (if provider disabled or API key missing)
5. **Hardcoded default** (`claude-sonnet-4-5`)

### Example Resolution

**Global config**:
```yaml
models:
  preset: balanced  # Default: gemini-3-flash-preview for exploration

  overrides:
    issue-agent:exploration: claude-haiku-4-5  # Override: use Haiku
```

**Project config** (`.panopticon.yaml`):
```yaml
models:
  overrides:
    issue-agent:exploration: glm-4.7-flashx  # Project override: use GLM
```

**Result**: `issue-agent:exploration` uses `glm-4.7-flashx` (project override wins)

---

## Advanced Configuration

### Debugging Model Resolution

To see which model is selected for a specific work type:

```bash
# View effective configuration
pan config show

# Check model for specific work type
pan config get issue-agent:implementation
```

### Validation

Panopticon validates configuration on startup:
- Invalid work type IDs → Warning logged, ignored
- Missing API keys → Fallback applied
- Syntax errors → Error message, defaults used

### Migration from settings.json

If you have an existing `~/.panopticon/settings.json`:

```bash
# Automatic migration (coming soon in PAN-118-6)
pan migrate-config

# Manual migration: convert complexity levels to work types
# Old: complexity.medium → New: issue-agent:* work types
```

---

## Getting Help

- **Configuration issues**: `pan config validate`
- **Full documentation**: [WORK-TYPES.md](./WORK-TYPES.md)
- **GitHub issues**: [panopticon-cli/issues](https://github.com/eltmon/panopticon-cli/issues)
- **Tracking issue**: [PAN-118](https://github.com/eltmon/panopticon-cli/issues/118)
