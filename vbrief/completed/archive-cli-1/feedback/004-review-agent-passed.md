---
specialist: review-agent
issueId: CLI-1
outcome: passed
timestamp: 2026-03-10T02:26:39Z
---

# Review PASSED (Round 4) — Security Fixes Verified

All HIGH and MEDIUM findings from the security review (003-security-review.md) are addressed.

## Security Fixes Verified

| Finding | Severity | Fix |
|---|---|---|
| HIGH-1 | Weak machine secret fallback | `loadOrCreateMachineKey()` — random 256-bit key stored with 0600 perms |
| HIGH-2 | Hardcoded compose secrets | `${MYN_TEST_JWT_SECRET:?...}` / `${MYN_TEST_DEMO_KEY:?...}` in docker-compose.yml |
| HIGH-3 | Unvalidated MYN_API_URL | `validateAPIURL()` enforces https, http only for localhost |
| MED-1 | No callback server timeouts | ReadTimeout/WriteTimeout/IdleTimeout set |
| MED-2 | Localhost bind ambiguity | `"127.0.0.1:0"` explicit loopback |
| MED-3 | Error param injection | `sanitizeParam()` strips non-printable chars |
| MED-4 | Retry-After DoS | Capped at 60 seconds |
| MED-5 | Integration test hardcoded key | Demo key from env var, custom client with timeout |
| LOW-1 | Response body size limit | `io.LimitReader(resp.Body, 10*1024*1024)` |
| LOW-6 | go.mod indirect | `golang.org/x/crypto` now direct dependency |

## Non-blocking Notes

1. `validateAPIURL` and `sanitizeParam` lack direct unit tests (recommend adding)
2. `isLocalhost` has dead branches (`HasPrefix` checks for port-suffixed hostnames that `u.Hostname()` already strips)
3. `app_test.go` still uses `New()` with `t.Skip` fallback — could use `NewWithConfig()` for reliability

## Test-agent queued
