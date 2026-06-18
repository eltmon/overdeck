# STATE.md - PAN-161: Mission Control

## Overview

Building **Mission Control** - a unified monitoring view that becomes the new default landing page for Overdeck, replacing the current Kanban board as the primary entry point. Additionally implementing **Shadow Engineering** - a groundbreaking mode for teams transitioning to AI-assisted development.

## Vision

Mission Control provides a Codex-inspired interface for monitoring all active projects, features, and agent activity in one place. Shadow Engineering enables AI to observe, document, and assist existing manual workflows before teams fully transition to AI-driven development.

## Key Decisions Made

### 1. Navigation & Routing
- ✅ **Mission Control becomes default at `/`**
- ✅ Kanban board moves to `/kanban` (still accessible)
- ✅ Skills panel remains separate tab at `/skills` (not integrated into Mission Control)
- ❌ No user preference setting for default view (forced adoption of new UX)

### 2. Planning Artifacts Scope
- ✅ **Full `.planning/` directory structure**
  - `PRD.md` / `STATE.md` (core planning docs)
  - `transcripts/` (meeting transcripts)
  - `discussions/` (tracker comments, PR threads)
  - `notes/` (ad-hoc documentation)
- ✅ **Tracker discussion sync: On-demand + webhook triggers**
  - Manual sync button for immediate refresh
  - Webhook integration for auto-sync when comments added
  - Stored as markdown in `discussions/` subdirectory
- ✅ **Transcript/note upload UI** with drag-and-drop support

### 3. Shadow Engineering Implementation
- ✅ **Full implementation (Monitoring + Observer agents)**
- ✅ **Observer Agent: Watch-only by default**
  - Only comments on PRs with observations
  - Requires explicit `/shadow propose` command to create PRs
  - Conservative approach prevents unwanted changes
- ✅ **Inference Document: Markdown format (.md)**
  - Stored as `INFERENCE.md` in `.planning/`
  - Human-readable, consistent with existing artifacts
  - Living document that updates as new artifacts arrive

### 4. UI/UX Design
- ✅ **Codex-inspired design: New CSS module for Mission Control only**
  - Isolated styles don't affect existing components
  - Matches Codex design language (Inter/SF Pro, warm cream sidebar, generous whitespace)
  - Migration to rest of app deferred to future work
- ✅ **Section isolation mode for concurrent agents (Recommended)**
  - Tail-anchored sections prevent layout jitter
  - Click section header to focus/fullscreen one section
  - Escape to return to multi-section view
  - Unread indicators for sections with new content
- ✅ **Empty projects show collapsed with '(no active features)' label**

### 5. Data Architecture
- ✅ **New `/api/activity/{issueId}` endpoint**
  - Aggregates all agent sessions for an issue
  - Includes planning, work, review, test, merge agents
  - Returns ordered sections with metadata (model, timestamps, status)
- ✅ **New `/api/planning/{issueId}` endpoints**
  - GET: Retrieve planning artifacts (PRD, STATE, transcripts, discussions, notes)
  - POST: Upload new artifacts
  - PUT: Update existing artifacts
- ✅ **Socket.io events for real-time updates**
  - `activity:output` - Streaming agent output for a feature
  - `planning:sync` - New planning artifact detected
  - `shadow:inference-update` - Inference Document updated

### 6. Out of Scope (Explicitly Deferred)
- ❌ **PR webhook integration for Observer Agent**
  - Observer will poll for PRs initially
  - Webhook integration deferred to follow-up work
- ❌ **Real-time collaboration features**
  - Single-user view for now
  - Shared cursors/presence indicators deferred
- ❌ **Advanced filtering/search in Mission Control**
  - Show all active features initially
  - Filtering by status/assignee/date deferred
- ❌ **Multi-project aggregated view**
  - One project tree at a time
  - Cross-project dashboard deferred

## Architecture

### Frontend Components

```
MissionControl/
├── index.tsx                    # Main view component
├── ProjectTree/
│   ├── ProjectNode.tsx          # Collapsible project folder
│   ├── FeatureItem.tsx          # Active feature/workspace item
│   └── EmptyState.tsx           # "(no active features)" display
├── ActivityView/
│   ├── index.tsx                # Unified activity container
│   ├── AgentSection.tsx         # Individual agent session section
│   ├── SectionHeader.tsx        # Section metadata (type, model, timestamps)
│   ├── IsolationMode.tsx        # Fullscreen section focus mode
│   └── UnreadIndicator.tsx      # New content badges
├── FeatureMetadata/
│   ├── BadgeBar.tsx             # Tasks, STATE, PRD badges
│   ├── TasksModal.tsx           # Beads tasks slide-over
│   ├── MarkdownModal.tsx        # STATE.md/PRD.md renderer
│   └── CostBadge.tsx            # Per-feature cost display
└── styles/
    └── mission-control.module.css  # Codex-inspired design tokens
```

### Backend APIs

```typescript
// Activity aggregation
GET /api/activity/:issueId
Response: {
  issueId: string;
  sections: Array<{
    type: 'planning' | 'work' | 'review' | 'test' | 'merge';
    sessionId: string;
    model: string;
    startedAt: string;
    duration: number | null;
    status: 'running' | 'completed' | 'failed';
    transcript: string;  // Full conversation/output
  }>;
}

// Planning artifacts
GET /api/planning/:issueId
Response: {
  prd?: string;          // PRD.md content
  state?: string;        // STATE.md content
  inference?: string;    // INFERENCE.md for Shadow Engineering
  transcripts: Array<{ filename: string; content: string; uploadedAt: string }>;
  discussions: Array<{ filename: string; content: string; syncedAt: string }>;
  notes: Array<{ filename: string; content: string; uploadedAt: string }>;
}

POST /api/planning/:issueId/upload
Body: { type: 'transcript' | 'note'; filename: string; content: string }

POST /api/planning/:issueId/sync-discussions
Body: { tracker: 'github' | 'linear' }
Response: { synced: number; files: string[] }
```

### Directory Structure

```
workspace-{issueId}/
├── .planning/
│   ├── PRD.md                   # Planning agent output
│   ├── STATE.md                 # Current state
│   ├── INFERENCE.md             # Shadow Engineering understanding (if applicable)
│   ├── transcripts/
│   │   ├── 2026-02-01-kickoff.md
│   │   ├── 2026-02-05-refinement-1.md
│   │   └── 2026-02-08-mid-impl-review.md
│   ├── discussions/
│   │   ├── github-PAN-161-comments.md
│   │   ├── pr-123-discussion.md
│   │   └── linear-PAN-161-comments.md
│   └── notes/
│       ├── architecture-decision.md
│       └── api-contract-draft.md
├── [rest of workspace files...]
```

### Specialist Agents (Shadow Engineering)

#### Monitoring Agent
- **Purpose**: Analyzes artifacts and infers what the team is building
- **Inputs**: Issue description, comments, transcripts, PRs, code changes
- **Output**: `INFERENCE.md` - Living understanding brief
- **Behavior**:
  - Runs when Shadow workspace is created
  - Updates INFERENCE.md as new artifacts arrive
  - Surfaces gaps, ambiguities, risks in the inferred plan
  - Tracks team decisions and patterns

#### Observer Agent
- **Purpose**: Watches team's development work and provides assistance
- **Default Mode**: Watch-only (comments on PRs)
- **Propose Mode**: Requires explicit `/shadow propose` command
- **Behavior**:
  - Monitors PR activity (polls initially, webhook later)
  - Comments with observations, suggestions, potential issues
  - Tracks progress against Inference Document
  - Flags deviations or scope changes
  - Documents patterns the team is using

### Design Tokens (Codex-Inspired)

```css
/* mission-control.module.css */
:root {
  /* Colors */
  --mc-bg-main: #FFFFFF;
  --mc-bg-sidebar: #FAF9F7;
  --mc-text-primary: #1A1A1A;
  --mc-text-secondary: #6B7280;
  --mc-border: #E5E7EB;

  /* Typography */
  --mc-font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'SF Pro', system-ui, sans-serif;
  --mc-font-size-meta: 12px;
  --mc-font-size-body: 14px;
  --mc-font-size-subtitle: 16px;
  --mc-font-size-heading: 28px;
  --mc-line-height: 1.5;

  /* Spacing (4px grid) */
  --mc-space-1: 4px;
  --mc-space-2: 8px;
  --mc-space-3: 12px;
  --mc-space-4: 16px;
  --mc-space-6: 24px;
  --mc-space-8: 32px;

  /* Components */
  --mc-radius: 8px;
  --mc-shadow: none;
}
```

## Implementation Plan

### Phase 1: Foundation (Parallel Work)
These tasks can be worked on simultaneously with minimal dependencies.

1. **Design System CSS Module** (difficulty:simple)
   - Create `mission-control.module.css`
   - Define Codex-inspired design tokens
   - Set up font loading (Inter/SF Pro fallbacks)

2. **`.planning/` Directory Structure** (difficulty:simple)
   - Establish standard directory structure
   - Create helper functions for directory management
   - Add validation for required files

3. **Activity Aggregation API** (difficulty:medium)
   - Implement `/api/activity/:issueId` endpoint
   - Read specialist logs from `~/.overdeck/specialists/`
   - Aggregate planning agent sessions
   - Return ordered sections with full metadata

4. **Planning Artifacts API** (difficulty:medium)
   - Implement `/api/planning/:issueId` GET endpoint
   - Implement `/api/planning/:issueId/upload` POST endpoint
   - File system operations for reading/writing artifacts
   - Validation and error handling

### Phase 2: Core Mission Control (Depends on Phase 1)

5. **MissionControl Component with Project Tree** (difficulty:complex)
   - Main layout with sidebar and content area
   - Project tree with collapsible folders
   - Feature items with status indicators (🔄/⚠️)
   - Cost badges per feature
   - Empty project state display
   - Apply Codex design tokens

6. **Feature Activity View** (difficulty:complex)
   - Unified activity container
   - Agent session sections
   - Section headers with metadata (type, model, timestamps)
   - Tail-anchored scrolling for concurrent agents
   - Markdown rendering with syntax highlighting
   - Status indicators (running/completed/failed)

7. **Section Isolation Mode** (difficulty:medium)
   - Click-to-focus section header
   - Fullscreen section view
   - Escape to return to multi-section
   - Smooth transitions
   - Unread content indicators

8. **Feature Metadata Badges** (difficulty:medium)
   - Tasks badge (shows beads panel)
   - STATE.md badge (renders in modal)
   - PRD badge (renders in modal)
   - Grayed-out state when unavailable
   - Modal/slide-over with react-markdown

### Phase 3: Planning Artifacts (Depends on Phase 1)

9. **Tracker Discussion Sync** (difficulty:medium)
   - Manual sync button in UI
   - `/api/planning/:issueId/sync-discussions` endpoint
   - GitHub API integration (pull issue comments)
   - Linear API integration (pull issue comments)
   - Convert to markdown and store in `discussions/`
   - Webhook endpoint for auto-sync (deferred: setup process)

10. **Transcript Upload UI** (difficulty:medium)
    - Drag-and-drop file upload
    - File type validation (.md, .txt)
    - Category selection (transcript/note)
    - Upload progress indicator
    - Success/error feedback
    - List of existing artifacts

### Phase 4: Shadow Engineering (Depends on Phases 1+2)

11. **Shadow Mode Toggle + Workspace Creation** (difficulty:medium)
    - Add "Shadow Engineering" mode toggle to workspace creation
    - Update workspace creation flow to initialize `.planning/INFERENCE.md`
    - Visual indicator for Shadow workspaces (distinct accent color/icon)
    - Documentation/tooltip explaining Shadow Engineering

12. **Monitoring Agent** (difficulty:expert)
    - Specialist agent implementation
    - Artifact aggregation (issue, comments, transcripts, PRs)
    - Inference Document generation
    - Gap/ambiguity detection
    - Living document updates
    - Pattern recognition in team decisions
    - Integration with planning artifacts API

13. **Observer Agent** (difficulty:expert)
    - Specialist agent implementation
    - PR polling (check for new PRs every 5 minutes)
    - Comment generation (observations, suggestions)
    - Proposal mode (requires `/shadow propose` command)
    - Progress tracking against Inference Document
    - Deviation/scope change detection
    - Pattern documentation

### Phase 5: Integration & Polish (Depends on All)

14. **Route Changes** (difficulty:simple)
    - Mission Control as default at `/`
    - Move Kanban to `/kanban`
    - Update navigation tabs in App.tsx
    - Update browser history/URL handling

15. **Cost Display Per-Feature** (difficulty:medium)
    - Integrate `useCostStream` hook
    - Aggregate costs across all agent types
    - Display in feature tree sidebar
    - Real-time updates via socket.io

16. **Model Display Per-Section** (difficulty:simple)
    - Extract model from session metadata
    - Display badge in section header
    - Use existing model display patterns from Settings

17. **Documentation Updates** (difficulty:simple)
    - Update README with Mission Control screenshots
    - Prominently describe Shadow Engineering feature
    - Update user guide with new navigation
    - Document `.planning/` directory structure
    - Add Shadow Engineering value proposition

## Socket.io Events

New events to implement:

```typescript
// Emitted by server when agent produces new output
socket.on('activity:output', (data: {
  issueId: string;
  sectionId: string;
  content: string;
}) => {
  // Append to the appropriate section
});

// Emitted when new planning artifact is detected
socket.on('planning:sync', (data: {
  issueId: string;
  artifactType: 'transcript' | 'discussion' | 'note';
  filename: string;
}) => {
  // Refetch planning artifacts
});

// Emitted when Inference Document is updated (Shadow Engineering)
socket.on('shadow:inference-update', (data: {
  issueId: string;
  content: string;
}) => {
  // Update INFERENCE.md display
});
```

## Testing Strategy

### Unit Tests
- Directory structure creation/validation
- Activity aggregation logic
- Planning artifacts API endpoints
- Markdown rendering with edge cases
- Cost aggregation calculations

### Integration Tests
- Full activity view with multiple sections
- Section isolation mode interactions
- File upload and validation
- Tracker discussion sync
- Shadow mode workspace creation

### E2E Tests
- Complete Mission Control user flow
- Feature selection and activity viewing
- Planning artifact management
- Shadow Engineering workflow
- Concurrent agent output handling

## Success Criteria

- ✅ Mission Control is the new default landing view at `/`
- ✅ Projects displayed as collapsible folders with active features inside
- ✅ Each feature shows agent status (spinner/warning), state, and cost
- ✅ Clicking a feature shows unified activity view with all agent sessions
- ✅ Activity sections are tail-anchored (no layout jitter from concurrent agents)
- ✅ Section isolation mode works (click to focus one section)
- ✅ Each section displays the model being used
- ✅ Tasks, STATE.md, and PRD badges work (grayed when unavailable)
- ✅ `.planning/` directory structure established in all workspaces
- ✅ Tracker discussions auto-synced to planning directory (on-demand + webhook)
- ✅ Transcript/note upload UI works with drag-and-drop
- ✅ Shadow Engineering mode toggle available when creating features
- ✅ Monitoring Agent produces Inference Document from artifacts
- ✅ Observer Agent comments on PRs (watch-only mode)
- ✅ Observer Agent only proposes PRs when explicitly asked (`/shadow propose`)
- ✅ UI matches Codex design language (fonts, spacing, warm minimalism)
- ✅ Existing Kanban view still accessible at `/kanban`
- ✅ README updated with Shadow Engineering feature prominently described

## Risks & Mitigations

### Risk: Codex Design Divergence
**Impact**: Design may not match Codex reference images exactly
**Mitigation**:
- Define clear design tokens upfront
- Isolate styles to Mission Control only
- Iterate on design in follow-up work

### Risk: Performance with Large Transcripts
**Impact**: Loading/rendering huge agent sessions may be slow
**Mitigation**:
- Implement virtualized scrolling for large sections
- Lazy-load section content on expansion
- Paginate very long transcripts

### Risk: Shadow Engineering Complexity
**Impact**: Monitoring + Observer agents are expert-level work
**Mitigation**:
- Start with simple implementations
- Use existing specialist infrastructure (PAN-79)
- Comprehensive testing before launch

### Risk: Tracker Webhook Setup
**Impact**: Users may not configure webhooks correctly
**Mitigation**:
- Provide clear webhook setup documentation
- Polling fallback if webhooks not configured
- Diagnostic tool to test webhook connectivity

## Open Questions

None - all clarifying questions have been answered.

## Next Steps

1. ✅ Planning session complete
2. ⏭️ Create PRD at `docs/prds/active/PAN-161-plan.md` (copy of this STATE.md)
3. ⏭️ Create beads tasks with dependencies
4. ⏭️ Hand off to implementation agent
