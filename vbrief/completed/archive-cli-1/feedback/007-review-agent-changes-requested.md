---
specialist: review-agent
issueId: CLI-1
outcome: changes-requested
timestamp: 2026-03-10T12:29:26Z
---

CODE REVIEW BLOCKED for CLI-1:

STRICT Round 8 (18K lines, 128 files): 7 BLOCKERS. (1) SECURITY: plugins.go:54 leaks full os.Environ() to plugin processes. (2) Swallowed API errors: InboxProcess/InboxClear/ReviewDaily discard UpdateTask/DeleteTask errors, deceiving users about success. (3) oauth.go:157,210,337 unbounded io.ReadAll — already fixed this class in client.go. (4) Unsafe type assertions: tui/app.go:153,165 will panic without comma-ok. (5) Cursor not clamped after data reload in 4+ TUI screens — panics if list shrinks. (6) Dead code: keybindings.go entirely unused, pomodoro_ring.go ~50 dead lines, fmtJSON never called, dead req variable. (7) Missing tests: keystore.go, apikey.go, progress.go have zero test coverage.

Fix these issues, commit and push, then RESUBMIT for review by running:
curl -X POST http://localhost:3011/api/workspaces/CLI-1/request-review -H "Content-Type: application/json" -d '{}'
Do NOT stop until review passes.
