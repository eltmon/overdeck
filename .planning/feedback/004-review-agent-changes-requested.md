---
specialist: review-agent
issueId: PAN-913
outcome: changes-requested
timestamp: 2026-04-29T01:20:30Z
---

# Verdict: CHANGES_REQUESTED

## Summary

PAN-913 delivers a Codex auth auto-detection and re-authentication flow: JWT expiry checking, burned refresh-token detection from CLIProxy logs, a dashboard banner, settings page status, spawn guardrails, and an auto-retry loop. Nine of eleven vBRIEF requirements are implemented correctly.

However, four MUST-level blockers prevent merge. (1) `readFileSync` is called inside an Effect route handler in `checkCodexAuthStatus`, which blocks the Node.js event loop and violates the project's hardcoded dashboard server rules — this is the same class of bug that PAN-70 spent 15 commits fixing. (2) The re-auth POST endpoint always generates a new tmux session instead of returning an existing live one as required by the vBRIEF idempotency spec. (3) The required cliproxy SKILL.md documentation update is absent — only a standalone `docs/CODEX-AUTH.md` was added. (4) `getProviderAuthMode` returns `string | undefined` instead of the `AuthMode` union type, creating a type-safety gap. Until these are resolved, the feature is incomplete and the dashboard server is at risk of event-loop starvation under concurrent spawn load.

## Blockers (MUST fix before merge)

### 1. `readFileSync` in Effect route handler blocks the Node.js event loop — `src/lib/codex-auth.ts:38`, `src/lib/agents.ts:1703-1704` — `!`
**Raised by**: correctness

**Why it blocks**: Every spawn for an OpenAI subscription model triggers a synchronous file read on the main thread. Under concurrent load this freezes all in-flight HTTP requests, WebSocket connections, and PTY terminal streams on the dashboard server. This violates CLAUDE.md's absolute rule against `readFileSync` in any code reachable from dashboard route handlers (the same class of bug that PAN-70 fixed with 15 commits and PAN-446 found 139 instances of).

`Effect.promise(() => checkCodexAuthStatus())` at `agents.ts:1703-1704` wraps a function that calls `getProviderAuthMode` (line 1701), which synchronously calls `loadYamlConfig()` and `getOpenAIAuthStatusSync()`. Both call `readFileSync` internally.

**Fix**: Replace synchronous file reads in `checkCodexAuthStatus` and `getProviderAuthMode` (and their dependencies `getOpenAIAuthStatusSync`, `loadYamlConfig`) with async variants using `fs/promises`. The `Effect.promise` call site already expects a Promise — change the underlying functions to return `Promise<T>` and use `fs/promises.readFile`.

---

### 2. Re-auth endpoint is not idempotent — always creates a new session instead of returning an existing live one — `src/dashboard/server/routes/codex-auth.ts:78-90` — `!`
**Raised by**: requirements

**Why it blocks**: The vBRIEF acceptance criterion `reauth-endpoint.ac3` explicitly requires "Returns existing session if `codex-reauth` tmux session is already alive (idempotent)." The POST handler always calls `generateReauthSession()` and `createSessionAsync(...)` with no check for an existing live session. Repeated "Re-authenticate" clicks create duplicate tmux sessions instead of reusing one.

**Fix**: Before spawning a new tmux session, check whether a `codex-reauth` session already exists (via `tmux list-sessions` or similar). If one does, return its name and token instead of creating a duplicate.

---

### 3. Required cliproxy SKILL.md update is missing — `!`
**Raised by**: requirements

**Why it blocks**: vBRIEF item `documentation` acceptance criterion `documentation.ac2` explicitly requires "Update the cliproxy SKILL.md with the new dashboard-based re-auth flow as the primary path instead of manual codex login." The changed-files list for this PR does not include `skills/cliproxy/SKILL.md` or `.claude/skills/cliproxy/SKILL.md` — only a standalone `docs/CODEX-AUTH.md` was added. The skill doc at `skills/cliproxy/SKILL.md:99-110` still presents the older manual workflow.

**Fix**: Update `skills/cliproxy/SKILL.md` (or `.claude/skills/cliproxy/SKILL.md` if that's the canonical location) to direct users to the new dashboard-based re-auth flow as the primary path.

---

### 4. `getProviderAuthMode` return type is imprecise — `src/lib/agents.ts:68` — `!`
**Raised by**: correctness

**Why it blocks**: The function returns `string | undefined` but the `AuthMode` type in `providers.ts` is `'api-key' | 'subscription'`. If the provider is neither `openai` nor `google`, the function returns `undefined` implicitly. While the guardrail at line 1702 short-circuits safely at runtime (due to strict equality), the broader `string | undefined` type is a type-safety gap that allows incorrect states to compile.

**Fix**: Change the return type to `AuthMode | undefined` (imported from `providers.ts`). Return `undefined` explicitly when the provider is neither `openai` nor `google`.

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Re-auth token is reusable for the full session lifetime — `src/dashboard/server/ws-terminal.ts:152`, `src/dashboard/server/routes/codex-auth.ts:21` — `~`
**Raised by**: security

The PR introduces a token gate for `reauth-*` tmux sessions via `generateReauthSession()`, but the token is never invalidated after first use. `ws-terminal.ts:152` only compares the presented `token` query param against the stored value — it is not consumed on first successful attach. Any party with access to the URL during the re-auth window (browser history, screenshots, same-origin script) can attach to the live tmux session and interfere with the OAuth/device-auth flow.

**Fix**: Invalidate the token (or replace the registry entry with an "attached" state) on first successful WebSocket attach. If reconnect support is needed, issue a new ephemeral token after the initial authenticated attach rather than allowing unlimited reuse of the original URL token.

## Nits (advisory — safe to defer)

- `src/dashboard/server/ws-terminal.ts:153-159` — `!-3` (correctness) — Triple Map lookup in re-auth token validation. Cache `getReauthSessionToken(sessionName)` in a local variable. (correctness)
- `src/lib/codex-auth.ts:94` — `?-1` (performance) — Cliproxy log scan reads the whole file before slicing to last 50 lines. Consider reading only the tail if the log grows large. (performance)
- `src/dashboard/server/ws-terminal.ts:152` — `?-1` (performance) — Same root cause as the reusable token issue above; fix together.
- `src/dashboard/frontend/src/components/CodexAuthBanner.tsx:27` — `?-1` (security best practice) — Re-auth attach token carried in `window.location.href` persists in browser history. Consider `history.replaceState()` to scrub the query string after terminal page boots. (security)
- `src/lib/codex-auth.ts:54-61` — `~-1` (correctness) — Burned refresh token detection reads last 50 lines but has no file-size guard. If the cliproxy log grows to gigabytes, the streaming read may still be problematic. Consider also checking file modification time as a staleness signal.

## Cross-cutting groups

**Re-auth token lifecycle** (shared root cause in `codex-auth.ts:21` and `ws-terminal.ts:152`):
- [blocker] `!-1` — `readFileSync` blocking call (fix by making `checkCodexAuthStatus` fully async, which also benefits the token validation path)
- [blocker] `!-4` — type imprecision in `getProviderAuthMode`
- [high-1] `~-1` (security) — reusable re-auth token
- [nit-1] `!-3` (correctness) — triple Map lookup
- [nit-4] `?-1` (security best practice) — token in URL

## What's good

- JWT `decodeJwtPayload` implementation is correct and has no external dependencies
- `bridgeCodexAuthToCliproxyAsync` correctly uses `fs/promises` for all file operations — compliant with dashboard server sync-call rules
- `isCliproxyRunningAsync` and `startCliproxyAsync` use `execAsync` (promisified) — compliant
- Guardrail condition correctly scopes the auth check to OpenAI subscription users only
- Re-auth token TTL of 60 minutes with cleanup on POST is reasonable
- The auto-retry loop (`useCodexAutoRetry`) correctly polls completion and replays blocked spawns
- WebSocket one-time token pattern correctly validates token before attaching PTY

## Review stats

- Blockers: 4   High: 2   Medium: 0   Nits: 5
- By reviewer: correctness=2 blockers + 2 nits, requirements=2 blockers, security=1 high + 1 best practice, performance=1 nit
- Files touched: ~35   Files with findings: 9

## Appendix: individual reviews

See individual reviewer output files:
- `correctness.md` — Full correctness analysis including verified-correct items
- `requirements.md` — Full requirements traceability matrix (9/11 implemented, 2 missing)
- `performance.md` — Hot-path analysis, no regressions found
- `security.md` — Full threat model for re-auth token lifecycle

---

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-913 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

