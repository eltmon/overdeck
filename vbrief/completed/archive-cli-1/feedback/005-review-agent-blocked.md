---
specialist: review-agent
issueId: CLI-1
outcome: blocked
timestamp: 2026-03-10T02:31:22Z
---

# Review BLOCKED (Strict Round 5) — 4 Issues

Previous rounds passed the implementation and security fixes. This strict review enforces mandatory requirements on test coverage, dead code, and error handling.

## BLOCKERS

### 1. Missing tests for `validateAPIURL` / `isLocalhost` (config.go:63-98)

The HIGH-3 security fix (SSRF prevention via URL validation) has **zero** direct test coverage. No test verifies that:
- `http://evil.com` is rejected
- `ftp://anything` is rejected
- URLs with no host are rejected
- `http://localhost:8080` is accepted
- `https://api.example.com` is accepted
- `http://127.0.0.1:5000` is accepted

**Fix:** Add `TestValidateAPIURL` with positive and negative cases. Add `TestIsLocalhost` with edge cases.

### 2. Missing test for `sanitizeParam` (oauth.go:376-385)

The MED-3 security fix (terminal escape injection prevention) has **zero** test coverage. No test verifies that non-printable characters, ANSI escape sequences, or control characters are stripped.

**Fix:** Add `TestSanitizeParam` with cases for clean strings, ANSI sequences (`\033[31m`), null bytes, and DEL characters.

### 3. Dead code in `isLocalhost` (config.go:96-97)

```go
strings.HasPrefix(host, "localhost:") ||
strings.HasPrefix(host, "127.0.0.1:")
```

These branches are **unreachable**. `isLocalhost` is called from `validateAPIURL` with `u.Hostname()` which strips the port. The input will never contain `:`.

**Fix:** Remove lines 96-97. The function is called only from `validateAPIURL` where port is already stripped.

### 4. Discarded write error in `loadOrCreateMachineKey` (keyring.go:213)

```go
_ = os.WriteFile(keyFile, key, 0600)
```

If the write fails (permissions, disk full, read-only FS), the generated key works for the current session but is lost on restart. The user's encrypted refresh token becomes **permanently undecryptable** with zero feedback.

**Fix:** Return the error or at minimum log a warning via `fmt.Fprintf(os.Stderr, ...)` so the user knows credential persistence is degraded.
