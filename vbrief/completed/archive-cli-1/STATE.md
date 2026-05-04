# Agent State: CLI-1

## Current Status: ALL 40 BEADS COMPLETE ✓

Opus 4.6 performed a full spec-grounded review of all code produced by Sonnet 4.6.
CLI side is solid (29+ command groups, config, auth, error handling, GoReleaser, CI).
TUI side is **incomplete** — 6 screens missing, 13 components missing, beads falsely closed.
Also found missing API methods, code quality bugs, and test gaps.

**Run `bd ready` to see what's unblocked. Work through each bead, close it, move to next.**

---

## Reopened Beads (were falsely closed — files don't exist)

### CLI-28: TUI screens — Compass, Search, Notifications, Stats, AI Chat
Create these files in `internal/tui/screens/`:
- `compass.go` — Compass briefing screen (§5.12): show current briefing with markdown rendering, keybindings g=generate, c=correct, Enter=complete
- `search.go` — Search overlay (§5.13): unified search across tasks/habits/chores/grocery, fuzzy filter, Enter=jump to item
- `notifications.go` — Notifications overlay (§5.18): list unread/read notifications, r=mark read, R=mark all read, d=delete
- `stats.go` — Stats & Achievements screen (§5.19): productivity stats, streaks, points, ASCII bar charts
- `ai_chat.go` — AI Chat screen (§5.20): streaming SSE chat with Kaia, conversation picker, Enter=send, n=new conv, h=history

### CLI-27: TUI screens — Pomodoro Focus
- `pomodoro.go` — Pomodoro Focus Mode screen (§5.17): circular progress ring, phase indicator (work/break), p=pause, r=resume, s=stop

### CLI-29: TUI components library
Create these files in `internal/tui/components/` per Appendix H:
- `task_list.go` — Filterable, sortable task list
- `task_row.go` — Single task row rendering with priority badge
- `priority_badge.go` — Priority zone indicator (●/◆ with color)
- `streak_bar.go` — Habit streak visualization (7-day grid)
- `timer_display.go` — Countdown/pomodoro display
- `pomodoro_ring.go` — Pomodoro progress ring (ASCII art)
- `input.go` — Text input field (for search, add task inline)
- `confirm.go` — Confirmation dialog (delete, archive)
- `toast.go` — Transient notification banner
- `modal.go` — Modal overlay wrapper
- `calendar_grid.go` — Week/month calendar grid
- `comment_list.go` — Task comment list with markdown rendering
- `progress_bar.go` — Horizontal progress bar (achievements, usage)
- `chart_bar.go` — ASCII bar chart (stats screen)
- `sse_reader.go` — SSE stream reader component for AI chat streaming

Wire components into screens. Refactor existing screens to USE these components instead of inline rendering.

---

## New Beads

### CLI-38: Missing API methods
Add to `internal/api/`:
- `tasks.go`: Add `ArchiveTask` — POST `/api/v2/unified-tasks/{id}/archive`
- `timers.go`: Add `CancelTimer` — POST `/api/v2/timers/{id}/cancel`
- `timers.go`: Add `SnoozeTimer` — POST `/api/v2/timers/{id}/snooze` with `{snoozeMinutes: N}`
- `ai.go`: Add `CreateAIConversation` — POST `/api/v1/ai/conversations`
- `ai.go`: Add `ArchiveAIConversation` — PATCH `/api/v1/ai/conversations/{id}/status` `{isArchived: true}`
- `ai.go`: Add `FavoriteAIConversation` — PATCH `/api/v1/ai/conversations/{id}/status` `{favorited: true}`
- `ai.go`: Add `SearchAIConversations` — GET `/api/v1/ai/conversations/search?q=`
- `ai.go`: Add `GetAIConversationStats` — GET `/api/v1/ai/conversations/stats`
- `ai.go`: Add `ContinueAIConversation` — POST `/api/v1/ai/conversations/{id}/continue`
- `habits.go`: Fix `ScheduleHabits` — change from GET→POST, pass `numberOfDays` in body not query
- `tasks.go`: Fix `ListTasks` — add `Priority` to query params (field exists but never sent)
- `habits.go`: Add `CalculateSmartTime` — POST `/api/habits/reminders/{habitId}/calculate-smart-time`

Wire all new API methods through the app layer and CLI commands.

### CLI-39: Code quality fixes
1. **config.go:252-263** — TUI boolean merge: change `VimKeys`, `Mouse`, `Animations` to `*bool` pointer types so `vim_keys: false` in YAML works. Update mergeConfig, defaults(), GetValue, SetValue accordingly.
2. **tokens.go:94-96** — Token TTL bounds: clamp `expires_in` to 1min-24h range, log warning on invalid values.
3. **keystore.go:32-37** — Keyring fallback: log warning to stderr when OS keyring save fails and falling back to file store.
4. **table.go:106** — ANSI strip: fix stripANSI to correctly skip entire 256-color sequences (`\033[38;5;196m`). The loop must continue until it finds a letter (a-z/A-Z), not stop at digits.
5. **output.go:79** — Printf: remove auto-appended `\n`. Match standard `fmt.Printf` behavior. Update all callers.
6. **table.go:70** — Unicode width: add `go get github.com/mattn/go-runewidth` and use `runewidth.StringWidth()` instead of `utf8.RuneCountInString()` for column width calculation.
7. **tui/app.go:285** — overlayCenter: add `if startCol < 0 { startCol = 0 }` to prevent negative indexing on narrow terminals.
8. **Add `mynow man` command** (§12): generate man page via Cobra's `doc.GenManTree()`.
9. **plugins.go:36-50** — Fix silent error in PluginRun: don't discard `LoadAPIKey()` error.
10. **plugins.go:58-93** — Fix plugin discovery: don't ignore `os.ReadDir` errors, handle empty `mynow-` prefix.
11. **errors.go:44** — Handle `context.Canceled` → exit code 130 (SIGINT standard).

### CLI-40: Robust test coverage (blocked by CLI-38, CLI-39, CLI-28, CLI-29)
Add tests for:
1. **TUI screens** — Unit tests for each screen: Init, Update with key messages, View rendering. At minimum test that each screen initializes without panic, handles window resize, renders non-empty output.
2. **TUI components** — Unit tests for each component: tabbar selection, statusbar rendering, command palette filtering, task_list sorting/filtering.
3. **Plugin system** — Test `discoverPlugins()` with mock directories, `PluginRun` with missing binary, `PluginList` output.
4. **Table/ANSI** — Test `stripANSI` with 256-color and true-color sequences. Test table alignment with emoji and CJK characters.
5. **JSON error structure** — Test that CLI errors produce JSON matching `{error, code, hint}` per §13.2.
6. **Quiet + JSON** — Test that `--quiet` suppresses text output but `--json` still works (or document behavior).
7. **Markdown rendering** — Test `RenderMarkdown` fallback when Glamour fails.
8. **Config round-trip** — Test that saving then loading config preserves boolean values including `false`.
9. **Token TTL bounds** — Test that `Refresh()` clamps extreme `expires_in` values.
10. **New API methods** — Test all methods added in CLI-38 (mock HTTP responses).

---

## Completed Work (keep — do not redo)

All 29+ CLI command groups wired and working. Existing files:
- cmd/mynow/main.go (1991 lines) — root command, all subcommands, global flags
- internal/config/config.go — YAML config, env vars, XDG (needs bool fix)
- internal/auth/ — OAuth PKCE, API key, keyring, tokens, device stub
- internal/api/ — 22 domain files (needs missing methods added)
- internal/app/ — 24 domain files with --json support
- internal/output/ — formatter, table, color, markdown, progress
- internal/errors/ — 6 exit codes, structured errors
- internal/util/ — date, duration, recurrence parsing
- internal/tui/ — app shell, 12 screen files, 3 components (needs 6 screens + 13 components)
- test/integration/ — setup, 5 test files
- .goreleaser.yaml, .github/workflows/ (ci, integration, release)

Security fixes (CLI-35), dependencies (CLI-36), arch bugs (CLI-37) all verified complete.

---

## Architecture Decisions (preserve)

1. `TokenStore` interface for swappable keyring backends
2. `Formatter` interface for text/JSON output switching
3. Retry-only-idempotent pattern in HTTP client
4. PKCE listener-first-then-register flow (port consistency)
5. Single binary providing both CLI and TUI modes
6. `internal/` packages to minimize public API surface

## Specialist Feedback

- **[2026-03-10T12:29Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/007-review-agent-changes-requested.md`
- **[2026-03-11T21:07Z] merge-agent → BLOCKED** — `.planning/feedback/008-merge-agent-blocked.md`
