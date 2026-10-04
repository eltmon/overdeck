# Flywheel state

Durable memory across Flywheel runs: substrate fixes the loop drove and
learnings worth keeping. Append only. No pipeline status, run ids, or counters.

## Substrate fixes

### PAN-4383 review never starts → PAN-4506 (2026-10-04)

- **What broke:** every re-review of PR #4387 launches a fresh Claude Code
  reviewer pane that sits at an empty prompt (0% context, no transcript). The
  kickoff is rejected by Herdr with `invalid_request: unexpected end of hex
  escape at line 1 column 4021`, both delivery attempts fail, and deacon-lite
  logs `review.stalled` then `review.stall-escalated`. It happened on the
  17:24 and 20:40 UTC review requests of 2026-10-03.
- **Evidence:** review pane `wPT:pK` empty prompt; lifecycle log
  `~/.overdeck/agents/agent-pan-4383-review/lifecycle.log` shows transcript
  `734d5f07-…jsonl` never created; `.pan/review/agent-pan-4383-review-4e585623/`
  holds only `context.json`, no report.
- **Fix:** PAN-4506 (kickoff text near char ~4000 serializes to JSON Herdr
  rejects; a non-retryable `invalid_request` must fail the dispatch instead of
  looking like a silent reviewer). Do not `pan review restart` PAN-4383 until
  PAN-4506 lands: the same kickoff fails the same way.

## Learnings

- A review that stalls twice with an empty reviewer pane is a delivery
  failure, not a slow reviewer. Run `grep -a "Kickoff delivery attempt"
  ~/.overdeck/logs/dashboard.log` before re-dispatching (`-a` is required:
  the log holds NUL bytes, so plain grep silently matches nothing).
