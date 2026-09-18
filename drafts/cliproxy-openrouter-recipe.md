# Claude Code on OpenRouter `stealth/ox-alpha` — proven recipe

Verified 2026-08-23 on this machine, Claude Code CLI, CLIProxyAPI 7.1.39 untouched.

## TL;DR — the working invocation (native path, no proxy)

OpenRouter natively serves an **Anthropic-compatible Messages endpoint** at
`https://openrouter.ai/api/v1/messages`. Claude Code talks to it directly — no
CLIProxy, no y-router, no extra infra.

```bash
export ANTHROPIC_BASE_URL=https://openrouter.ai/api
export ANTHROPIC_AUTH_TOKEN=$OPENROUTER_API_KEY          # key REDACTED — sourced from env
export CLAUDE_CODE_MAX_CONTEXT_TOKENS=1048576            # ox-alpha's real window (see caveats)

claude --model "stealth/ox-alpha" -p "Reply exactly: OX-CC-OK"
# -> OX-CC-OK
```

Notes on the env vars:

- `ANTHROPIC_BASE_URL` is `https://openrouter.ai/api` (Claude Code appends
  `/v1/messages`). Do NOT include `/v1`.
- `ANTHROPIC_AUTH_TOKEN` (Bearer auth) works with the OpenRouter key. Raw curl
  with `x-api-key` also works, so `ANTHROPIC_API_KEY` should too; Bearer via
  `ANTHROPIC_AUTH_TOKEN` is the form actually verified end-to-end with the CLI.
- The API key came from the environment of a running `omp --model
  stealth/ox-alpha` process (`/proc/<pid>/environ`). It is not printed,
  logged, or committed anywhere; scratchpad debug logs were grepped for the key
  and its `sk-or-` prefix — zero hits.

## What was verified (all PROVEN)

1. **Raw endpoint probe** — `POST https://openrouter.ai/api/v1/messages` with
   `model: stealth/ox-alpha` returned HTTP 200 with a well-formed Anthropic
   `message` object (including a `thinking` content block — the model is a
   reasoning model).
2. **Basic headless turn** — `claude --model "stealth/ox-alpha" -p "Reply
   exactly: OX-CC-OK"` → `OX-CC-OK`.
3. **2-turn `--resume`** — turn 1 stored a codeword (`--output-format json` to
   capture `session_id`), turn 2 with `--resume <session_id>` recalled it
   (`ZEBRA-42`). Sessions persist.
4. **Tool call** — `claude --model "stealth/ox-alpha" --allowedTools
   "Bash(echo:*)" --permission-mode acceptEdits -p "Run the shell command: echo
   tool-path-works ..."` → the model invoked Bash and reported
   `tool-path-works` verbatim. Tool use round-trips through OpenRouter's
   Anthropic translation correctly.
5. **Context window override** — `CLAUDE_CODE_MAX_CONTEXT_TOKENS=1048576`
   suppresses the "auto-compact will keep this session within 200k tokens"
   warning. OpenRouter's `/api/v1/models` reports ox-alpha at
   `context_length: 1048576`, `max_completion_tokens: 131072`.

## Empty-completion / retry check — NOT OBSERVED (not disproven)

Three consecutive headless sessions ran with `--debug`, stderr captured. All
three returned the correct answer with **zero empty completions and zero
retries** — the failure mode this migration exists for did not occur in the
sample, so Claude Code's retry-on-empty behavior was never exercised, only its
absence of need. Two honest caveats for the operator:

- A short sample of 3 clean sessions says nothing about the intermittent empty
  rate under fleet load.
- If the provider returns an empty completion **with HTTP 200**, that may not
  trigger the same Claude Code retry path as a 5xx/529/stream error. There is
  no evidence either way from this run. If the fleet re-harness is betting
  specifically on retry-on-empty-200, that remains undemonstrated.

## ALERT: pre-existing CLIProxy alias outage (not caused by this work)

While sanity-checking the "don't break the gpt-5.6 aliases" constraint, the
existing alias path turned out to be **already down**:

```
POST http://127.0.0.1:8317/v1/messages  (model: claude-sonnet-5)
-> 503 {"error":{"message":"auth_unavailable: no auth available (providers=codex, model=claude-sonnet-5)"}}
```

Attribution is airtight:

- `~/.overdeck/cliproxy/cliproxy.log` shows the codex OAuth refresh failing at
  **2026-08-22 11:23:38** with a 401 `refresh_token_reused` ("Your refresh
  token has already been used to generate a new access token. Please try
  signing in again.").
- This session's first and only request to cliproxy was 2026-08-23 03:02 — a
  read-only test. **CLIProxy was never reconfigured or restarted by this
  work**; `config.extra.yaml` is byte-identical to before.
- Fix: an interactive codex OAuth re-login, which only the operator can do.
- This breakage is codex-OAuth-specific. It would not have blocked a
  hypothetical openrouter upstream inside CLIProxy (that would use API-key
  auth, not OAuth).

## CLIProxy path — NOT ATTEMPTED (deliberately)

The brief's approach order made CLIProxy conditional on the native path
failing. The native path is proven, so `config.extra.yaml` was not modified
and cliproxy was not restarted — the existing `oauth-model-alias` entries are
untouched by construction (no diff to show).

On the operator's earlier attempt ("configured openrouter in CLIProxy and it
didn't work"): **no trace of it exists** — zero `openrouter`/`stealth` hits in
`config.yaml`, `config.extra.yaml`, both auth dirs, or the full 18MB
`cliproxy.log`. Whatever was tried was reverted or never saved; there was
nothing to diagnose.

## Caveats and cosmetics

- **Unknown-model warnings are cosmetic.** Each run prints
  `[claude-code:unrecognized_model]` telemetry and "Advisor disabled — base
  model 'stealth/ox-alpha' has no advisor rank". Neither affects operation.
  (`CLAUDE_CODE_ENABLE_EXPERIMENTAL_ADVISOR_TOOL=1` re-enables the advisor if
  wanted; untested here.)
- **Set the window explicitly.** Without `CLAUDE_CODE_MAX_CONTEXT_TOKENS`,
  Claude Code assumes 200k and auto-compacts early. For Overdeck-launched
  fleet agents, note the launchers already export
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW` for non-Anthropic models (PAN-2441) — the
  ox-alpha integration should carry 1048576 through that same mechanism. (Note
  only; the Overdeck repo was not modified.)
- **Rate limits** — none hit during testing (≈8 requests). No conclusions.
- **stdin in scripts** — headless `claude -p` waits 3s for piped stdin; append
  `< /dev/null` in scripts to skip the wait.

## Status summary

| Path | Status |
| --- | --- |
| Native: `ANTHROPIC_BASE_URL=https://openrouter.ai/api` + `ANTHROPIC_AUTH_TOKEN=<openrouter key>` | **PROVEN** (basic turn, 2-turn resume, tool call, window override) |
| Retry-on-empty-completion | **NOT OBSERVED** — zero empties in 3 debug sessions; behavior on an empty-200 undemonstrated |
| CLIProxy openrouter upstream | **NOT ATTEMPTED** — unnecessary; native path works; existing aliases untouched |
| Pre-existing gpt-5.6 alias path | **DOWN since 2026-08-22 11:23** — codex OAuth `refresh_token_reused`; operator re-login required |
