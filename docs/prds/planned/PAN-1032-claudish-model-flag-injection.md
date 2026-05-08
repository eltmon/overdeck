# PAN-1032: claudish --model-opus/--model-sonnet/--model-haiku/--model-subagent Flag Injection + Tests

**GitHub Issue:** [#1032](https://github.com/eltmon/panopticon-cli/issues/1032)
**Follows up:** PAN-920 (subagent tier-model env var injection for direct providers)

---

## Problem

PAN-920 added `tierModels` to every `ProviderConfig` and injected subagent-model env vars for **direct providers** (Kimi Code Plan, MiMo, MiniMax, Z.AI). Three gaps remain:

### Gap 1 — claudish providers: no env injection + no CLI flags

The claudish branch of `getProviderEnv` in `src/lib/providers.ts` (lines 274–312) returns only the native API key env var. claudish itself (at `/home/eltmon/.config/nvm/versions/node/v22.22.0/bin/claudish`) accepts four CLI flags at launch time for subagent model routing:

```
--model-opus     <model>
--model-sonnet   <model>
--model-haiku    <model>
--model-subagent <model>
```

These flags are not currently passed in `getAgentRuntimeBaseCommand`.

### Gap 2 — CLIProxy path: no env injection

When OpenAI models route through CLIProxy (subscription/OAuth), `getProviderEnvForModel` returns early with `getCliproxyClientEnv()`, skipping tier-model injection entirely.

### Gap 3 — PROVIDER_ENV_KEYS tracking incomplete

Four tier-model env vars are missing from PROVIDER_ENV_KEYS in agents.ts and child-env.ts: `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL`. Stale values from a previous Anthropic session can leak into claudish-routed spawns.

---

## Solution

**Single source of truth:** `provider.tierModels`. One read, two emit paths: CLI flags in `getAgentRuntimeBaseCommand`, env vars in `getProviderEnv`/`getProviderEnvForModel`.

### A. Expand PROVIDER_ENV_KEYS (agents.ts + child-env.ts)
Add the four missing vars to both tracking structures.

### B. Claudish env injection (providers.ts)
After setting the native API key in the claudish branch, apply the same tierModels injection as the direct branch.

### C. CLIProxy env injection (agents.ts)
After `getCliproxyClientEnv()`, merge tier-model env vars from `PROVIDERS.openai.tierModels`.

### D. claudish CLI flags (agents.ts)
In `getAgentRuntimeBaseCommand`, append `--model-opus <val> --model-sonnet <val> --model-haiku <val> --model-subagent <val>` from `provider.tierModels`. Flag values use the claudish-prefixed form (e.g. `kc@kimi-k2` from `getLaunchModelForModel`). `--model-subagent` maps to `tierModels.haiku`.

---

## Acceptance Criteria

1. `getProviderEnv` for all claudish providers returns tier-model env vars alongside the native API key.
2. `getProviderEnvForModel` for CLIProxy returns tier-model env vars alongside the cliproxy env.
3. `getAgentRuntimeBaseCommand` for claudish models appends all four `--model-*` flags when `provider.tierModels` is defined.
4. `PROVIDER_ENV_KEYS` in both agents.ts and child-env.ts includes all five tier-model env vars (haiku was already there).
5. Existing tests pass. New Vitest tests cover all three routing paths.
6. `HARNESSES.md` documents the flag injection behavior.
