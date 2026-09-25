# Configuration Guide

Complete guide to configuring Overdeck's multi-model routing system.

## Table of Contents

- [Quick Start](#quick-start)
- [Configuration Files](#configuration-files)
- [Permission Mode](#permission-mode)
- [Removed: Presets, Work-Type Overrides, Thinking Levels](#removed-presets-work-type-overrides-thinking-levels)
- [Provider Management](#provider-management)
- [Local Models (Ollama)](#local-models-ollama)
- [Deprecated Model IDs](#deprecated-model-ids)
- [Provider Fallback](#provider-fallback)
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

Nothing reads `models.overrides` (#4131). If your config still carries it,
config load ignores it and logs one warning per process. Loading never rewrites
`config.yaml`. Saving from the Settings page drops the key from the file. The
Command Deck status review runs on `models.status_review_model` (see
[MODEL-CALLS.md](MODEL-CALLS.md)).

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

Each lane's model is `roles.review.sub.<lane>.model` (`resolveModel` in
`src/lib/config-yaml/roles.ts`). The built-in defaults give every lane its own
model (`security` on `workhorse:expensive`, the other three on
`workhorse:mid`), so setting `roles.review.model` alone does not change the
lanes. A lane uses `roles.review.model` only when its model is set to `parent`. The review parent, which writes the synthesis
in `full` mode and does the whole review in `quick` mode, uses
`roles.review.model`. See [MODEL-CALLS.md](MODEL-CALLS.md) for the defaults.

`roles.review.sub.synthesis` is retired (#4131). No spawn ever read it, because
synthesis runs on the review parent. Config load drops the key
(`RETIRED_SUB_ROLES` in `src/lib/config-yaml/roles.ts`), the Settings API
accepts it without error, and the Roles panel no longer shows it. To change the
synthesis model, set `roles.review.model`.

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
consult `review:*` keys in `models.overrides`; that map is retired (see
[Removed: Presets, Work-Type Overrides, Thinking Levels](#removed-presets-work-type-overrides-thinking-levels)).

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

Disabling a provider does not reroute role agents. `determineModel`
(`src/lib/agents/provider-env.ts`) resolves a role's model with `resolveModel`
(`src/lib/config-yaml/roles.ts`) and never checks `models.providers`. If
`roles.work.model` names a model whose provider is disabled, the agent still
launches on that model. Nothing substitutes an Anthropic model. `pan doctor` flags a tiered-execution
crew model, or `roles.work.model` when tiering is off, whose provider is not
enabled (`provider-not-enabled` in `src/lib/agents/tier-fitness.ts`).

To move a role off a provider, change its model: `roles.<role>.model`,
`roles.review.sub.<lane>.model`, or the `workhorses` slot it references.

---

## Local Models (Ollama)

Models served by a local Ollama (0.14.0 or newer) are addressed as
`ollama:<tag>` — for example `ollama:gemma4:12b` — and run on the `claude-code`
harness, which speaks the Anthropic Messages API that Ollama serves natively.
Local runs record `$0`.

The optional top-level `ollama:` block tunes the endpoint:

```yaml
ollama:
  base_url: http://localhost:11434   # default
  context_length: 65536              # default
```

| Key | Default | Meaning |
| --- | --- | --- |
| `base_url` | `http://localhost:11434` | Where the Ollama server listens. **Must be a localhost address** (`localhost`, `127.x.x.x`, or `::1`); anything else is a config-load error, because the point of a local model is that nothing leaves the machine. A trailing slash is stripped. No `/v1` suffix — Claude Code appends `/v1/messages` itself. |
| `context_length` | `65536` | The window Overdeck asks for when **it** starts `ollama serve`. It does not change a server someone else started. Must be an integer of at least 2048. |

The configured `context_length` is a request, not the authority. Overdeck
warm-loads the model and pins Claude Code to the window the server actually
assigned, because Ollama silently truncates a prompt past that window rather
than erroring.

Full setup — GPU requirements, installing Ollama, pulling a model, and setting
`OLLAMA_CONTEXT_LENGTH` on a server Overdeck does not own — is in
[configuration/local-models.mdx](../configuration/local-models.mdx).

---

## Deprecated Model IDs

`src/lib/model-deprecations.ts` maps retired model IDs to their replacements
(for example `claude-sonnet-4-5` → `claude-sonnet-4-6`). Overdeck resolves a
deprecated ID to its replacement in memory whenever it reads a model reference
(`resolveModelId` in `src/lib/model-capabilities.ts`). It never rewrites
`~/.overdeck/config.yaml` and never writes a `config.yaml.bak`.

When you save settings with a deprecated ID under `roles` or `workhorses`, the
Settings API returns a warning naming the replacement. The save still goes
through. To stop the warning, replace the ID in your config.

Mappings are single-hop: when a model is retired, every older ID that pointed
at it is re-pointed straight at its replacement.

---

## Provider Fallback

Provider fallback applies to one caller: conversation enrichment
(`resolveEnrichmentModel` in `src/lib/conversations/enrichment/enrich-session.ts`).
When the enrichment model's provider is disabled, `applyFallback`
(`src/lib/model-fallback.ts`) substitutes an Anthropic model:

1. the model's entry in `FALLBACK_MAP` in `src/lib/model-fallback.ts`, if it
   has one;
2. otherwise `models.provider_fallback_model` (default `claude-sonnet-5`, set
   in `src/lib/config-yaml/defaults.ts`).

If Anthropic is also disabled, it keeps the original model. Each substitution
logs a warning. Role agents never fall back (see
[When Providers are Disabled](#when-providers-are-disabled)).

```yaml
models:
  provider_fallback_model: claude-sonnet-5
```

See [MODEL-CALLS.md](MODEL-CALLS.md) ("Provider-disabled substitute") for where
this model is recorded.

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

Gate commands do not inherit the dashboard's `OVERDECK_*` environment (PAN-3902). Variables such as `OVERDECK_NO_RESUME` or `OVERDECK_TERMINAL_BACKEND` describe how the host booted, and a gate that saw them would pass or fail by boot state instead of by the diff. Only `OVERDECK_HOME` passes through. A gate that needs another `OVERDECK_*` value sets it in its `env:` map. The dashboard's `API_PORT`, `PORT`, and `DASHBOARD_URL` are dropped the same way.

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
