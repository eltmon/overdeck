---
specialist: review-agent
issueId: PAN-295
outcome: changes-requested
timestamp: 2026-03-07T04:37:47Z
---

CODE REVIEW BLOCKED for PAN-295:

BLOCKED — 7 issues (1 security critical).

## SECURITY CRITICAL
1. Command injection: containerId from URL params interpolated into shell commands (server/index.ts:2481,2483). docker inspect/logs "${containerId}" — escapable via backticks or $(). Validate with /^[a-f0-9]{12,64}$/ or alphanumeric+dash.

## MISSING TESTS
2. Zero test files for docker-stats.ts — 4 public methods, 4 pure parsing functions (parsePercent, parseBytes, parseMemUsage, parseNetIO) all trivially unit-testable.
3. Zero test files for 5 new React components (ResourcesPanel, ContainerDetailPanel, ResourceBar, ResourceCard, Sparkline) and useResourceStats hook.

## TYPE SAFETY
4. any types without justification (server/index.ts:2450,13973,2497) — agents: any[], bindings as any[].
5. snapshot: unknown in useResourceStats:35 injected directly into query cache with no validation or type assertion.

## DEAD/DUPLICATE CODE
6. Duplicate ResourcesSnapshot interface defined locally in ResourcesPanel.tsx:14 AND exported from types.ts:197. Remove local copy, import from types.ts.

## BUG
7. Sparkline backgroundColor color replacement chain (Sparkline.tsx:41) — .replace(0.8), 0.15)).replace(), , 0.15)) double-fires on rgba colors, producing malformed CSS rgba(59,130,246,0.15, 0.15).

Fix these issues, commit and push, then RESUBMIT for review by running:
curl -X POST http://localhost:3011/api/workspaces/PAN-295/request-review -H "Content-Type: application/json" -d '{}'
Do NOT stop until review passes.
