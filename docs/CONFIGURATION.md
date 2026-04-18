# Configuration Guide

Complete guide to Panopticon model routing, provider auth, and per-job overrides.

## Table of Contents

- [Quick Start](#quick-start)
- [How Routing Works](#how-routing-works)
- [Configuration Files](#configuration-files)
- [Provider Authentication](#provider-authentication)
- [Current Model Families](#current-model-families)
- [Job Settings and Work Types](#job-settings-and-work-types)
- [Overrides](#overrides)
- [Fallback Behavior](#fallback-behavior)
- [Examples](#examples)
- [Precedence Rules](#precedence-rules)
- [Advanced Configuration](#advanced-configuration)
- [Using Alternative LLM APIs with Claude Code](#using-alternative-llm-apis-with-claude-code)
- [External Service Integrations](#external-service-integrations)
- [Getting Help](#getting-help)

---

## Quick Start

1. **Start with the default capability-based routing**
   ```yaml
   # ~/.panopticon/config.yaml
   models:
     providers:
       anthropic:
         enabled: true
   ```

2. **Enable the extra providers you actually want**
   ```yaml
   models:
     providers:
       anthropic:
         enabled: true
       openai:
         enabled: true
         auth: subscription
       google:
         enabled: false
       kimi:
         enabled: true
         api_key: $KIMI_API_KEY
   ```

3. **Add only the job-specific overrides you care about**
   ```yaml
   models:
     overrides:
       issue-agent:implementation: gpt-5.4
       convoy:security-reviewer: claude-opus-4-6
       cli:quick-command: claude-haiku-4-5
   ```

4. **Put secrets in `~/.panopticon.env` when you need API keys**
   ```env
   ANTHROPIC_API_KEY=sk-ant-...
   KIMI_API_KEY=sk-kimi-...
   GOOGLE_API_KEY=...
   OPENROUTER_API_KEY=...
   ```

If you do nothing beyond enabling Anthropic, Panopticon still works. The router selects models from enabled providers and falls back to Anthropic when a selected provider cannot be used.

---

## How Routing Works

Panopticon’s current model system is capability-based.

Resolution flow:

1. **Capability-based selection** picks a model for each work type from the providers you have enabled.
2. **Per-work-type overrides** replace that automatic choice when you want a specific job pinned to a specific model.
3. **Provider auth mode** determines how the runtime reaches the provider.
   - OpenAI subscription auth routes through claudish as `cx@model`
   - OpenAI API key auth routes through claudish as `oai@model`
   - Google subscription auth routes through claudish as `go@model`
   - Anthropic-compatible direct providers use direct endpoints
4. **Fallback logic** swaps unavailable non-Anthropic models to a matching Anthropic tier so work continues.

What you usually configure:

- which providers are enabled
- which auth mode each provider should use
- a small number of job overrides
- Gemini thinking level if you rely on Gemini

What you usually do not need to configure:

- one model per work type
- Anthropic fallback behavior
- provider-specific prompt formatting

---

## Configuration Files

Panopticon reads configuration from four places.

### 1. Global config: `~/.panopticon/config.yaml`

This is the main config file for model routing.

```yaml
models:
  providers:
    anthropic:
      enabled: true
    openai:
      enabled: true
      auth: subscription
      plan: plus
    google:
      enabled: false
    kimi:
      enabled: true
      api_key: $KIMI_API_KEY
    openrouter:
      enabled: false

  overrides:
    issue-agent:implementation: gpt-5.4
    issue-agent:testing: claude-sonnet-4-6
    convoy:security-reviewer: claude-opus-4-6

  gemini_thinking_level: 3

openrouter:
  favorites:
    - openai/gpt-5.4-mini
    - anthropic/claude-sonnet-4.5
```

You can also use the short boolean form for simple providers:

```yaml
models:
  providers:
    anthropic: true
    openai: true
    google: false
```

Use the object form whenever you need `auth`, `plan`, or `api_key`.

### 2. Per-project config: `.pan.yaml`

Project config overrides global config for one repo.

```yaml
models:
  overrides:
    issue-agent:implementation: kimi-k2.5
    issue-agent:documentation: claude-sonnet-4-6
```

Panopticon still reads `.panopticon.yaml`, but that name is deprecated. Rename it to `.pan.yaml`.

### 3. Environment file: `~/.panopticon.env`

Use this for secrets and tokens that should not live in YAML.

```env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
KIMI_API_KEY=sk-kimi-...
OPENROUTER_API_KEY=sk-or-...
LINEAR_API_KEY=lin_api_...
GITHUB_TOKEN=ghp_...
GITLAB_TOKEN=glpat-...
RALLY_API_KEY=_abc123...
HUME_API_KEY=...
```

### 4. Settings page

The dashboard Settings page is the UI for:

- enabling and disabling provider families
- adding per-job model overrides
- managing tracker keys
- managing OpenRouter favorites

The YAML files remain the source of truth.

---

## Provider Authentication

Different providers use different auth paths.

### Anthropic

Anthropic is the required base provider.

- Native route: Claude Code / Anthropic
- Typical auth: local Claude login or `ANTHROPIC_API_KEY`
- Typical jobs: fallback, planning, security, review, synthesis

### OpenAI

OpenAI routes through claudish.

Use subscription auth when Panopticon should use your local Codex / ChatGPT login:

```yaml
models:
  providers:
    openai:
      enabled: true
      auth: subscription
      plan: plus
```

This maps OpenAI models to `cx@model`.

Use API-key auth when Panopticon should use `OPENAI_API_KEY`:

```yaml
models:
  providers:
    openai:
      enabled: true
      auth: api-key
      api_key: $OPENAI_API_KEY
```

This maps OpenAI models to `oai@model`.

### Google

Google also routes through claudish.

```yaml
models:
  providers:
    google:
      enabled: true
      auth: api-key
      api_key: $GOOGLE_API_KEY
```

If you use a subscription-style coding login instead:

```yaml
models:
  providers:
    google:
      enabled: true
      auth: subscription
```

### Kimi

Kimi is direct and Anthropic-compatible.

- Good for: implementation-heavy workloads where value matters
- Typical auth: API key or Kimi credential helper

```yaml
models:
  providers:
    kimi:
      enabled: true
      api_key: $KIMI_API_KEY
```

### OpenRouter

OpenRouter is direct and uses model IDs from its catalog.

```yaml
models:
  providers:
    openrouter:
      enabled: true
      api_key: $OPENROUTER_API_KEY
```

Use the Settings page to choose favorite OpenRouter models so they appear in the UI browser.

### Direct-compatible legacy / custom provider slots

Panopticon also supports direct Anthropic-compatible providers such as GLM-style and MiniMax-style integrations in the runtime. Most users do not need to touch those slots for normal day-to-day setup.

---

## Current Model Families

These are the main model families Panopticon currently understands in the router.

### Anthropic

| Model | Typical use |
|-------|-------------|
| `claude-opus-4-6` | Planning, architecture, security review, highest-confidence synthesis |
| `claude-sonnet-4-6` | Strong all-around implementation support, testing, documentation, review response |
| `claude-sonnet-4-5` | Compatibility with older overrides |
| `claude-haiku-4-5` | Fast helper agents, quick commands, cheap exploration |

### OpenAI

| Model | Typical use |
|-------|-------------|
| `gpt-5.4-pro` | Highest-end OpenAI coding slot |
| `gpt-5.4` | Premium implementation, debugging, large-context editing |
| `o3` | Deliberate reasoning and hard debugging |
| `o4-mini` | Cheaper reasoning-heavy work |
| `gpt-5.4-mini` | Fast implementation and interactive work |
| `gpt-5.4-nano` | Cheap quick tasks and lightweight agents |

### Google

| Model | Typical use |
|-------|-------------|
| `gemini-3.1-pro-preview` | Large-context planning and analysis |
| `gemini-3-flash` | Fast exploration and mixed general work |
| `gemini-3.1-flash-lite-preview` | Cheapest Gemini lane |

### Kimi

| Model | Typical use |
|-------|-------------|
| `kimi-k2.5` | High-value implementation and coding-heavy execution |

### OpenRouter

OpenRouter favorites are user-selected. Panopticon does not hardcode one OpenRouter lineup because those model IDs vary by upstream provider.

---

## Job Settings and Work Types

A "job setting" in Panopticon means a work type. Each work type maps to one part of the workflow and can be overridden independently.

These are routing slots, not a second copy of the runtime agent roster. Some entries below describe main workflow stages, some describe helper jobs, and convoy entries describe parallel review lanes inside the review system.

Current router-backed work types:

| Work type | When it is used |
|-----------|-----------------|
| `issue-agent:exploration` | Initial codebase discovery and requirement digestion before the main implementation push |
| `issue-agent:implementation` | The main code-writing phase in the issue worktree |
| `issue-agent:testing` | Test execution, test fixes, and validation passes |
| `issue-agent:documentation` | README updates, inline docs, migration notes, and supporting documentation |
| `issue-agent:review-response` | Follow-up passes after review feedback lands |
| `specialist-review-agent` | Dedicated code review specialist stage |
| `specialist-test-agent` | Specialist verification and test-focused validation |
| `specialist-merge-agent` | Final merge preparation and merge-time housekeeping |
| `specialist-inspect-agent` | Per-bead inspection stage invoked during implementation |
| `specialist-uat-agent` | Browser-based UAT stage after automated tests pass |
| `subagent:explore` | Fast helper subagent for searching and reading |
| `subagent:plan` | Helper subagent for task breakdown and approach sketches |
| `subagent:bash` | Helper subagent for shell-heavy work |
| `subagent:general-purpose` | General helper subagent when the task is mixed or unclear |
| `convoy:security-reviewer` | Security-focused parallel convoy review lane |
| `convoy:performance-reviewer` | Performance-focused parallel convoy review lane |
| `convoy:correctness-reviewer` | Logic and correctness parallel convoy review lane |
| `convoy:requirements-reviewer` | Requirement/design alignment parallel convoy review lane |
| `convoy:synthesis-agent` | Synthesis lane that combines convoy findings |
| `planning-agent` | Up-front planning and vBRIEF generation |
| `cli:interactive` | Long-running interactive CLI conversations |
| `cli:quick-command` | Short one-shot CLI requests |

See [WORK-TYPES.md](./WORK-TYPES.md) for the detailed per-job breakdown.

---

## Overrides

Overrides let you pin one job to one model while leaving the rest of the router automatic.

### Basic override

```yaml
models:
  overrides:
    issue-agent:implementation: gpt-5.4
```

### Security-first

```yaml
models:
  overrides:
    convoy:security-reviewer: claude-opus-4-6
    convoy:correctness-reviewer: claude-sonnet-4-6
```

### Kimi-heavy implementation

```yaml
models:
  providers:
    anthropic:
      enabled: true
    kimi:
      enabled: true
      api_key: $KIMI_API_KEY

  overrides:
    issue-agent:implementation: kimi-k2.5
    issue-agent:testing: claude-sonnet-4-6
```

### OpenAI subscription example

```yaml
models:
  providers:
    anthropic:
      enabled: true
    openai:
      enabled: true
      auth: subscription
      plan: plus

  overrides:
    issue-agent:implementation: gpt-5.4
    cli:quick-command: gpt-5.4-nano
```

### Gemini thinking level

Gemini currently uses one global thinking level:

```yaml
models:
  gemini_thinking_level: 4
```

Valid values are `1` through `4`.

---

## Fallback Behavior

When a selected provider cannot be used, Panopticon falls back to Anthropic.

Common reasons:

- the provider is disabled
- the provider requires an API key and none is configured
- a subscription-only path is unavailable

Typical fallback behavior:

| Selected model | Typical fallback |
|----------------|------------------|
| `gpt-5.4` | `claude-sonnet-4-6` |
| `gpt-5.4-mini` | `claude-haiku-4-5` |
| `gpt-5.4-pro` | `claude-sonnet-4-6` |
| `o3` | `claude-sonnet-4-6` |
| `gemini-3.1-pro-preview` | `claude-sonnet-4-6` |
| `gemini-3-flash` | `claude-haiku-4-5` |
| `kimi-k2.5` | `claude-sonnet-4-6` |

Fallback is intentional. The goal is continuity of work, not hard failure on every missing provider.

---

## Examples

### Example 1: Minimal setup

```yaml
models:
  providers:
    anthropic:
      enabled: true
```

Result:

- Anthropic only
- capability-based defaults
- no extra provider setup required

### Example 2: OpenAI implementation, Claude reviews

```yaml
models:
  providers:
    anthropic:
      enabled: true
    openai:
      enabled: true
      auth: subscription
      plan: plus

  overrides:
    issue-agent:implementation: gpt-5.4
    issue-agent:testing: gpt-5.4-mini
    convoy:security-reviewer: claude-opus-4-6
    specialist-review-agent: claude-opus-4-6
```

### Example 3: Kimi for implementation, Anthropic for review

```yaml
models:
  providers:
    anthropic:
      enabled: true
    kimi:
      enabled: true
      api_key: $KIMI_API_KEY

  overrides:
    issue-agent:implementation: kimi-k2.5
    specialist-review-agent: claude-opus-4-6
    specialist-test-agent: claude-sonnet-4-6
```

### Example 4: Large-context Google planning

```yaml
models:
  providers:
    anthropic:
      enabled: true
    google:
      enabled: true
      auth: api-key
      api_key: $GOOGLE_API_KEY

  overrides:
    planning-agent: gemini-3.1-pro-preview
    issue-agent:exploration: gemini-3-flash

  gemini_thinking_level: 4
```

### Example 5: Project-specific override

Global config:

```yaml
models:
  providers:
    anthropic:
      enabled: true
    openai:
      enabled: true
      auth: subscription

  overrides:
    issue-agent:implementation: gpt-5.4
```

Project config (`.pan.yaml`):

```yaml
models:
  overrides:
    issue-agent:implementation: kimi-k2.5
    issue-agent:documentation: claude-sonnet-4-6
```

Result: the project uses Kimi for implementation while every other repo keeps the global GPT override.

---

## Precedence Rules

Model resolution order:

1. `.pan.yaml` project override
2. `~/.panopticon/config.yaml` global override
3. capability-based automatic selection across enabled providers
4. Anthropic fallback if the chosen provider cannot be used

For non-model settings:

1. project YAML overrides global YAML
2. YAML overrides defaults
3. environment variables fill in missing secrets

---

## Advanced Configuration

### Debugging model resolution

Use the Settings page and the documented YAML files as the source of truth for model routing. Panopticon does not currently expose a `pan admin config show|get|set|validate` CLI for router inspection.

For the older TOML-backed runtime config, the currently supported admin CLI surface is shadow mode only:

```bash
pan admin config shadow --status
pan admin config shadow --tracker github --enable
pan admin config shadow --tracker github --disable
```

### Validation

Panopticon validates:

- known model IDs
- provider enablement
- Gemini thinking level range
- deprecated model IDs and migrations

### Deprecated IDs

Panopticon automatically migrates common retired IDs such as:

- `gpt-5.2-codex` → `gpt-5.4`
- `o3-deep-research` → `o3`
- `gpt-4o` → `gpt-5.4-mini`
- `gpt-4o-mini` → `gpt-5.4-nano`
- `gemini-3-pro-preview` → `gemini-3.1-pro-preview`
- `gemini-3-flash-preview` → `gemini-3-flash`
- `kimi-k2` → `kimi-k2.5`

The dashboard warns when deprecated IDs are still present, and saving settings migrates them forward.

---

## Using Alternative LLM APIs with Claude Code

This section is about the Claude Code CLI itself, not Panopticon’s work-type router.

### API compatibility levels

**Direct-compatible**:

- Kimi / Moonshot
- GLM-style Anthropic-compatible endpoints
- MiniMax coding endpoint

**Claudish-routed**:

- OpenAI
- Google Gemini

### Why do this?

- keep coding when Anthropic usage is constrained
- use a cheaper implementation model for heavy coding loops
- match different workloads to different providers

### Kimi example

```bash
export ANTHROPIC_BASE_URL=https://api.kimi.com/coding/
export ANTHROPIC_AUTH_TOKEN=sk-kimi-YOUR_KEY_HERE
claude
```

### GLM-style example

```bash
export ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic
export ANTHROPIC_AUTH_TOKEN=your-zai-api-key
export API_TIMEOUT_MS=300000
claude
```

### Verify Claude Code

```bash
claude /status
```

You should see the active endpoint and auth mode there.

---

## External Service Integrations

Panopticon can manage external service configurations as part of the workspace lifecycle. These are configured per-project in `~/.panopticon/projects.yaml` under the `workspace` section.

### Cloudflare Tunnels

Automatically creates and deletes Cloudflare tunnel ingress routes so workspaces are reachable via public URLs.

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

Lifecycle:

- created during `pan workspace create`
- deleted during `pan workspace remove` and deep-wipe

Module: `src/lib/tunnel.ts`

### Hume EVI (Voice AI)

Automatically creates and deletes per-workspace Hume EVI configs for BYOLLM.

Prerequisite:

- `HUME_API_KEY` in `~/.panopticon.env`

```yaml
workspace:
  hume:
    template_config_id: "your-production-config-id"
    name_pattern: "kaia-{{FEATURE_FOLDER}}"
    byollm_url_pattern: "https://api-{{FEATURE_FOLDER}}.yourdomain.com/api/v1/ai/hume/chat/completions"
```

| Field | Description |
|-------|-------------|
| `template_config_id` | Hume EVI config ID to clone from |
| `name_pattern` | Name for workspace configs |
| `byollm_url_pattern` | Workspace-specific BYOLLM callback URL |
| `api_key_env` | Env var for the Hume API key, default `HUME_API_KEY` |

Lifecycle:

- create: clones the template config and writes `.hume-config`
- remove: deletes the workspace-specific config

Docker integration example:

```yaml
env_file:
  - path: ../.hume-config
    required: false
```

Module: `src/lib/hume.ts`

### Adding new integrations

External service integrations follow a common pattern:

1. define the config interface in `workspace-config.ts`
2. create a module with `create*()` and `delete*()` functions
3. wire it into workspace create and remove flows
4. add cleanup to deep-wipe
5. add the schema to `projects.yaml`

---

## Getting Help

- inspect shadow-mode config: `pan admin config shadow --status`
- inspect work-type coverage: [WORK-TYPES.md](./WORK-TYPES.md)
- review higher-level guidance: [MODEL_RECOMMENDATIONS.md](./MODEL_RECOMMENDATIONS.md)
- file issues: [panopticon-cli/issues](https://github.com/eltmon/panopticon-cli/issues)
