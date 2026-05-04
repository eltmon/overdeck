---
specialist: review-agent
issueId: CLI-1
outcome: blocked
timestamp: 2026-03-10T12:29:26Z
---

# Review BLOCKED (Strict Round 8) — 7 Blockers

Major expansion: 128 files changed, ~18K lines added. Full CLI+TUI implementation.

## BLOCKERS

### 1. SECURITY: Plugin execution leaks full environment
`internal/app/plugins.go:54` — `os.Environ()` forwards ALL host env vars (AWS keys, DB passwords, etc.) to arbitrary plugin executables.

**Fix:** Whitelist only `MYN_API_TOKEN`, `MYN_API_URL`, `HOME`, `PATH`, `TERM`.

### 2. Swallowed API errors deceive users
- `internal/app/app.go:249-266` — `InboxProcess`: `_, _ = a.Client.UpdateTask(...)` / `DeleteTask(...)`
- `internal/app/app.go:295-296` — `InboxClear`: `_ = a.Client.DeleteTask(...)` in loop
- `internal/app/app.go:420-436` — `ReviewDaily`: `_, _ = a.Client.UpdateTask(...)`

Users see success messages ("Completed", "Cleared N items") when API calls fail.

**Fix:** Check and surface errors, or at minimum count failures and report.

### 3. Unbounded io.ReadAll in oauth.go
`internal/auth/oauth.go:157,210,337` — Error response bodies read without size limit. Already fixed in client.go with `io.LimitReader(resp.Body, 10*1024*1024)`.

**Fix:** Apply same `io.LimitReader` pattern.

### 4. Unsafe type assertions — runtime panics
- `internal/tui/app.go:153` — `m.searchScreen = updated.(screens.SearchScreen)`
- `internal/tui/app.go:165` — `m.notifScreen = updated.(screens.NotificationsScreen)`

**Fix:** Use comma-ok idiom: `if s, ok := updated.(screens.SearchScreen); ok { m.searchScreen = s }`

### 5. Cursor not clamped after data reload — panics
4+ screens don't reset cursor when refreshed data is shorter:
- `internal/tui/screens/notifications.go:103-105`
- `internal/tui/screens/timers.go:57-59`
- `internal/tui/screens/habits.go:57-59`
- `internal/tui/screens/tasks.go` (tasksLoadedMsg)

**Fix:** After setting items, clamp: `if s.cursor >= len(s.items) { s.cursor = max(0, len(s.items)-1) }`

### 6. Dead code
- `internal/tui/keybindings.go` — Entire file unused. `KeyMap` defined but `Update()` uses `msg.String()`, never `key.Matches()`.
- `internal/tui/components/pomodoro_ring.go:125` — Dead `partial` constant
- `internal/tui/components/pomodoro_ring.go:173-222` — ~50 lines dead (`renderedRows` + `rowStr`)
- `internal/app/helpers.go:49-56` — Dead `fmtJSON` method
- `internal/app/app.go:293-298` — Dead `req` variable with `_ = req`

**Fix:** Remove all dead code.

### 7. Missing tests for new files
- `internal/auth/keystore.go` — Zero test coverage (unified credential store)
- `internal/auth/apikey.go` — Zero test coverage (API key validation/login)
- `internal/output/progress.go` — Zero test coverage (ProgressBar, StreamWriter)

**Fix:** Add test files with at minimum happy-path and error-path coverage.

## KEY WARNINGS (not blocking, tracked for follow-up)

- W1: `map[string]interface{}` in 21+ API return types
- W2: Token cache TOCTOU race + thundering herd on refresh (`tokens.go:81-121`)
- W3: `InboxList` passes `Priority: "inbox"` which never matches — likely returns 0 results
- W4: Plugin API key logic `&&` should be `||` (`plugins.go:48`)
- W5: `ExportDownload` writes to user-supplied path with 0644, no validation
- W6: Custom `max()` shadows Go 1.24 builtin (`commandpalette.go:244`)
- W7: UTF-8 truncation by byte length (`calendar_grid.go:143`, `task_row.go:44`)
- W8: Duplicate endpoint: `GetProductivityStats` == `GetAccountUsage`
- W9: Dead `isHeader` branch in `table.go:82-86`
- W10: Inconsistent API path prefixes (some `/api/v1/`, some `/api/`)
- W11: `MemoryExport` bypasses Formatter, writes directly to stdout
