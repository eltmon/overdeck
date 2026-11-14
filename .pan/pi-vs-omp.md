# PAN-5212 checkpoint: pi 0.85.0 vs oh-my-pi (omp) 17.4.1

Verified on 2026-11-13 against `pi` 0.85.0 and 1.5.2 (npm `latest`, in a
scratch prefix: same flags, extension events, control channel, `--session`
resume and session format), and the installed binaries (`pi` 0.85.0 from
`@earendil-works/pi-coding-agent`, `omp/17.4.1`), pi's bundled docs
(`<pkg>/docs/{extensions,rpc,session-format,models}.md`), and a live
`pi --mode rpc` run with a probe extension (session dir, FIFO stdin,
`prompt`, `/pan-done`, `abort`, then a second launch with `--session <id>`).

**Verdict: pi supports every capability Overdeck's ohmypi path relies on.**
No blocker. Message injection (RPC `prompt` + `streamingBehavior: "steer"`,
and extension `sendUserMessage(..., { deliverAs })`), session resume
(`--session <id>`), the extension lifecycle hooks, slash-command
registration, thinking levels and per-session model switching all exist.
The differences below are shape differences that the pi runtime, launcher
and extension must follow. The two that change launches are model
resolution (pi fuzzy-matches unknown ids to the wrong provider, see
"Model resolution") and resume (`--session`, not `--resume`).

Live evidence (2026-11-13): an RPC run on `openrouter/openai/gpt-oss-20b`
ran a bash tool call and replied; `turn_end` carried real usage
(`input 28215, output 43, cost.total 0.00051`), `tool_execution_end` carried
`{toolCallId, toolName, result, isError}`, and a `before_agent_start`
system-prompt edit took effect. A TUI launch inside this worktree reached
the input prompt with no dialog, and `session_start` fired with
`ctx.mode === "tui"`.

## Binary and runtime

| Property | pi | omp |
| --- | --- | --- |
| Binary | `pi` | `omp` |
| npm package | `@earendil-works/pi-coding-agent` | `@oh-my-pi/pi-coding-agent` |
| Runtime | Node (`#!/usr/bin/env node`) | Bun >= 1.3.14 |
| Process title | `pi` (`process.title = APP_NAME`) | `omp` |
| Config root | `~/.pi/agent` (`PI_CODING_AGENT_DIR`) | `~/.omp/agent` |

pi needs no Bun on PATH.

## CLI flags used by the launcher

| Need | pi | omp |
| --- | --- | --- |
| RPC over stdin | `--mode rpc` | `--mode rpc` |
| Model | `--model <provider/id>` | same |
| Thinking | `--thinking off\|minimal\|low\|medium\|high\|xhigh\|max` | `low..xhigh` used |
| Session dir | `--session-dir <dir>` (storage and lookup) | same |
| Extension | `--extension <path>` (repeatable) | same |
| System prompt | `--append-system-prompt <text\|file>` (repeatable) | one value only |
| **Resume** | **`--session <path\|id>`** (partial UUID). `--resume` is a boolean that opens an interactive picker. | `--resume <id>` |
| Context files | `--no-context-files` exists; not emitted (parity with omp, which loads AGENTS.md/CLAUDE.md) | flag removed |
| Project trust | TUI shows a trust dialog when the cwd has `.pi/settings.json`, `.pi/{extensions,skills,prompts,themes}`, `.pi/SYSTEM.md` or `.agents/skills`; RPC never prompts and ignores those resources. Launcher passes **`--no-approve`** so both modes behave the same and a conversation never blocks on a dialog. AGENTS.md/CLAUDE.md load regardless of trust. | no equivalent |

Verified live: a second launch with `--session <id> --session-dir <dir>`
reopened the same `<ts>_<id>.jsonl` file (no new file) and reported the same
session id. `--thinking max` is accepted.

## RPC protocol (stdin FIFO)

Identical for the commands Overdeck sends:
`{"type":"prompt","message":...,"streamingBehavior":"steer"}` is accepted
while streaming and delivered immediately when idle; `{"type":"abort"}`
aborts the current run without exiting the process (same as omp, so the kill
ladder still escalates to SIGTERM/kill-session). Every command gets a
`{"type":"response","command":...,"success":true}` line on stdout.

## Extension API

| Overdeck extension needs | pi 0.85 | omp |
| --- | --- | --- |
| `on('session_start')` | yes; event is `{ reason }` only (`startup\|reload\|new\|resume\|fork`). Session id comes from `ctx.sessionManager.getSessionId()`, transcript path from `ctx.sessionManager.getSessionFile()`, model from `ctx.model` | event carries `sessionId`, `model` |
| Fold Overdeck context into the system prompt | no `ctx.appendSystemPrompt` (omp 17.4.1 has none either, so the extension's fold is a no-op on both). The launcher already passes the rendered context layers and the session briefing via `--append-system-prompt`, so the extension must not inject them again. `before_agent_start` returning `{ systemPrompt }` works (verified) if ever needed | no `appendSystemPrompt` in omp's extension types |
| `on('turn_end')` | `{ turnIndex, message, toolResults }`, fired once **per LLM response**, including tool-call responses. Output text is in `message.content[].text`, usage in `message.usage`, model in `message.provider`/`message.model`. No `output`/`sessionLogPath`; transcript path from `ctx.sessionManager.getSessionFile()`. Work-agent completion checks run on `agent_settled` (pi will not continue on its own), not on every `turn_end`, so a tool-heavy reply is not counted as several progressless turns | `output`, `sessionLogPath`, `usage`, `model` |
| `on('tool_execution_end')` | `{ toolCallId, toolName, result, isError }`; no usage | similar, may carry usage |
| `on('input')` | `{ text, images, source: interactive\|rpc\|extension, streamingBehavior }` | same |
| `registerCommand('pan-done')` | yes; handler `(args, ctx)` receives the raw argument string (verified: `/pan-done finished it` -> `"finished it"`) | same |
| `sendUserMessage(text, { deliverAs: 'steer'\|'followUp' })` | yes (required while streaming) | same |
| `setThinkingLevel(level)` | yes, levels add `max` | yes |
| `setModel(model)` | **takes a Model object**, returns `false` without auth. Resolve with `ctx.modelRegistry.find(provider, id)` | accepts a model string |
| `ctx.compact()` | yes | yes |
| MCP | pi has no MCP client; Overdeck MCP stays off (`overdeckMcp: false`, same as omp) | off |
| `ask` tool | **none** (built-ins: read, bash, edit, write, grep, find, ls). Questions arrive as plain assistant text, so pi answers by message, not the omp ask-modal keystroke path | `ask` modal |

## Session JSONL

Same v3 format as omp (omp kept pi's format): header
`{"type":"session","version":3,"id","timestamp","cwd"}`, then `message`,
`model_change`, `thinking_level_change`, ... entries. Files are named
`<timestamp>_<uuid>.jsonl` under `--session-dir`. pi's `model_change` uses
`provider` + `modelId` (omp uses one `model` field); the existing pi parsers
already read both. Assistant usage is `usage.{input,output,cacheRead,cacheWrite,totalTokens,cost.total}`.

## Model provisioning (`models.json`)

| Property | pi | omp |
| --- | --- | --- |
| File | `~/.pi/agent/models.json` | `~/.omp/agent/models.json` |
| Built-in provider merge | custom models upsert by `id`; built-ins kept | same |
| `apiKey` env reference | **`"$ENV_NAME"`** (a bare `ENV_NAME` is a literal key) | bare env-var name |
| Model fields | `id, name, reasoning, input, contextWindow, maxTokens, cost` (no `supportsTools`) | adds `supportsTools` |

## Model resolution

pi resolves `--model <provider>/<id>` exactly when the id is in its catalog
(case-insensitive: `minimax/minimax-m2.7` binds `MiniMax-M2.7`). An unknown
id is **fuzzy-matched to another provider**: `xai/grok-build-0.1` bound a
`vercel-ai-gateway` model, and a bare OpenRouter id `openai/gpt-oss-20b`
bound pi's **groq** provider. `openrouter/openai/gpt-oss-20b` bound
OpenRouter correctly (real turn replied). So the launcher must always pass
a pi-provider-qualified id, OpenRouter included, and every Overdeck tier
model pi does not ship must be provisioned.

Overdeck tier models vs pi 0.85.0's bundled catalog (pi-ai
`models.generated.js`):

| Overdeck provider | pi provider | Missing from pi's catalog |
| --- | --- | --- |
| google | `google` | `gemini-4-argon` |
| minimax | `minimax` | `MiniMax-M3.1-Flash` (lowercase m2.7 ids resolve by case) |
| zai | `zai` | `glm-5.3-flashx`, `glm-5.1`, `glm-4.7-flash` |
| mimo | `xiaomi-token-plan-sgp` (Overdeck MiMo keys are token-plan SGP keys; pi's `xiaomi` is the `api.xiaomimimo.com` billing endpoint) | `mimo-v2.6-pro`, `mimo-v2.6-flash`, `mimo-v2.6-pro-ultraspeed` |
| xai | `xai` | `grok-build-0.1`, `grok-4.7` |
| groq | `groq` | none |
| cerebras | `cerebras` | none |
| mistral | `mistral` | `mistral-large-4-0` |
| openrouter | `openrouter` | dynamic; ids must be prefixed `openrouter/` |
| nous | none (no pi provider) | custom `nous` provider (Nous Portal OpenAI-compatible endpoint) |
| dashscope | none matching (pi's `qwen-token-plan` is a different product and key) | custom `dashscope` provider, as omp |

omp 17.4.1 resolves `grok-build-0.1` and `glm-5.1` natively but also misses
`mimo-v2.6-pro` and `MiniMax-M3.1-Flash` (it falls through to zenmux), so
pi's provisioning list is longer than omp's (dashscope + google).

**The catalog changes between pi versions.** pi 1.5.2 (npm `latest` on
2026-11-13) ships `gemini-4-argon`, `MiniMax-M3.1-Flash`, the MiMo v2.6 ids
and `grok-4.7`, and a `models.json` entry with a built-in id *replaces* the
built-in definition. So provisioning reads the installed pi's catalog
(`pi-ai/dist/providers/data/<provider>.json`, found from the `pi` binary) and
writes only the ids it lacks; an Overdeck entry is removed once pi ships the
id. Verified: on 0.85.0 all planned ids were written; on 1.5.2 only
`glm-5.3-flashx`, `glm-5.1`, `glm-4.7-flash`, `mimo-v2.6-pro-ultraspeed` and
`grok-build-0.1`.

DashScope's OpenAI-compatible endpoint rejects the `developer` role
(`developer is not one of ['system', ...]`), so its provider entry sets
`compat.supportsDeveloperRole: false`.

### Per-provider launch matrix (2026-11-13)

Every model of every provider that now defaults to pi was run through the
branch's real provisioning, `qualifyPiModel(..., 'pi')` and
`getProviderEnvForModel(..., 'pi')`, then one `pi -p` turn. All 38 bound the
intended provider and model on pi 0.85.0, and the 1.5.2 rerun matched.

| Provider | Result |
| --- | --- |
| google (7 models) | real reply from every model, incl. provisioned `gemini-4-argon` (0.85) and built-in (1.5.2) |
| openrouter (`qwen/qwen3.7-flash`) | real reply |
| nous (`qwen/qwen3.6-plus`) | real reply through the provisioned `nous` provider |
| dashscope | real reply (`qwen3.7-plus`) after the compat fix |
| minimax, zai, mimo | bound correctly; no real turn: this machine's accounts are out of balance, out of quota, and failing auth (Overdeck's own pre-flight reports it) |
| xai, groq, cerebras, mistral | bound correctly; no key configured here, so the endpoint rejected a dummy key |

## Auth

pi reads provider keys from env (`OPENROUTER_API_KEY`, `GEMINI_API_KEY`,
`XAI_API_KEY`, `ZAI_API_KEY`, `MINIMAX_API_KEY`, `GROQ_API_KEY`,
`CEREBRAS_API_KEY`, `MISTRAL_API_KEY`, `ANTHROPIC_API_KEY`/`ANTHROPIC_OAUTH_TOKEN`,
...) and from `~/.pi/agent/auth.json` (`/login`). Overdeck's launcher exports
the provider key under each of those names (`getProviderEnv` in
`src/lib/providers.ts`), with gaps closed in PAN-5212: MiMo is also
exported as `XIAOMI_TOKEN_PLAN_SGP_API_KEY` (pi's token-plan provider);
Google launches got only the CLIProxy (Anthropic-compatible) env and no
`GEMINI_API_KEY` for any harness, so pi-family Google launches now get
`GEMINI_API_KEY`; Nous and DashScope are custom providers whose `models.json`
entries reference `$NOUS_API_KEY` / `$DASHSCOPE_API_KEY`. `pi auth check --provider <p>` reports
readiness.

## Stored `pi` rows

Un-folding `pi` from `ohmypi` changes how stored `pi` rows resolve. On this
machine `overdeck.db` holds 25 `harness='pi'` conversations, all created
2026-06-20..2026-06-24. 24 predate the PAN-1989 commit (2026-06-24 16:16
UTC); one (16:40 UTC) is 24 minutes after it and most likely ran before that
build was deployed. No agent `state.json` carries `harness: pi`. So the rows
that will now resume on pi really ran on pi.

## Terms of service

pi is a third-party harness like omp. Anthropic's consumer terms limit
subscription (Claude Pro/Max OAuth) use to Anthropic's own clients, so pi
gets the same rule as omp: Anthropic models are blocked under subscription
auth and allowed with an API key.
