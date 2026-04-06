# PAN-479: OpenRouter Integration

## Status: In Progress

## Current Phase
Implementing panopticon-0ny: OpenRouter env overrides in conversation and agent launchers

## Completed Work
- [x] panopticon-ugg: Add OpenRouter to provider system — model-fallback.ts, model-capabilities.ts, config-yaml.ts, env-loader.ts, settings-api.ts (commit: 1b7ee7d)
- [x] panopticon-q17: Create OpenRouter backend service — openrouter-service.ts with fetchModels() cache, validateApiKey(), getModelCapabilities() (commit: 4c69e2a)
- [x] panopticon-r62: Add OpenRouter API endpoints — GET /openrouter/models, PUT /openrouter/favorites, POST /openrouter/test-key + register service in server.ts (commit: 2567689)
- [x] panopticon-565: Create dedicated OpenRouter settings page — OpenRouterPage.tsx + OpenRouterModelBrowser.tsx (commit: 018f62c)
- [x] panopticon-shf: Unify ModelPicker with full provider system — fetches from /api/settings/available-models + /api/settings/openrouter/models, groups by provider, shows cost badges, passes effortLevels via onChange callback (commit: TBD)

## Remaining Work
- [ ] panopticon-0ny: OpenRouter env overrides in conversation and agent launchers
- [ ] panopticon-8bl: Cost tracking and usage display for OpenRouter models
- [ ] panopticon-dz1: Quality gates: typecheck, lint, and test pass

## Key Decisions
- OpenRouter model IDs contain '/' (e.g., 'qwen/qwen3.6-plus:free') — used as heuristic in isOpenRouterModel()
- Dynamic OpenRouter models use string type, not the strict ModelId union type (which only contains known static models)
- OpenRouter favorites stored in config.yaml under openrouter.favorites: string[]
- NormalizedConfig.openrouterFavorites: string[] added for runtime access

## Specialist Feedback
(none yet)
