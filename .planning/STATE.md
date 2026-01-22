# PAN-32: Cloister Phase 5 - Remaining Specialist Agents

## Current Status (2026-01-22) - COMPLETE ✓

**All Phases Complete:**
- ✓ Phase A: Review Agent (review-agent.ts, prompt template)
- ✓ Phase B: Test Agent (test-agent.ts, prompt template, multi-runner detection)
- ✓ Phase C: Queue Integration (queue helpers in specialists.ts)
- ✓ Phase D: CLI Commands (list, wake, queue, reset commands)
- ✓ Phase E: Testing (E2E tests, multi-runner tests)

**Test Results:**
- ✓ 21/21 multi-runner detection tests passing
- ✓ 10 E2E workflow tests created (skipped for CI)

**Latest Commits:**
- b6a5a3d - test: add comprehensive test suites for specialist agents (PAN-32)
- 3dd8cdd - feat: implement specialists CLI commands (PAN-32)

---

## Issue Summary

Implement the remaining specialist agents (review-agent, test-agent) and specialist queue system. These build on the merge-agent pattern established in PAN-29.

**Note:** planning-agent is NOT needed - existing planning workflow (human + Claude session) is sufficient.

## Key Decisions

### 1. Scope Boundaries

**In Scope:**
- review-agent (Sonnet) - Code review, security checks, approve/reject PRs
- test-agent (Haiku) - Run tests, report failures, simple fixes
- Specialist queues (review queue, merge queue)
- Worker agent integration (submit to queues)

**Out of Scope:**
- planning-agent (existing planning workflow sufficient)
- GitHub webhooks (worker agents submit directly to queues)
- External PR handling (only Panopticon-created PRs for now)

**Future Work (file GitHub issues):**
- Select external PRs from repo for merge
- Multiple merge agents per repo

### 2. Review Agent

**Model:** Sonnet

**Trigger:** Worker agent submits PR to review queue

**Responsibilities:**
- Code review for correctness, security, performance
- OWASP top 10 vulnerability checks
- Suggest improvements
- **Full GitHub authority:** Can approve, request changes, or comment

**Queue Behavior:**
- Uses existing GUPP hooks system
- Processes one PR at a time
- Worker agents call `pushToHook('review-agent', { type: 'task', payload: { prUrl, issueId } })`

**Output Markers:**
```
REVIEW_RESULT: APPROVED | CHANGES_REQUESTED | COMMENTED
FILES_REVIEWED: file1.ts, file2.ts
SECURITY_ISSUES: none | issue1, issue2
PERFORMANCE_ISSUES: none | issue1, issue2
NOTES: Brief summary
```

### 3. Test Agent

**Model:** Haiku

**Trigger:** Worker agent or review-agent requests test run

**Responsibilities:**
- Detect test runner (multi-runner support)
- Run full test suite
- Analyze failures
- Fix simple issues (< 5 min fix)
- Report results

**Test Runner Detection (priority order):**
1. Check `cloister.toml` for explicit `test_command` config
2. Detect from package.json `scripts.test` (npm/yarn)
3. Detect from file patterns:
   - `jest.config.*` → `npm test` or `npx jest`
   - `vitest.config.*` → `npm test` or `npx vitest`
   - `pytest.ini`, `pyproject.toml [tool.pytest]` → `pytest`
   - `Cargo.toml` → `cargo test`
   - `pom.xml` → `mvn test`
   - `go.mod` → `go test ./...`

**Configuration Override:**
```toml
# ~/.panopticon/cloister.toml
[specialists.test-agent]
enabled = true
model = "haiku"
test_command = "npm test"  # Optional override
```

**Output Markers:**
```
TEST_RESULT: PASS | FAIL | ERROR
TESTS_RUN: 42
TESTS_PASSED: 40
TESTS_FAILED: 2
FAILURES:
- test/foo.spec.ts: should handle edge case - AssertionError
- test/bar.spec.ts: integration test - timeout
FIX_ATTEMPTED: true | false
FIX_RESULT: SUCCESS | FAILED | NOT_ATTEMPTED
NOTES: Brief summary
```

### 4. Specialist Queue System

**Decision:** Extend existing GUPP hooks system for specialist queues

**Queue Locations:**
- Review queue: `~/.panopticon/agents/review-agent/hook.json`
- Merge queue: `~/.panopticon/agents/merge-agent/hook.json`

**Queue Item Schema:**
```typescript
interface SpecialistQueueItem extends HookItem {
  type: 'task';
  priority: 'urgent' | 'high' | 'normal' | 'low';
  source: string;  // e.g., "agent-pan-42"
  payload: {
    prUrl: string;
    issueId: string;
    workspace: string;
    branch: string;
    filesChanged?: string[];
    context?: Record<string, any>;
  };
}
```

**Processing:**
- Specialists wake, check queue via `checkHook()`
- Process one item at a time
- Pop item after completion via `popFromHook()`
- Submit to next specialist queue if needed (review → merge)

### 5. Worker Agent Integration

**Flow:**
1. Worker agent completes implementation
2. Worker creates PR
3. Worker submits to review queue: `pushToHook('review-agent', { ... })`
4. Review agent wakes, reviews, approves/rejects
5. If approved, review agent submits to merge queue
6. Merge agent wakes, merges, handles CI

**Worker Agent Prompt Addition:**
```markdown
## PR Workflow

After creating a PR:
1. Submit to review queue:
   Use the hooks system to notify review-agent
2. Wait for review result
3. Address any requested changes
4. Once approved, PR will be auto-queued for merge
```

### 6. CLI Commands

**New Commands:**
```bash
# Wake a specialist manually (for testing/debugging)
pan specialists wake <name> [--task "description"]

# Check specialist queue
pan specialists queue <name>

# List all specialists with status
pan specialists list

# Reset a specialist (clear session, start fresh)
pan specialists reset <name>
```

### 7. Session Management

**Session Files:**
- `~/.panopticon/specialists/review-agent.session`
- `~/.panopticon/specialists/test-agent.session`

**Resume Pattern:**
```typescript
const sessionId = getSessionId('review-agent');
if (sessionId) {
  spawn('claude', ['--model', 'sonnet', '--resume', sessionId, '-p', taskPrompt]);
} else {
  // Fresh start, will capture new sessionId
  spawn('claude', ['--model', 'sonnet', '-p', initPrompt + taskPrompt]);
}
```

## Architecture

### Component Relationships

```
┌─────────────────────────────────────────────────────────────────┐
│                      Worker Agents                               │
│  (agent-pan-42, agent-pan-43, ...)                              │
└───────────────────────────┬─────────────────────────────────────┘
                            │ pushToHook('review-agent', ...)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Review Queue                                  │
│  ~/.panopticon/agents/review-agent/hook.json                    │
└───────────────────────────┬─────────────────────────────────────┘
                            │ checkHook() → process → popFromHook()
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    review-agent (Sonnet)                        │
│  - Code review, security, performance                           │
│  - Full GitHub authority                                        │
│  - Session: ~/.panopticon/specialists/review-agent.session      │
└───────────────────────────┬─────────────────────────────────────┘
                            │ If approved: pushToHook('merge-agent', ...)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Merge Queue                                   │
│  ~/.panopticon/agents/merge-agent/hook.json                     │
└───────────────────────────┬─────────────────────────────────────┘
                            │ checkHook() → process → popFromHook()
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    merge-agent (Sonnet)                         │
│  - Already implemented (PAN-29)                                 │
│  - Merge, conflict resolution, CI handling                      │
└─────────────────────────────────────────────────────────────────┘
```

### File Structure

```
src/lib/cloister/
├── specialists.ts         # Existing - extend with queue helpers
├── merge-agent.ts         # Existing - PAN-29
├── review-agent.ts        # NEW - review specialist
├── test-agent.ts          # NEW - test specialist
└── prompts/
    ├── merge-agent.md     # Existing
    ├── review-agent.md    # NEW
    └── test-agent.md      # NEW

src/cli/commands/specialists/
├── index.ts               # NEW - pan specialists subcommands
├── wake.ts                # NEW - pan specialists wake
├── queue.ts               # NEW - pan specialists queue
├── list.ts                # NEW - pan specialists list
└── reset.ts               # NEW - pan specialists reset
```

### Files to Modify

```
src/lib/cloister/specialists.ts   # Add review-agent, test-agent to registry
src/lib/cloister/config.ts        # Add test_command config option
src/lib/hooks.ts                  # May need specialist-specific helpers
src/cli/commands/index.ts         # Register specialists subcommand
```

## Implementation Order

### Phase A: Review Agent

1. Create `prompts/review-agent.md` - prompt template
2. Create `review-agent.ts` following merge-agent pattern
3. Add review-agent to DEFAULT_SPECIALISTS in specialists.ts
4. Test manual wake with sample PR

### Phase B: Test Agent

5. Create `prompts/test-agent.md` - prompt template
6. Create `test-agent.ts` with multi-runner detection
7. Add test_command config to cloister.toml schema
8. Add test-agent to DEFAULT_SPECIALISTS
9. Test manual wake with sample workspace

### Phase C: Queue Integration

10. Add queue-related helpers to specialists.ts
11. Update hooks.ts if needed for specialist-specific behavior
12. Create worker agent integration guide/prompt additions

### Phase D: CLI Commands

13. Create specialists subcommand structure
14. Implement `pan specialists list`
15. Implement `pan specialists wake`
16. Implement `pan specialists queue`
17. Implement `pan specialists reset`

### Phase E: Testing & Documentation

18. E2E test: worker → review → merge flow
19. Test multi-runner detection
20. Update documentation

## Beads Tasks

| ID | Title | Phase | Blocked By | Complexity |
|----|-------|-------|------------|------------|
| pan32-01 | Create review-agent prompt template | A | - | simple |
| pan32-02 | Implement review-agent.ts following merge-agent pattern | A | pan32-01 | medium |
| pan32-03 | Add review-agent to specialist registry | A | pan32-02 | trivial |
| pan32-04 | Create test-agent prompt template | B | - | simple |
| pan32-05 | Implement test-agent.ts with multi-runner detection | B | pan32-04 | medium |
| pan32-06 | Add test_command config option to cloister.toml | B | - | trivial |
| pan32-07 | Add test-agent to specialist registry | B | pan32-05 | trivial |
| pan32-08 | Add queue helpers to specialists.ts | C | pan32-03, pan32-07 | simple |
| pan32-09 | Document worker agent PR submission workflow | C | pan32-08 | simple |
| pan32-10 | Create specialists CLI subcommand structure | D | - | simple |
| pan32-11 | Implement pan specialists list | D | pan32-10 | simple |
| pan32-12 | Implement pan specialists wake | D | pan32-10, pan32-03, pan32-07 | simple |
| pan32-13 | Implement pan specialists queue | D | pan32-10, pan32-08 | simple |
| pan32-14 | Implement pan specialists reset | D | pan32-10 | simple |
| pan32-15 | E2E test: worker → review → merge flow | E | pan32-08 | medium |
| pan32-16 | Test multi-runner detection in test-agent | E | pan32-05 | simple |
| pan32-17 | File GitHub issue: external PR selection | E | - | trivial |
| pan32-18 | File GitHub issue: multiple merge agents per repo | E | - | trivial |

## Success Criteria

1. review-agent can wake, review a PR, and approve/request changes on GitHub
2. test-agent can detect and run tests for npm, pytest, cargo projects
3. test_command config in cloister.toml overrides auto-detection
4. Specialist queues work (one item at a time, FIFO)
5. Worker agents can submit to review queue
6. Approved PRs auto-queue for merge
7. CLI commands work: list, wake, queue, reset
8. Existing merge-agent continues working
9. Session persistence works (--resume preserves context)

## Open Questions (Resolved)

1. **Webhooks needed?** → No, worker agents submit directly
2. **Test runner detection?** → Multi-runner with config override
3. **Planning-agent?** → NOT needed, skip
4. **Review authority?** → Full authority (approve/reject)
5. **Queue processing?** → One at a time, use existing GUPP hooks

## References

- PRD-CLOISTER.md lines 16-47 (Agent Taxonomy)
- PRD-CLOISTER.md lines 1411-1421 (Phase 5 tasks)
- merge-agent.ts - Pattern to follow
- hooks.ts - GUPP queue system
- specialists.ts - Registry management
