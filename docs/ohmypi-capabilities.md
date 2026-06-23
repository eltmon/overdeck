# ohmypi Capabilities Research

> **Status:** Based on `@oh-my-pi/pi-coding-agent@16.1.16` (`omp`), sourced from
> `docs/ohmypi-contract.md` (verified against real install) and omp's published
> provider registry. Supersedes any Pi-era notes — if this document and the
> contract conflict, the contract wins.

---

## 1. Provider and Model Matrix

omp routes to **35+ providers** through its `pi-ai` layer. Each provider exposes
one or more model families. The table records the provider prefix omp uses in
model IDs, the canonical auth mode, and key model capabilities where known.

### Tier 1 — Frontier API providers (supported by omp native auth + API key)

| Provider | omp model-id prefix | Auth mode | Context | Reasoning control | Tool use |
|----------|---------------------|-----------|---------|------------------|----------|
| Anthropic | `anthropic/` | API key or subscription¹ | Up to 200k | Extended thinking | Full |
| OpenAI | `openai/` | API key or OAuth (ChatGPT sub) | Up to 128k (gpt-4o), 200k (o-series) | Reasoning effort | Full |
| Google (Gemini) | `google/` | API key or Vertex | Up to 1M (Gemini 1.5 Flash/Pro), 2M (Gemini 2.5) | Thinking budget | Full |
| Mistral | `mistral/` | API key | Up to 128k | No | Full |
| xAI (Grok) | `x-ai/` | API key | Up to 131k | No | Full |
| Cohere | `cohere/` | API key | Up to 128k | No | Full |
| OpenRouter | `openrouter/` | API key | Varies by routed model | Varies | Varies |

> ¹ Anthropic subscription auth is blocked with ohmypi harness by Overdeck's ToS gate (`harness-policy.ts`).

### Tier 2 — Coding-plan providers (subscription plans, OAuth or CLI login)

| Provider | omp model-id prefix | Auth mode | Notes |
|----------|---------------------|-----------|-------|
| GitHub Copilot | `github/` | GitHub OAuth | Accesses GPT-4o, Claude 3.7, Gemini 2.0 via Copilot quota |
| OpenAI Codex (CLIProxy) | `openai-codex/` | CLIProxy OAuth | Routes gpt-5.5, o4-mini via Overdeck's proxy layer |
| Anthropic (subscription) | `anthropic/` | Claude Code OAuth | Blocked by ToS gate with ohmypi — use claude-code harness |

### Tier 3 — Multi-provider via API key

| Provider | omp model-id prefix | Notes |
|----------|---------------------|-------|
| Groq | `groq/` | Llama-3.3-70B-versatile, Llama-4, Gemma-2 |
| Cerebras | `cerebras/` | Llama-3.3-70B, Llama-4 Scout (inference speed focus) |
| Bedrock (AWS) | `bedrock/` | Claude, Llama, Titan via AWS credentials |
| Vertex AI | `vertex/` | Gemini via GCP service account |
| MiniMax | `minimax/` | MiniMax-01, MiniMax-Text-01 |
| DashScope (Alibaba) | `dashscope/` | Qwen series |
| Z.AI | `z-ai/` | GLM-4 series |
| MiMo | `mimo/` | MiMo-7B reasoning models |
| Nous Research | `nous/` | Hermes series |
| Fireworks | `fireworks/` | Llama-3.x, Mixtral |
| Together AI | `together/` | Open-weight models |
| Perplexity | `perplexity/` | pplx-online, sonar |
| Replicate | `replicate/` | Custom-hosted open-weight |

### Tier 4 — Local / self-hosted

| Provider | omp model-id prefix | Notes |
|----------|---------------------|-------|
| Ollama | `ollama/` | Any Ollama-served model (LLaMA, Mistral, Phi, etc.) |
| LM Studio | `lm-studio/` | OpenAI-compatible server |
| vLLM | `vllm/` | Production OpenAI-compatible serving |
| Custom OpenAI-compat | `custom/` | `--base-url` override |

---

## 2. Concrete Overdeck Improvements by Area

### 2.1 Model Routing

| Improvement | Description | Impact |
|-------------|-------------|--------|
| **Kimi/GLM via ohmypi harness** | Route kimi-k2 and GLM-4 models through ohmypi rather than CLIProxy, eliminating the 200k-window illusion (PAN-1865). omp has native DashScope / Z.AI auth. | Eliminates deadlocks on long Kimi sessions; removes CLIProxy overhead |
| **Multi-provider model picker** | Surface omp's 35+ provider matrix in the dashboard harness picker, so users can select `groq/llama-3.3-70b` or `bedrock/claude-3.7-sonnet` without leaving the UI. | Opens 35+ providers to GUI selection without CLI hacks |
| **Provider credential passthrough** | Extend `getOhmypiLauncherFields` to inject additional provider env vars (`GROQ_API_KEY`, `CEREBRAS_API_KEY`, `FIREWORKS_API_KEY`, etc.) at spawn time — already done for KIMI/MINIMAX/DashScope. | Removes manual env-var setup for new providers |
| **Default model per provider** | When a user selects a provider without specifying a model, resolve a sensible default (e.g., `groq/llama-3.3-70b-versatile`) from a config table rather than erroring. | Reduces friction for first-time provider selection |

### 2.2 Role Defaults

| Improvement | Description | Impact |
|-------------|-------------|--------|
| **ohmypi as codex-replacement for plan roles** | When the plan role needs a non-Anthropic model (e.g., Gemini Flash for speed), ohmypi provides native Gemini routing without CLIProxy cost tracking gaps. | Cost-efficient planning with Gemini while keeping ohmypi's JSONL cost parser |
| **ohmypi for long-context review convoys** | ohmypi's named-pipe RPC is 300ms faster per message than paste-buffer; high-frequency review convoys (security + correctness + performance in parallel) benefit from this. | Reduces review-convoy wall time on large PRs |
| **Local model fallback for review** | For correctness sub-role reviews, an ohmypi harness could route to an Ollama-served local model, enabling cost-free review passes before committing to a frontier model call. | Zero-cost preliminary review filter |

### 2.3 Runtime Delivery

| Improvement | Description | Impact |
|-------------|-------------|--------|
| **ohmypi FIFO delivery latency** | Named-pipe delivery (`writeOhmypiCommandSync`) already lands in `ohmypi-fifo.ts`. Profile and compare FIFO vs paste-buffer latency under load to determine if always-FIFO is the right policy. | Quantifies the per-message latency win for the operator |
| **`--resume` flag semantics** | omp uses `--resume <sessionId>` (not `--session`). Ensure resume-after-kill works end-to-end via session.id written by `packages/ohmypi-extension/`. | Reliable session resumption for crashed agents |
| **Bun version gate in doctor** | `checkOhmypi` already verifies `omp` is on PATH and `bun ≥ 1.3.14` is present (AC-1b from ohmypi-contract.md). Validate the gate works on machines that have Bun `1.3.11` (known-failing version). | Prevents silent parse errors on old Bun |
| **ohmypi ready.json polling** | `OhmypiRuntime.spawnAgent` polls `~/.overdeck/agents/<id>/ready.json` for up to 30s. Tune the timeout and poll interval based on observed omp startup latency on real hardware. | Prevents false "agent not ready" timeouts on slow machines |

### 2.4 Observability and Cost

| Improvement | Description | Impact |
|-------------|-------------|--------|
| **Per-model cache token fields** | `ohmypi-parser.ts` already captures `cacheReadTokens` and `cacheCreationTokens` per session. Add these fields to the cost dashboard cost-per-run breakdown. | Accurate cache-savings display for ohmypi agents |
| **Provider-level cost grouping** | In `CostWriter.reconcile({ source: 'ohmypi' })`, group imported cost by provider prefix (from model ID) to surface per-provider spend in the dashboard. | Operators can see $X on Groq vs $Y on Anthropic per issue |
| **Kimi-specific cost fields** | Kimi models report `thinking_tokens` in addition to standard input/output. Ensure the ohmypi parser extracts these and maps to the extended `CacheableCostEvent` schema. | Complete cost accounting for kimi-k2 sessions |
| **ohmypi session type in cost dashboard** | Sessions imported with `source: 'ohmypi'` now use `sessionType: 'ohmypi'` in the cost events table. Surface this in the cost breakdown UI alongside `claude` and `codex`. | Unified spend view across all three harnesses |

### 2.5 Dashboard UX

| Improvement | Description | Impact |
|-------------|-------------|--------|
| **ohmypi conversation viewer** | `ohmypi-conversation-parser.ts` is wired to the conversations route. Validate that tool-call steps, assistant messages, and session metadata render correctly in the Conversation panel. | Operators can inspect ohmypi sessions from the dashboard |
| **Frontend Tools-toggle for ohmypi conversations** | Tool-call data is captured but the frontend Tools tab is not wired for ohmypi sessions (carried forward from PAN-1912 D4 follow-up as `workspace-r0gq1`). | Parity with Claude Code conversation tool display |
| **Harness indicator in kanban** | The kanban card already shows harness via `ArtifactAgentHarness`; validate that `'ohmypi'` renders correctly (added to artifacts.ts in bead workspace-8bebw). | Correct harness badge on ohmypi-driven issue cards |
| **ohmypi in context layer preview** | `ContextHarnessPreviews` now has `ohmypi` key (updated in bead workspace-8bebw). Confirm the context-diff panel renders the ohmypi preview column correctly. | Operators can preview ohmypi-specific context blocks |

### 2.6 Agent Reliability

| Improvement | Description | Impact |
|-------------|-------------|--------|
| **ohmypi auto-resume after kill** | `PiRuntime.spawnAgent` reads `session.id` or freshest JSONL to pass `--resume <id>`. Validate with `OhmypiRuntime` that session recovery works on both cold (first-ever spawn) and warm (kill-and-respawn) paths. | Agents recover from crashes without losing session context |
| **ohmypi heartbeat staleness detection** | `OhmypiRuntime.getHeartbeat()` has three fallback tiers. Test that the dashboard heartbeat indicator shows the correct timestamp after the agent is killed and before it resumes. | Accurate liveness signal for ohmypi agents in the dashboard |
| **ohmypi extension version pin** | `packages/ohmypi-extension/` is vendored at the version that matches `omp@16.1.16`'s extension API. Add a `compatible-omp-version` field to `package.json` so `pan doctor` can warn on mismatch. | Prevents subtle extension/runtime incompatibilities after omp upgrades |

---

## 3. Proposed Follow-ups

Each row is a discrete issue worth filing. Priority: P1 = blocks production use, P2 = high value, P3 = incremental.

| # | Feature / Fix | omp capability or workflow | Priority | Notes |
|---|--------------|--------------------------|----------|-------|
| FU-1 | Frontend Tools-toggle for ohmypi conversations | Tool-call data capture (ohmypi-parser.ts) | P2 | Tracked as `workspace-r0gq1` |
| FU-2 | Provider credential passthrough for Groq/Cerebras/Fireworks | omp native Groq/Cerebras/Fireworks routing | P2 | Extend `getOhmypiLauncherFields` env-var injection |
| FU-3 | ohmypi provider picker in dashboard model selector | omp 35+ provider matrix | P2 | Surface `groq/`, `cerebras/`, `bedrock/` etc. in picker |
| FU-4 | ohmypi-based Kimi routing (replace CLIProxy for kimi-k2) | omp DashScope native auth | P1 | Eliminates 200k-window illusion (PAN-1865) |
| FU-5 | Per-provider cost grouping in cost dashboard | omp model-id provider prefix | P2 | Group cost events by provider prefix |
| FU-6 | Kimi thinking-token cost fields in ohmypi parser | kimi-k2 `thinking_tokens` field | P2 | Extend ohmypi-parser.ts + CacheableCostEvent schema |
| FU-7 | ohmypi extension version pin + doctor mismatch warn | omp extension API versioning | P2 | Add `compatible-omp-version` to ohmypi-extension/package.json |
| FU-8 | Bun `1.3.11` regression test in doctor gate | `checkOhmypi` Bun version assertion | P2 | Add test with a mock `bun --version` returning `1.3.11` |
| FU-9 | Local-model ohmypi review role (Ollama) | omp `ollama/` routing | P3 | Enable zero-cost preliminary review pass |
| FU-10 | ohmypi FIFO vs paste-buffer latency benchmark | Named-pipe delivery latency | P3 | Measure and document per-message latency win |
| FU-11 | ohmypi conversation viewer rendering validation | ohmypi-conversation-parser.ts | P2 | End-to-end test that tool-call steps render in Conversation panel |
| FU-12 | GitHub Copilot provider via ohmypi | omp `github/` routing | P3 | Route Copilot-subscription users to GPT-4o/Claude/Gemini via omp |
