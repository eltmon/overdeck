---
name: code-review-performance
description: Deep performance analysis focusing on algorithms and resources
---

# Performance Review

## Algorithm Complexity
- Identify O(n^2) or worse algorithms
- Look for unnecessary iterations
- Check for opportunities to use better data structures

## Database/API Patterns
- N+1 query detection
- Missing indexes (check query patterns)
- Unbounded queries (missing LIMIT)
- Connection pool exhaustion risks

## Memory & Resources
- Memory leaks (unclosed resources)
- Unbounded caches or buffers
- Large object allocations in loops

## Concurrency
- Lock contention hotspots
- Blocking operations in async contexts
- Thread pool exhaustion

## Blocking Operations (CRITICAL for Node.js)
- **execSync/spawnSync** - These BLOCK the event loop and cause UI freezes
- Search for: `execSync`, `spawnSync`, `readFileSync` in hot paths
- **ALWAYS flag as HIGH IMPACT** - causes perceived hangs and latency spikes

**Fix pattern to recommend:**
```typescript
// Replace execSync with async version
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
const { stdout } = await execAsync('command here');
```

Common offenders in this codebase:
- `tmux capture-pane` / `tmux send-keys` / `tmux has-session`
- `git branch` / `git status` / `git log`
- `bd list` / `bd show` (beads commands)

## Output Format
For each finding:
- **Impact**: High/Medium/Low
- **Scale factor**: "At 10x load, this will..."
- **Location**: file:line
- **Suggested optimization**
