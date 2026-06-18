# PAN-28 Planning: Shadow Mode - Work Issues Independently of Tracker State

## Discovery Summary

### Problem Statement

Overdeck currently assumes it should update the issue tracker (Linear, GitHub Issues) when moving issues through the workflow. This doesn't work for:
- Shadowing teams at work (observing without modifying their issue states)
- Read-only access scenarios
- Demo/training modes
- Parallel workflows alongside official team workflow

### Current State Analysis

**Existing Infrastructure:**

1. **Issue Tracker Abstraction** (`src/lib/tracker/`)
   - Well-defined `IssueTracker` interface with multiple implementations (Linear, GitHub, GitLab, Rally)
   - State mapping system decouples canonical states from tracker-specific states
   - Factory pattern for creating tracker instances from config

2. **Configuration Hierarchy**
   - Global: `~/.panopticon.env` (API keys)
   - Global: `~/.panopticon/config.toml` (tracker settings)
   - **Per-project: `.panopticon.yaml`** (model settings - exists but limited scope)
   - Per-project config infrastructure exists and can be extended

3. **Existing Skip Patterns**
   - `--no-linear` flag on `done` and `approve` commands
   - `--dry-run` patterns throughout codebase
   - These provide partial solution but not persistent state

4. **Where Tracker Updates Happen:**
   | File | Function | Transition |
   |------|----------|------------|
   | `src/cli/commands/work/issue.ts:573` | `updateLinearToInProgress()` | → In Progress |
   | `src/cli/commands/work/done.ts:117` | `updateLinearToInReview()` | → In Review |
   | `src/cli/commands/work/approve.ts:156` | `updateLinearStatus()` | → Done |
   | `src/dashboard/server/index.ts:235` | Auto-merge GraphQL | → Done |

---

## Architecture Decisions (User Confirmed)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **MVP Scope** | Full feature | Everything including install wizard, sync-back, dashboard UI |
| **Per-project Config** | Extend existing `.panopticon.yaml` | Infrastructure exists, just needs shadow mode fields |
| **Read Behavior** | Read normally from tracker | Fetch issue data normally, only skip writes |
| **Sync History** | Preserve history | Keep shadow-state as audit trail after sync-back |
| **Status Display** | Show both states | "In Progress (tracker: Backlog)" format |
| **Config Precedence** | CLI > Project > Global | Most specific wins |
| **Install Flow** | Global + per-tracker questions | Plus support for reconfiguring existing projects |
| **Dashboard UI** | Full UI in v1 | Ghost icons, tooltips, dashed borders, filter options |
| **Runtime Toggle** | Spawn time only | No mid-flight toggle, set at agent spawn |
| **Sync Direction** | Bidirectional | Push shadow→tracker AND pull tracker→shadow |
| **Sync Errors** | User choice at runtime | Prompt: retry, skip, or queue |
| **Local-only Issues** | Not supported | Must exist in tracker (shadow mode is read+local-write, not create) |

---

## Implementation Plan

### Phase 1: Core Shadow State Infrastructure

**Goal**: Shadow state storage and core APIs.

#### 1.1 Shadow State Storage (`src/lib/shadow-state.ts`)

New module for managing shadow state files.

**Storage Location:** `~/.panopticon/shadow-state/`

**Schema:**
```typescript
interface ShadowState {
  issueId: string;                    // e.g., "MIN-123"
  shadowStatus: CanonicalState;       // Overdeck's view
  trackerStatus: CanonicalState;      // Last known tracker status (cached)
  trackerStatusUpdatedAt: string;     // When tracker status was last fetched
  shadowedAt: string;                 // When shadow mode was enabled
  syncedAt?: string;                  // When last synced to tracker
  history: ShadowHistoryEntry[];      // Audit trail
}

interface ShadowHistoryEntry {
  from: CanonicalState;
  to: CanonicalState;
  at: string;
  by: string;                         // Command that triggered: "pan work plan", "dashboard", etc.
  syncedToTracker: boolean;           // Was this transition synced?
}
```

**Functions:**
- `getShadowState(issueId): ShadowState | null`
- `updateShadowState(issueId, newStatus, triggeredBy): void`
- `createShadowState(issueId, initialTrackerStatus): ShadowState`
- `syncToTracker(issueId): Promise<SyncResult>` (push)
- `refreshFromTracker(issueId): Promise<void>` (pull)
- `listShadowedIssues(): ShadowState[]`
- `isShadowed(issueId): boolean`

#### 1.2 Shadow Mode Configuration

**Extend `YamlConfig` in `src/lib/config-yaml.ts`:**
```typescript
interface YamlConfig {
  // ... existing fields ...

  shadow?: {
    /** Global shadow mode default */
    enabled?: boolean;

    /** Per-tracker overrides */
    trackers?: {
      linear?: boolean;
      github?: boolean;
      gitlab?: boolean;
      rally?: boolean;
    };
  };
}
```

**Extend `~/.panopticon.env`:**
```bash
# Global shadow mode default
SHADOW_MODE=true
```

**Config Loading Priority:**
1. CLI flag `--shadow` / `--no-shadow`
2. Per-project `.panopticon.yaml` shadow.enabled
3. Global `~/.panopticon/config.yaml` shadow.enabled
4. Global `~/.panopticon.env` SHADOW_MODE
5. Default: `false` (normal mode)

---

### Phase 2: CLI Integration

**Goal**: Add `--shadow` flag and update commands to respect shadow mode.

#### 2.1 Shared Shadow Mode Resolution (`src/lib/shadow-mode.ts`)

```typescript
interface ShadowModeOptions {
  cliFlag?: boolean;          // --shadow / --no-shadow
  issueId?: string;           // For checking existing shadow state
}

function resolveShadowMode(options: ShadowModeOptions): boolean
```

#### 2.2 Command Updates

| Command | Changes |
|---------|---------|
| `pan work plan <ID>` | Add `--shadow`, use shadow state instead of tracker update |
| `pan work issue <ID>` | Add `--shadow`, skip `updateLinearToInProgress()` |
| `pan work done <ID>` | Add `--shadow`, skip `updateLinearToInReview()` |
| `pan work approve <ID>` | Add `--shadow`, skip `updateLinearStatus()` |
| `pan status` | Show shadow state with "(tracker: X)" suffix |
| `pan work list` | Add `--shadow-only` filter, show indicators |

#### 2.3 New Commands

| Command | Purpose |
|---------|---------|
| `pan work shadow <ID>` | Display shadow state details for an issue |
| `pan work sync <ID>` | Sync shadow state to tracker (with confirmation) |
| `pan work refresh <ID>` | Refresh tracker status cache |
| `pan work unshadow <ID>` | Exit shadow mode, sync current state to tracker |

---

### Phase 3: Dashboard Integration

**Goal**: Visual indicators and controls for shadow mode.

#### 3.1 API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/shadow-state` | List all shadowed issues |
| `GET /api/shadow-state/:issueId` | Get shadow state for specific issue |
| `POST /api/shadow-state/:issueId/sync` | Sync to tracker |
| `POST /api/shadow-state/:issueId/refresh` | Refresh from tracker |
| `DELETE /api/shadow-state/:issueId` | Exit shadow mode |

#### 3.2 UI Components

**KanbanBoard Changes:**
- Ghost icon (👻) on shadowed issue cards
- Dashed border for shadowed issues
- Tooltip: "Shadow mode - tracker shows: [status]"
- Filter toggle: "Show shadow issues only"

**Issue Details:**
- Shadow state indicator
- "Sync to Tracker" button
- "Refresh from Tracker" button
- Shadow history timeline

**Settings Page:**
- Global shadow mode toggle
- Per-tracker shadow mode toggles

---

### Phase 4: Install Wizard & Configuration UI

**Goal**: Easy shadow mode setup for new and existing users.

#### 4.1 Install Wizard Changes (`pan install`)

**New Questions:**
1. Global: "How should Overdeck interact with issue trackers?"
   - Normal - Update issue status in tracker (default)
   - Shadow - Track status locally, don't modify tracker
   - Ask per-project - Configure each project separately

2. Per-tracker (when adding tracker): "Enable shadow mode for [tracker name]?"

#### 4.2 Configuration Commands

| Command | Purpose |
|---------|---------|
| `pan config shadow --enable` | Enable global shadow mode |
| `pan config shadow --disable` | Disable global shadow mode |
| `pan config shadow --status` | Show current shadow mode config |

---

### Phase 5: Sync & Error Handling

**Goal**: Robust bidirectional sync with user-friendly error handling.

#### 5.1 Sync-to-Tracker Flow

1. User runs `pan work sync <ID>` or clicks "Sync" in dashboard
2. Show confirmation with preview: "Will change [tracker] status from [X] to [Y]"
3. Attempt tracker update
4. On success: Update shadow state `syncedAt`, mark history entries as synced
5. On failure: Prompt user - Retry / Skip / Queue for later

#### 5.2 Refresh-from-Tracker Flow

1. User runs `pan work refresh <ID>` or clicks "Refresh"
2. Fetch current status from tracker
3. Update `trackerStatus` and `trackerStatusUpdatedAt` in shadow state
4. If differs from shadow status, notify user

#### 5.3 Sync Queue (for deferred syncs)

**Storage:** `~/.panopticon/sync-queue.json`

```typescript
interface SyncQueueEntry {
  issueId: string;
  targetStatus: CanonicalState;
  queuedAt: string;
  retryCount: number;
  lastError?: string;
}
```

**Processing:**
- Automatic retry on dashboard startup
- Manual retry via `pan work sync --retry-queued`

---

## File Structure

```
src/lib/
├── shadow-state.ts          # NEW: Shadow state management
├── shadow-mode.ts           # NEW: Shadow mode resolution
├── config-yaml.ts           # MODIFY: Add shadow config fields
├── env-loader.ts            # MODIFY: Load SHADOW_MODE

src/cli/commands/work/
├── issue.ts                 # MODIFY: Add --shadow flag
├── plan.ts                  # MODIFY: Add --shadow flag
├── done.ts                  # MODIFY: Add --shadow flag
├── approve.ts               # MODIFY: Add --shadow flag
├── list.ts                  # MODIFY: Show shadow indicators
├── shadow.ts                # NEW: Shadow status command
├── sync.ts                  # NEW: Sync command (or extend existing)

src/cli/commands/
├── status.ts                # MODIFY: Show shadow state
├── install.ts               # MODIFY: Add shadow mode questions

src/dashboard/
├── server/index.ts          # MODIFY: Add shadow state endpoints
├── frontend/src/components/
    ├── KanbanBoard.tsx      # MODIFY: Shadow indicators
    ├── IssueCard.tsx        # MODIFY: Ghost icon, dashed border
    ├── SettingsPage.tsx     # MODIFY: Shadow mode toggles

~/.panopticon/
├── shadow-state/            # NEW: Shadow state storage
│   ├── MIN-123.json
│   └── PAN-27.json
└── sync-queue.json          # NEW: Deferred sync queue
```

---

## Definition of Done

- [ ] Shadow state can be created, read, updated for any issue
- [ ] `--shadow` flag works on `plan`, `issue`, `done`, `approve`
- [ ] Shadow mode respects config hierarchy (CLI > Project > Global)
- [ ] `pan status` shows both shadow and tracker status
- [ ] Dashboard shows ghost icon and tooltip for shadowed issues
- [ ] Dashboard has filter for shadow issues
- [ ] "Sync to Tracker" works with retry/skip/queue on error
- [ ] "Refresh from Tracker" updates cached tracker status
- [ ] Install wizard asks shadow mode preference
- [ ] Per-project `.panopticon.yaml` supports shadow config
- [ ] Existing `--no-linear` flags still work (backward compatible)

---

## Out of Scope (Future Work)

- Local-only issues (issues that don't exist in tracker)
- Runtime toggle (changing shadow mode mid-flight)
- Auto-sync on certain triggers
- Shadow mode for PR operations (just issue state for now)
- Multi-tracker shadow state (shadowing same issue in multiple trackers)
