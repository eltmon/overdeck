# PAN-5212 checkpoint: pi 0.85.0 vs oh-my-pi (omp) 17.4.1

Verified on 2026-11-13 against the installed binaries (`pi` 0.85.0 from
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
and extension must follow.

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
| Fold Overdeck context into the system prompt | **no `ctx.appendSystemPrompt`**. Use `on('before_agent_start')` and return `{ systemPrompt: event.systemPrompt + extra }` (chained across extensions, applied per turn) | `ctx.appendSystemPrompt(text)` at session start |
| `on('turn_end')` | `{ turnIndex, message, toolResults }`. Output text is in `message.content[].text`, usage in `message.usage`, model in `message.provider`/`message.model`. No `output`/`sessionLogPath`; transcript path from `ctx.sessionManager.getSessionFile()` | `output`, `sessionLogPath`, `usage`, `model` |
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

pi's bundled catalog (pi-ai `models.generated.js`) has the providers
google, minimax, zai, xiaomi, xai, groq, cerebras, mistral, openrouter,
kimi-coding, openai-codex, anthropic, but **not dashscope**, and lacks
`google/gemini-4-argon`. So pi needs the same provisioning omp gets
(dashscope + the missing Gemini ids), written to pi's file with `$`-prefixed
key references.

## Auth

pi reads provider keys from env (`OPENROUTER_API_KEY`, `GEMINI_API_KEY`,
`XAI_API_KEY`, `ZAI_API_KEY`, `MINIMAX_API_KEY`, `GROQ_API_KEY`,
`CEREBRAS_API_KEY`, `MISTRAL_API_KEY`, `ANTHROPIC_API_KEY`/`ANTHROPIC_OAUTH_TOKEN`,
...) and from `~/.pi/agent/auth.json` (`/login`). The launcher already exports
the Overdeck provider env, so no pi-specific auth work is needed.
`pi auth check --provider <p>` reports readiness.

## Terms of service

pi is a third-party harness like omp. Anthropic's consumer terms limit
subscription (Claude Pro/Max OAuth) use to Anthropic's own clients, so pi
gets the same rule as omp: Anthropic models are blocked under subscription
auth and allowed with an API key.
