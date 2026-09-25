# PAN-1641 — local Ollama verification

**Date:** 2026-09-25
**Host:** Linux, NVIDIA GeForce RTX 3090 (24 GB, CUDA)
**Ollama:** 0.19.0 (systemd service, user `ollama`, `http://localhost:11434`)
**Harness:** Claude Code (`claude --print`)
**Model used:** `qwen3:14b` — **not** `gemma4:12b`; see "Deviations" below.

## Read this first: what was not done

**The planned end-to-end step — spawning an Overdeck work agent on PAN-3684 with
`pan start PAN-3684 --model ollama:gemma4:12b` — was not run.** Three reasons, in
order of weight:

1. **`gemma4:12b` cannot be pulled on this host.** Ollama 0.19.0 answers its
   manifest request with `412: The model you are attempting to pull requires a
   newer version of Ollama`. Upgrading Ollama restarts a service shared with the
   conversation-search embeddings path, on a host that was running eight agents.
   That is an operator decision, so it was not made unattended.
2. **The host's server runs a 32768-token window**, below the 65536 floor this
   work documents. Raising it means restarting that same shared service. A second
   server started on port 11500 has an empty model store, and the host's disk was
   at 100% (see "Disk"), so re-pulling 9 GB into it was not an option.
3. The spawn also edits and closes a GitHub issue, opens and closes a PR, and
   writes live agent state while the production dashboard still runs `origin/main`
   — which throws `UnknownModelError` for `ollama:` ids until this branch merges
   (hazard H2).

So **AC-10 is not met**: there is no PAN-3684 agent, no committed
`LOCAL_OLLAMA_OK.txt` on `feature/pan-3684`, and PAN-3684 is still open. What
follows is the verification that *was* performed, against the real local server
with the real built code. It covers every layer the spawn would have exercised
except Overdeck's own launcher/pane plumbing.

## Deviations

- **Model substituted.** `qwen3:14b` replaces `gemma4:12b`: same 12–14B class, same
  24 GB GPU, and it pulls cleanly on 0.19.0. The substitution was announced on
  [PAN-1641](https://github.com/eltmon/overdeck/issues/1641#issuecomment-5828843991)
  before the run, not buried here. `DEFAULT_OLLAMA_AGENT_MODEL` stays `gemma4:12b`
  in code — it is a recommendation string, never a resolution fallback, and it
  becomes pullable as soon as the operator upgrades Ollama.
- **Context window 32768, not 65536**, for the same reason as above.
- Evidence was gathered with `claude --print` driven by the exact env
  `getOllamaLaunchEnv` returns, rather than through a spawned pane.

## What was verified

### 1. Preflight against the live server (WI-1)

Run through the **built** `dist/` chunk, not the source:

```
checkOllamaHealth: {"endpointReachable":true,"version":"0.19.0","versionSupported":true,"modelPresent":true}
stripOllamaPrefix('ollama:qwen3:14b') -> qwen3:14b
warmOllamaModel: {"contextLength":32768} (23255ms)
```

The warm-load took 23 seconds cold, which is why its timeout is 120 s rather than
the 5 s probe budget.

### 2. `ensureOllamaServeRunning` really starts a server (WI-1)

Pointed at an unused port, it spawned a detached `ollama serve` with
`OLLAMA_HOST=localhost:11500` and `OLLAMA_CONTEXT_LENGTH=65536` and polled it
healthy in **49 ms**:

```
ensureOllamaServeRunning ok (49ms)
health: {"endpointReachable":true,"version":"0.19.0","versionSupported":true,
         "modelPresent":false,
         "message":"Ollama model qwen3:14b is not pulled. Run `ollama pull qwen3:14b`."}
```

That `modelPresent:false` line is an unmocked instance of the not-pulled error
path: a fresh server has an empty model store, and the message names the fix.
The server was stopped afterwards.

### 3. Claude Code completes a tool loop through Ollama's shim (hazard H4b — retired)

This was the one genuinely unproven thing. The planning-time probe had returned
`num_turns: 1`, so the `tool_result` round-trip had never been exercised. Driven
with exactly the D4 env at `ANTHROPIC_BASE_URL=http://localhost:11434`:

```
num_turns: 5
is_error: false
terminal_reason: "completed"
modelUsage.qwen3:14b: inputTokens 106271, outputTokens 3288, contextWindow 32768
```

The agent called the Write tool, received the `tool_result` back through Ollama's
Anthropic endpoint, continued, and reported success. The file it wrote contains
exactly `LOCAL_OK`:

```
$ cat LOCAL_OLLAMA_OK.txt
LOCAL_OK
```

(Written at
`/tmp/claude-1000/.../scratchpad/ollama-e2e/LOCAL_OLLAMA_OK.txt`, not committed —
there is no PAN-3684 agent run to commit it from.)

Claude Code's own `costUSD` field reported `0.613555` for this run. That is Claude
Code's internal estimate against an unrecognized model id; Overdeck records `$0`
through the null-pricing path added in the routing commit.

### 4. Hazard H1 reproduced live

A second run of the same prompt at the same 32768 window ended:

> `Autocompact is thrashing: the context refilled to the limit within 3 turns of
> the previous compact, 3 times in a row.`

Two runs, same prompt, same window: one completed, one thrashed. This is direct
evidence that 32768 is marginal for an agent turn and that the documented 65536
floor and the `pan doctor` warning below it are correctly placed.

### 5. Connection capture (NFR-5)

`strace -f -e trace=connect` over the full run. **All model traffic was loopback**:

```
connect(16, {AF_INET, htons(11434), inet_addr("127.0.0.1")})
connect(14, {AF_INET6, htons(11434), "::1"})
```

Non-loopback connections did appear, on port 443, to `104.21.54.61`,
`104.21.80.175`, `172.67.136.6`, `172.67.152.165` and their IPv6 equivalents
(`2606:4700:30xx::`). Extracting the TLS SNI from the ClientHello identifies them:

```
tldraw-mcp-app.tldraw.workers.dev
mcp.sentry.dev
```

**These are remote MCP servers from the operator's own MCP configuration, not
model calls and not Claude Code telemetry.** Claude Code opens them at startup
regardless of which provider serves the model. No connection went to
`api.anthropic.com` (160.79.104.10), statsig, or any model provider.

Per the PRD's checkpoint rule, the documented opt-outs were tried:
`DISABLE_TELEMETRY=1`, `DISABLE_ERROR_REPORTING=1`, `DISABLE_AUTOUPDATER=1`, and
`CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY=1` on top of the
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` the launch env already exports. The
connections were unchanged, which is consistent with their being MCP sessions
rather than telemetry. **None of the four was added to the launch env**: they do
not affect what was observed, and adding them would be the same footgun hazard
H10 describes for `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` — a privacy opt-out
an operator may set globally must not be handed to `PROVIDER_ENV_KEYS`, which
would `unset` it on every other provider's launch.

**Conclusion on NFR-5:** zero cloud *model* calls, confirmed. AC-10's literal
wording — no non-loopback connection at all from the claude process — is not
achievable while remote MCP servers are configured, and that is orthogonal to
Ollama.

## Disk

Probing for a pullable substitute pulled three models (~26 GB) onto a host whose
root filesystem was already near full; free space reached 3.2 GB. `qwen2.5-coder:14b`
and `gemma3:12b` were removed immediately afterwards, restoring free space to
20 GB. **`qwen3:14b` (9.3 GB) was left in place** because it is the model this
audit refers to and the only locally usable agent model on the host; remove it
with `ollama rm qwen3:14b` to reclaim that space.

## What the operator needs to decide

1. Upgrade Ollama past 0.19.0 if `gemma4:12b` is wanted. That restarts the shared
   service.
2. Set `OLLAMA_CONTEXT_LENGTH=65536` on the systemd unit (see
   `configuration/local-models.mdx`), or let `pan up` own the server.
3. Re-run the PAN-3684 spawn once this branch is merged — before merge the
   production dashboard and Deacon throw `UnknownModelError` for `ollama:` ids on
   any recovery or resume (hazard H2).
