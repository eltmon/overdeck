---
type: feedback
description: Reproduce an operator-reported UI bug in a signed-in browser before
  explaining it; never call it timing or offer to defer it
updated: 2026-11-13
---

When the operator reports a visible dashboard bug, reproduce it with Playwright and a signed-in session (cookie overdeck_session = HMAC-SHA256(internal-token, 'overdeck-dashboard-session-v1') base64url, domain localhost) before giving any cause, then fix the root cause in the same turn's work. A headless browser without that cookie loads no data and proves nothing.

**Why:** on 2026-11-13 the Flywheel called the 'Issue details' drawer header a fresh-issue timing glitch and offered to queue a fix; a real repro showed every issue opens with that placeholder for 2.6 to 4 s (PAN-5171). The operator had already reported it months earlier (PAN-3659, fixed only one cause) and said this kind of bug costs the product its credibility.

**How to apply:** reproduce, measure, name the file:line cause, file with the measurements, start the fix immediately. Do not frame operator-visible polish bugs as low priority.
