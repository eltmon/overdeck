# Research: Mission Control Feature Adoption for Overdeck

**Date**: 2026-03-02
**Status**: Research Complete
**Source**: [builderz-labs/mission-control](https://github.com/builderz-labs/mission-control) v1.3.0
**Local clone**: `/home/eltmon/Projects/builderz-mission-control`

---

## Executive Summary

Mission Control (MC) is an open-source Next.js agent orchestration dashboard built by Builderz Labs. It's a monitoring/management UI layer designed to sit atop OpenClaw (their agent gateway). While Overdeck is a deeper orchestration engine (workspace lifecycle, specialist pipeline, Cloister health, skills, git workflow), MC has several production-hardened features that Overdeck lacks entirely. This document proposes adopting the strongest MC features into Overdeck, prioritized by impact.

### Relationship Between the Two

```
MC is a wide, shallow dashboard (26 panels, passive monitoring)
Overdeck is a deep orchestration engine (workspace lifecycle, active monitoring, automation)
```

They occupy different layers. MC watches; Overdeck acts. The features proposed below fill gaps in Overdeck's watch/notify/report capabilities without duplicating its orchestration strengths.

---

## Proposed Features (Ranked by Impact)

### 1. Event Bus & Real-Time Broadcast

**Priority**: Critical
**MC Implementation**: `src/lib/event-bus.ts` (64 lines) + `src/app/api/events/route.ts` (71 lines)
**Overdeck Gap**: Socket.io is configured but has **zero event handlers registered**. All dashboard updates are poll-based (React Query refetchInterval). The `pipeline-notifier.ts` bridge exists but isn't wired to Socket.io.

**What MC Does**:
- Singleton EventEmitter broadcasts all state mutations
- 13+ event types: `task.created`, `agent.status_changed`, `chat.message`, `audit.security`, etc.
- SSE endpoint streams events to clients with 30s heartbeat keepalive
- Every API mutation calls `eventBus.broadcast(type, data)` at the end

**What Overdeck Should Do**:
- Wire `pipeline-notifier.ts` to Socket.io (the bridge already exists, just not connected)
- Add event types for: agent health changes, specialist transitions, cost events, workspace state changes, handoff triggers
- Emit events from: Cloister health checks, specialist queue changes, cost recording, workspace lifecycle, agent spawn/stop
- Frontend subscribes via Socket.io (already connected) instead of polling

**Effort**: Low — infrastructure exists, just needs wiring
**Impact**: High — eliminates polling overhead, enables real-time dashboard, unlocks webhooks and alerts

**Key files to modify**:
- `src/dashboard/server/index.ts` — register Socket.io event handlers
- `src/lib/pipeline-notifier.ts` — expand event types, wire to Socket.io
- `src/lib/cloister/service.ts` — emit health events
- `src/lib/cloister/specialists.ts` — emit queue/transition events
- Dashboard React components — replace `refetchInterval` with Socket.io subscriptions

---

### 2. Webhook System

**Priority**: High
**MC Implementation**: `src/lib/webhooks.ts` (365 lines) + `src/app/api/webhooks/route.ts` (183 lines)
**Overdeck Gap**: Zero webhook infrastructure. No way to notify external systems.

**What MC Does**:
- HMAC-SHA256 signed payloads (constant-time comparison, prevents timing attacks)
- Event matching: subscribe to `*` (all) or specific events
- Exponential backoff retry: 30s → 5m → 30m → 2h → 8h with ±20% jitter
- Circuit breaker: disables after 5 consecutive failures, manual reset via API
- Delivery logging: last 200 deliveries per webhook (status, duration, response)
- 10-second timeout per delivery

**What Overdeck Should Do**:
- Implement webhook delivery engine (subscribe to event bus from Feature #1)
- Store webhooks in cloister.db or a new webhooks.db
- CLI: `pan webhook add <url> --events "agent.*,specialist.*" --secret <key>`
- Dashboard: webhook management panel
- Use cases:
  - Slack/Discord notification on issue completion
  - CI trigger on specialist review pass
  - External dashboard integration
  - Custom alerting pipelines

**Effort**: Medium — MC's implementation is clean and portable, ~500 lines total
**Impact**: High — unlocks entire external integration ecosystem

**Design note**: MC's `webhooks.ts` is well-architected and could be adapted almost directly. The retry schedule, circuit breaker, and HMAC signing are production-grade patterns.

---

### 3. Claude Session Introspection

**Priority**: High
**MC Implementation**: `src/lib/claude-sessions.ts` (299 lines)
**Overdeck Gap**: Overdeck spawns Claude Code agents but doesn't read their session transcripts. Cost tracking relies on hook-based event capture, not transcript parsing.

**What MC Does**:
- Scans `~/.claude/projects/*/` every 60 seconds
- Parses JSONL session transcripts to extract:
  - Session ID, project slug, git branch
  - Model used (claude-opus-4-6, etc.)
  - User/assistant message counts, tool use counts
  - Token usage: input, output, cache read, cache creation
  - Estimated cost based on per-model pricing
  - First/last message timestamps
  - Last user prompt (first 500 chars preview)
- Detects active sessions (last message < 5 minutes ago)
- Stores in SQLite with upsert semantics

**What Overdeck Should Do**:
- Add session transcript scanner to Deacon (background patrol)
- Use as **secondary cost verification** — cross-check hook-based cost events against transcript totals
- Feed into **PAN-293 memory extraction** — transcripts are the richest source for learning extraction
- Expose via dashboard: session list with token usage, model, branch, activity status
- Use for **stuck detection enhancement** — if transcript shows no new messages for N minutes but agent isn't marked idle, it's stuck

**Effort**: Medium — MC's scanner is well-written and adaptable
**Impact**: High — improves cost accuracy, feeds memory system, enhances stuck detection

**Integration with PAN-293**: The session transcript is listed as extraction source #4 in the Living Memory PRD. MC's scanner provides exactly the file discovery and parsing logic needed.

---

### 4. Alert Rules Engine

**Priority**: Medium-High
**MC Implementation**: `src/components/panels/alert-rules-panel.tsx` + `src/app/api/alerts/route.ts`
**Overdeck Gap**: No alerting. Budget overruns show a red widget but don't notify anyone. Stuck agents are detected by Cloister but only logged internally.

**What MC Does**:
- Condition-based alert rules: `if agent.status == 'error' then notify`
- Alert types: agent status change, task priority escalation, cost threshold
- Cooldown period to prevent alert storms
- Notification channel routing (in-app, webhook)

**What Overdeck Should Do**:
- Alert rules stored in config or cloister.db
- Conditions: budget exceeded, agent stuck > N minutes, specialist queue depth > N, health state degraded, mass death detected
- Actions: webhook (from Feature #2), dashboard notification, terminal bell
- CLI: `pan alert add --condition "budget.percent > 80" --action webhook:<id>`
- Deacon processes alert rules on each health check cycle
- Cooldown per rule (e.g., max once per hour)

**Effort**: Medium — depends on Event Bus (#1) and Webhooks (#2)
**Impact**: Medium-High — proactive notification prevents wasted spend and stuck agents

---

### 5. Standup / Daily Reports

**Priority**: Medium
**MC Implementation**: `src/components/panels/standup-panel.tsx`
**Overdeck Gap**: No reporting. Mission Control panel shows features/agents but no summarized daily view.

**What MC Does**:
- Daily standup view: what agents worked on, what completed, what's blocked
- Per-agent activity summary
- Timeline of status changes

**What Overdeck Should Do**:
- `pan standup` CLI command — generates daily summary from:
  - Issues progressed (status changes)
  - Issues completed (merged)
  - Agent hours/cost by issue
  - Specialist pipeline throughput (reviews completed, tests passed)
  - Blocking issues / stuck agents
- Output: terminal (default), markdown file, or webhook payload
- Dashboard: standup panel showing daily/weekly view
- Scheduled: Deacon generates standup at configured time, sends via webhook

**Effort**: Low-Medium — data already exists (costs, pipeline state, agent activity), just needs aggregation
**Impact**: Medium — visibility into multi-agent team performance

---

### 6. Workflow Templates & Pipelines

**Priority**: Medium
**MC Implementation**: `src/app/api/workflows/route.ts` (160 lines) + `src/app/api/pipelines/route.ts` (183 lines)
**Overdeck Gap**: Skills define knowledge but not execution sequences. No reusable task templates.

**What MC Does**:
- Workflow templates: reusable task specs (model, prompt, timeout, agent role, tags)
- Pipelines: ordered sequences of workflow steps with `on_failure: stop | continue`
- Usage tracking: `use_count`, `last_used_at`
- Run history with completion stats

**What Overdeck Should Do**:
- This partially overlaps with **skills** (knowledge) and **PRDs** (planning). Consider whether Overdeck needs a separate concept or can extend skills.
- Possible approach: "Runbooks" — ordered sequences of skill invocations with failure handling
  - `pan runbook create "deploy-and-verify" --steps "build,test,deploy,smoke-test"`
  - Each step references a skill or shell command
  - Failure at any step can halt or continue
- Complements the specialist pipeline (which is hardcoded: review → test → merge)
- Enables user-defined post-merge actions (deploy, notify, update docs)

**Effort**: Medium — new concept, needs design work
**Impact**: Medium — extends automation beyond the fixed specialist pipeline

**Note**: Lower priority because Overdeck's specialist pipeline already handles the most common workflow (review → test → merge). This would be for custom automation.

---

### 7. Quality Review Gate Improvements

**Priority**: Low-Medium
**MC Implementation**: `src/app/api/quality-review/route.ts` (107 lines)
**Overdeck Gap**: Overdeck's merge step already requires user approval (`pan approve`), but the UX is CLI-only. The dashboard has an APPROVE button but no structured review form.

**What MC Does**:
- Dedicated quality review API: review records with status (approved/rejected/needs_revision), reviewer, notes
- Task progression blocked until quality review passes
- Audit trail of all review decisions

**What Overdeck Should Do**:
- Add structured review notes to the approval flow (not just approve/reject)
- Store review decisions in archive (currently only specialist feedback is archived)
- Dashboard: review panel with checklist, notes field, history
- `pan approve <issue> --notes "Reviewed: looks good, minor style nit in X"`

**Effort**: Low — mostly UI polish + a notes field
**Impact**: Low-Medium — improves audit trail, marginal workflow improvement

---

### 8. RBAC & Authentication

**Priority**: Low (for now)
**MC Implementation**: `src/lib/auth.ts` (3 roles: viewer/operator/admin, session + API key + Google OAuth)
**Overdeck Gap**: Zero auth. Dashboard is open to anyone on localhost.

**What MC Does**:
- 3-tier RBAC: viewer (read-only), operator (read-write), admin (full)
- Session cookies (7-day expiry) + API key (headless)
- Google OAuth with admin approval workflow
- Scrypt password hashing
- Audit logging of all auth events

**What Overdeck Should Do**:
- **Not now** — Overdeck is single-operator by design. Auth adds complexity without value for the current use case.
- **Future trigger**: When Overdeck dashboard is exposed beyond localhost (e.g., team access, remote agents reporting back)
- **Minimum viable auth**: API key validation on dashboard endpoints + optional basic auth
- Store in `~/.overdeck/auth.yaml` (not a database — single operator doesn't need user management)

**Effort**: Medium — auth is always more work than it looks
**Impact**: Low (currently) — would increase if Overdeck goes multi-user

---

## Implementation Roadmap

### Phase A: Event Foundation (Features #1)
**Prerequisite for everything else.** Wire the event bus, emit from all state mutation points, subscribe in dashboard.

### Phase B: Webhooks + Alerts (Features #2, #4)
With event bus in place, add webhook delivery engine and alert rules. This unlocks Slack notifications, CI integration, and proactive monitoring.

### Phase C: Session Introspection + Standup (Features #3, #5)
Add Claude session scanner to Deacon. Use for cost verification, memory extraction input, and daily standup generation.

### Phase D: Polish (Features #6, #7, #8)
Workflow templates, quality review improvements, and auth — lower priority, implement when needed.

```
Phase A (event bus)     → no dependencies, start here
  │
  ├──► Phase B (webhooks + alerts) → depends on Phase A
  │
  └──► Phase C (sessions + standup) → independent of Phase B
          │
          └──► Phase D (polish) → after B + C
```

**Estimated scope**: Phase A is ~1 issue. Phase B is ~2 issues. Phase C is ~2 issues. Phase D is ~3 issues.

---

## What NOT to Adopt

| MC Feature | Why Skip |
|-----------|----------|
| **Multi-tenant provisioning** | Overdeck is single-operator. SaaS deployment is not on the roadmap. |
| **SSE over Socket.io** | Overdeck already uses Socket.io (bidirectional, needed for terminal). Switching to SSE would be a downgrade for our use case. |
| **Agent templates (archetypes)** | Overdeck's skills + CLAUDE.md + project templates serve the same purpose with more depth. |
| **Kanban board** | Overdeck already has a kanban board. MC's is simpler (no specialist pipeline integration). |
| **OpenClaw gateway protocol** | Overdeck manages agents directly via tmux. Adding a gateway layer adds complexity without value for local orchestration. |
| **Memory browser panel** | Superseded by PAN-293 (Project Living Memory) which is much more ambitious than MC's file browser. |
| **Direct CLI registration** | Interesting pattern but Overdeck's tmux-based agent management is more capable (bi-directional, message delivery, session resume). |
| **Next.js migration** | MC uses Next.js App Router. Overdeck's Express + Vite React stack works fine. Migration cost >> benefit. |

---

## References

- **MC Repository**: https://github.com/builderz-labs/mission-control
- **MC Local Clone**: `/home/eltmon/Projects/builderz-mission-control`
- **Key MC files analyzed**:
  - `src/lib/webhooks.ts` — webhook delivery engine (365 lines)
  - `src/lib/event-bus.ts` — SSE event bus (64 lines)
  - `src/lib/claude-sessions.ts` — session introspection (299 lines)
  - `src/lib/scheduler.ts` — background scheduler (369 lines)
  - `src/app/api/quality-review/route.ts` — quality gates (107 lines)
  - `src/app/api/workflows/route.ts` — workflow templates (160 lines)
  - `src/app/api/pipelines/route.ts` — pipeline definitions (183 lines)
- **Overdeck integration points**:
  - `src/lib/pipeline-notifier.ts` — event bridge (ready for wiring)
  - `src/dashboard/server/index.ts` — Socket.io configured but unused
  - `src/lib/cloister/deacon.ts` — background patrol (add session scanner here)
  - `src/lib/cloister/service.ts` — health event emission point
