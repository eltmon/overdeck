## Summary

Add QuantumLlama as a supported AI provider in Overdeck. QuantumLlama is a model provider with three model tiers (Reason 70B, Swift 8B, Nano 1B) that must integrate with Overdeck's provider registry, cost tracking, model routing, and dashboard/CLI display.

**The complete provider specification is at `benchmarks/specs/quantumllama.md`** — read this file first. It is the authoritative source of truth for all API details, pricing, model capabilities, and integration requirements.

## Scope

1. **Provider registry** — Register `quantumllama` as a provider with its three models, context windows, and auth configuration
2. **Cost tracking** — Add pricing entries for all three QL models so token usage is correctly costed in the cost calculation module
3. **Model routing** — Enable the Cloister to resolve `ql-*` model IDs to the `quantumllama` provider and access model capabilities for routing decisions
4. **Dashboard** — QuantumLlama models appear with friendly names in cost breakdowns, model displays, and agent info sections
5. **CLI** — `pan status` and cost commands display QuantumLlama models and costs identically to other providers

## What NOT to do

- Do NOT implement actual HTTP client calls to QuantumLlama (it does not exist)
- Do NOT create API request/response handling code
- Do NOT modify agent spawning to invoke QuantumLlama models
- Focus is on configuration, routing metadata, cost calculation, and display layers only

## Acceptance Criteria

- [ ] `quantumllama` is a recognized provider in the provider/model registry
- [ ] All three models (`ql-reason-70b`, `ql-swift-8b`, `ql-nano-1b`) have correct pricing in the cost module
- [ ] Cloister resolves `ql-*` model IDs to provider `quantumllama` with correct context window and max output metadata
- [ ] `config.yaml` can specify QuantumLlama models for agent types (e.g., `work: ql-reason-70b`)
- [ ] Dashboard cost breakdowns show friendly model names (e.g., "QL Reason 70B")
- [ ] CLI cost output includes QuantumLlama models when present in cost data
- [ ] `QUANTUMLLAMA_API_KEY` is documented as the expected env var
- [ ] All existing tests pass — no regressions
- [ ] New unit tests cover QuantumLlama pricing calculations
