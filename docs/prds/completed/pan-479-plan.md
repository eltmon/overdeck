# PAN-479: OpenRouter Integration — Planning State

## Decisions Made

### Architecture: Full Provider Integration
OpenRouter is added as a first-class provider alongside Anthropic, OpenAI, Google, Kimi, Z.AI. This means:
- `openrouter` added to `ModelProvider` enum
- API key stored in `config.yaml` under `api_keys.openrouter`
- Env fallback via `OPENROUTER_API_KEY` in `~/.panopticon.env`
- Model capabilities stored per-model from OpenRouter API metadata

### Model Discovery: Dynamic Fetch + User Favorites
- Fetch full model list from `GET https://openrouter.ai/api/v1/models`
- Cache with TTL (5-10 minutes) server-side
- Users browse/search and star favorites in Settings
- Only favorited models appear in Mission Control ModelPicker
- Store favorites in `config.yaml` under `openrouter.favorites: string[]`

### Settings UI: Dedicated OpenRouter Page
- New page/tab in Settings specifically for OpenRouter
- API key input + test button at top
- Full model catalog below with search, category filters (Free/Chat/Code), pricing
- Favorites section at top showing starred models
- All Models section below with full browsable list

### ModelPicker: Unified with Provider System
- Refactor `ModelPicker.tsx` from hardcoded 3 Claude models to pull from all enabled providers
- Group models by provider (Anthropic, OpenRouter, OpenAI, etc.)
- Show per-model cost indicator
- EffortPicker integration: check model capability metadata for effort/thinking support

### Effort/Thinking: Capability Metadata from API
- When fetching OpenRouter models, extract capability metadata (supports_thinking, supports_tools, etc.)
- Store per-model capabilities alongside favorites
- EffortPicker enabled/disabled based on stored capabilities
- Anthropic models via OpenRouter likely support effort; non-Anthropic models generally don't

### Conversation Spawning: Env Var Override
When an OpenRouter model is selected, the launcher script adds:
```bash
export ANTHROPIC_BASE_URL=https://openrouter.ai/api
export ANTHROPIC_AUTH_TOKEN=<openrouter-key>
export ANTHROPIC_API_KEY=""
```
And passes `--model <openrouter-model-id>` to Claude CLI. Native provider models use existing flow.

### Scope: Everything In
- Cost tracking / usage monitoring — in scope
- Work agent integration (issue-agent, specialists can use OpenRouter models) — in scope
- End-to-end validation with `qwen/qwen3.6-plus:free` — in scope

## Key Files to Modify

| File | Change |
|------|--------|
| `src/lib/model-capabilities.ts` | Add `openrouter` to `ModelProvider`, add dynamic model type |
| `src/lib/config-yaml.ts` | Add `openrouter` key + favorites to config schema |
| `src/lib/env-loader.ts` | Add `OPENROUTER_API_KEY` extraction |
| `src/lib/settings-api.ts` | Add OpenRouter to settings conversion |
| `src/dashboard/server/routes/settings.ts` | Add OpenRouter model list, favorites CRUD, key test endpoints |
| `src/dashboard/server/routes/conversations.ts` | Detect OpenRouter model, set env overrides in launcher |
| `src/dashboard/frontend/src/components/chat/ModelPicker.tsx` | Refactor to unified provider-based model list |
| `src/dashboard/frontend/src/components/chat/EffortPicker.tsx` | Dynamic effort support from model capabilities |

## New Files

| File | Purpose |
|------|---------|
| `src/dashboard/server/services/openrouter-service.ts` | Model discovery, API key validation, model caching |
| `src/dashboard/frontend/src/components/Settings/OpenRouterPage.tsx` | Dedicated settings page |
| `src/dashboard/frontend/src/components/Settings/OpenRouterModelBrowser.tsx` | Search/filter/favorite model catalog |

## Technical Notes

### OpenRouter Anthropic Skin
OpenRouter provides an Anthropic-compatible Messages API at `POST https://openrouter.ai/api/v1/messages`. This means:
- No proxy or adapter needed
- Claude Code CLI works natively with `ANTHROPIC_BASE_URL` override
- Model ID passed as-is (e.g., `qwen/qwen3.6-plus:free`)

### OpenRouter Models API
- `GET https://openrouter.ai/api/v1/models` returns full catalog
- Each model has: `id`, `name`, `pricing` (prompt/completion per token), `context_length`, `top_provider`, `architecture`
- No auth required for model list (public endpoint)

### Work Agent Integration
- Model overrides in `config.yaml` already support per-work-type model selection
- OpenRouter models need the same env var override pattern in agent launcher scripts
- Agent launchers in `src/dashboard/server/routes/agents.ts` need same `ANTHROPIC_BASE_URL` logic
