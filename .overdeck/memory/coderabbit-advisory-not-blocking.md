---
type: feedback
description: "CodeRabbit (free OSS quota) is advisory: review its PR comments
  when it posts, merge without it when rate-limited or silent"
updated: 2026-11-01
---

CodeRabbit reviews Overdeck PRs on a limited free open-source quota, so it often posts only 'rate limited by coderabbit'. When it does post findings on a PR, review them before merge: send valid ones to the work agent (or file a follow-up if already merged). When it is rate-limited or never comments, move forward without it; never hold a merge waiting for it.

**Why:** operator instruction 2026-11-01; the quota is free but scarce, and its findings are useful when they arrive.

**How to apply:** the pipeline already ingests CodeRabbit findings into the review context as advisory (src/lib/cloister/coderabbit-ingestion.ts, PAN-2374), but only those posted before the reviewer starts. Before merging, check `gh api repos/eltmon/overdeck/pulls/<n>/comments` for coderabbitai[bot] comments newer than the review.
