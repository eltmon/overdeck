---
specialist: review-agent
issueId: PAN-913
outcome: commented
timestamp: 2026-04-29T00:56:52Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-913 adds Codex auth auto-detection and a re-authentication flow for ChatGPT subscription users whose tokens are expired or burned. The implementation is substantial (14 files, 4 reviewers) but has 4 blocking findings: a security vulnerability where the fixed `codex-reauth` tmux session name is predictable and hijackable by any dashboard user; two missing requirement links (the frontend never calls the re-auth completion endpoint, and the Settings Re-auth button bypasses the defined flow); and a logic error where `checkCodexAuthStatus()` is called for API-key users when it should only run for subscription auth. The work agent must address all 4 blockers before this PR can merge.

## Blockers (MUST fix before merge)

### 1. Predictable re-auth tmux session allows session hijacking — `src/dashboard/server/routes/codex-auth.ts:12,27-46` — `!`
**Raised by**: security
**Why it blocks**: The fixed session name `codex-reauth` is returned to the browser and used to attach via `/terminal/codex-reauth`. The terminal attach path only checks session existence (via `listSessionNamesAsync`), not ownership or authorization. Any dashboard user who knows the session name can attach to a live OAuth flow in progress, view device-auth prompts, and drive the login to their own Codex account.

<fix instruction>
Use an unguessable per-request session identifier generated via `crypto.randomUUID()`. The POST `/api/settings/codex-reauth` response must include this generated session name. Additionally, the terminal attach path (`ws-terminal.ts:142-185`) must validate an authorization token bound to the session creator — do not allow unauthenticated attach to any session name supplied in the URL. At minimum, require the browser to present a server-issued one-time token when connecting to `/ws/terminal?session=<name>`.
</fix>

---

### 2. Frontend never calls re-auth completion endpoint — `src/dashboard/frontend/src/hooks/useCodexAutoRetry.ts:16-46` — `!`
**Raised by**: requirements
**Why it blocks**: `GET /api/settings/codex-reauth/status` exists server-side (`codex-auth.ts:51-66`) and handles token re-bridging on completion, but no changed frontend file calls it. `useCodexAutoRetry` only retries when `GET /api/settings/codex-auth` returns `valid`, which means it cannot distinguish "re-auth completed and bridged" from "auth happened to be valid all along". The specified completion handshake is dead code and the auto-retry promise is incomplete.

<fix instruction>
In `useCodexAutoRetry.ts` (or wherever the re-auth lifecycle is managed), add a polling call to `GET /api/settings/codex-reauth/status` after the re-auth terminal is launched. Use the returned `authStatus`/completion signal to determine when to trigger the pending spawn retry, rather than relying solely on the generic `valid` check from the codex-auth endpoint.
</fix>

---

### 3. Settings Re-auth button bypasses the defined flow — `src/dashboard/frontend/src/components/Settings/SettingsPage.tsx:915-922` — `!`
**Raised by**: requirements
**Why it blocks**: The banner (`CodexAuthBanner.tsx:18`) calls `POST /api/settings/codex-reauth` before navigating, which creates the tmux session with the correct lifecycle hooks. The Settings page only sets `window.location.href = '/terminal/codex-reauth'` and never hits the re-auth endpoint. If no session exists yet, the user lands on a terminal route without the server-managed session-creation behavior, breaking the designed flow.

<fix instruction>
In `SettingsPage.tsx:915-922`, replace the bare navigation with a call to `POST /api/settings/codex-reauth` (mirroring what `CodexAuthBanner.tsx:18` does), then navigate to the returned `sessionName`. This ensures the server-side session lifecycle is triggered from both entry points.
</fix>

---

### 4. Missing auth mode guard — `src/dashboard/server/routes/agents.ts:1700` — `!`
**Raised by**: correctness
**Why it blocks**: `checkCodexAuthStatus()` validates ChatGPT subscription OAuth tokens, but the spawn guard calls it for all OpenAI-provider users, including those using API-key auth. If an API-key user has a stale `codex-primary.json` with burned/expired tokens (from a previous subscription), their spawn will be incorrectly blocked even though their auth mode doesn't use those tokens.

<fix instruction>
Wrap the `checkCodexAuthStatus()` call with an `authMode === 'subscription'` check using `getProviderAuthMode(spawnModel)` (already imported at line 68). The check should only run when the provider is OpenAI AND the auth mode is `'subscription'`. See the corrected pattern in correctness.md lines 38-52.
</fix>

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Full log-file scan on every auth-status poll — `src/lib/codex-auth.ts:94` — `~`
**Raised by**: performance
<fix instruction>
Replace `readFile(logPath, 'utf8')` + `split('\n').slice(-50)` with a tail-reading approach (e.g., use `createReadStream` with `start` offset to read only the last N bytes, or track burn status in a separate small state file written by CLIProxy). This bounds I/O and memory as the log grows.
</fix>

### 2. Module-level mutable state shared across requests — `src/dashboard/frontend/src/lib/pending-codex-spawn.ts:8` — `~`
**Raised by**: correctness
<fix instruction>
For single-user deployments this is acceptable. If multi-user support is needed, replace the `let pendingSpawn` module-level variable with a `Map<userId, PendingSpawn>` or use `sessionStorage` (frontend-only) instead of process memory.
</fix>

## Nits (advisory — safe to defer)

- `src/dashboard/server/routes/agents.ts:149` — `?` — `getProjectPath` uses `replace(/[-\s]/g, '')` which removes ALL hyphens and spaces; pre-existing issue, not blocking for this PR. Use `replace(/[-\s]+/g, '')` for clarity. (correctness)
- `src/lib/codex-auth.ts:103` — `?` — Consider extracting `'refresh token has already been used'` to a named constant `BURNED_TOKEN_LOG_PATTERN` for testability. (correctness)
- `src/lib/cliproxy.ts:146` — `?` — Fallback exp calculation (`Math.floor(Date.now() / 1000) + 3600`) creates a 1-hour token if neither token has an `exp` claim. Consider a much shorter fallback (e.g., 60 seconds) or returning an error instead. (correctness)
- `src/dashboard/server/routes/codex-auth.ts:63` — `?` — Re-auth completion should be tied to the session initiator; only bridge credentials for the user/session that started the re-auth, not silently promote to shared instance-wide credentials. (security — best practice)

## Cross-cutting groups

**Re-auth flow endpoint wiring** (all three find the same root: the re-auth flow was designed server-side but the frontend entry points are not fully wired):
- [blocker-2] Re-auth completion endpoint is never called by frontend
- [blocker-3] Settings Re-auth button bypasses `POST /api/settings/codex-reauth`
- [blocker-1] Predictable session name makes the terminal attach path hijackable (security side of same issue)

**Auth mode confusion** (root: spawn guard doesn't respect auth mode):
- [blocker-4] Missing auth mode guard in spawn route
- [blocker-1] Session name predictability enables cross-user credential crossover on shared instances

## What's good
- Burned refresh-token detection from CLIProxy logs is implemented correctly and complete
- The `GET /api/settings/codex-auth` endpoint and polling hook work as specified
- Codex auth banner UI and Settings status display are well-implemented
- Documentation (`docs/CODEX-AUTH.md`) is clear and covers the OAuth vs API key distinction
- Pending spawn retention works across all three spawn entry points

## Review stats
- Blockers: 4   High: 2   Medium: 0   Nits: 4
- By reviewer: correctness=1, security=1, performance=1, requirements=2
- Files touched: 28   Files with findings: 10

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the
Synthesis Context above. Those files contain full per-reviewer detail; this
synthesis is the policy layer.

