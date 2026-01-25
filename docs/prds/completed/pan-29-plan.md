# PAN-29: Implement merge-agent - Automatic Merge Conflict Resolution

## Issue Summary

When clicking "Approve & Merge" on an issue with merge conflicts, Panopticon currently shows a manual resolution message. This issue implements the `merge-agent` specialist to automatically resolve conflicts using Claude Code.

## Key Decisions

### 1. Working Directory
**Decision:** Main project directory

merge-agent works directly in the project root, not in the workspace. This matches the manual workflow and is simpler to implement.

### 2. Failure Handling
**Decision:** Notify user only

If merge-agent fails to resolve conflicts:
1. Abort the merge attempt
2. Report which files/conflicts failed
3. User resolves manually

No automatic escalation to Opus or alternative approaches.

### 3. Session Mode
**Decision:** Persistent session with `--resume`

merge-agent maintains a single persistent Claude session ID stored in `~/.panopticon/specialists/merge-agent.session`. This allows:
- Context accumulation across merges (learns project patterns)
- More efficient token usage via context caching
- Session rotation when context gets too large (manual for MVP)

### 4. Scope
**Decision:** MVP - merge-agent only

Focus solely on merge conflict resolution. Other specialists (review-agent, test-agent) remain as UI-only scaffolding for future issues.

### 5. Progress Reporting
**Decision:** Both dashboard activity log + API result

- Real-time progress streams to dashboard activity log
- Final result returned via API response (success/failure + details)

### 6. Test Running
**Decision:** Yes - run tests after resolution

After resolving conflicts, merge-agent runs the project's test suite to verify the merge didn't break anything. If tests fail, the merge is aborted.

### 7. Timeout
**Decision:** 15 minutes

merge-agent has 15 minutes to complete conflict resolution + tests before being considered stuck.

## Scope

### In Scope (PAN-29)

**Integration Layer:**
- [ ] Modify approve API to detect conflicts and delegate to merge-agent
- [ ] Add `MergeConflictContext` type with branch info, conflict files
- [ ] Implement `spawnMergeAgent()` function

**Agent Layer:**
- [ ] Create merge-agent prompt template
- [ ] Implement agent spawning with `--resume` support
- [ ] Implement result polling/streaming
- [ ] Handle success flow (complete merge, push, continue)
- [ ] Handle failure flow (abort, report, cleanup)

**Persistence:**
- [ ] Session ID storage in `~/.panopticon/specialists/merge-agent.session`
- [ ] Merge history in `~/.panopticon/specialists/merge-agent/history.jsonl`

**Dashboard:**
- [ ] Modify approve flow to show "Resolving conflicts..." status
- [ ] Stream merge-agent progress to activity log
- [ ] Update agent list to show merge-agent as active during resolution

### Out of Scope

- CLI commands (`pan specialist wake/list/reset`) - future issue
- review-agent implementation - future issue
- test-agent implementation - future issue
- Automatic escalation to Opus on failure - future enhancement
- Session rotation based on context size - future enhancement
- Multi-project specialist sharing - future enhancement

## Architecture

### Files to Create/Modify

```
src/lib/cloister/
├── specialists.ts          # (existing) - minor updates
├── merge-agent.ts          # NEW - merge-agent logic
└── prompts/
    └── merge-agent.md      # NEW - prompt template

src/dashboard/server/
└── index.ts                # MODIFY - integrate merge-agent in approve flow
```

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Approve Flow with merge-agent                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  POST /api/approve                                               │
│         │                                                        │
│         ▼                                                        │
│  git merge feature-branch                                        │
│         │                                                        │
│         ├── Success ──► Push to main ──► Update Linear ──► Done │
│         │                                                        │
│         └── Conflict detected                                    │
│                  │                                               │
│                  ▼                                               │
│         git merge --abort                                        │
│                  │                                               │
│                  ▼                                               │
│         spawnMergeAgent({                                        │
│           projectPath,                                           │
│           sourceBranch,                                          │
│           targetBranch,                                          │
│           conflictFiles                                          │
│         })                                                       │
│                  │                                               │
│                  ▼                                               │
│         ┌────────────────────────────────────────┐               │
│         │        merge-agent (Claude)             │              │
│         │  1. Analyze conflict files              │              │
│         │  2. Understand both change intents      │              │
│         │  3. Resolve conflicts                   │              │
│         │  4. Run tests                           │              │
│         │  5. Stage and commit merge              │              │
│         └────────────────────────────────────────┘               │
│                  │                                               │
│                  ├── Success                                     │
│                  │      │                                        │
│                  │      ▼                                        │
│                  │   Push to main ──► Update Linear ──► Done     │
│                  │                                               │
│                  └── Failure                                     │
│                         │                                        │
│                         ▼                                        │
│                  Return error with details                       │
│                  (files that failed, reason)                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### merge-agent Prompt Structure

```markdown
You are a merge conflict resolution specialist.

## Context
- Project: {projectPath}
- Target branch: main
- Source branch: {sourceBranch}
- Conflict files: {conflictFiles}
- Issue: {issueId}

## Your Task
Resolve the merge conflicts and verify the result.

## Instructions
1. Analyze each conflict file to understand both versions
2. Resolve conflicts by:
   - Preserving the intent of both changes when possible
   - If incompatible, prefer the feature branch changes (they're newer)
   - Keep code style consistent with the project
3. Run the test suite: {testCommand}
4. If tests pass, stage all resolved files
5. Complete the merge commit

## Constraints
- Do NOT create new commits beyond the merge commit
- Do NOT modify files that don't have conflicts
- Do NOT push to remote (the caller handles that)

## When Done
Report your results in this format:
MERGE_RESULT: SUCCESS|FAILURE
RESOLVED_FILES: file1.ts, file2.ts
FAILED_FILES: (if any)
TESTS: PASS|FAIL|SKIP
NOTES: (any important observations)
```

### Success/Failure Detection

Parse agent output for structured result markers:
- `MERGE_RESULT: SUCCESS` + `TESTS: PASS` → Continue with push
- `MERGE_RESULT: FAILURE` → Abort, report failure
- Timeout (15 min) → Kill agent, abort, report timeout

## Implementation Order

### Layer 1: Agent Infrastructure
1. Create merge-agent prompt template
2. Implement `spawnMergeAgent()` with --resume support
3. Implement result parsing from agent output

### Layer 2: Integration
4. Modify approve API to detect conflicts
5. Integrate merge-agent spawning on conflict
6. Handle success/failure flows
7. Stream progress to activity log

### Layer 3: Polish
8. Add merge history logging
9. Update dashboard to show merge-agent status
10. Error handling and edge cases

## Beads Tasks

| ID | Title | Layer | Blocked By |
|----|-------|-------|------------|
| panopticon-m01 | Create merge-agent prompt template | 1 | - |
| panopticon-m02 | Implement spawnMergeAgent with --resume | 1 | - |
| panopticon-m03 | Implement result parsing | 1 | m02 |
| panopticon-m04 | Modify approve API to detect conflicts | 2 | - |
| panopticon-m05 | Integrate merge-agent in approve flow | 2 | m02, m03, m04 |
| panopticon-m06 | Handle success flow (push, continue) | 2 | m05 |
| panopticon-m07 | Handle failure flow (abort, report) | 2 | m05 |
| panopticon-m08 | Add merge history logging | 3 | m06, m07 |
| panopticon-m09 | Update dashboard for merge-agent status | 3 | m05 |
| panopticon-m10 | Edge cases and error handling | 3 | m06, m07 |

## Technical Notes

### Claude Code Spawning

```typescript
import { execSync, spawn } from 'child_process';

interface MergeAgentConfig {
  projectPath: string;
  sourceBranch: string;
  targetBranch: string;
  conflictFiles: string[];
  issueId: string;
  testCommand: string;
}

async function spawnMergeAgent(config: MergeAgentConfig): Promise<MergeResult> {
  const sessionFile = `${SPECIALISTS_DIR}/merge-agent.session`;
  const sessionId = existsSync(sessionFile)
    ? readFileSync(sessionFile, 'utf-8').trim()
    : null;

  const prompt = buildMergePrompt(config);

  // Build command
  const args = ['--model', 'sonnet', '--print', '-p', prompt];
  if (sessionId) {
    args.push('--resume', sessionId);
  }

  // Spawn in project directory
  const proc = spawn('claude', args, {
    cwd: config.projectPath,
    env: { ...process.env, PANOPTICON_AGENT_ID: 'merge-agent' }
  });

  // Capture output, look for MERGE_RESULT markers
  // ...
}
```

### Session ID Capture

After first run (no --resume), capture session ID from Claude's output or from the JSONL session file created.

### Test Command Detection

Detect test command from package.json, pom.xml, Cargo.toml, etc.:
- `npm test` / `yarn test` for Node.js
- `mvn test` for Java
- `cargo test` for Rust
- `pytest` for Python

Fallback: skip tests if unknown.

### Timeout Implementation

```typescript
const MERGE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

const timeoutPromise = new Promise((_, reject) =>
  setTimeout(() => reject(new Error('merge-agent timeout')), MERGE_TIMEOUT_MS)
);

const result = await Promise.race([
  runMergeAgent(config),
  timeoutPromise
]);
```

## Open Questions

None - all decisions captured above.

## References

- PRD: `/home/eltmon/projects/panopticon/docs/PRD-CLOISTER.md` (Phase 5: Specialist Agents)
- Specialist infrastructure: `/home/eltmon/projects/panopticon/src/lib/cloister/specialists.ts`
- Approve API: `/home/eltmon/projects/panopticon/src/dashboard/server/index.ts` (line ~2765)
- GitHub Issue: https://github.com/eltmon/panopticon-cli/issues/29
