---
audience: operator
name: cliproxy
description: >
  Check and restart the CLIProxy sidecar (port 8317). CLIProxy bridges
  ChatGPT subscription OAuth tokens to an Anthropic-compatible /v1/messages
  endpoint so Panopticon agents can use GPT models without an OpenAI API key.
  Use when GPT-model agents are returning API errors or when cliproxy is down.
triggers:
  - cliproxy is down
  - restart cliproxy
  - cliproxy not running
  - GPT API errors
  - GPT5 errors
  - gpt5 not working
  - check cliproxy
  - cliproxy status
  - fix GPT routing
allowed-tools:
  - Bash
  - Read
---
audience: operator

# CLIProxy — Check and Restart

CLIProxy is a background sidecar that proxies Anthropic-compatible API calls to GPT
models via ChatGPT subscription OAuth tokens. Panopticon agents talk to it via
`ANTHROPIC_BASE_URL=http://127.0.0.1:8317`.

## Quick Status Check

```bash
# Is it running?
ss -tlnp | grep 8317

# Check PID file
cat ~/.panopticon/cliproxy/cliproxy.pid 2>/dev/null

# Verify process is alive
kill -0 $(cat ~/.panopticon/cliproxy/cliproxy.pid 2>/dev/null) 2>/dev/null && echo "alive" || echo "dead"
```

## Restart CLIProxy

```bash
# Kill any existing instance
lsof -ti:8317 2>/dev/null | xargs -r kill 2>/dev/null || true
rm -f ~/.panopticon/cliproxy/cliproxy.pid

# Start fresh
nohup ~/.panopticon/bin/cliproxy -config ~/.panopticon/cliproxy/config.yaml \
  >> ~/.panopticon/cliproxy/cliproxy.log 2>&1 &
echo $! > ~/.panopticon/cliproxy/cliproxy.pid

# Confirm it's up (give it 2 seconds)
sleep 2 && ss -tlnp | grep 8317
```

## Check Recent Logs

```bash
# Last 30 lines of cliproxy log
tail -30 ~/.panopticon/cliproxy/cliproxy.log

# Watch live
tail -f ~/.panopticon/cliproxy/cliproxy.log
```

## Config and Auth

| Path | Purpose |
|---|---|
| `~/.panopticon/bin/cliproxy` | Binary (v6.9.24, built from eltmon/cliproxy fork) |
| `~/.panopticon/cliproxy/config.yaml` | Server config (host, port, auth-dir, api-keys) |
| `~/.panopticon/cliproxy/auth/codex-primary.json` | Codex OAuth credentials (bridged from `~/.codex/auth.json`) |
| `~/.panopticon/cliproxy/cliproxy.pid` | PID file written on manual start |
| `~/.panopticon/cliproxy/cliproxy.log` | Append-only log |

Config contents:
```yaml
host: "127.0.0.1"
port: 8317
auth-dir: "/home/eltmon/.panopticon/cliproxy/auth"
api-keys:
  - "panopticon-local-cliproxy-key"
debug: false
```

## Lifecycle in Panopticon

Panopticon's `startCliproxy()` in `src/lib/cliproxy.ts` handles:
1. Ensuring binary is installed
2. Writing `~/.panopticon/cliproxy/config.yaml`
3. Bridging `~/.codex/auth.json` → `auth/codex-primary.json`
4. Spawning the process detached with a PID file

CLIProxy is normally started automatically by `pan up`. If it crashed or was never
started, use the restart snippet above.

## Auth Token Refresh

If 502 errors are appearing in the log, the Codex OAuth token may be expired.
CLIProxy has an auto-refresh loop, but if it fails:

```bash
# Check if auth file exists and has tokens
cat ~/.codex/auth.json | python3 -c "import sys,json; d=json.load(sys.stdin); print('access_token:', bool(d.get('tokens',{}).get('access_token')))"

# Re-bridge auth (re-runs the mapping from ~/.codex/auth.json)
# This is done automatically by pan up — or run pan install to re-authenticate
```

## See Also

- `src/lib/cliproxy.ts` — full lifecycle implementation in Panopticon
- `/pan:health` — overall Panopticon health check
- `/pan:up` — start Panopticon (also starts cliproxy)
