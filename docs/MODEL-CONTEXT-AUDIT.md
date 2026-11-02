# Model context and effort audit — 2026-09-07

Picker context labels describe the configured session budget. They are not a claim about the provider's largest API window, the amount of free space left, or a subscription entitlement. The available-models response includes the exact `contextWindow` token count. Conventional binary tiers use 256K for 262,144 and 1M for 1,048,576; decimal provider limits remain decimal. Runtime overhead and reserved response space reduce usable input.

| Models | Configured tokens | Evidence and constraints |
| --- | ---: | --- |
| GPT-6 Astra, Sol, Luna, Rosalind, Astra for Law; GPT-6.1 Sol, Terra; GPT-5.6 Sol, Terra, Luna | 272,000 | Installed Codex catalog default (GPT-6 Sol/Luna: Codex 0.157.1 catalog, 272,000 default / 872,000 max; GPT-6.1 Sol: Codex 0.159.0 catalog, 272,000 default / 872,000 max; GPT-6.1 Terra: Codex 0.159.0 catalog, 500,000 default / 872,000 max, pinned to 272,000); explicit managed `model_context_window` pin. GPT-6 Rosalind / Astra for Law: model pages unpublished (404, 2026-11-02); 272,000 is the Codex harness pin. |
| GPT-5.6 `[372k]` choices | 372,000 | Explicit opt-in; launch strips the Overdeck suffix while retaining the larger configuration. |
| Fable 5.1, Fable 5, Opus 5.5/5/4.8/4.7, Sonnet 5.5/5, Haiku 5.5 | 1,000,000 | Native 1M models. Claude account restrictions or a disabled-1M setting can reduce this. |
| Opus 4.6, Sonnet 4.6, Haiku 4.5 | 200,000 | Claude Code runs bare Opus 4.6 and Sonnet 4.6 at 200K; their 1M API window needs the plan-gated [1m] variant (Sonnet 4.6 [1m] uses usage credits on every subscription plan). Haiku 4.5 is 200K natively. |
| Gemini 4 Argon | 1,048,576 | Window shared by input, thinking and output; 65,536 max output per stream (32,768 non-streaming). Provisioned into the omp registry; Pi passes the id through its google provider. |
| Gemini 3.8 Flash, 3.5 Flash Lite | 1,048,576 | Google input limit; 65,536 max output. New models provisioned into the omp registry. |
| GLM 5.3 / 5.2 | 1,000,000 | 128K max output. GLM 5.3 accepts Low/High/Max and always reasons. |
| GLM 5.1 | 200,000 | Retained previous model. |
| MiniMax M3, M3.1 Flash | 1,000,000 | Latest coding models; M3 installed runtime agrees. M3.1 Flash per the MiniMax models page (PAN-4825). |
| MiniMax M2.7 / Highspeed | 204,800 | Retained previous generation. |
| MiMo V2.6 Pro / Flash / Pro UltraSpeed | 1,048,576 | Official model pages: 1M context, 128K max output. V2.5 / Pro were retired 2026-10-21 (PAN-4825). |
| Qwen 3.7 Plus / 3.8 Flash | 1,000,000 | Official model pages give the exact decimal context and 131,072 max output. |
| Kimi K3 256K / K2.7 Code / K2.7 Code Highspeed | 262,144 | Installed Kimi CLI 0.40.1 catalog; Highspeed rechecked with Kimi CLI 2.0.2 (2026-11-02). |
| Kimi K3 1M | 1,048,576 | Installed Kimi CLI 0.40.1 catalog. |
| Kimi K3.1 Pro / Highspeed | 1,048,576 | Installed Kimi CLI 2.0.2 catalog (2026-11-02); no 256K tier. |
| Kimi K2.8 Preview (`kimi-code/kimi-for-coding`) | 1,048,576 | Installed Kimi CLI 2.0.2 catalog (2026-11-02); effort low/high/max. |
| Grok 4.3, Mistral Large 4 | 1,000,000 | Official xAI and Mistral model pages (PAN-4825). |
| Grok 4.7 | 500,000 | Official xAI models page (PAN-4825). |
| GPT OSS 120B / 20B (Groq), GPT OSS 120B (Cerebras) | 131,072 | Groq models page; Cerebras paid tier (65K on its free tier) (PAN-4825). |

Other retained entries show their existing configured budget. This audit does not silently raise every older model to its largest advertised API window. Known non-Anthropic models routed through Claude Code receive both `CLAUDE_CODE_AUTO_COMPACT_WINDOW` and `CLAUDE_CODE_MAX_CONTEXT_TOKENS`; supplying only the first can leave Claude's unknown-model 200K ceiling in place.

## Codex limits and billing

The installed Astra catalog distinguishes a 272,000 default window from an 872,000 maximum configuration override. The public API advertises 1,050,000. These are different surfaces. Codex's 95% effective-window allowance explains a displayed 258,400 usable window when configured for 272,000; it does not explain the provider's 872,000 maximum.

A standalone CLI user can explicitly request `codex -m gpt-6-astra -c model_context_window=872000`. Overdeck keeps 272,000 as the default. No 872K Overdeck picker choice is added by this change.

API long-input pricing and subscription allowance consumption are distinct. Do not apply the API's greater-than-272K price multiplier as a verified subscription-credit multiplier. Historical GPT 5.2–5.5 records and token prices remain; new choices are removed and old configuration references resolve to the corresponding 5.6 tier.

## Price labels

Anthropic badges use the published equal input/output average: Fable $30/M, Opus 5.5 $12/M, Opus 5 and earlier $15/M, Haiku 4.5 $3/M, and Haiku 5.5 $0.3/M (its rate for prompts up to 100K tokens; prompts over 100K tokens cost 5× on every component, which cost tracking applies per request). Earlier Fable/Opus values were inflated ranking heuristics displayed as dollar prices. Sonnet 5 remains $2/M input and $10/M output; the planned September increase was cancelled. Sonnet 5.5 cache reads dropped from $0.20/M to $0.10/M on 2026-10-07. See [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing). These API estimates are not subscription charges. Unverified DashScope zero-price placeholders say “See pricing” rather than claiming free usage.

## Effort

Managed Codex configuration and app-server turns explicitly default to High. `resolveEffort()` (`src/lib/agents/resolve-effort.ts`) resolves the selected effort for `pan start` work-agent spawns, planning (`spawnPlanningSession`), `pan strike`, and definition-less role runs (review sub-roles, the standing supervisor) and their codex/omp launcher fields; see [Reasoning effort](../configuration/effort.mdx). `resolveRelaunchEffort()` (`src/lib/agents/relaunch-effort.ts`) re-applies the persisted `state.effort` on every relaunch path — resume, restart, crash recovery, the messaging fresh-launch fallback, session rotation, crash respawn, and cloister model handoff — re-clamping it to the relaunch's model and harness instead of letting the launcher fall back to the role frontmatter default (PAN-4253). Conversation launches still resolve effort ad hoc, pending #4254. A live app-server picker change is acknowledged before conversation metadata is updated and applies to later turns. It cannot change a turn already running. Old hosts must be restarted to load the new control operation.

Managed omp launches explicitly supply `--thinking high` unless an effort was chosen. Native Kimi and ACP launches initialize the chosen effort. K3 supports Low/High/Max; saved Medium maps to High and Extra High maps to Max. K2.8 Preview (`kimi-code/kimi-for-coding`) supports Low/High/Max the same way. K2.7 Code and K2.7 Code Highspeed have no adjustable effort, so their pickers do not advertise one. ACP live updates wait for provider acceptance. Terminal-only sessions use launch settings and their native terminal controls; a dashboard-only label change is not treated as a runtime update.

Kimi's bare Overdeck `k3` historically denotes the smaller window. It now translates to the real `k3-256k` endpoint; `k3[1m]` remains Claude Code's full-window syntax. Native aliases retain the CLI's own namespace. Claude tier environment values use the same 256K route. K2.7 maps to `kimi-for-coding` on the coding endpoint, while Moonshot platform requests retain their platform ID. K3.1 Pro ids (`k3.1-pro`, `k3.1-pro-highspeed`) are sent unchanged to the coding endpoint and as `kimi-k3.1-pro` / `kimi-k3.1-pro-highspeed` to the Moonshot platform endpoint.

## Sources

- [OpenAI API pricing](https://developers.openai.com/api/docs/pricing), checked 2026-11-02: `gpt-6-rosalind` $15/M input, $1.50/M cached, $75/M output (>272K: $30/$3/$112.50), trusted-access only; `gpt-6-astra-law` $10/$1/$50, promotional through at least 2026-12-31; `gpt-5.6-sol` $4/$0.40/$20, promotional through at least 2026-11-21 with no post-promo rate published.
- [Claude model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations): `claude-sonnet-4-5` retires 2026-11-30 (Anthropic recommends `claude-sonnet-5-5`; Overdeck migrates saved selections to `claude-sonnet-4-6`).
- [OpenAI Astra API model](https://developers.openai.com/api/docs/models/gpt-6-astra)
- [OpenAI GPT-6 Sol API model](https://developers.openai.com/api/docs/models/gpt-6-sol): `gpt-6-sol`, 1.05M context, 128K maximum output, $2/M input, $0.20/M cached input, $10/M output; >272K input bills 2x input / 1.5x output.
- [OpenAI GPT-6.1 Sol API model](https://developers.openai.com/api/docs/models/gpt-6.1-sol): `gpt-6.1-sol`, 1.05M context, 128K maximum output, $2/M input, $0.10/M cached input, $10/M output; >272K input bills 2x input / 1.5x output.
- [OpenAI GPT-6.1 Terra API model](https://developers.openai.com/api/docs/models/gpt-6.1-terra): `gpt-6.1-terra`, 1.05M context, 922K maximum input, 128K maximum output, $1/M input, $0.05/M cached input, $5/M output; >272K input bills 2x input / 1.5x output.
- [OpenAI GPT-6 Luna API model](https://developers.openai.com/api/docs/models/gpt-6-luna): `gpt-6-luna`, 1.05M context, 128K maximum output, $0.10/M input, $0.01/M cached input, $0.50/M output; same long-input tier.
- [Codex configuration reference](https://developers.openai.com/codex/config-reference)
- [Claude Code model, effort, and context configuration](https://code.claude.com/docs/en/model-config): Fable 5.1 requires Claude Code 2.1.255 or newer. Availability depends on the account.
- [Claude Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/overview): `claude-opus-5-5`, 1M context, 128K maximum output, $4/M input, $20/M output, and $0.20/M cache reads.
- [Claude Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/overview): `claude-sonnet-5-5`, 1M context, 128K maximum output, $2/M input, $10/M output, $0.10/M cache reads (cut from $0.20/M on 2026-10-07); requires Claude Code 2.1.284 or newer.
- [Claude Haiku 5.5](https://platform.claude.com/docs/en/models/haiku-5-5/overview): `claude-haiku-5-5`, released 2026-10-07, 1M context, 128K maximum output; prompts up to 100K tokens $0.10/M input, $0.50/M output, $0.01/M cache reads, and prompts over 100K tokens $0.50/M, $2.50/M and $0.05/M; adaptive thinking on by default at medium effort; `budget_tokens` and non-default sampling parameters return 400; its tokenizer counts about 30% more tokens than Haiku 4.5; requires Claude Code 2.1.293 or newer.
- [Fable 5.1](https://platform.claude.com/docs/en/models/fable-5-1/overview) and [pricing changes](https://platform.claude.com/docs/en/models/fable-5-1/whats-new-fable-5-1): $10/M input, $50/M output, $0.25/M cache reads.
- [Gemini 4 Argon](https://ai.google.dev/gemini-api/docs/generate-content/latest-model): `gemini-4-argon`, GA 2026-10-13; introductory $2/M input, $10/M output, $0.10/M cached input through 2026-11-30, then $4/M, $20/M and $0.20/M; thinking levels low/medium/high; sampling parameters ignored; explicit context caching removed.
- [Gemini model catalog](https://ai.google.dev/gemini-api/docs/models), [3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), [3.5 Flash Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), [3.6 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash), [3.1 Flash Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite), [pricing](https://ai.google.dev/gemini-api/docs/pricing), [deprecations](https://ai.google.dev/gemini-api/docs/deprecations).
- [GLM 5.3](https://docs.z.ai/guides/llm/glm-5.3): some accounts with a Coding Plan history currently require the OpenAI-compatible endpoint; the Anthropic route is not universally available.
- [GLM 5.3 Flash/FlashX](https://docs.z.ai/guides/llm/glm-5.3-flash) and [Z.AI pricing](https://docs.z.ai/guides/overview/pricing): 1M context, 128K output, effort low/high/max.
- [MiniMax model catalog](https://platform.minimax.io/docs/guides/models-intro).
- [MiMo pay-as-you-go pricing](https://mimo.mi.com/docs/en-US/price/pay-as-you-go) (V2.5 retirement notice), [MiMo V2.6 Pro](https://mimo.mi.com/models/en-US/mimo-v2.6-pro), [V2.6 Flash](https://mimo.mi.com/models/en-US/mimo-v2.6-flash), [V2.6 Pro UltraSpeed](https://mimo.mi.com/models/en-US/mimo-v2.6-pro-ultraspeed).
- [Qwen 3.7 Plus](https://www.alibabacloud.com/help/en/model-studio/qwen3-7-plus), [Qwen 3.8 Flash](https://help.aliyun.com/en/model-studio/qwen3-8-flash), [Qwen 3.8 Max](https://www.alibabacloud.com/help/en/model-studio/qwen3-8-max) (1,000,000-token window), [Model Studio pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing), [deprecations](https://docs.modelstudio.console.alibabacloud.com/pt-br/model-studio/model-depreciation).
- [Kimi models](https://www.kimi.com/code/docs/en/kimi-code/models.html), [Claude Code integration](https://www.kimi.com/code/docs/en/third-party-tools/claude-code.html).

Provider request-shape tests verify propagation without spending subscription credits. They do not establish every account's entitlement or prove a full-capacity million-token request succeeds.

## November 2026 refresh (PAN-4825)

Every fact below was re-read from the official source on 2026-11-02 before the catalog changed.

**Verified**

- [MiMo pay-as-you-go pricing](https://mimo.mi.com/docs/en-US/price/pay-as-you-go): "Xiaomi MiMo-V2.5-Pro and MiMo-V2.5 were retired on Oct 21, 2026, at 10:00 (UTC+8), and their model IDs no longer work." Real-time USD per 1M tokens: `mimo-v2.6-pro` $0.435 in / $0.0036 cached / $0.87 out; `mimo-v2.6-flash` $0.14 / $0.0028 / $0.28; `mimo-v2.6-pro-ultraspeed` $4.35 / $0.036 / $8.70.
- [MiMo V2.6 Pro](https://mimo.mi.com/models/en-US/mimo-v2.6-pro), [V2.6 Pro UltraSpeed](https://mimo.mi.com/models/en-US/mimo-v2.6-pro-ultraspeed), [V2.6 Flash](https://mimo.mi.com/models/en-US/mimo-v2.6-flash): 1M context and 128K max output for all three; Flash accepts image, video, audio and text input.
- [Groq deprecations](https://console.groq.com/docs/deprecations): `llama-3.3-70b-versatile` and `llama-3.1-8b-instant` shut down 2026-08-16 (replacements `openai/gpt-oss-120b` and `openai/gpt-oss-20b`); `qwen-qwq-32b` shut down 2025-07-14 (Groq named `qwen/qwen3-32b`); `gemma2-9b-it` shut down 2025-10-08 (Groq named `llama-3.1-8b-instant`). The [Groq models page](https://console.groq.com/docs/models) still lists both Llama ids; the deprecations page is treated as authoritative.
- [Groq models](https://console.groq.com/docs/models): `openai/gpt-oss-120b` 131,072 context, 65,536 max completion, $0.15 in / $0.60 out; `openai/gpt-oss-20b` 131,072, 65,536, $0.075 / $0.30.
- [Cerebras deprecations](https://inference-docs.cerebras.ai/support/deprecation): `llama3.1-70b` deprecated 2025-01-17; `llama-3.3-70b` deprecated 2026-02-16 → GPT OSS 120B; `llama3.1-8b` deprecated 2026-05-27 → GPT OSS 120B.
- [Cerebras GPT OSS](https://inference-docs.cerebras.ai/models/openai-oss): API id `gpt-oss-120b`; 131k context and 40k max output on the paid tier (65k / 32k free); $0.35 in / $0.75 out.
- [Mistral Large 4](https://docs.mistral.ai/models/mistral-large-4-0.md): API names `mistral-large-4` and `mistral-large-4-0`, released 2026-10-06, Public Preview, 1M context, $0.70 in / $0.07 cached / $2.10 out.
- [xAI models](https://docs.x.ai/docs/models): `grok-4.7` 500k context, $2.00 / $0.50 cached / $6.00 below 200k prompt tokens and $4.00 / $1.00 / $12.00 for every token once a prompt reaches 200k; `grok-4.3` 1M context, $1.25 / $0.20 / $2.50 and $2.50 / $0.40 / $5.00 at ≥200k; `grok-build-0.1` still listed.
- [MiniMax pricing](https://platform.minimax.io/docs/guides/pricing) and [models](https://platform.minimax.io/docs/guides/models-intro): `MiniMax-M3.1-Flash` $0.15 in / $0.60 out / $0.015 cache read at every input length, 1M context, "tunable thinking depth"; `MiniMax-M3` Standard ≤512K input $0.30 / $1.20 / $0.06, >512K input $0.60 / $2.40 / $0.12.
- [Meta reasoning](https://dev.meta.ai/docs/reasoning): `max` is "Supported by `muse-wonder-1.0` and `muse-spark-1.3`; not available with `muse-spark-1.3-contributor`."
- [Kimi Code models](https://www.kimi.com/code/docs/en/kimi-code/models.html), matching Kimi CLI 2.0.2 `kimi provider list --json`: `kimi-for-coding` is "K2.8 Preview", up to 1,048,576 tokens, effort low/high/max (default max); `kimi-for-coding-highspeed` is "K2.7 Code Highspeed", up to 262,144 tokens, and "does not support adjustable thinking effort."

**Changed**

- Added `mimo-v2.6-pro`, `mimo-v2.6-flash`, `mimo-v2.6-pro-ultraspeed`; retired `mimo-v2.5-pro` → `mimo-v2.6-pro` and `mimo-v2.5` → `mimo-v2.6-flash`. MiMo tier slots are V2.6 Pro / Pro / Flash, the haiku slot is V2.6 Flash, and the settings connection test probes `mimo-v2.6-pro`.
- Added Groq `openai/gpt-oss-120b` and `openai/gpt-oss-20b`, routed to Groq ahead of the OpenRouter slash catch-all. Retired `llama-3.3-70b-versatile` and `qwen-qwq-32b` → `openai/gpt-oss-120b`, and `llama-3.1-8b-instant` and `gemma2-9b-it` → `openai/gpt-oss-20b`. Groq tier slots are 120B / 120B / 20B.
- Added Cerebras `gpt-oss-120b`; retired `llama3.3-70b`, `llama-3.3-70b`, `llama3.1-70b` and `llama3.1-8b` → `gpt-oss-120b`. Every Cerebras tier slot is `gpt-oss-120b`.
- Added `mistral-large-4-0`, `grok-4.7`, `grok-4.3` and `MiniMax-M3.1-Flash`.
- `MiniMax-M3` notes now carry the >512K input rate.
- `muse-wonder-1.0` and `muse-spark-1.3` list `max` effort; the Muse harness still sends at most `xhigh`.
- `kimi-code/kimi-for-coding` is K2.8 Preview: 1,048,576 context and low/high/max effort. `kimi-code/kimi-for-coding-highspeed` is named K2.7 Code Highspeed.

**Not changed (unverified)**

- What `mistral-large-latest` resolves to: no official page says, so the `-latest` ids and Mistral tier slots are unchanged.
- MiniMax M2.7 and M2.7 Highspeed stay live. The official pricing and models pages, re-read 2026-11-02, do not mention M2.7 and show no retirement notice. Third-party sources report the models closed to new users on 2026-10-19 and retiring on 2026-11-18.
- Image input (`supportsImages`) for MiMo V2.6 and the gpt-oss ids: no live probe was run, so the flag stays unset.
- Whether Overdeck's MiMo Token-Plan endpoint (`token-plan-sgp.xiaomimimo.com`) serves the V2.6 ids: not testable without a key, so the base URL is unchanged.
- Effort levels for Grok 4.7 / 4.3, Mistral Large 4, the gpt-oss ids and MiniMax M3.1 Flash: no official page lists them.
- K2.8 Preview pricing: unpublished, so `kimi-for-coding` keeps the K2.7 rate. The claude-route ids `kimi-k2.7-code` and bare `kimi-for-coding` keep their 262,144 window and no adjustable effort.
- Muse `minimal` effort: not an Overdeck effort level.
- Groq's own replacements for QwQ (`qwen/qwen3-32b`) and Gemma (`llama-3.1-8b-instant`, itself shut down) are not used, because this refresh adds no third Groq model and a migration target must be live.
- omp/pi launches of the Groq slash ids: omp reads `openai/` as its own provider prefix, so qualifying them as `groq/openai/...` is out of scope.
