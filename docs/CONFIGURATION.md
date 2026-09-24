# Configuration Guide

Complete guide to configuring Overdeck's multi-model routing system.

## Table of Contents

- [Quick Start](#quick-start)
- [Configuration Files](#configuration-files)
- [Permission Mode](#permission-mode)
- [Removed: Presets, Work-Type Overrides, Thinking Levels](#removed-presets-work-type-overrides-thinking-levels)
- [Provider Management](#provider-management)
- [Model Deprecation & Migration](#model-deprecation--migration)
- [Fallback Strategy](#fallback-strategy)
- [Advanced Configuration](#advanced-configuration)
- [Using Alternative LLM APIs with Claude Code](#using-alternative-llm-apis-with-claude-code)
- [Getting Help](#getting-help)

---

## Quick Start

1. **Pick your model slots** (optional, in `~/.overdeck/config.yaml`; the built-in defaults work without this):
   ```yaml
   workhorses:
     expensive: claude-opus-4-8
     mid: claude-sonnet-5
     cheap: claude-haiku-4-5
   ```

2. **Add API keys** (in `~/.overdeck.env`):
   ```env
   ANTHROPIC_API_KEY=sk-ant-...
   OPENAI_API_KEY=sk-...
   GOOGLE_API_KEY=...
   ZAI_API_KEY=...
   ```

3. **Start using Overdeck** - it works!

---

## Configuration Files

Overdeck uses two configuration file types:

### Global Configuration: `~/.overdeck/config.yaml`

System-wide defaults applied to all projects.

**Location**: `~/.overdeck/config.yaml`

**Format**: YAML

**Example**:
```yaml
models:
  # Provider enable/disable
  providers:
    anthropic: true   # Always enabled (required)
    openai: true      # Enabled (has API key)
    google: false     # Disabled (no API key or user preference)
    zai: false        # Disabled

# Model slots that roles reference as workhorse:<slot>
workhorses:
  expensive: claude-opus-4-8
  mid: claude-sonnet-5
  cheap: claude-haiku-4-5

# Per-role models (optional; see MODEL-CALLS.md for every role's default)
roles:
  work:
    model: gpt-5.2-codex
  review:
    sub:
      security:
        model: claude-opus-4-8

# Permission mode for spawned Claude Code agents.
# 'auto' (default) — Claude Code's classifier blocks destructive ops
# 'bypass'         — legacy --dangerously-skip-permissions behavior
# See the "Permission Mode" section for details and the required
# ~/.claude/settings.json prereq when using auto.
claude:
  permissionMode: auto
```

### Per-Project Configuration: `.overdeck.yaml`

Project-specific overrides in the project root directory.

**Location**: `.overdeck.yaml` (project root)

**Format**: YAML

**Example**:
```yaml
# Project values win over ~/.overdeck/config.yaml
roles:
  work:
    model: gpt-5.2-codex   # Use Codex for implementation in this codebase
  review:
    mode: full
    sub:
      security:
        model: claude-opus-4-8   # Never compromise on security here
```

### API Keys: `~/.overdeck.env`

Sensitive API keys stored separately from configuration.

**Location**: `~/.overdeck.env`

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

# QuantumLlama (fictional benchmark provider, no live endpoint)
QUANTUMLLAMA_API_KEY=ql-...

# Linear (for issue tracking)
LINEAR_API_KEY=lin_api_...

# Hume AI (optional - for EVI voice config management)
HUME_API_KEY=your-hume-api-key
```

**Note**: Direct-compatible providers (Kimi, GLM, MiniMax, MiMo) route through their native Anthropic-compatible endpoints. OpenAI and Gemini route through Overdeck's built-in CLIProxy sidecar.

**Note**: `HUME_API_KEY` is only needed if your project uses Hume EVI integration (see [External Service Integrations](#external-service-integrations) below).

---

## Permission Mode

Every Claude Code agent Overdeck spawns runs autonomously — no human is sitting at the
prompt to click "approve" on each tool call. To make that work, every spawn site passes
permission flags to `claude`. Overdeck ships with two modes for those flags:

| Mode | Flags passed | Behavior |
|------|--------------|----------|
| `auto` (**default since 0.8.16**) | `--permission-mode auto` | Claude Code's built-in classifier auto-approves safe tool calls and **blocks destructive ones** — force pushes, exfiltration, `rm -rf`, writes outside the workspace, etc. |
| `bypass` | `--dangerously-skip-permissions --permission-mode bypassPermissions` | Historical Overdeck behavior: every tool call auto-approved, no classifier. Use when you genuinely want zero gating, or when an agent runs against a non-Anthropic backend that rejects the `auto` flag. |

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
Saves to `~/.overdeck/config.yaml` automatically.

**2. Persist directly in `~/.overdeck/config.yaml`:**

```yaml
claude:
  permissionMode: auto    # or 'bypass'
```

`.overdeck.yaml` (per-project) accepts the same key and overrides the global setting for
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
3. **`claude.permissionMode` in config** (`~/.overdeck/config.yaml`, then `.overdeck.yaml`)
4. **Default**: `auto`

### Caveats

- **`claudish`-routed providers** (Kimi, MiniMax, GLM, OpenRouter, Mimo, OpenAI non-subscription, Google CodeAssist) are **always pinned to `bypass`**, regardless of config. `auto` is a Claude Code research-preview feature that doesn't translate through claudish to the upstream provider. Tracked in [#1015](https://github.com/eltmon/overdeck/issues/1015) — once claudish is fully replaced by CLIProxy, every provider will honor the config.
- **CLIProxy-routed OpenAI subscription** does honor the config — `claude` is still the binary, only `ANTHROPIC_BASE_URL` points at the local sidecar.
- Settings on **`~/.claude/settings.json`** are per-user, not per-project. Each developer needs `skipAutoPermissionPrompt: true` on their own machine. Overdeck doesn't write this for you.

### When to switch back to `bypass`

- Running an Anthropic plan that doesn't include the auto-mode preview
- Using Bedrock / Vertex / Foundry routing where the `auto` flag is rejected
- Doing intentionally destructive automation (data migration, bulk file rewrites, etc.) where the classifier is just adding latency
- Reproducing pre-0.8.16 behavior for a regression hunt

---

## Removed: Presets, Work-Type Overrides, Thinking Levels

These `models:` keys belonged to the old work-type router. Presets went first
(`60033c12674`), and PAN-1048 (`cfd48b80881`) deleted the router itself in
favour of roles and workhorse slots. Nothing picks a model from these keys. A config file that still carries them loads without error, and the
keys do nothing.

| Key | What it did | Where the job went |
|---|---|---|
| `models.preset` (`premium` / `balanced` / `budget`) | Picked a curated model per work type | `workhorses.expensive` / `mid` / `cheap`, which the role defaults reference as `workhorse:<slot>` |
| `models.overrides` (`issue-agent:*`, `review:*`, `specialist-*`, `subagent:*`, `cli:*` keys) | Pinned a model to one work type | `roles.<role>.model`, and `roles.review.sub.<lane>.model` for review lanes (see [Review Mode and Reviewer Models](#review-mode-and-reviewer-models)) |
| `models.thinking` | Set a Gemini thinking level per work type | dropped; per-role reasoning effort is `roles.<role>.effort` |

No spawn path reads `models.overrides`. What still touches it changes no
agent's model: the deprecated-model-ID migration below, a Settings deprecation
warning, and the Command Deck status review, which looks up a `status-review`
key in a Settings payload that never carries `overrides` and so always runs on
its built-in model.

---

## Review Mode and Reviewer Models

Review is configured under `roles.review` in `~/.overdeck/config.yaml`.
`roles.review.mode` chooses how an issue is reviewed (`resolveReviewMode` in
`src/lib/cloister/review-agent.ts`):

| Mode | Behavior |
|---|---|
| `quick` (default) | One review agent does a combined correctness, security, performance, and requirements pass. |
| `full` | Four parallel reviewer lanes (`correctness`, `security`, `performance`, `requirements`) plus a review parent that writes the synthesis. |
| `none` | No AI review. The verification quality floor still applies. |

Each lane's model is `roles.review.sub.<lane>.model`, falling back to
`roles.review.model` and then the built-in default (`resolveModel` in
`src/lib/config-yaml/roles.ts`). The review parent, which writes the synthesis
in `full` mode and does the whole review in `quick` mode, uses
`roles.review.model`. See [MODEL-CALLS.md](MODEL-CALLS.md) for the defaults.

```yaml
roles:
  review:
    mode: full
    sub:
      security:
        model: claude-opus-4-8
      correctness:
        model: claude-sonnet-4-6
```

**Removed:** the `[[specialists.review_agents]]` list in `cloister.toml`
(`name`, `model`, `focus`, `enabled`). Nothing reads it. The reviewer lanes are
fixed: a lane's model comes from `roles.review.sub.<lane>.model`, and whether
the lanes run at all comes from `roles.review.mode`. Reviewer dispatch does not
consult the `review:*` keys in `models.overrides` shown elsewhere on this page.

---

## Provider Management

Enable or disable entire model families.

### Provider Configuration

```yaml
models:
  providers:
    anthropic: true   # Always enabled (Overdeck requires Claude)
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
roles:
  work:
    model: gpt-5.2-codex

models:
  providers:
    openai: false  # OpenAI disabled (no API key)

# Result: gpt-5.2-codex → claude-sonnet-4-5 (fallback)
```

---

## Model Deprecation & Migration

When model IDs change (e.g., `claude-opus-4-5` → `claude-opus-4-6`), Overdeck rewrites deprecated IDs it finds in the retired `models.overrides` map of `~/.overdeck/config.yaml`. That map routes nothing (see [Removed](#removed-presets-work-type-overrides-thinking-levels)), so this migration only tidies a leftover key. Model IDs under `roles` and `workhorses` are not rewritten on disk.

### How It Works

1. **Auto-Detection**: When you load settings (via Dashboard or CLI), Overdeck checks your model overrides against a deprecation mapping
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

**Before** (`~/.overdeck/config.yaml`):
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

**Backup created**: `~/.overdeck/config.yaml.bak` (your original config, for safety)

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
cp ~/.overdeck/config.yaml.bak ~/.overdeck/config.yaml
```

**Note**: The backup file is overwritten on each migration, so it always contains the most recent pre-migration state.

---

## Fallback Strategy

When API keys are missing or providers disabled, Overdeck falls back to Anthropic models.

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
roles:
  work:
    model: gpt-5.2-codex
```

**Missing API key**: `OPENAI_API_KEY` not configured

**Result**:
```
Warning: Model gpt-5.2-codex requires openai API key - falling back to claude-sonnet-4-5
```

**Outcome**: Implementation phase uses `claude-sonnet-4-5` instead

---

## Advanced Configuration

### Debugging Model Resolution

`GET /api/models/resolve` on the dashboard returns the model each role and
review lane resolves to under the current config (`resolveModel` in
`src/lib/config-yaml/roles.ts`).

### Migration from settings.json

If you have an existing `~/.overdeck/settings.json`:

```bash
# Automatic migration (coming soon in PAN-118-6)
pan migrate-config

# Manual migration: convert complexity levels to work types
# Old: complexity.medium → New: issue-agent:* work types
```

---

## Using Alternative LLM APIs with Claude Code

When working on Overdeck, you can configure Claude Code itself to use third-party LLM APIs like Kimi instead of Anthropic's API. This is separate from Overdeck's multi-model routing and affects the Claude Code CLI tool you use to interact with Overdeck.

### API Compatibility Levels

Different LLM providers have different compatibility with Claude Code's API format:

**✅ Direct API Compatible** (No router needed):
- **Kimi/Moonshot** - Implements Anthropic-compatible API ✅ Tested
- **GLM (Z.AI)** - Implements Anthropic-compatible API ✅ Tested

**🔄 Requires CLIProxy** (Anthropic-compatible sidecar):
- **OpenAI** - Subscription auth via Codex CLI / CLIProxy sidecar
- **Google Gemini** - API key bridged into CLIProxy sidecar

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

### CLIProxy Sidecar (OpenAI, Gemini)

For providers whose APIs differ from Anthropic's format (OpenAI, Gemini), Overdeck
runs a local CLIProxy sidecar that translates requests. The sidecar starts
automatically with the dashboard — no manual installation needed.

**Architecture Decision**:
- **Direct APIs** (Kimi, GLM, MiniMax, MiMo): Use `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` ← Simpler, less overhead
- **Incompatible APIs** (OpenAI, Gemini): Use CLIProxy sidecar ← Handles auth bridging and API translation

### Important Notes

- This configures **Claude Code** (the CLI tool), not Overdeck's agent routing
- Overdeck agents spawned via `pan work issue` will inherit this configuration
- All Claude Code sessions in the terminal will use the configured endpoint
- To switch back to Anthropic, unset the environment variables
- For Overdeck multi-model routing (mixing providers in one workflow), see PAN-78

### Resources

- [Kimi Third-Party Agents Documentation](https://www.kimi.com/code/docs/en/more/third-party-agents.html)
- [Setup Guide (Medium)](https://guozheng-ge.medium.com/set-up-claude-code-using-third-party-coding-models-glm-4-7-minimax-2-1-kimi-k2-5a3cdf38c261)
- [Kimi API Documentation](https://platform.moonshot.ai/docs)

---

## External Service Integrations

Overdeck can manage external service configurations as part of the workspace lifecycle. These are configured per-project in `~/.overdeck/projects.yaml` under the `workspace` section.

## Project Registry Source Of Truth

The runtime project registry is `~/.overdeck/projects.yaml`; `PROJECTS_CONFIG_FILE` resolves to that file and the dashboard reads it directly. The tracked `.overdeck/projects.yaml` in this repository is a portable seed/snapshot for Overdeck development workspaces, not the active runtime config.

When Overdeck creates a workspace for this repo, `workspace-manager.ts` copies the live `~/.overdeck/projects.yaml` into `<workspace>/.overdeck/projects.yaml` so agents see the same project registry as the host. Keep the tracked snapshot aligned with intended defaults, but apply active-machine changes to `~/.overdeck/projects.yaml` by hand and restart/reload the dashboard when gate command behavior changes.

### Change-Scoped Verification Gates

The default `quality_gates.test` command is change-scoped:

```yaml
quality_gates:
  test:
    command: npx vitest run --changed {{CHANGED_BASE}}
    required: true
```

A project with extra test roots (e.g. overdeck's `src/dashboard/frontend`) appends them in its own explicit `quality_gates.test` (`… && cd src/dashboard/frontend && npx vitest run --changed {{CHANGED_BASE}}`). The generic default stays single-root so it works for any project.

`{{CHANGED_BASE}}` is injected as `origin/<target-branch>` after the verification runner syncs the target branch. This keeps unrelated pre-existing failures from failing every work agent gate. Vitest's `--changed` graph follows static imports; dynamic imports, fixtures, generated files, and environment-driven branches may need explicit tests because they can be invisible to the changed-file graph.

Keep e2e, Playwright, and other heavy browser tests out of the local per-change gate. Put them in CI-only jobs or an explicit `@slow` tier so local agent verification stays fast and targeted.

### Tests on CI (`verification.tests`)

A project with CI does not run its `quality_gates.test` gate on the host at all (PAN-3965): the verification gate runs typecheck, lint, and the project's other non-`test` gates, and the CI test job on the PR head is the test gate. One full-suite run per push, on CI.

```yaml
verification:
  tests: ci      # ci | local
```

| Value | Behavior |
| --- | --- |
| `ci` | Skip the local `test` gate. Merge readiness requires the PR checks green; a red CI job named `test` (or `tests`, `test (22)`, …) is journaled as `verification.failed { failedCheck: 'test' }` and sent to the work agent as verification feedback. |
| `local` | Run `quality_gates.test` on the host during verification, as before. |
| unset | `ci` when the project has `github_repo` and a GitHub Actions workflow that runs on pull requests and defines a job named `test`/`tests`/`test-*`/`test (…)`, else `local`. The verification artifact's `testsMode` records the mode and the reason. |

Agent feedback for a red CI test job comes from the GitHub webhooks, so a GitLab project that sets `ci` gets the pipeline merge gate but no automatic feedback message. See [PIPELINE-GATES.md](PIPELINE-GATES.md#one-full-suite-run-per-push-on-ci-pan-3965).

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

**Prerequisites**: `HUME_API_KEY` in `~/.overdeck.env`

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
- **GitHub issues**: [overdeck/issues](https://github.com/eltmon/overdeck/issues)
- **Tracking issue**: [PAN-118](https://github.com/eltmon/overdeck/issues/118)
