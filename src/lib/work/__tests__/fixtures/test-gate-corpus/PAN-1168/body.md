## Symptom

After #1167 fixed the proxy-boot race, starting a Nous Portal agent or conversation surfaces:

> Nous Portal (qwen/qwen3.6-plus): endpoint unreachable (timeout) — the provider may be down

The provider is **not** down. The local proxy is reachable and the upstream returns 200 — just slowly.

## Root Cause

`validateProviderHealth` POSTs an Anthropic-format messages request with `max_tokens: 1` and a one-character prompt to verify auth + network before spawn. For OpenAI-compatible providers this is converted by the local sidecar to `POST /v1/chat/completions`.

Qwen 3.6 Plus is a reasoning model. It ignores `max_tokens` for the reasoning phase. Direct upstream measurement:

\`\`\`
POST https://inference-api.nousresearch.com/v1/chat/completions
body: {"model":"qwen/qwen3.6-plus","messages":[{"role":"user","content":"."}],"max_tokens":1}
→ HTTP 200, 7.55s, 11 prompt tokens + 302 completion tokens (288 reasoning)
\`\`\`

The probe's `PROBE_TIMEOUT_MS = 8000` is on the edge of this latency. Through the proxy (which waits for the full upstream response before responding) the probe routinely aborts → `kind: 'timeout'` → "endpoint unreachable".

Side effect: every spawn pre-flight burns ~$0.0006 in reasoning tokens, just to check auth.

## Fix

For Nous, swap the probe payload: GET `/v1/models` instead of POST `/v1/messages`. The endpoint is already supported by the local proxy and gives the same liveness signal:

- network failure → fetch fails → `kind: 'network'`
- 401 → invalid API key → `kind: 'auth'`
- 429 → rate-limited → `kind: 'quota'`
- 5xx → upstream broken → `kind: 'server'`
- 200 → ready to spawn

Measurement: `GET http://127.0.0.1:12436/nous/v1/models` returns 200 in ~0.7s. No reasoning tokens.

This is a Nous-specific code path because Nous is the only provider currently routed through the OpenAI-compat sidecar with a reasoning-only model. Other direct providers (Kimi, MiniMax, Z.AI, MiMo, OpenRouter) continue to use the existing `/v1/messages` probe — their models respect `max_tokens` and answer in under a second.

## Reproduction

1. Restart the dashboard (so proxy boots fresh).
2. Try to start an agent or conversation with model `qwen/qwen3.6-plus`.
3. Observe "endpoint unreachable (timeout)" after ~8 seconds.

## Related

- #1167 — proxy-boot race (separate root cause, same surface symptom)
- `aad141522` — original pre-flight check commit
- `src/lib/openai-compatible-proxy.ts:91-94` — `/v1/models` route in the local sidecar

--- comment ---
Code audit result: COMPLETE.

Audited against the original Nous timeout / reasoning-model probe issue and current main.

Evidence:
- Nous health check uses `probeModelsEndpoint(...)`, not the generic messages probe: `src/lib/provider-health.ts:110-117`.
- Models probe builds `GET /v1/models` and classifies non-2xx failures: `src/lib/provider-health.ts:159-184`.
- Non-Nous providers still use the existing POST `/v1/messages` probe with `max_tokens: 1`: `src/lib/provider-health.ts:120-141`.
- OpenAI-compatible proxy accepts `/v1/models` and forwards model-list requests: `src/lib/openai-compatible-proxy.ts:89`, `src/lib/openai-compatible-proxy.ts:111-128`.

Verification: `npx vitest run tests/lib/provider-health.test.ts tests/lib/openai-compatible-proxy.test.ts` passed (`6` tests).
