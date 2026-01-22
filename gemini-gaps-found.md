# Panopticon Implementation Gaps

This document identifies gaps between the requirements defined in `docs/PRD.md` and the current codebase implementation in `src/`.

## Critical Gaps (Missing Functionality)

### 1. Context Budget Manager (PRD Phase 12.8)
**Status:** ⚠️ Partially Implemented / Simplified
**Requirement:** Sophisticated budget manager with "reserved" buckets for system prompt, skills, and history.
**Findings:**
- `src/lib/context.ts` contains a basic `ContextBudget` interface.
- It only tracks `maxTokens` vs `usedTokens`.
- Missing the advanced logic for:
  - `reserved` allocations (system prompt vs skills vs history).
  - Smart budget updates based on reservation prioritization.
  - Integration with agent context loading to enforce these limits dynamically.

### 2. Runtime Metrics (PRD Phase 13.6)
**Status:** ❌ Not Implemented
**Requirement:** Track success rates, duration, and capabilities for each runtime (Claude vs Codex vs Gemini) to inform routing.
**Findings:**
- `src/lib/runtime/metrics.ts` is missing.
- `RuntimeComparison` component is missing from Dashboard.
- No code found that records task completion stats by runtime type.
- The `AgentCV` logic exists in `lib/cv.ts`, but it tracks *agent instance* stats, not *runtime engine* benchmarks.

### 3. Multi-Runtime Dashboard (PRD Phase 13)
**Status:** ❌ Not Implemented
**Requirement:** Dashboard view to compare runtime performance side-by-side.
**Findings:**
- `src/dashboard/frontend/src/components/RuntimeComparison.tsx` is missing.
- Dashboard only shows basic agent list and basic health status.

## Summary
The core "Panopticon" orchestration (Agents, Workspaces, FPP Hooks, Basic Multi-Runtime) is implemented. The primary remaining gaps are related to **Smart Context Budgeting** and **Comparative Runtime Metrics**.
