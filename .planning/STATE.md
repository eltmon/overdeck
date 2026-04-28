# PAN-913: Auto-detect expired Codex auth and spawn re-authentication flow

## Problem

When the Codex OAuth token expires (or the refresh token is burned), all `gpt-5.4` agents fail with `503 auth_unavailable`. Users have no visibility until agents start dying. The real cause (`refresh token already used`) is buried in `~/.panopticon/cliproxy/cliproxy.log`.

## Decisions

### Scope
- **Codex only** — other providers already show API key status via ProviderCard
- Codex binary is NOT required for API-key-only mode, only for subscription OAuth

### Detection Strategy: JWT expiry + CLIProxy log monitoring
- **Primary**: Read `~/.panopticon/cliproxy/auth/codex-primary.json`, decode JWT `exp` claim, compare to `Date.now()`
- **Secondary**: Tail last N lines of `~/.panopticon/cliproxy/cliproxy.log` for `"refresh token has already been used"` pattern — catches burned refresh tokens before access token expires
- **Known limitation**: Log monitoring is fragile (log rotation, format changes). Work agent should implement it as a best-effort supplement, not a critical path. If the pattern isn't found, fall back to JWT-only status.
- **Polling**: Check every ~2 minutes from dashboard frontend via API endpoint. Also check at spawn time as a guardrail.

### Re-auth UX: Terminal panel
- Click "Re-authenticate" → spawns `codex login` (or `codex login --device-auth` on headless) in a tmux session → dashboard opens terminal panel showing the OAuth flow live
- **Headless detection**: Check `!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY` on the server. If headless, use `codex login --device-auth` which prints a URL + code to stdout — the terminal panel displays this to the user.
- `codex login --device-auth` is confirmed available in the installed codex binary (v6.9.24+).

### Auto-retry
- **Simplest approach**: After successful re-auth, re-bridge tokens via `bridgeCodexAuthToCliproxy()`, then the frontend re-fires the original spawn request. No server-side pending queue — the frontend holds the spawn parameters and retries.

### Pre-existing bug fix
- `isCliproxyRunning()` uses `execSync` in the spawn path reachable from dashboard routes — violates CLAUDE.md no-sync rule. An async variant `isCliproxyRunningAsync()` already exists at `cliproxy.ts:401`. The spawn guardrail bead should use the async version.

## Architecture

### New files
- `src/lib/codex-auth.ts` — `checkCodexAuthStatus()` utility (async, reads JSON + JWT + log)
- `src/dashboard/server/routes/codex-auth.ts` — API endpoints for auth status + re-auth trigger
- `src/dashboard/frontend/src/components/CodexAuthBanner.tsx` — banner component
- `src/dashboard/frontend/src/hooks/useCodexAuthStatus.ts` — polling hook

### Modified files
- `src/dashboard/server/routes/agents.ts` — add codex auth check to `evaluateSpawnGuardrails()`
- `src/dashboard/server/server.ts` — mount new codex-auth routes
- `src/dashboard/frontend/src/App.tsx` — render CodexAuthBanner
- `src/dashboard/frontend/src/components/Settings/SettingsPage.tsx` — show Codex auth type/status
- `src/lib/cliproxy.ts` — async-ify spawn-path calls, expose JWT decode utility
- `src/lib/agents.ts` — use `isCliproxyRunningAsync()` instead of sync version

### API endpoints
- `GET /api/settings/codex-auth` — returns `{ status: 'valid'|'expired'|'burned'|'missing'|'unknown', email?, expiresAt?, message? }`
- `POST /api/settings/codex-reauth` — spawns `codex login` tmux session, returns `{ sessionName, headless: boolean }`
- `GET /api/settings/codex-reauth/status` — polls re-auth session completion

### Data flow
1. Frontend polls `GET /api/settings/codex-auth` every ~120s
2. If expired/burned → show `CodexAuthBanner` with "Re-authenticate" button
3. User clicks → `POST /api/settings/codex-reauth` → server spawns tmux session
4. Dashboard opens terminal panel for that session (existing `/ws/terminal` infra)
5. User completes OAuth in browser (or enters device code on headless)
6. Frontend polls `GET /api/settings/codex-reauth/status` until session exits
7. Server re-bridges tokens via `bridgeCodexAuthToCliproxy()`
8. If spawn was blocked, frontend auto-retries the original spawn request
