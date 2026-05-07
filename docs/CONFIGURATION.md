# Configuration Guide

Complete guide to configuring Panopticon's multi-model routing system.

## Table of Contents

- [Quick Start](#quick-start)
- [Configuration Files](#configuration-files)
- [Permission Mode](#permission-mode)
- [Presets](#presets)
- [Per-Work-Type Overrides](#per-work-type-overrides)
- [Provider Management](#provider-management)
- [Model Deprecation & Migration](#model-deprecation--migration)
- [Fallback Strategy](#fallback-strategy)
- [Examples](#examples)
- [Precedence Rules](#precedence-rules)
- [Advanced Configuration](#advanced-configuration)
- [Using Alternative LLM APIs with Claude Code](#using-alternative-llm-apis-with-claude-code)
- [Getting Help](#getting-help)

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
    review:security: claude-opus-4-6
    subagent:explore: glm-4.7-flashx

  # Gemini thinking levels (optional)
  thinking:
    issue-agent:exploration: minimal
    issue-agent:planning: high
    review:performance: high

# Permission mode for spawned Claude Code agents.
# 'auto' (default) — Claude Code's classifier blocks destructive ops
# 'bypass'         — legacy --dangerously-skip-permissions behavior
# See the "Permission Mode" section for details and the required
# ~/.claude/settings.json prereq when using auto.
claude:
  permissionMode: auto
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
    review:security: claude-opus-4-6

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

# OpenAI (optional - requires router)
OPENAI_API_KEY=sk-...

# Google (optional - requires router)
GOOGLE_API_KEY=...

# Z.AI / GLM (optional - direct API, no router)
ZAI_API_KEY=your-zai-key

# Kimi / Moonshot (optional - direct API, no router)
KIMI_API_KEY=sk-kimi-...

# Linear (for issue tracking)
LINEAR_API_KEY=lin_api_...

# Hume AI (optional - for EVI voice config management)
HUME_API_KEY=your-hume-api-key
```

**Note**: Direct-compatible providers (Kimi, GLM) don't need claude-code-router. Only OpenAI and Gemini require the router.

**Note**: `HUME_API_KEY` is only needed if your project uses Hume EVI integration (see [External Service Integrations](#external-service-integrations) below).

---

## Permission Mode

Every Claude Code agent Panopticon spawns runs autonomously — no human is sitting at the
prompt to click "approve" on each tool call. To make that work, every spawn site passes
permission flags to `claude`. Panopticon ships with two modes for those flags:

| Mode | Flags passed | Behavior |
|------|--------------|----------|
| `auto` (**default since 0.8.16**) | `--permission-mode auto` | Claude Code's built-in classifier auto-approves safe tool calls and **blocks destructive ones** — force pushes, exfiltration, `rm -rf`, writes outside the workspace, etc. |
| `bypass` | `--dangerously-skip-permissions --permission-mode bypassPermissions` | Historical Panopticon behavior: every tool call auto-approved, no classifier. Use when you genuinely want zero gating, or when an agent runs against a non-Anthropic backend that rejects the `auto` flag. |

### Prereq for `auto` mode

Each user must have **`skipAutoPermissionPrompt: true`** in their own `~/.claude/settings.json`.
Without it, fresh tmux-spawned agents hang on the one-time auto-mode opt-in dialog (Claude
Code waits for keyboard confirmation that no autonomous agent will ever provide).

```json
{
  "skipDangerousModePermissionPrompt": true,
  "skipAutoPermissionPrompt": true
}
```

`auto` is also gated by Anthropic plan tier — it's available on Max, Team, Enterprise, and
direct API plans. Pro / Bedrock / Vertex / Foundry users may need to explicitly switch to
`bypass` (see Override below).

### Setting the mode

**1. Dashboard Settings → Permissions** (easiest). Two radio options: Auto / Bypass.
Saves to `~/.panopticon/config.yaml` automatically.

**2. Persist directly in `~/.panopticon/config.yaml`:**

```yaml
claude:
  permissionMode: auto    # or 'bypass'
```

`.panopticon.yaml` (per-project) accepts the same key and overrides the global setting for
that project only.

**2. Override per-invocation with `--yolo` or `PAN_YOLO`:**

```bash
pan up                     # uses config (default: auto)
pan up --yolo=false        # force auto for this invocation
pan up --yolo              # force bypass (yolo mode!)
pan up --yolo=true         # same as --yolo
pan up --no-yolo           # force auto

PAN_YOLO=false pan up      # env-var equivalent (works for child processes)
PAN_YOLO=true pan up       # env-var equivalent
```

The flag works in **any argv position** relative to the subcommand:

```bash
pan --yolo=false up        # before subcommand
pan up --yolo=false        # after subcommand
pan up agent-foo --yolo=no # after positional args
```

### Precedence

Highest wins:

1. **`PAN_YOLO` env var** (`true`/`yes`/`on`/`1` → bypass; `false`/`no`/`off`/`0` → auto)
2. **`--yolo` CLI flag** (normalized into `PAN_YOLO` before commander parses)
3. **`claude.permissionMode` in config** (`~/.panopticon/config.yaml`, then `.panopticon.yaml`)
4. **Default**: `auto`

### Caveats

- **`claudish`-routed providers** (Kimi, MiniMax, GLM, OpenRouter, Mimo, OpenAI non-subscription, Google CodeAssist) are **always pinned to `bypass`**, regardless of config. `auto` is a Claude Code research-preview feature that doesn't translate through claudish to the upstream provider. Tracked in [#1015](https://github.com/eltmon/panopticon-cli/issues/1015) — once claudish is fully replaced by CLIProxy, every provider will honor the config.
- **CLIProxy-routed OpenAI subscription** does honor the config — `claude` is still the binary, only `ANTHROPIC_BASE_URL` points at the local sidecar.
- Settings on **`~/.claude/settings.json`** are per-user, not per-project. Each developer needs `skipAutoPermissionPrompt: true` on their own machine. Panopticon doesn't write this for you.

### When to switch back to `bypass`

- Running an Anthropic plan that doesn't include the auto-mode preview
- Using Bedrock / Vertex / Foundry routing where the `auto` flag is rejected
- Doing intentionally destructive automation (data migration, bulk file rewrites, etc.) where the classifier is just adding latency
- Reproducing pre-0.8.16 behavior for a regression hunt

---

## Presets

Presets provide curated model configurations optimized for different priorities.

### Premium Preset

**Goal**: Best quality and accuracy
**Cost**: Highest
**Use case**: Critical production work, complex problems, quality-first projects

**Model Selection**:
- **Critical thinking**: claude-opus-4-6
- **Code generation**: gpt-5.2-codex
- **Security**: claude-opus-4-6
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
- **Critical thinking**: claude-opus-4-6 or gemini-3-pro-preview
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
- `review:*` - Parallel review agents (5 types: security, performance, correctness, requirements, synthesis)
- `*-agent` - Pre-work agents (4 types: prd, triage, planning, decomposition)
- `cli:*` - User-facing CLI contexts (2 types)

### Override Examples

**Example 1: Always use Opus for security**
```yaml
models:
  preset: budget  # Use cheap models everywhere...

  overrides:
    review:security: claude-opus-4-6  # ...except security!
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
    review:security: gemini-3-pro-preview

  thinking:
    issue-agent:planning: high
    review:security: high
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

## Parallel Review Agents

Panopticon's review specialist runs multiple reviewer agents in parallel before producing a synthesis report. You can customize which agents run, their models, and their focus areas via the `specialists.review_agents` list in `~/.panopticon/cloister.toml`.

### Default Reviewers

When `review_agents` is not configured, Panopticon uses three built-in reviewers:

| Name | Focus |
|---|---|
| `correctness` | Logic, edge cases, null handling, type safety |
| `security` | OWASP Top 10, injection, auth, secrets |
| `performance` | Algorithms, N+1 queries, memory leaks |

After all reviewers complete, a **synthesis** agent combines the findings.

### Configuration Schema

In `~/.panopticon/cloister.toml`:

```toml
# Each entry controls one parallel reviewer.
# Absent = use the three defaults (correctness, security, performance).

[[specialists.review_agents]]
name = "security"
model = "claude-opus-4-6"   # Optional: override model for this reviewer
focus = ["OWASP Top 10", "injection", "auth"]
enabled = true

[[specialists.review_agents]]
name = "performance"
# model not set → resolved via review:performance work-type routing
focus = ["algorithms", "N+1 queries", "memory leaks"]
enabled = true

[[specialists.review_agents]]
name = "correctness"
enabled = true

[[specialists.review_agents]]
name = "requirements"
enabled = true

[[specialists.review_agents]]
name = "docs-coverage"     # Custom reviewer — uses code-review-docs-coverage.md agent
focus = ["missing JSDoc", "README coverage"]
enabled = false            # Disabled by default; set to true to activate
```

### Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Reviewer name — maps to `agents/code-review-<name>.md` template |
| `model` | string | no | Model override (e.g. `claude-opus-4-6`). Falls back to `review:<name>` work-type routing |
| `focus` | string[] | no | Focus areas passed as context to the reviewer prompt |
| `enabled` | boolean | no | Set to `false` to skip this reviewer. Defaults to `true` |

### Per-Reviewer Model Overrides

You can also override reviewer models via the standard `models.overrides` map in `config.yaml`:

```yaml
models:
  overrides:
    review:security: claude-opus-4-6    # Security reviewer always uses Opus
    review:correctness: claude-sonnet-4-6
    review:performance: claude-sonnet-4-6
    review:requirements: claude-sonnet-4-6
    review:synthesis: claude-sonnet-4-6
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

## Model Deprecation & Migration

When model IDs change (e.g., `claude-opus-4-5` → `claude-opus-4-6`), Panopticon automatically migrates your configuration to use the current model IDs.

### How It Works

1. **Auto-Detection**: When you load settings (via Dashboard or CLI), Panopticon checks your model overrides against a deprecation mapping
2. **Automatic Backup**: If deprecated models are found, `config.yaml.bak` is created before any changes
3. **Silent Migration**: Deprecated model IDs are replaced with current equivalents in memory and on disk
4. **Console Logging**: Migration actions are logged to the console
5. **Dashboard Warnings**: The Settings page shows amber banners and toast notifications for deprecated models

### Current Deprecations

```yaml
# Deprecated → Current
claude-opus-4-5 → claude-opus-4-6
claude-sonnet-4-5 → claude-sonnet-4-6
```

### Example Migration

**Before** (`~/.panopticon/config.yaml`):
```yaml
models:
  overrides:
    issue-agent:planning: claude-opus-4-5      # deprecated
    issue-agent:implementation: claude-sonnet-4-5  # deprecated
```

**After auto-migration**:
```yaml
models:
  overrides:
    issue-agent:planning: claude-opus-4-6
    issue-agent:implementation: claude-sonnet-4-6
```

**Backup created**: `~/.panopticon/config.yaml.bak` (your original config, for safety)

**Console output**:
```
✓ Backed up config.yaml → config.yaml.bak

🔄 Model ID Migration:
  issue-agent:planning: claude-opus-4-5 → claude-opus-4-6
  issue-agent:implementation: claude-sonnet-4-5 → claude-sonnet-4-6
```

### Dashboard Behavior

When you open the Settings page with deprecated model IDs:

1. **Deprecation Banner**: Amber banner at the top showing all deprecated overrides
2. **Toast Notification**: Warning toast prompting you to save to complete migration
3. **Card Highlighting**: Agent cards with deprecated models show amber borders and "DEPRECATED" badge
4. **Auto-Fix on Save**: Clicking "Save" automatically migrates to current model IDs

### Strategy

- **Single-Hop Only**: Deprecation mappings are updated with each new model version
- **When 4.7 arrives**: Both `4-5→4-7` and `4-6→4-7` mappings will be added
- **No Multi-Hop**: We don't chain `4-5→4-6→4-7`; each mapping is direct

### Restoring from Backup

If you need to restore your original configuration:

```bash
cp ~/.panopticon/config.yaml.bak ~/.panopticon/config.yaml
```

**Note**: The backup file is overwritten on each migration, so it always contains the most recent pre-migration state.

---

## Fallback Strategy

When API keys are missing or providers disabled, Panopticon falls back to Anthropic models.

### Fallback Mappings

| Original Model | Fallback Model | Reason |
|----------------|----------------|--------|
| `gpt-5.2-codex` | `claude-sonnet-4-5` | Similar capability tier |
| `gpt-4o` | `claude-sonnet-4-5` | Similar capability tier |
| `gpt-4o-mini` | `claude-haiku-4-5` | Budget tier |
| `o3-deep-research` | `claude-opus-4-6` | Premium tier |
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
    review:security: claude-opus-4-6

  thinking:
    # Dial up thinking for complex tasks
    issue-agent:planning: high
    review:security: high
    review:performance: high
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
    review:security: claude-opus-4-6
    review:correctness: claude-opus-4-6
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
    review:security: high

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

Use the Settings page and the documented YAML files as the source of truth for model routing. Panopticon does not currently expose a `pan admin config show|get|set|validate` CLI for router inspection.

For the older TOML-backed runtime config, the currently supported admin CLI surface is shadow mode only:

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

## Using Alternative LLM APIs with Claude Code

When working on Panopticon, you can configure Claude Code itself to use third-party LLM APIs like Kimi instead of Anthropic's API. This is separate from Panopticon's multi-model routing and affects the Claude Code CLI tool you use to interact with Panopticon.

### API Compatibility Levels

Different LLM providers have different compatibility with Claude Code's API format:

**✅ Direct API Compatible** (No router needed):
- **Kimi/Moonshot** - Implements Anthropic-compatible API ✅ Tested
- **GLM (Z.AI)** - Implements Anthropic-compatible API ✅ Tested

**🔄 Requires Router** (API format translation needed):
- **OpenAI** - Different API structure, requires claude-code-router
- **Google Gemini** - Different API structure, requires claude-code-router

### Why Use Alternative APIs?

- **Cost savings**: Kimi and other providers may offer lower API costs
- **API limits**: Continue working when Anthropic credits are exhausted
- **Model access**: Use alternative models like Kimi K2, GLM, Gemini, GPT

### Configuring Direct-Compatible APIs (Kimi, GLM)

**CRITICAL**: Use `ANTHROPIC_AUTH_TOKEN` (not `ANTHROPIC_API_KEY`):

**Kimi API:**
```bash
# Option 1: Kimi coding endpoint
export ANTHROPIC_BASE_URL=https://api.kimi.com/coding/
export ANTHROPIC_AUTH_TOKEN=sk-kimi-YOUR_KEY_HERE
claude

# Option 2: Moonshot/Kimi K2 endpoint
export ANTHROPIC_BASE_URL=https://api.moonshot.ai/anthropic
export ANTHROPIC_AUTH_TOKEN=sk-kimi-YOUR_KEY_HERE
claude
```

**GLM (Z.AI) API:**
```bash
# GLM/Z.AI endpoint (Anthropic-compatible)
export ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic
export ANTHROPIC_AUTH_TOKEN=your-zai-api-key
export API_TIMEOUT_MS=300000  # Optional: increase timeout
claude
```

**Alternative (China mainland):**
```bash
export ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic
```

### Getting a Kimi API Key

1. **Register**: Sign up at [platform.moonshot.ai](https://platform.moonshot.ai/) (Google account recommended)
2. **Create key**: Console → API Keys → "Create New Key"
3. **Copy immediately**: Key is shown only once for security
4. **Add credits**: Navigate to Billing tab and purchase credits for API access

### Persistent Configuration

Add to your shell profile (`~/.bashrc` or `~/.zshrc`):

```bash
# Kimi API configuration for Claude Code
export ANTHROPIC_BASE_URL=https://api.kimi.com/coding/
export ANTHROPIC_AUTH_TOKEN=sk-kimi-YOUR_KEY_HERE
```

Then reload your shell:
```bash
source ~/.bashrc  # or source ~/.zshrc
```

### Verification

Check your Claude Code configuration:
```bash
claude /status
```

You should see the custom API endpoint listed in the status output.

### When to Use claude-code-router

For providers that require API format translation (OpenAI, Gemini), use claude-code-router:

```bash
# Install router
npm install -g @musistudio/claude-code-router

# Configure via router config
# See PAN-78 for dashboard UI configuration
```

**Architecture Decision**:
- **Direct APIs** (Kimi, GLM): Use `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` ← Simpler, less overhead
- **Incompatible APIs** (OpenAI, Gemini): Use claude-code-router ← Required for API translation

### Important Notes

- This configures **Claude Code** (the CLI tool), not Panopticon's agent routing
- Panopticon agents spawned via `pan work issue` will inherit this configuration
- All Claude Code sessions in the terminal will use the configured endpoint
- To switch back to Anthropic, unset the environment variables
- For Panopticon multi-model routing (mixing providers in one workflow), see PAN-78

### Resources

- [Kimi Third-Party Agents Documentation](https://www.kimi.com/code/docs/en/more/third-party-agents.html)
- [Setup Guide (Medium)](https://guozheng-ge.medium.com/set-up-claude-code-using-third-party-coding-models-glm-4-7-minimax-2-1-kimi-k2-5a3cdf38c261)
- [Kimi API Documentation](https://platform.moonshot.ai/docs)

---

## External Service Integrations

Panopticon can manage external service configurations as part of the workspace lifecycle. These are configured per-project in `~/.panopticon/projects.yaml` under the `workspace` section.

### Cloudflare Tunnels

Automatically creates/deletes Cloudflare tunnel ingress routes so workspaces are accessible via public URLs (e.g., `api-feature-min-123.mindyournow.com`).

**Config** (in `projects.yaml`):
```yaml
workspace:
  tunnel:
    provider: cloudflare
    tunnel_id: "your-tunnel-id"
    account_id: "your-account-id"
    zone_id: "your-zone-id"
    credentials_file: ~/.cloudflared/cert.pem
    service_target: "https://localhost"
    hostnames:
      - pattern: "api-{{FEATURE_FOLDER}}.yourdomain.com"
        http_host_header: "api-{{FEATURE_FOLDER}}.yourdomain.localhost"
        no_tls_verify: true
```

**Lifecycle**: Created during `pan workspace create`, deleted during `pan workspace remove` and deep-wipe.

**Module**: `src/lib/tunnel.ts`

### Hume EVI (Voice AI)

Automatically creates/deletes per-workspace Hume EVI configs for BYOLLM (Bring Your Own LLM). Each workspace gets its own Hume config with a workspace-specific callback URL, cloned from a production template config.

**Prerequisites**: `HUME_API_KEY` in `~/.panopticon.env`

**Config** (in `projects.yaml`):
```yaml
workspace:
  hume:
    template_config_id: "your-production-config-id"
    name_pattern: "kaia-{{FEATURE_FOLDER}}"
    byollm_url_pattern: "https://api-{{FEATURE_FOLDER}}.yourdomain.com/api/v1/ai/hume/chat/completions"
```

| Field | Description |
|-------|-------------|
| `template_config_id` | Hume EVI config ID to clone from (production config) |
| `name_pattern` | Name for workspace configs (supports `{{FEATURE_FOLDER}}`, `{{FEATURE_NAME}}` placeholders) |
| `byollm_url_pattern` | BYOLLM callback URL pattern (Hume calls this for LLM completions) |
| `api_key_env` | Env var name for Hume API key (default: `HUME_API_KEY`) |

**Lifecycle**:
- **Create**: Clones template config with workspace-specific BYOLLM URL, writes `.hume-config` env file (`HUME_CONFIG_ID`, `VITE_HUME_CONFIG_ID`) to workspace root
- **Remove/Deep-wipe**: Deletes workspace-specific Hume config via API

**Docker integration**: Add `.hume-config` as optional `env_file` in your docker-compose template:
```yaml
env_file:
  - path: ../.hume-config
    required: false
```

**Module**: `src/lib/hume.ts`

### Adding New Integrations

External service integrations follow a common pattern (see `tunnel.ts` and `hume.ts`):

1. Define a config interface in `workspace-config.ts`
2. Create a module with `create*()` and `delete*()` functions
3. Wire into `createWorkspace()` (before Docker start) and `removeWorkspace()`
4. Wire into the deep-wipe endpoint in `dashboard/server/index.ts`
5. Add to `projects.yaml` schema

---

## Getting Help

- **Configuration issues**: `pan config validate`
- **Full documentation**: [WORK-TYPES.md](./WORK-TYPES.md)
- **GitHub issues**: [panopticon-cli/issues](https://github.com/eltmon/panopticon-cli/issues)
- **Tracking issue**: [PAN-118](https://github.com/eltmon/panopticon-cli/issues/118)
