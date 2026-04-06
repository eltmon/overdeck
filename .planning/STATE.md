# PAN-479: OpenRouter Integration

## Status: In Progress

## Current Phase
Running quality gates (panopticon-dz1)

## Completed Work
- [x] panopticon-ugg: Add OpenRouter to provider system — model-fallback.ts, model-capabilities.ts, config-yaml.ts, env-loader.ts, settings-api.ts (commit: 1b7ee7d)
- [x] panopticon-q17: Create OpenRouter backend service — openrouter-service.ts with fetchModels() cache, validateApiKey(), getModelCapabilities() (commit: 4c69e2a)
- [x] panopticon-r62: Add OpenRouter API endpoints — GET /openrouter/models, PUT /openrouter/favorites, POST /openrouter/test-key + register service in server.ts (commit: 2567689)
- [x] panopticon-565: Create dedicated OpenRouter settings page — OpenRouterPage.tsx + OpenRouterModelBrowser.tsx (commit: 018f62c)
- [x] panopticon-shf: Unify ModelPicker with full provider system — fetches from /api/settings/available-models + /api/settings/openrouter/models, groups by provider, shows cost badges, passes effortLevels via onChange callback (commit: 19dfadc)
- [x] panopticon-0ny: OpenRouter env overrides in conversation and agent launchers — added openrouter to ProviderName/PROVIDERS, getProviderForModel detects '/' in model ID, spawnConversationSession injects ANTHROPIC_BASE_URL+AUTH_TOKEN, agents.ts getProviderEnvForModel handles openrouter (commit: bbcb07b)
- [x] panopticon-8bl: Cost tracking and usage display — ModelPicker shows FREE/$/1M for all models via costDisplay, OpenRouterModelBrowser shows emerald FREE badge and avg cost per 1M tokens (already complete as part of shf+565)

## Remaining Work
- [ ] panopticon-dz1: Quality gates: typecheck, lint, and test pass

## Key Decisions
- OpenRouter model IDs contain '/' (e.g., 'qwen/qwen3.6-plus:free') — used as heuristic in isOpenRouterModel()
- Dynamic OpenRouter models use string type, not the strict ModelId union type (which only contains known static models)
- OpenRouter favorites stored in config.yaml under openrouter.favorites: string[]
- NormalizedConfig.openrouterFavorites: string[] added for runtime access

## Specialist Feedback
(none yet)
