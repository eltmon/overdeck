# PAN-513: Memory Monitoring + Pre-Spawn Guard Rails

## Problem

Spawning multiple planning agents simultaneously can exhaust system RAM (64GB), causing systemd memory pressure, cache flushing, and full system crash. There is no visibility into memory usage from the main dashboard (only God View), and no guardrails to prevent over-provisioning.

## Decisions

### 1. RAM Indicator Location
**Decision:** Compact pill/chip in the main Header bar, between CloisterStatusBar and FreshnessIndicator.
- Shows: `48 / 64 GB` with color-coded dot
- Color coding: green > 30% free, yellow 15-30%, red < 15%
- Refreshes every 10s (reuses existing `GET /api/godview/system-health` endpoint, already cached with 10s TTL)
- Visible on every tab (not just God View)

### 2. Pre-Spawn Memory Guard (Two Tiers)
**Decision:** Two-tier system with configurable thresholds.

- **Warning tier** (default: 4GB free) — shows a confirmation dialog via existing `DialogProvider`. User can proceed or cancel.
- **Critical tier** (default: 2GB free) — hard block, returns 422 from `POST /api/agents`. No override. Prevents the crash scenario.

**Implementation:**
- Backend: Add memory check in `POST /api/agents` handler (`routes/agents.ts`) after existing validation guards, before workspace creation.
- Read thresholds from `~/.panopticon.env` (`PAN_MEMORY_WARN_GB`, `PAN_MEMORY_BLOCK_GB`)
- Response includes `memoryWarning: true` or `memoryBlocked: true` so frontend can differentiate
- For warning tier: frontend shows confirmation dialog before re-submitting with `bypassMemoryWarning: true`
- For critical tier: frontend shows error toast, no bypass option

### 3. Warning Banner
**Decision:** Sticky warning banner at top of dashboard (below header) when system memory is below warning threshold.
- Shows system total: "System memory low: 1.8 GB free of 64 GB"
- Lists top 3-5 memory consumers (from running agents — read from state files + `os.freemem()` breakdown)
- Includes "Kill" action button per agent for quick cleanup
- Dismissible, but re-appears if memory drops further
- Banner component reuses the health polling already in place (10s interval)

### 4. Fly.io Remote Offloading Hint
**Decision:** Include a basic hint message (no new functionality).
- When spawn is blocked at critical tier, include: "Consider offloading to a remote runner: `pan issue <id> --remote`"
- Added to the 422 response body and displayed in the UI error message

### 5. Configuration
**Decision:** Environment variables in `~/.panopticon.env`:
- `PAN_MEMORY_WARN_GB=4` — warning threshold (confirmation dialog)
- `PAN_MEMORY_BLOCK_GB=2` — critical threshold (hard block)
- Loaded via existing `loadPanopticonEnv()` in `env-loader.ts`
- Defaults baked into code if not set

## Architecture Notes

### Existing Infrastructure Being Reused
- `GET /api/godview/system-health` — already returns `memUsed`, `memTotal`, `memPercent`, refreshed every 10s
- `DialogProvider.tsx` — existing confirmation dialog system
- `loadPanopticonEnv()` — existing env file loader
- `os.freemem()` / `os.totalmem()` — already imported in `misc.ts`

### New Components
- `MemoryIndicator.tsx` — header pill component (small, self-contained)
- `MemoryWarningBanner.tsx` — sticky banner component
- Memory check logic in `routes/agents.ts` post-validation guard

### Data Flow
1. Backend: `refreshGodViewSystemHealth()` already computes mem stats every 10s
2. New: `GET /api/godview/system-health` response extended with `memFree` (bytes) for threshold comparison
3. Frontend: `MemoryIndicator` polls same endpoint (or shares hook with God View)
4. Frontend: `MemoryWarningBanner` conditionally renders based on threshold
5. Spawn flow: backend checks `os.freemem()` directly (real-time, not cached) before spawning

### Files Modified
- `src/dashboard/server/routes/misc.ts` — add `memFree` to health cache response
- `src/dashboard/server/routes/agents.ts` — add memory guard in POST /api/agents
- `src/lib/env-loader.ts` — add `getMemoryThresholds()` helper
- `src/dashboard/frontend/src/components/Header.tsx` — add MemoryIndicator
- `src/dashboard/frontend/src/components/MemoryIndicator.tsx` — new component
- `src/dashboard/frontend/src/components/MemoryWarningBanner.tsx` — new component
- `src/dashboard/frontend/src/App.tsx` — render MemoryWarningBanner below Header
- `src/dashboard/frontend/src/components/KanbanBoard.tsx` (or wherever spawn is triggered) — handle memoryWarning response with confirmation dialog

## Out of Scope
- Docker container memory limits enforcement
- Per-container memory breakdown from Docker stats API (would need `docker stats` calls)
- Actual Fly.io remote offloading implementation
- Memory-based auto-scaling
