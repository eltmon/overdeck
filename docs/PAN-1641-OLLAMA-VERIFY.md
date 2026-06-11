# PAN-1641 local Ollama Pi verification

Date: 2026-06-11

## Scope

This note records the end-to-end local-model verification for PAN-1641's Pi harness Ollama path. The verification exercises the Panopticon work-agent spawn lifecycle, the generated Pi launcher, the FIFO prompt path, the Panopticon Pi extension provider registration, and Ollama's OpenAI-compatible `/v1` endpoint.

## Environment

- Host default IPv4 Ollama service: `/usr/local/bin/ollama serve` on `127.0.0.1:11434`, server `0.19.0`.
- The host service is root-owned and could not be upgraded in this passwordless workspace session (`sudo -n true` requires a password).
- Ollama `0.19.0` cannot pull `gemma4:12b`; `ollama pull gemma4:12b` returns: `The model you are attempting to pull requires a newer version of Ollama.`
- For verification, the current Ollama Linux amd64 tarball was downloaded to `/tmp/pan1641-ollama-default/` and served loopback-only on the default Ollama port via IPv6: `http://[::1]:11434`.
- Model pulled on that default-port local server: `gemma4:12b`.

The IPv6 loopback listener was used only because the root-owned stale IPv4 listener already occupied `127.0.0.1:11434`. This still exercises Ollama on the default port `11434`, loopback-only, with no model traffic leaving the machine.

## Current Ollama setup commands

```bash
curl -fL https://ollama.com/download/ollama-linux-amd64.tar.zst \
  -o /tmp/pan1641-ollama-default/ollama-linux-amd64.tar.zst

tar --zstd -xf /tmp/pan1641-ollama-default/ollama-linux-amd64.tar.zst \
  -C /tmp/pan1641-ollama-default

OLLAMA_HOST='[::1]:11434' /tmp/pan1641-ollama-default/bin/ollama serve \
  > /tmp/pan1641-ollama-default/serve.log 2>&1

OLLAMA_HOST='http://[::1]:11434' \
  /tmp/pan1641-ollama-default/bin/ollama pull gemma4:12b
```

The server log confirmed the default-port loopback listener:

```text
Listening on [::1]:11434 (version 0.30.7)
```

The model pull completed successfully:

```text
pulling 1278394b6936: 100% ▕██████████████████▏ 7.4 GB
pulling 675ad6e68101: 100% ▕██████████████████▏ 175 MB
verifying sha256 digest
writing manifest
success
```

## Panopticon work-agent spawn under Pi + Ollama

The verification used a temporary Panopticon work agent, not a direct `pi -p` command. The spawn call was:

```ts
await spawnAgent({
  issueId: 'PAN-1641-E2E-PROMPT',
  workspace: '/tmp/pan1641-work-agent-prompt',
  role: 'work',
  harness: 'pi',
  model: 'ollama:gemma4:12b',
  prompt: 'Respond with exactly PAN1641_WORK_AGENT_DEFAULT_OK and no other text.',
  allowHost: true,
});
```

The temporary workspace contained a `.beads/issues.jsonl` entry labeled `pan-1641-e2e-prompt`, so the normal work-agent beads gate was exercised. `allowHost: true` bypassed only the Docker stack health gate because the temporary verification workspace intentionally had no devcontainer stack.

For this rootless host verification, the project config used by the spawn was:

```yaml
models:
  providers:
    ollama:
      enabled: true
      base_url: "http://[::1]:11434"
```

The generated Panopticon launcher exported the expected local provider env and invoked Pi in work-agent RPC mode:

```bash
export OPENAI_BASE_URL="http://[::1]:11434/v1"
export OPENAI_API_KEY="ollama"
export PANOPTICON_OLLAMA_MODEL="gemma4:12b"
exec pi --mode rpc \
  --model 'ollama/gemma4:12b' \
  --session-dir '/home/eltmon/.panopticon/agents/agent-pan-1641-e2e-prompt' \
  --extension '/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1641/packages/pi-extension/dist/index.js' \
  --no-context-files \
  <> '/home/eltmon/.panopticon/agents/agent-pan-1641-e2e-prompt/rpc.in'
```

The `spawnAgent()` result showed the work agent running with the expected harness/model and the kickoff prompt delivered through the Pi FIFO path:

```json
{
  "id": "agent-pan-1641-e2e-prompt",
  "issueId": "PAN-1641-E2E-PROMPT",
  "harness": "pi",
  "model": "ollama:gemma4:12b",
  "status": "running",
  "workspace": "/tmp/pan1641-work-agent-prompt",
  "kickoffDelivered": true
}
```

## Result

The Pi work-agent JSONL transcript recorded a successful assistant response from provider `ollama`, model `gemma4:12b`, cost `0`:

```json
{
  "role": "assistant",
  "content": [{ "type": "text", "text": "PAN1641_WORK_AGENT_DEFAULT_OK" }],
  "api": "openai-completions",
  "provider": "ollama",
  "model": "gemma4:12b",
  "usage": {
    "input": 18725,
    "output": 89,
    "cacheRead": 0,
    "cacheWrite": 0,
    "totalTokens": 18814,
    "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 }
  },
  "stopReason": "stop"
}
```

The exact response marker was:

```text
PAN1641_WORK_AGENT_DEFAULT_OK
```

## Zero-cloud network evidence

The temporary Pi work-agent launch was instrumented with:

```bash
strace -f -e trace=connect -s 200 \
  -o /tmp/pan1641-work-agent-prompt.strace \
  /home/eltmon/.config/nvm/versions/node/v22.22.0/bin/pi ...
```

`strace` observed only Unix sockets, the local dashboard heartbeat, and the default-port loopback Ollama endpoint:

```text
connect_count 10
127.0.0.1:3011
AF_UNIX
[::1]:11434
non_local_count 0
```

The `127.0.0.1:3011` connections are the Panopticon extension heartbeat attempts to the local dashboard. The model request went to `[::1]:11434`, the loopback-only Ollama OpenAI-compatible endpoint on the default Ollama port. No Anthropic, OpenAI, or other cloud endpoint connections were observed during the spawned work-agent run.

## Earlier superseded verification

An earlier 2026-06-08 smoke test used a direct `pi --offline --no-session --no-tools` command against `127.0.0.1:11435`. That proved the Pi extension could talk to local Ollama, but it did not satisfy the full vBRIEF e2e acceptance criteria because it bypassed the Panopticon work-agent spawn lifecycle and used a non-default port. The 2026-06-11 work-agent verification above supersedes that smoke test.

## Conclusion

The Pi + Ollama path now has end-to-end evidence through a real Panopticon work-agent spawn: Panopticon generated the Pi launcher, registered the Ollama provider through the extension env, delivered the prompt through the work-agent FIFO path, ran `gemma4:12b` locally through Ollama's OpenAI-compatible endpoint on default port `11434`, and produced zero non-local network connections.
