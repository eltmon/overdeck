---
specialist: verification-gate
issueId: PAN-513
outcome: failed
timestamp: 2026-04-07T04:33:04Z
---

VERIFICATION FAILED for PAN-513 (attempt 2/10):

Failed check: vbrief-ac

Acceptance criteria check FAILED — 16/16 AC incomplete:

### Extend system health endpoint with memFree and threshold config (3/3 incomplete)
  - [ ] GET /api/godview/system-health returns memFree in bytes
  - [ ] Health response includes warnThresholdBytes and blockThresholdBytes from env config
  - [ ] Thresholds default to 4GB warn / 2GB block when env vars not set

### Add two-tier memory guard to POST /api/agents (4/4 incomplete)
  - [ ] Spawning agent when RAM < critical threshold returns 422 with memoryBlocked flag
  - [ ] Spawning agent when RAM < warning threshold returns memoryWarning requiring confirmation
  - [ ] Passing bypassMemoryWarning: true skips warning tier and proceeds with spawn
  - [ ] Critical block response includes Fly.io remote offloading hint message

### Create MemoryIndicator pill component in dashboard header (3/3 incomplete)
  - [ ] Dashboard header shows live RAM usage (used / total) with color-coded status dot
  - [ ] Color transitions: green > 30% free, yellow 15-30%, red < 15%
  - [ ] Indicator auto-refreshes every 10 seconds

### Create sticky MemoryWarningBanner below header (3/3 incomplete)
  - [ ] Warning banner appears when RAM is below warning threshold
  - [ ] Banner lists top memory consumers with kill action buttons
  - [ ] Banner is dismissible but re-appears if memory drops further

### Handle memory warning response in spawn UI with confirmation dialog (2/2 incomplete)
  - [ ] Warning-tier spawn shows confirmation dialog with memory stats before proceeding
  - [ ] Critical-tier block shows error message with Fly.io remote hint

### Document PAN_MEMORY_WARN_GB and PAN_MEMORY_BLOCK_GB configuration (1/1 incomplete)
  - [ ] Thresholds are configurable via ~/.panopticon.env (PAN_MEMORY_WARN_GB, PAN_MEMORY_BLOCK_GB)

## REQUIRED: Complete all acceptance criteria BEFORE resubmitting

1. Review the incomplete AC above
2. Implement the missing requirements and write tests
3. Update plan.vbrief.json subItem statuses to 'completed'
4. Commit and push ALL changes
5. ONLY THEN resubmit:
curl -X POST http://localhost:3011/api/workspaces/PAN-513/request-review -H "Content-Type: application/json" -d '{}'

Do NOT resubmit until all AC are completed.
