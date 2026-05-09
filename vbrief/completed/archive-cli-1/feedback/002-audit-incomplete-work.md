---
specialist: human-audit
issueId: CLI-1
outcome: changes-requested
timestamp: 2026-03-10T01:45:00Z
---

# CLI-1 DEEP AUDIT — IMPLEMENTATION INCOMPLETE

The review agent passed the code quality of what was submitted, but the actual
feature coverage against the spec and PRD is critically incomplete. This issue
cannot be marked done. You have built a well-structured scaffold; the actual
feature has barely begun.

---

## CRITICAL BUG: OAuth Endpoint Paths Are Wrong

The CLI hardcodes these paths in `internal/auth/oauth.go`:
```go
registerPath = "/oauth/register"
authPath     = "/oauth/authorize"
tokenPath    = "/oauth/token"
```

The MYN backend's actual endpoints are:
```
POST /api/mcp/oauth/register
GET  /api/mcp/oauth/authorize
POST /api/mcp/oauth/token
```

The OAuth flow will fail at runtime — nothing will work. Fix the constants.

The discovery endpoint (if you use it) is:
`GET /.well-known/oauth-authorization-server`
which returns the correct paths. Consider using discovery to avoid hardcoding.

---

## SCOPE COMPLETION: Spec Coverage

### CLI Command Groups (29 required, per spec Sections 4.2–4.29)

| Command Group | Status |
|---|---|
| `task` (list, add, show, edit, done, archive, uncomplete, delete, restore, batch, snooze, move) | STUB — only `done` and `snooze` wired, all print "not yet implemented" |
| `inbox` (list, add, process, count) | STUB — `process` and `count` missing |
| `now` (default view, focus) | STUB — no real API calls |
| `review daily` | STUB — no real API call |
| `plugin` (list, enable, disable, info) | STUB — `disable` and `info` missing |
| `compass` (show, generate, correct, complete, status, history) | **MISSING ENTIRELY** |
| `habit` (list, done, skip, streak, chains, schedule, reminders) | **MISSING ENTIRELY** |
| `chore` (list, done, schedule, rotation) | **MISSING ENTIRELY** |
| `calendar` (show, add, delete, decline, skip) | **MISSING ENTIRELY** |
| `timer` (list, start, pomodoro, alarm, cancel, snooze, pause, resume, complete, dismiss, count) | **MISSING ENTIRELY** |
| `grocery` (list, add, add-bulk, check, delete, clear, convert) | **MISSING ENTIRELY** |
| `project` (list, show, create) | **MISSING ENTIRELY** |
| `plan` / `schedule` / `reschedule` | **MISSING ENTIRELY** |
| `search` | **MISSING ENTIRELY** |
| `whoami` / `goals` / `prefs` | **MISSING ENTIRELY** |
| `memory` | **MISSING ENTIRELY** |
| `household` | **MISSING ENTIRELY** |
| `review weekly` | **MISSING ENTIRELY** |
| `task comment` (list, add, edit, delete, count) | **MISSING ENTIRELY** |
| `task share` + `shared-inbox` | **MISSING ENTIRELY** |
| `notifications` (list, unread, read, read-all, delete) | **MISSING ENTIRELY** |
| `stats` / `achievements` | **MISSING ENTIRELY** |
| `export` (list, download, delete, delete-batch) | **MISSING ENTIRELY** |
| `account` (usage, subscription, billing, delete, mcp-sessions) | **MISSING ENTIRELY** |
| `apikey` (list, create, show, update, revoke) | **MISSING ENTIRELY** |
| `ai` (chat, conversations CRUD) | **MISSING ENTIRELY** |
| `timer pomodoro` (smart, current, pause, resume, interrupt, suggest, stop, complete, history, settings) | **MISSING ENTIRELY** |
| `config` (show, set, get, reset, path) | **MISSING ENTIRELY** |
| `completion` (bash, zsh, fish) + `man` | **MISSING ENTIRELY** |
| `auth status` / `auth refresh` | **MISSING ENTIRELY** |

**~25 of 29 command groups are entirely absent. The 4 that exist are all stubs
that print "not yet implemented" and make no real API calls.**

### Global Flags (Spec §4.1)
- `--api-url` flag: **MISSING** (not declared in root command)
- `--debug` flag: **MISSING** (not declared in root command)
- `--json`, `--quiet`, `--no-color`: wired correctly ✓

### Auth (Spec §2.5–2.6)
- OAuth PKCE flow: implemented ✓ (but paths wrong — see above)
- `login --api-key` (API key auth): **MISSING**
- `login --device` (device flow): **MISSING**
- Token auto-refresh on 401: **MISSING** (no middleware in API client)
- Linux Secret Service / GNOME Keyring / KDE Wallet: **MISSING** (file storage only)
- `mynow whoami`: **MISSING**
- `mynow auth status` / `mynow auth refresh`: **MISSING**

### Config (Spec §3.3)
- Full YAML config file (`~/.config/mynow/config.yaml`): **MISSING** (only reads MYN_API_URL env var)
- Env vars `MYN_API_KEY`, `MYNOW_CONFIG`, `MYNOW_KEYRING`, `NO_COLOR`, `MYNOW_DEBUG`: **MISSING**
- `mynow config show/set/get/reset/path` commands: **MISSING**

### API Layer (Spec §1.2)
`internal/api/` has only a generic HTTP client. The spec requires ~22 domain
API files: `tasks.go`, `habits.go`, `chores.go`, `compass.go`, `calendar.go`,
`timers.go`, `pomodoro.go`, `lists.go`, `projects.go`, `planning.go`,
`search.go`, `profile.go`, `memory.go`, `household.go`, `comments.go`,
`sharing.go`, `notifications.go`, `gamification.go`, `export.go`, `account.go`,
`apikeys.go`, `ai.go`. **None exist.**

### App Layer
`internal/app/app.go` has 12 stub methods. The spec requires ~24 domain files
matching the API layer above. **None exist.**

### Output (Spec §7)
`internal/output/` has only a basic text/JSON formatter. **Missing:**
- `table.go` — column-aligned tables with headers
- `color.go` — ANSI color by productivity zone
- `markdown.go` — Glamour rendering for rich output
- `progress.go` — progress bars + SSE streaming for AI chat responses

### Plugin System (Spec §9)
`plugins/` directory does not exist. The plugin interface, loading mechanism,
and discovery are all absent.

---

## TUI: 0 of 20 Screens Implemented (Spec §5)

`internal/tui/tui.go` is a 4-line comment stub. **Bubble Tea is not in go.mod.**
No screens, no components, no keybindings, no tab bar. All 20 screens are missing:

Now, Inbox, Tasks, Habits, Chores, Calendar, Timers, Grocery, Task Detail,
Compass, Search, Settings, Help, Command Palette, Pomodoro Focus Mode,
Notifications, Stats & Achievements, AI Chat, Tab Bar, Global Keybindings.

To add Bubble Tea: `go get github.com/charmbracelet/bubbletea`
Also needed: `github.com/charmbracelet/lipgloss` (styling),
`github.com/charmbracelet/bubbles` (pre-built components).

---

## Integration Tests: 1 of 16 Required (Spec §14.4)

Only `test/integration/demo_account_test.go` exists. The spec requires:
`auth_test.go`, `tasks_test.go`, `habits_test.go`, `chores_test.go`,
`calendar_test.go`, `compass_test.go`, `timers_test.go`, `grocery_test.go`,
`projects_test.go`, `planning_test.go`, `search_test.go`, `profile_test.go`,
`memory_test.go`, `household_test.go`, `review_test.go`, `cli_output_test.go`.

---

## Distribution (Spec §15): Not Started

- No `.goreleaser.yaml` (required for .tar.gz, .deb, .rpm, .apk, Arch packages)
- No `.github/workflows/` CI pipeline
- No `go mod vendor` for reproducible builds
- `golang.org/x/crypto` is marked `// indirect` in go.mod despite being
  directly imported — run `go mod tidy`

---

## Security Findings (Full review at `.planning/feedback/003-security-review.md`)

Fix these before shipping:

### HIGH (must fix)

**HIGH-1: Wrong OAuth endpoint paths** (see top of this file — CRITICAL)

**HIGH-2: Weak encryption key fallback** (`internal/auth/keyring.go:172–194`)
On macOS and minimal Linux containers, `/etc/machine-id` is absent so the
PBKDF2 password degrades to `sha256(hostname + "|myn-cli-v1")`. The suffix is
public in this open-source repo. Fix: use OS keychain for the wrapping key
(`github.com/zalando/go-keyring`) or generate a random key on first run and
store it separately with 0600 permissions.

**HIGH-3: Hardcoded secrets in docker-compose** (`test/integration/docker-compose.yml:43`)
`JWT_SECRET` and `DEMO_API_KEY` are committed in plaintext. Fix:
```yaml
JWT_SECRET: ${MYN_TEST_JWT_SECRET:?must be set}
DEMO_API_KEY: ${MYN_TEST_DEMO_KEY:?must be set}
```

**HIGH-4: `MYN_API_URL` not validated** (`internal/config/config.go:28`)
Any env var override can redirect all OAuth traffic and Bearer tokens to an
attacker server. Fix: validate URL scheme is `https` (allow `http://localhost`
for dev), reject invalid URLs.

### MEDIUM (fix before ship)

**MEDIUM-1:** OAuth callback server has no `ReadTimeout`/`WriteTimeout` —
add `ReadTimeout: 30*time.Second, WriteTimeout: 30*time.Second` to `http.Server`.

**MEDIUM-2:** Callback binds to `"localhost:0"` — use explicit `"127.0.0.1:0"`
to avoid DNS resolution issues.

**MEDIUM-3:** ANSI injection via `errorParam` from OAuth callback — sanitize
before printing.

**MEDIUM-4:** `Retry-After` header sleep has no cap — add `if seconds > 60 { seconds = 60 }`.

**MEDIUM-5:** Integration test uses `http.DefaultClient` with no timeout —
add explicit timeout and HTTPS validation.

---

## MYN Backend / Frontend: NO CHANGES NEEDED

The MYN backend (`McpOAuthController.java`) already fully supports the CLI's
OAuth 2.1 + PKCE flow on the `/api/mcp/oauth/*` endpoints. All required
endpoints exist with proper PKCE (S256), redirect URI validation, refresh token
rotation, and token persistence. The frontend (`McpAuth.tsx`) handles the
browser consent redirect. No backend or frontend changes are required.

---

## What You Must Do Before Calling `pan work done` Again

1. **Fix OAuth paths** — `registerPath`, `authPath`, `tokenPath` constants
2. **Implement all 29 CLI command groups** — with real API calls, not stubs
3. **Implement all 20 TUI screens** — add Bubble Tea to go.mod first
4. **Implement all ~22 API domain files** in `internal/api/`
5. **Implement all ~24 app domain files** in `internal/app/`
6. **Auth completeness** — `login --api-key`, device flow, auto-refresh on 401,
   GNOME/KDE keyring integration
7. **Config YAML** — full `~/.config/mynow/config.yaml` read/write with all sections
8. **Output** — table, color, markdown (Glamour), progress renderers
9. **Plugin system** — `plugins/` directory, interface, loader
10. **15 missing integration test files**
11. **GoReleaser + CI** — `.goreleaser.yaml` + `.github/workflows/`
12. **Fix all HIGH and MEDIUM security findings** listed above
13. **Run `go mod tidy`** to fix indirect dependency annotation

When all of the above is complete, commit and push, then re-submit for review:
```
curl -X POST http://localhost:3011/api/workspaces/CLI-1/request-review \
  -H "Content-Type: application/json" -d '{}'
```
Do NOT call `pan work done` — it will be blocked until the review passes.
