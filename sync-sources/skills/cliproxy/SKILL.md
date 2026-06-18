---
name: cliproxy
description: >
  Check and restart the CLIProxy sidecar (port 8317). CLIProxy bridges
  ChatGPT subscription OAuth tokens to an Anthropic-compatible /v1/messages
  endpoint so Overdeck agents can use GPT models without an OpenAI API key.
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

# CLIProxy — Check and Restart

CLIProxy is a background sidecar that proxies Anthropic-compatible API calls to GPT
models via ChatGPT subscription OAuth tokens. Overdeck agents talk to it via
`ANTHROPIC_BASE_URL=http://127.0.0.1:8317`.

## Quick Status Check

```bash
# Is it running?
ss -tlnp | grep 8317

# Check PID file
cat ~/.overdeck/cliproxy/cliproxy.pid 2>/dev/null

# Verify process is alive
kill -0 $(cat ~/.overdeck/cliproxy/cliproxy.pid 2>/dev/null) 2>/dev/null && echo "alive" || echo "dead"
```

## Restart CLIProxy

```bash
# Kill any existing instance
lsof -ti:8317 2>/dev/null | xargs -r kill 2>/dev/null || true
rm -f ~/.overdeck/cliproxy/cliproxy.pid

# Start fresh
nohup ~/.overdeck/bin/cliproxy -config ~/.overdeck/cliproxy/config.yaml \
  >> ~/.overdeck/cliproxy/cliproxy.log 2>&1 &
echo $! > ~/.overdeck/cliproxy/cliproxy.pid

# Confirm it's up (give it 2 seconds)
sleep 2 && ss -tlnp | grep 8317
```

## Check Recent Logs

```bash
# Last 30 lines of cliproxy log
tail -30 ~/.overdeck/cliproxy/cliproxy.log

# Watch live
tail -f ~/.overdeck/cliproxy/cliproxy.log
```

## Config and Auth

| Path | Purpose |
|---|---|
| `~/.overdeck/bin/cliproxy` | Binary (v6.9.24, built from eltmon/cliproxy fork) |
| `~/.overdeck/cliproxy/config.yaml` | Server config (host, port, auth-dir, api-keys) |
| `~/.overdeck/cliproxy/auth/codex-primary.json` | Codex OAuth credentials (bridged from `~/.codex/auth.json`) |
| `~/.overdeck/cliproxy/cliproxy.pid` | PID file written on manual start |
| `~/.overdeck/cliproxy/cliproxy.log` | Append-only log |

Config contents:
```yaml
host: "127.0.0.1"
port: 8317
auth-dir: "~/.overdeck/cliproxy/auth"
api-keys:
  - "overdeck-local-cliproxy-key"
debug: false
```

## Lifecycle in Overdeck

Overdeck's `startCliproxy()` in `src/lib/cliproxy.ts` handles:
1. Ensuring binary is installed
2. Writing `~/.overdeck/cliproxy/config.yaml`
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

## Dashboard Re-Auth Flow (PAN-913)

The Overdeck dashboard can trigger interactive Codex re-authentication when
ChatGPT subscription tokens expire. This avoids requiring the user to run
`codex login` manually in a terminal.

### Flow

1. **Detection** — Dashboard polls `GET /api/settings/codex-auth` every 2 min.
   Status can be `valid`, `expired`, `burned`, `missing`, or `unknown`.
2. **Initiation** — User clicks **Re-authenticate** in Settings or the top banner.
   Dashboard calls `POST /api/settings/codex-reauth` (idempotent — returns an
   existing live session if one is already running).
3. **Terminal login** — Backend spawns a tmux session named `reauth-<uuid>`
   running `codex login` (or `codex login --device-auth` when headless), sets an
   HttpOnly `pan_codex_reauth` cookie for `/ws/terminal`, and the frontend opens
   `/terminal/<sessionName>` so the user can complete OAuth in a live terminal panel.
4. **Polling** — Frontend polls `POST /api/settings/codex-reauth/status` with the
   session name and status token every 3 s. The session is considered complete when
   the tmux pane exits.
5. **Bridge** — On completion, the backend calls `bridgeCodexAuthToCliproxyAsync()`
   to rewrite `~/.overdeck/cliproxy/auth/codex-primary.json` from the fresh
   `~/.codex/auth.json`, then returns the updated auth status.
6. **Auto-retry** — If an agent spawn was blocked by expired auth, the frontend
   automatically retries `POST /api/agents` once auth becomes valid.

### Security

- Re-auth terminal tokens are short-lived UUIDs stored only in an HttpOnly
  cookie scoped to `/ws/terminal`; they are required for `reauth-*` WebSockets.
- Sessions expire from the in-memory registry after 1 hour.
- The tmux session name is a random UUID — not guessable.

### API Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/settings/codex-auth` | Current auth status (`valid`/`expired`/etc.) |
| `POST` | `/api/settings/codex-reauth` | Spawn (or reuse) a re-auth tmux session and set the terminal cookie |
| `POST` | `/api/settings/codex-reauth/status` | Poll for completion with `{ session, token }` |

### Manual Fallback

If the dashboard re-auth flow fails, fall back to terminal login:

```bash
# Interactive login
codex login

# Headless / device-auth flow
codex login --device-auth

# Re-bridge into cliproxy format
node -e "require('./src/lib/cliproxy.js').bridgeCodexAuthToCliproxyAsync().then(console.log)"
```

## See Also

- `src/lib/cliproxy.ts` — full lifecycle implementation in Overdeck
- `/pan:health` — overall Overdeck health check
- `/pan:up` — start Overdeck (also starts cliproxy)
