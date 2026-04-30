# Codex Authentication

How Panopticon manages OpenAI Codex CLI OAuth authentication and the automatic re-authentication flow.

---

## Overview

Panopticon uses **OpenAI Codex CLI** (via CLIProxy) for `gpt-5.4` agent work. Codex CLI authenticates with OpenAI using **OAuth** rather than API keys. The OAuth JWT has a limited lifetime and must be refreshed periodically. When the token expires (or is burned by a concurrent refresh), Panopticon detects the failure, surfaces a dashboard banner, and guides you through re-authentication.

**Key principle**: Panopticon never stores Codex credentials itself. It reads the JWT that Codex CLI writes to disk and bridges it into CLIProxy's runtime path.

---

## Why Codex Auth Is Different

| Mechanism | API Keys | Codex OAuth |
|-----------|----------|-------------|
| Storage | `~/.panopticon.env` | `~/.panopticon/cliproxy/auth/codex-primary.json` |
| Lifetime | Permanent until revoked | ~7 days (JWT expiry) |
| Refresh | Not applicable | Automatic via `codex login` |
| Burn risk | None | High — concurrent refreshes invalidate the refresh token |
| Fallback | Anthropic models | None (spawn is blocked until re-auth) |

Because Codex OAuth tokens expire and can be burned, Panopticon implements **automatic detection** and **one-click re-authentication** so you don't discover the failure mid-agent-run.

---

## Token Storage & Bridging

### Where Tokens Live

Codex CLI writes its authentication state to:

```
~/.panopticon/cliproxy/auth/codex-primary.json
```

This file contains:
- `id_token` — OpenID JWT with `exp` claim
- `refresh_token` — Used to obtain a new id_token
- `email` — The authenticated user's email

### Bridging to CLIProxy

CLIProxy (the sidecar that proxies Codex CLI API calls) expects credentials at:

```
~/.codex/
```

Panopticon **bridges** the token by copying `codex-primary.json` into `~/.codex/config.json` whenever:
1. The dashboard server starts
2. A re-authentication session completes

This bridge is performed asynchronously (`bridgeCodexAuthToCliproxyAsync`) and is idempotent — it skips the copy if the files are already byte-identical.

---

## Detection Strategy

Panopticon detects expired/burned tokens through two complementary mechanisms:

### 1. JWT Expiry (Primary)

Every 2 minutes, the dashboard frontend polls `GET /api/settings/codex-auth`. The server:

1. Reads `codex-primary.json`
2. Decodes the JWT payload (without verification)
3. Compares `exp` against current time
4. Returns one of:
   - `valid` — Token is good
   - `expired` — JWT `exp` has passed
   - `missing` — No token file found
   - `unknown` — File exists but cannot be parsed

### 2. CLIProxy Log Tailing (Secondary)

When the JWT expiry check returns `valid`, the server also tails the last 50 lines of `cliproxy.log` for the error:

```
refresh token has already been used
```

This catches **burned tokens** — when the refresh token was consumed by another process (e.g., you ran `codex login` in a different terminal) but the new token wasn't bridged to Panopticon's path.

If this string is found, the status is reported as `burned`.

---

## Re-Authentication Flow

### Dashboard Banner

When the frontend receives `expired` or `burned` status, it renders a yellow banner at the top of every page:

```
⚠ Codex authentication expired — gpt-5.4 agents will fail. (user@example.com)
[ Re-authenticate ]
```

Clicking **Re-authenticate**:
1. Calls `POST /api/settings/codex-reauth`
2. The server spawns a tmux session named `codex-reauth`
3. The session runs `codex login` (or `codex login --device-auth` on headless systems)
4. The browser navigates to `/terminal/codex-reauth` so you can complete the OAuth flow

### Automatic Retry

When you finish logging in and close the terminal:

1. The auth status polling detects `valid`
2. `bridgeCodexAuthToCliproxyAsync()` copies the new token to `~/.codex/`
3. Any **blocked spawn** that was queued during the expired state is **automatically retried**

This means if you clicked "Start Agent" while Codex auth was expired, the agent starts automatically after you re-authenticate — you don't need to click Start again.

### Spawn Guardrails

The `POST /api/agents` endpoint checks Codex auth **before** spawning any agent that routes to an OpenAI model (`gpt-*`). If auth is `expired` or `burned`:

- Returns HTTP `429` with `blocked: true`
- Error message: `Codex authentication expired. Re-authenticate to continue.`
- Frontend stores the spawn request and waits for re-auth

---

## Manual Re-Authentication (CLI)

If you prefer the terminal or the dashboard is unavailable:

```bash
# 1. Log in to Codex CLI
codex login

# 2. Bridge the new token to CLIProxy
pan bridge-codex-auth
```

Or, if Panopticon doesn't expose `pan bridge-codex-auth` yet, manually copy:

```bash
cp ~/.panopticon/cliproxy/auth/codex-primary.json ~/.codex/config.json
```

Then restart the dashboard or wait for the next poll cycle.

---

## Troubleshooting

### "Codex authentication expired" banner won't go away

1. Open the re-auth terminal from the banner
2. Complete the OAuth flow (sign in with your OpenAI account)
3. Wait up to 2 minutes for the next poll, or refresh the dashboard page

### Re-authenticated but agents still fail

1. Check that `~/.codex/config.json` exists and has a recent timestamp:
   ```bash
   ls -la ~/.codex/config.json
   ```
2. If missing, manually bridge:
   ```bash
   cp ~/.panopticon/cliproxy/auth/codex-primary.json ~/.codex/config.json
   ```
3. Restart CLIProxy if it's running:
   ```bash
   pan cliproxy restart
   ```

### "refresh token has already been used" in logs

This means the refresh token was consumed elsewhere. The detection system will report `burned`. Re-authenticate via the dashboard banner or run `codex login` again.

### No banner but gpt-5.4 agents fail

1. Check auth status directly:
   ```bash
   curl http://localhost:3000/api/settings/codex-auth
   ```
2. Verify the model you're spawning actually routes to OpenAI:
   ```bash
   pan config get issue-agent:implementation
   ```
3. If the model is Anthropic, Codex auth is not the issue — check `ANTHROPIC_API_KEY`

---

## Related Documentation

- [CONFIGURATION.md](./CONFIGURATION.md) — General provider and API key configuration
- [TESTING-PROVIDERS.md](./TESTING-PROVIDERS.md) — Provider connectivity testing
- [MODEL_ROUTING.md](./MODEL_ROUTING.md) — How work types map to providers
