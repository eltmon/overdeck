---
type: feedback
description: The Flywheel approves its own pan reload restarts with pan restart
  approve once the build succeeds; never list them as needs-you
updated: 2026-11-03
---

After a Flywheel-started pan reload builds successfully and waits for restart approval, the Flywheel runs pan restart approve itself, then verifies buildCommit. Restart approvals never go into needs-you for the operator.

**Why:** operator/orchestrator instruction 2026-11-03: reloads do not drop live conversations, and waiting on approvals held deploys for hours (reload43 78 min, reload44 lost to a reboot).

**How to apply:** start pan reload detached, wait until its log shows the approval banner, run pan restart approve, wait for 'Dashboard reloaded and healthy', check buildCommit contains the merges, then close out.
