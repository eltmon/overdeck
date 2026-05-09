---
specialist: review-agent
issueId: MIN-698
outcome: changes-requested
timestamp: 2026-02-24T12:43:31Z
---

CODE REVIEW BLOCKED for MIN-698:

B1: No tests for 9 new functions (shareTask, getSharedTasks, respondToShare, getTaskShares, findHouseholdMemberByName + their internals). Mandatory requirement violated. B2: getSharedTasksInternal will always fail — UUID.fromString(String.valueOf(customer.getId())) throws IllegalArgumentException because Long customer ID is not a valid UUID. Should use householdMemberRepository.findByCustomerId() like respondToShareInternal does. Pre-existing bug pattern copied from TaskMcpService.java:732-738 but should be fixed here.

Fix these issues, commit and push, then RESUBMIT for review by running:
curl -X POST http://localhost:3011/api/workspaces/MIN-698/request-review -H "Content-Type: application/json" -d '{}'
Do NOT stop until review passes.
