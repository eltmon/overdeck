# PAN-1641 — local Ollama verification

**Date:** 2026-09-27 (supersedes the 2026-09-25 pass; both are described below)
**Host:** Linux, NVIDIA GeForce RTX 3090 (24 GB, CUDA)
**Ollama:** 0.34.4, systemd service at `http://localhost:11434`, default window 32768
**Harness:** Claude Code, spawned by Overdeck (`pan start`) from the workspace-built CLI
**Model:** `gemma4:12b` (7.6 GB, Q4_K_M, 11.9B params), pulled into the service's store

## Verdict

**Overdeck's local-model launch path is verified end to end. `gemma4:12b` is not
capable enough to drive a work agent, so AC-10's task-completion clause is still
unmet — for a model reason, not an Overdeck one.**

AC-10 asks for two different things in one sentence: that Overdeck can launch a
claude-code agent onto a local model with no cloud calls, and that the agent then
finishes PAN-3684's task. The first is now proven live. The second failed on the
model, three times, with the evidence below. Per PRD decision D12 the model was not
silently swapped.

## What the live spawn proved

`node dist/cli/index.js start PAN-3684 --model ollama:gemma4:12b --harness claude-code`,
run twice from this workspace's own build.

**1. The whole Overdeck launch path ran.** Model routing resolved `ollama:gemma4:12b`
to the `ollama` provider, `canUseHarness` admitted claude-code, the preflight probed
the live server, and the launcher was generated and run in a real Herdr pane with
`--effort high`, the hooks, and the work-role system prompt. `--effort` caused no
error, retiring hazard H4.

**2. The launcher env is exactly D4** (`~/.overdeck/agents/agent-pan-3684/launcher.sh`):

```
export ANTHROPIC_BASE_URL="http://localhost:11434"
export ANTHROPIC_AUTH_TOKEN="ollama"
export ANTHROPIC_DEFAULT_OPUS_MODEL="gemma4:12b"
export ANTHROPIC_DEFAULT_SONNET_MODEL="gemma4:12b"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="gemma4:12b"
export ANTHROPIC_SMALL_FAST_MODEL="gemma4:12b"
export CLAUDE_CODE_SUBAGENT_MODEL="gemma4:12b"
export API_TIMEOUT_MS="600000"
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1"
export CLAUDE_CODE_MAX_CONTEXT_TOKENS="32768"
export CLAUDE_CODE_AUTO_COMPACT_WINDOW="32768"
```

`grep -c 'export ANTHROPIC_API_KEY'` is **0** — the only mention is the `unset` line.
The launch flag is `--model 'gemma4:12b'`, so the `ollama:` prefix was stripped at the
single launch-arg door. Exactly one pin pair is exported, confirming
`getClaudeCodeContextPolicyForModel` correctly returns `{}` for this provider.
**AC-10.ac2 is met.** The captured launcher, alongside the same exports regenerated
from the shipping build, is committed at
[`pan-1641-pan-3684-launcher-env.txt`](pan-1641-pan-3684-launcher-env.txt). The two
differ only in the pin value, for the reason in "A pin bug this run found and fixed"
below; the shipping build pins 32768, this host's real serving window.

**3. Ollama really served the agent.** The agent's first turn consumed
**16387 input tokens** and produced output, so the Messages API round-trip works
inside a real Overdeck agent, not only under `claude --print`.

**4. Zero cloud model calls (NFR-5).** `strace` cannot attach to a pane that is not a
descendant (`ptrace_scope=1`), so the PRD's documented fallback was used: a 1 Hz
`ss -tnpH` poll over the agent's whole process tree for its entire life. All model
traffic was loopback to `127.0.0.1:11434` / `[::1]:11434`. Three non-loopback
destinations appeared, all on 443:

```
[2606:4700:3031::6815:363d]:443
[2606:4700:3035::ac43:8806]:443
[2606:4700:3035::ac43:98a5]:443
```

These are the same Cloudflare-fronted addresses the 2026-09-25 pass identified from
the TLS SNI as **`tldraw-mcp-app.tldraw.workers.dev` and `mcp.sentry.dev`** — remote
MCP servers from the operator's own MCP configuration, which Claude Code opens at
startup whatever serves the model. Nothing reached `api.anthropic.com`
(160.79.104.10), statsig, or any model provider.

So AC-10's literal clause "none belongs to the claude process" is unreachable on any
host with remote MCP servers configured, and is orthogonal to Ollama. The substantive
requirement — no cloud *model* calls — holds.

## Why the task did not complete: the model

Three attempts, all on `gemma4:12b`:

1. **First spawn: `Prompt is too long`.** The kickoff prompt exceeded the 32768 window
   and the API rejected the turn outright.
2. **Second spawn, then two explicit nudges** naming the tool, the exact absolute path
   and the exact git command. The model answered each with a generic greeting —
   *"I am ready. Please provide your instructions"* and *"I'm ready to help you with
   the Overdeck project… Please provide your first task or question!"* — and made
   **zero tool calls in 73 transcript records**.

The model is not broken in general: in an isolated short-context session with the same
harness and the same D4 env it completed the loop, `num_turns: 3`, emitting a real
`Write` tool_use and receiving `File created successfully`. It simply loses the
instruction inside a 16K-token agent system prompt. It also hallucinated the target
directory there, writing `LOCAL_OK` to a flattened `/tmp/...-scratchpad/g4test/` path
rather than its cwd, and then reported success — so even its successful loop needs
its claims checked.

For contrast, `qwen3:14b` did complete this loop in the 2026-09-25 pass
(`num_turns: 5`, file written with exactly `LOCAL_OK`). A model swap is a deliberate
plan change under D12, so it was not made here.

## A pin bug this run found and fixed

The first fix attempted was to ask for the window per request: Ollama honors
`options.num_ctx` on `/api/generate`, and a warm-load asking for 65536 did make
`/api/ps` report 65536 — apparently letting `ollama.context_length` work on a server
Overdeck cannot reconfigure.

**It is wrong, and the live run proved it.** The harness's own `/v1/messages` requests
carry no `num_ctx`, so Ollama serves them at the server default; `/api/ps` fell back
to 32768 as soon as the agent ran. Claude Code, pinned to the 65536 that was asked
for, then let context grow past what the server would serve. The transcript shows the
consequence exactly:

```
usage in: 16387 out: 55     <- fits the real 32768 window, produced output
usage in: 58595 out: 0      <- past it: zero output
usage in: 61349 out: 0      <- past it: zero output
```

Two turns of 58K and 61K input returning **zero** output tokens: the silent truncation
of hazard H1, caused by a pin that over-promised. So `warmOllamaModel` stays a plain
load with no `num_ctx`, because the window it reads back has to be the window the
harness will actually get. `ollama.context_length` legitimately applies only to a
server Overdeck starts itself, `pan doctor` is what tells an operator the window is
too small, and the docs now say so. Do not re-try the `num_ctx` idea; this is the
record of why.

The host's own window could not be raised: this agent has no passwordless sudo, so
the systemd `OLLAMA_CONTEXT_LENGTH` override the docs recommend was not available.

## Housekeeping

- Both PAN-3684 agents were killed as soon as their evidence was captured. No Herdr
  pane was left behind, and `/api/ps` reports no resident model.
- PAN-3684's body was corrected from "Pi work agent" to "claude-code work agent".
- No model was pulled during this pass. `gemma4:12b` was already in the service store.
- PAN-3684 is **left open** with no `LOCAL_OLLAMA_OK.txt` commit, because its task was
  not completed.

## What the operator needs to decide

1. **Accept a capable local model for AC-10**, or accept the launch-path proof above
   and retire the task-completion clause to a follow-up. `gemma4:12b` cannot drive a
   work agent on this host; `qwen3:14b` demonstrably can drive a short tool loop.
2. **Set `OLLAMA_CONTEXT_LENGTH=65536`** on the systemd unit (root needed). At the
   default 32768 a work-agent kickoff prompt is at the edge: 16387 tokens fit, and one
   larger sync made the first spawn fail outright.
3. Re-run PAN-3684 after this branch merges. Before merge the production dashboard and
   Deacon still throw `UnknownModelError` for `ollama:` ids on any recovery or resume
   (hazard H2).
