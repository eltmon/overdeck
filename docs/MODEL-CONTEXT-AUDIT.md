# Model context and effort audit — 2026-09-07

Picker context labels describe the configured session budget. They are not a claim about the provider's largest API window, the amount of free space left, or a subscription entitlement. The available-models response includes the exact `contextWindow` token count. Conventional binary tiers use 256K for 262,144 and 1M for 1,048,576; decimal provider limits remain decimal. Runtime overhead and reserved response space reduce usable input.

| Models | Configured tokens | Evidence and constraints |
| --- | ---: | --- |
| GPT-6 Astra; GPT-5.6 Sol, Terra, Luna | 272,000 | Installed Codex catalog default; explicit managed `model_context_window` pin. |
| GPT-5.6 `[372k]` choices | 372,000 | Explicit opt-in; launch strips the Overdeck suffix while retaining the larger configuration. |
| Fable 5.1, Fable 5, Opus 5/4.8/4.7, Sonnet 5 | 1,000,000 | Native 1M models. Claude account restrictions or a disabled-1M setting can reduce this. |
| Opus 4.6, Sonnet 4.6, Haiku 4.5 | 200,000 | Conservative managed budget; older extended-context entitlements vary by plan. |
| Gemini 3.8 Flash, 3.5 Flash Lite | 1,048,576 | Google input limit; 65,536 max output. New models provisioned into the omp registry. |
| GLM 5.3 / 5.2 | 1,000,000 | 128K max output. GLM 5.3 accepts Low/High/Max and always reasons. |
| GLM 5.1 | 200,000 | Retained previous model. |
| MiniMax M3 | 1,000,000 | Latest coding model; installed runtime agrees. |
| MiniMax M2.7 / Highspeed | 204,800 | Retained previous generation. |
| MiMo V2.5 / Pro | 1,048,576 | Updated base V2.5 from the obsolete 262K entry. |
| Qwen 3.7 Plus / 3.8 Flash | 1,000,000 | Official model pages give the exact decimal context and 131,072 max output. |
| Kimi K3 256K / K2.7 Code / Highspeed | 262,144 | Installed Kimi CLI 0.40.1 catalog. |
| Kimi K3 1M | 1,048,576 | Installed Kimi CLI 0.40.1 catalog. |

Other retained entries show their existing configured budget. This audit does not silently raise every older model to its largest advertised API window. Known non-Anthropic models routed through Claude Code receive both `CLAUDE_CODE_AUTO_COMPACT_WINDOW` and `CLAUDE_CODE_MAX_CONTEXT_TOKENS`; supplying only the first can leave Claude's unknown-model 200K ceiling in place.

## Codex limits and billing

The installed Astra catalog distinguishes a 272,000 default window from an 872,000 maximum configuration override. The public API advertises 1,050,000. These are different surfaces. Codex's 95% effective-window allowance explains a displayed 258,400 usable window when configured for 272,000; it does not explain the provider's 872,000 maximum.

A standalone CLI user can explicitly request `codex -m gpt-6-astra -c model_context_window=872000`. Overdeck keeps 272,000 as the default. No 872K Overdeck picker choice is added by this change.

API long-input pricing and subscription allowance consumption are distinct. Do not apply the API's greater-than-272K price multiplier as a verified subscription-credit multiplier. Historical GPT 5.2–5.5 records and token prices remain; new choices are removed and old configuration references resolve to the corresponding 5.6 tier.

## Price labels

Anthropic badges now use the published equal input/output average: Fable $30/M, Opus $15/M, and Haiku $3/M. Earlier Fable/Opus values were inflated ranking heuristics displayed as dollar prices. Sonnet 5 remains $2/M input and $10/M output; the planned September increase was cancelled. See [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing). These API estimates are not subscription charges. Unverified DashScope zero-price placeholders say “See pricing” rather than claiming free usage.

## Effort

Managed Codex configuration and app-server turns explicitly default to High. The selected effort is passed through conversation, work, specialist, and planning launches. A live app-server picker change is acknowledged before conversation metadata is updated and applies to later turns. It cannot change a turn already running. Old hosts must be restarted to load the new control operation.

Managed omp launches explicitly supply `--thinking high` unless an effort was chosen. Native Kimi and ACP launches initialize the chosen effort. K3 supports Low/High/Max; saved Medium maps to High and Extra High maps to Max. K2.7 Code has no adjustable effort, so its picker does not advertise one. ACP live updates wait for provider acceptance. Terminal-only sessions use launch settings and their native terminal controls; a dashboard-only label change is not treated as a runtime update.

Kimi's bare Overdeck `k3` historically denotes the smaller window. It now translates to the real `k3-256k` endpoint; `k3[1m]` remains Claude Code's full-window syntax. Native aliases retain the CLI's own namespace. Claude tier environment values use the same 256K route. K2.7 maps to `kimi-for-coding` on the coding endpoint, while Moonshot platform requests retain their platform ID.

## Sources

- [OpenAI Astra API model](https://developers.openai.com/api/docs/models/gpt-6-astra)
- [Codex configuration reference](https://developers.openai.com/codex/config-reference)
- [Claude Code model, effort, and context configuration](https://code.claude.com/docs/en/model-config): Fable 5.1 requires Claude Code 2.1.255 or newer. Availability depends on the account.
- [Fable 5.1](https://platform.claude.com/docs/en/models/fable-5-1/overview) and [pricing changes](https://platform.claude.com/docs/en/models/fable-5-1/whats-new-fable-5-1): $10/M input, $50/M output, $0.25/M cache reads.
- [Gemini model catalog](https://ai.google.dev/gemini-api/docs/models), [3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), [3.5 Flash Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite).
- [GLM 5.3](https://docs.z.ai/guides/llm/glm-5.3): some accounts with a Coding Plan history currently require the OpenAI-compatible endpoint; the Anthropic route is not universally available.
- [MiniMax model catalog](https://platform.minimax.io/docs/guides/models-intro).
- [MiMo V2.5](https://mimo.mi.com/models/en-US/mimo-v2.5) and [plan changes](https://mimo.mi.com/docs/en-US/news/latest/v2.5-news).
- [Qwen 3.7 Plus](https://www.alibabacloud.com/help/en/model-studio/qwen3-7-plus), [Qwen 3.8 Flash](https://help.aliyun.com/en/model-studio/qwen3-8-flash).
- [Kimi models](https://www.kimi.com/code/docs/en/kimi-code/models.html), [Claude Code integration](https://www.kimi.com/code/docs/en/third-party-tools/claude-code.html).

Provider request-shape tests verify propagation without spending subscription credits. They do not establish every account's entitlement or prove a full-capacity million-token request succeeds.
