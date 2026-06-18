# Planning: PAN-598 — Support latest ChatGPT/OpenAI models with subscription tier awareness

## Summary

Replace `claude-code-router` with `claudish` as the multi-model router and extend OpenAI model support with subscription tier awareness. claudish (v6.12.2) provides OAuth-based ChatGPT subscription access via claudish prefixes, replacing the API-key-only approach.

## Key Decisions

### 1. Auth Configuration

**For API key auth:** Both `config.yaml` (primary) and environment variables (fallback for CI/automation). No change to existing pattern.

**For OAuth auth:** Refer to claudish documentation. Users run `claudish login` for their provider (e.g., ChatGPT Plus/Pro, Google OAuth). Overdeck detects claudish auth state and routes accordingly.

**Config schema addition** (`config-yaml.ts`):
```yaml
models:
  providers:
    openai:
      enabled: true
      auth: subscription  # "subscription" | "api-key" (default: "api-key")
      plan: pro           # "free" | "plus" | "pro" (only for subscription)
    google:
      auth: subscription
      plan: pro
```

### 2. CCR Command

**Remove entirely.** claudish is managed via `pan install`/`pan sync` only. No direct CLI command needed for end users. The `pan ccr` command and its docs are deleted.

### 3. claudish Installation

- **Linux:** Download binary directly from GitHub releases (`claudish-linux-x64`, `claudish-linux-arm64`)
- **macOS:** Homebrew formula works (macOS only)
- `pan install` auto-detects OS and uses correct method
- Linux binary is installed to `~/.local/bin/claudish` or `$PATH` location

### 4. Model Prefixes

claudish uses `provider@model` syntax:
- `oai@` — OpenAI API key
- `go@` — Google OAuth (Gemini CodeAssist)
- `g@` — Google API key
- `kimi@` — Kimi API key
- Plus others (openrouter, ollama, etc.)

**ChatGPT OAuth (`cx@`) prefix:** NOT confirmed in current claudish documentation (v6.12.2). The planning prompt mentions it via "Codex subscription OAuth" introduced in v6.10.0, but it's not listed in the README. **Research item:** verify if `cx@` is the correct prefix for ChatGPT Plus/Pro OAuth. If not confirmed, use the verified prefix from claudish docs or the `go@`/`oai@` pattern.

### 5. Dashboard Model Display

Show **full prefix + backing** for claudish-routed agents: e.g., `oai@gpt-5.4` or `go@o3-mini`. The tmux pane parser (`workspaces.ts`) needs to be updated to recognize OpenAI model names in addition to `[Opus]/[Sonnet]/[Haiku]`. A display helper function will format the prefix + display name for the inspector panel.

### 6. OpenAI Model Registry

Current models (already present): `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`, `o3`. Add based on actual releases (April 2026):
- `o4-mini` (if released)
- `gpt-4.1` family (if released)
- Other confirmed models from claudish's model catalog

**Do not add speculative models.** Only add models that are confirmed in claudish's 580+ model catalog.

### 7. Token Usage Tracking

Already works — `AIProvider` includes `'openai'` and `DEFAULT_PRICING` has OpenAI models. Need to handle model name stripping in `costs/reconciler.ts` for claudish-prefixed names (e.g., `oai@gpt-5.4` → strip prefix → `gpt-5.4` for pricing lookup). The JSONL entries from Claude Code report the API model name (without claudish prefix in the response), so this should work out of the box. **Verify by testing.**

## Files to Change

| File | Change |
|------|--------|
| `src/lib/model-capabilities.ts` | Add new OpenAI models, add `minTier` field to `ModelCapability` |
| `src/lib/config-yaml.ts` | Add `auth`/`plan` fields to provider config schema |
| `src/lib/providers.ts` | Add claudish prefix mapping, update provider descriptions |
| `src/lib/model-fallback.ts` | Tier-aware fallback (prefer GPT within OpenAI before switching providers) |
| `src/lib/smart-model-selector.ts` | Filter by subscription tier availability |
| `src/lib/agents.ts` | Add `getClaudishPrefix()` utility, update `spawnAgent` to apply prefix |
| `src/lib/router-config.ts` | Replace CCR config with claudish config generation (or remove if CCR is fully gone) |
| `src/cli/commands/ccr/index.ts` | **DELETE** — CCR command removed |
| `src/cli/commands/install.ts` | Replace CCR install with claudish binary download from GitHub releases |
| `src/cli/commands/sync.ts` | Replace CCR sync check with claudish version check |
| `src/dashboard/server/routes/workspaces.ts` | Update tmux pane model parser to recognize OpenAI names |
| `src/dashboard/frontend/src/components/inspector/` | Update model display to show full prefix + backing |
| `src/dashboard/server/read-model.ts` | Add `agentModelFull` field to agent schema if needed |
| `src/lib/costs/reconciler.ts` | Handle prefix-stripped model names for pricing lookup |
| `src/lib/work-type-router.ts` | Pass tier info to smart selector |

## Architecture

### Provider Prefix Mapping

```
claudish prefix = authMode + model
authMode from config.yaml (subscription → cx@ or provider-specific, api-key → oai@)
```

### Tier-Aware Model Selection

```
SmartSelector.filterByTier(models, userTier) → models available at user's tier
SmartSelector.select(model, availableModels, workType) → best model
```

### Spawn Flow

```
1. WorkTypeRouter.getModel(workTypeId) → ModelId
2. Determine auth mode from config (subscription vs api-key)
3. getClaudishPrefix(model, authMode) → "oai@gpt-5.4" or "cx@o3"
4. agents.spawnAgent({ model: "oai@gpt-5.4", ... })
5. tmux session starts with model prefix
6. Dashboard reads model from JSONL/pane → displays full prefix
```

## Difficulty Estimates

| Task | Complexity | Notes |
|------|-----------|-------|
| Config schema + model registry | medium | New fields, new models |
| claudish install/sync | simple | Binary download, version check |
| CCR command removal | trivial | Delete files |
| Provider prefix mapping | simple | Pure functions, well-defined inputs |
| Tier-aware smart selector | medium | Filter logic, new config field |
| Tier-aware fallback | simple | Extend existing fallback chain |
| agents.ts prefix application | medium | Understand spawn flow, add prefix |
| Dashboard display | medium | Pane parser + display component |
| Cost tracking prefix | simple | Strip prefix for pricing |
| Integration testing | medium | Test full spawn flow with real models |

**Overall: complex** — affects 12+ files across CLI, server, and frontend, but follows existing patterns throughout.

## Open Questions

1. **cx@ prefix:** Not confirmed in claudish v6.12.2 docs. Verify during implementation.
2. **claudish config file:** Does claudish read a config file? Or does it use `.env` / env vars? Need to understand how claudish picks up auth for each prefix.
3. **OAuth token storage:** Where does claudish store OAuth tokens? Overdeck should check if tokens exist before suggesting `claudish login`.

## Out of Scope

- Supporting other claudish providers beyond OpenAI (Kimi, Google, etc.) in this issue — the mechanism is the same, but this issue focuses on OpenAI
- Adding speculative/future models not yet confirmed in claudish catalog
- Changing the underlying agent runtime (Claude Code stays the runtime)
