# PAN-479: OpenRouter Integration

## Status: In Progress

## Current Phase
Implementing panopticon-shf: Unify ModelPicker with full provider system

## Completed Work
- [x] panopticon-ugg: Add OpenRouter to provider system — model-fallback.ts, model-capabilities.ts, config-yaml.ts, env-loader.ts, settings-api.ts (commit: 1b7ee7d)
- [x] panopticon-q17: Create OpenRouter backend service — openrouter-service.ts with fetchModels() cache, validateApiKey(), getModelCapabilities() (commit: 4c69e2a)
- [x] panopticon-r62: Add OpenRouter API endpoints — GET /openrouter/models, PUT /openrouter/favorites, POST /openrouter/test-key + register service in server.ts (commit: 2567689)

## Remaining Work
- [ ] panopticon-q17: Create OpenRouter backend service (src/dashboard/server/services/openrouter-service.ts)
- [ ] panopticon-r62: Add OpenRouter API endpoints to settings routes
- [ ] panopticon-565: Create dedicated OpenRouter settings page with model browser
- [ ] panopticon-shf: Unify ModelPicker with full provider system
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
