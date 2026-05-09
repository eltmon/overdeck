---
specialist: review-agent
issueId: CLI-1
outcome: blocked
timestamp: 2026-03-09T22:56:41Z
---

# Review BLOCKED — 16 Blockers, 16 Warnings

## BLOCKERS (must fix before resubmit)

### B1. ZERO test files
34 new source files, ~3,400 lines of code, and not a single `_test.go` in the diff. Every new function needs tests. At minimum: config, auth/keyring, auth/oauth, api/client, parse/date, parse/duration, output/formatter.

### B2. OAuth: `math/rand` for PKCE and state
`internal/auth/oauth.go:10,296-312` — `generateCodeVerifier()` and `generateState()` use `math/rand.Read()` which is not cryptographically secure. Change to `crypto/rand`.

### B3. OAuth: Missing `client_id` in token exchange
`internal/auth/oauth.go:259-293` — `exchangeCode` form data omits `client_id`. Required for public OAuth clients. Token exchange will fail at runtime.

### B4. OAuth: Redirect URI mismatch
`internal/auth/oauth.go:149 vs 182` — `registerClient` registers `http://localhost/callback` (no port) but `buildAuthURL` uses `http://localhost:{port}/callback`. Auth server will reject due to mismatch.

### B5. OAuth: Callback server never shut down
`internal/auth/oauth.go:198-257` — HTTP server started with `go server.Serve(listener)` is never shut down. Returns `server` reference to enable `server.Shutdown(ctx)` after receiving the code.

### B6. Keyring: Weak encryption key derivation
`internal/auth/keyring.go:229-245` — Single SHA-256 of public `machine-id` + static salt. Any local process can derive the same key. Use PBKDF2/Argon2 or document the limitation explicitly.

### B7. Keyring: Credentials dir world-readable
`internal/auth/keyring.go:135` — `os.MkdirAll(..., 0755)` should be `0700`.

### B8. API client: Nil pointer panic on malformed URL
`internal/api/client.go:153` — `parsedURL, _ := url.Parse(u)` — if URL is malformed, `parsedURL` is nil, next line panics.

### B9. API client: Retry corrupts non-idempotent requests
`internal/api/client.go:76-103` — Retry loop retries all methods including POST. `io.Reader` body is consumed on first attempt; retries send empty body. Either skip retries for POST or buffer the body.

### B10. OAuth: Lost refresh token on save failure
`internal/auth/oauth.go:135` — `_ = c.Keyring.SaveRefreshToken(tokens.RefreshToken)` — if save fails, old token is consumed by server and new token is lost. User must re-authenticate. Return this error.

### B11. Keyring: `Clear()` error handling is dead code
`internal/auth/keyring.go:72-86` — `errs` slice declared but never appended to. All deletion errors discarded. Function always returns nil.

### B12. CLI: Global flags have zero effect
`cmd/mynow/main.go:43-45` — `--json`, `--quiet`, `--no-color` flags declared but never read or wired to `output.Formatter`. Users pass them, nothing happens.

### B13. CLI: Misleading help text for required args
`cmd/mynow/main.go` — `Use: "done [id]"` with `cobra.ExactArgs(1)` in 4 places. `[arg]` means optional by Cobra convention; use `<arg>` for required.

### B14. CLI: Missing SilenceUsage
`cmd/mynow/main.go` — No `rootCmd.SilenceUsage = true`. Every RunE error dumps full usage text alongside the error message.

### B15. No context.Context in App methods
`internal/app/app.go` — None of the App methods accept `context.Context`. Needed for HTTP timeouts, cancellation (Ctrl+C), deadline propagation. Must be designed in from the start.

### B16. Error-swallowing constructors
`internal/config/config.go` — `Load()` returns `*Config` with no error. `internal/app/app.go` — `New()` returns `*App` with no error. Both silently swallow `os.UserHomeDir()` failures and future config parsing errors.

## WARNINGS

- `oauth.go:153` — `json.Marshal` error ignored
- `config.go:119-121` — YAML unmarshal error silently discarded
- `config.go:187,197,205` + `keyring.go:103` — `os.UserHomeDir()` errors discarded (4 places)
- `client.go:82-83` — Retry backoff uses `time.Sleep`, ignores context cancellation
- `sse.go:130` — Channel send can deadlock if consumer stops reading
- `sse.go:122` — `bufio.Scanner` blocks, context cancellation only between events
- `client.go:174-178` — No `Retry-After` header parsing for 429
- `keyring.go:248-256` — `randomString` has modulo bias
- `keyring.go:258-282` — `splitLines`/`indexByte` duplicate stdlib
- `output.go:20` — `json.Encoder.Encode` error ignored
- `output.Formatter` defined but never used
- All app methods use `fmt.Println` directly, bypassing Formatter
- `client.go:41-48` — No mutex protecting `apiKey`/`token` fields
- `client.go` — Callers must close `resp.Body`; no documentation of this contract
- `main.go:50` — `_ = application` is dead code
- `sse.go:98` — Uses `== io.EOF` instead of `errors.Is`
