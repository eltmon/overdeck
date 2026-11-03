---
type: feedback
description: "CodeRabbit (free OSS quota) is advisory: review its PR comments
  when it posts, merge without it when rate-limited or silent"
updated: 2026-11-03
---

CodeRabbit reviews Overdeck PRs on a limited free open-source quota, so it often posts only 'rate limited by coderabbit'. When it does post findings on a PR, send them to the work agent, which fixes the ones it agrees with and replies on the PR with its reason for any it rejects (or file a follow-up if already merged). Operator restated 2026-11-03: "if code rabbit left comments tell the agent to address the comments (but of course only if it agrees with the comments)". This settles PAN-4773; never ask the operator about it again. When it is rate-limited or never comments, move forward without it; never hold a merge waiting for it.

**Why:** operator instruction 2026-11-01; the quota is free but scarce, and its findings are useful when they arrive.

**How to apply:** the pipeline already ingests CodeRabbit findings into the review context as advisory (src/lib/cloister/coderabbit-ingestion.ts, PAN-2374), but only those posted before the reviewer starts. Before merging, check `gh api repos/eltmon/overdeck/pulls/<n>/comments` for coderabbitai[bot] comments newer than the review.
