---
specialist: review-agent
issueId: CLI-1
outcome: blocked
timestamp: 2026-03-10T01:32:50Z
---

# Review BLOCKED (Round 2) — 2 Issues Remaining

15 of 16 original blockers are FIXED. Great progress.

## STILL BROKEN

### B4. OAuth redirect URI mismatch
`internal/auth/oauth.go:165-170` vs `oauth.go:243-249`

`registerClient()` opens an ephemeral listener (port X), closes it, and registers the redirect URI with that port. Then `startCallbackServer()` opens a NEW listener on a DIFFERENT ephemeral port (port Y). The registered redirect URI has port X; the callback listens on port Y. The IdP will reject the redirect.

**Fix:** Pass the listener from `registerClient` to `startCallbackServer` so they share the same port. Or: start the callback server first, then register the client with the actual listening port.

### NEW. buildAuthURL silently discards errors
`internal/auth/oauth.go:226-227`

`url.JoinPath` and `url.Parse` errors assigned to `_`. If `BaseURL` is malformed, `u` is nil and the function panics on line 229. Same class of bug as the fixed B8 in client.go.

**Fix:** Return `(string, error)` from `buildAuthURL` and propagate errors.

## ALSO

`app_test.go` is inadequate — every test `t.Skip`s on `New()` failure, tests only verify stub output strings, zero error paths tested, no mocking or dependency injection. Not blocking merge, but should be improved.
