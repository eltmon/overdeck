# PAN-293: Project Living Memory

## Context

This PRD consolidates four existing memory-related issues into a single system:
- **PAN-225**: Memory extraction daemon
- **PAN-179**: Memory-aware agent spawning (context injection)
- **PAN-184**: Thinking-block learning extraction
- **PAN-182**: Continuity ledgers for agent work tracking

Research foundation: `docs/research/ai-memory-layer-research.md` (mem0 analysis)

## Problem Statement

Overdeck has **zero semantic memory**. Every agent session generates valuable learnings — debugging approaches, codebase patterns, architectural decisions — but all knowledge evaporates when the workspace is torn down. The next agent working on a similar problem starts from scratch.

| What Exists Today | Limitation |
|-------------------|------------|
| STATE.md | Destroyed on teardown |
| CLAUDE.md | Static, hand-written, never learns |
| Skills (SKILL.md) | Static, no adaptation |
| Beads | Task tracking only, no semantic content |
| PRDs | Archived, never queried semantically |
| Archives (~/.panopticon/archives/) | Never read again |

Agents repeatedly rediscover the same patterns, hit the same gotchas, and make the same mistakes — across every issue, every session.

## Solution: Project Living Memory

A **per-project memory system** that stores agent-learned knowledge alongside the codebase, accumulates across issues, and injects relevant context into future agent sessions.

### Core Principles

1. **Git-native**: Memories stored as JSONL in the repo — travel with the code, human-reviewable in PRs
2. **Per-project**: Each project has its own memory store — no cross-contamination
3. **Configurable location**: Memory path configured in `.panopticon.yaml` or `projects.yaml` — can live in the primary repo, a shared repo (like myn/infra), or a dedicated memory repo
4. **Derived index**: sqlite-vec vector index is .gitignored, rebuilt from JSONL on demand (like node_modules from package.json)
5. **Content-hash caching**: Embeddings cached by content hash — only new/changed memories re-embedded on rebuild

## Architecture

### Storage Model

```
Source of truth (git-tracked):
  {memory_path}/memories.jsonl         # Structured memories, one per line
  {memory_path}/extractions/           # Raw extraction logs (audit trail)

Derived index (.gitignored):
  {memory_path}/.index/memory.db       # sqlite-vec index, rebuilt from JSONL
```

### Memory Path Resolution

Configured per-project in `projects.yaml` or `.panopticon.yaml`:

```yaml
# projects.yaml — monorepo (memory in same repo)
projects:
  overdeck:
    memory:
      path: .panopticon/memory/        # Relative to project root

# projects.yaml — polyrepo (shared memory location)
  mind-your-now:
    memory:
      repo: infra                      # Which polyrepo sub-repo holds memory
      path: .panopticon/memory/        # Path within that repo

# .panopticon.yaml — per-project override
memory:
  path: /home/eltmon/Projects/myn/infra/.panopticon/memory/  # Absolute path
```

**Default**: `.panopticon/memory/` in the project's primary repo (or first repo for polyrepos).

### JSONL Schema

Each line in `memories.jsonl`:

```json
{
  "id": "mem_a1b2c3d4",
  "type": "PATTERN",
  "content": "All API routes use withAuth() wrapper — never call handler directly",
  "confidence": 0.8,
  "source_issue": "PAN-142",
  "source_agent": "agent-pan-142",
  "tags": ["api", "auth", "middleware"],
  "created_at": "2026-02-15T10:30:00Z",
  "last_reinforced_at": "2026-03-01T14:20:00Z",
  "reinforcement_count": 3,
  "content_hash": "sha256:abc123..."
}
```

### Memory Types

| Type | What It Captures | Example |
|------|-----------------|---------|
| PATTERN | Recurring code patterns | "All API routes use withAuth() wrapper" |
| ARCHITECTURE | Structural decisions | "Dashboard uses Socket.io, not REST polling" |
| CONSTRAINT | Hard rules (NEVER/ALWAYS) | "NEVER use execSync in dashboard server" |
| CONVENTION | Style/naming norms | "Test files use .spec.ts not .test.ts" |
| GOTCHA | Non-obvious traps | "tmux send-keys needs 300ms delay before C-m" |
| DEPENDENCY | Integration knowledge | "node-pty needs npm rebuild after Node upgrade" |

### sqlite-vec Index Schema

```sql
CREATE TABLE memory_vectors (
  id TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL UNIQUE,
  embedding BLOB NOT NULL,           -- sqlite-vec vector
  created_at TEXT NOT NULL
);

CREATE TABLE memory_metadata (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  confidence REAL DEFAULT 0.5,
  tags TEXT,                          -- JSON array
  source_issue TEXT,
  reinforcement_count INTEGER DEFAULT 0,
  last_reinforced_at TEXT,
  created_at TEXT NOT NULL
);
```

### Index Rebuild Process

Triggered on: workspace creation, `pan memory rebuild`, or when JSONL is newer than index.

```
For each line in memories.jsonl:
  1. Parse JSON
  2. Check content_hash against memory_vectors table
  3. If hash exists → skip (embedding still valid)
  4. If new/changed → call embedding API → insert into sqlite-vec
  5. Upsert metadata
```

Cost: ~$0.001 per 100 memories with text-embedding-3-small. Full rebuild is pennies.

### Confidence Lifecycle

Inspired by mem0's conflict resolution and MYN Kaia's confidence model:

| Event | Effect |
|-------|--------|
| Memory created | confidence = 0.5 (neutral) |
| Same pattern extracted again (different issue) | confidence += 0.15, reinforcement_count++ |
| Agent explicitly validates (`pan memory reinforce`) | confidence += 0.2 |
| Memory contradicted by new extraction | confidence -= 0.3, flag for review |
| No reinforcement in 90 days | confidence *= 0.9 (gradual decay) |
| confidence < 0.2 | Pruned on next `pan memory prune` |

### Conflict Resolution (on extraction)

Following mem0's pattern — LLM decides per-fact what to do:

```
For each new fact extracted:
  1. Embed fact, search existing memories (top 5 by similarity)
  2. If no similar memories → ADD (new memory)
  3. If similar memory exists with same meaning → REINFORCE (boost confidence)
  4. If similar memory exists with different/updated info → UPDATE (replace content, keep ID)
  5. If new fact contradicts existing memory → FLAG (lower confidence, create review entry)
  6. If fact is already captured → NONE (skip)
```

LLM call for conflict resolution uses cheap model (gpt-4.1-nano or haiku).

## Full Lifecycle

```
DURING SESSION (Continuity)
  Agent maintains .planning/CONTINUITY.md — live working memory
  Updated continuously: current goals, completed steps, decisions, blockers
  Survives context compaction within a session
        │
        ▼
POST-SESSION (Extraction)
  Triggered after archive, before teardown (in approve workflow)
  OR by background daemon detecting stale heartbeats
        │
  1. Read session sources:
     - .planning/CONTINUITY.md
     - .planning/STATE.md
     - .planning/feedback/*.md (specialist feedback)
     - Session transcript (if accessible)
        │
  2. LLM extraction (headless claude -p --model haiku):
     - Extract structured facts with type classification
     - Look for perception signals: "realized", "the issue was",
       "root cause", "I was wrong", "fixed by"
        │
  3. Conflict resolution against existing memories
        │
  4. Append new/updated memories to memories.jsonl
  5. Update sqlite-vec index
  6. Git commit + push the JSONL changes
        │
        ▼
AT SPAWN (Injection)
  In buildWorkAgentPrompt() — new context layer
        │
  1. Resolve project memory path from config
  2. Rebuild index if JSONL newer than .index/memory.db
  3. Embed current issue description + title
  4. Query sqlite-vec: top 15-20 memories by weighted score
     - Relevance (cosine similarity): 40%
     - Confidence: 40%
     - Recency (last_reinforced_at): 20%
  5. Format as structured section in agent prompt
  6. Inject between planning context and tracker context
```

## Implementation Plan

### Phase 1: Memory Storage & CLI Foundation

**Goal**: JSONL storage, basic CLI, manual memory management.

**Files to create/modify:**

| File | Change |
|------|--------|
| `src/lib/memory/store.ts` | NEW — JSONL read/write, memory CRUD, ID generation |
| `src/lib/memory/types.ts` | NEW — Memory, MemoryType, MemoryConfig interfaces |
| `src/lib/memory/index.ts` | NEW — Public API barrel export |
| `src/cli/commands/memory.ts` | NEW — `pan memory add/list/search/remove/prune` CLI |
| `src/lib/config.ts` | Add `memory` field to project config interface |

**CLI Commands:**
- `pan memory add "content" --type PATTERN --tags api,auth` — manual memory creation
- `pan memory list [--project <name>] [--type <type>]` — list memories
- `pan memory search <query>` — text search (FTS before vector search exists)
- `pan memory remove <id>` — remove a memory
- `pan memory prune` — remove low-confidence memories
- `pan memory stats` — count by type, avg confidence, staleness

### Phase 2: Vector Index & Semantic Search

**Goal**: sqlite-vec index, embedding pipeline, semantic retrieval.

**Files to create/modify:**

| File | Change |
|------|--------|
| `src/lib/memory/index-builder.ts` | NEW — sqlite-vec index creation, content-hash caching, incremental rebuild |
| `src/lib/memory/embeddings.ts` | NEW — Embedding API client (OpenAI text-embedding-3-small, configurable) |
| `src/lib/memory/retrieval.ts` | NEW — Weighted search (relevance + confidence + recency) |
| `src/cli/commands/memory.ts` | Add `pan memory rebuild` command |
| `package.json` | Add `sqlite-vec` dependency |

### Phase 3: Agent Prompt Injection

**Goal**: Memories injected into agent prompts at spawn time.

**Files to modify:**

| File | Change |
|------|--------|
| `src/lib/cloister/work-agent-prompt.ts` | Add `readProjectMemories()` call in dynamic context gathering (after line ~86). Query top 15-20 relevant memories, format as `## Project Memory` section. |
| `src/lib/cloister/prompts/work-agent.md` | Add `{PROJECT_MEMORY}` variable placeholder |
| `src/lib/workspace-manager.ts` | Rebuild memory index during workspace creation (after skill setup) |

**Prompt format:**
```markdown
## Project Memory (15 relevant learnings)

**PATTERNS:**
- [0.9] All API routes use withAuth() wrapper (from PAN-142, reinforced 3x)
- [0.8] Dashboard polling uses Socket.io, not REST (from PAN-78)

**CONSTRAINTS:**
- [0.95] NEVER use execSync in dashboard server code (from PAN-70, reinforced 5x)

**GOTCHAS:**
- [0.7] tmux send-keys needs 300ms delay before C-m (from PAN-34)
```

### Phase 4: Continuity Ledgers

**Goal**: Live working memory during sessions, surviving context compaction.

**Files to create/modify:**

| File | Change |
|------|--------|
| `src/lib/cloister/prompts/work-agent.md` | Add CONTINUITY.md maintenance instructions to agent prompt |
| `src/lib/memory/continuity.ts` | NEW — Continuity file read/format for prompt injection |

**Convention:**
- File: `.planning/CONTINUITY.md`
- Agent updates it continuously (prompted via work-agent.md instructions)
- Sections: Current Goals, Completed Steps, Key Decisions, Active Blockers, File Locations, Open Questions
- Read on session resume (context compaction recovery)

### Phase 5: Automated Extraction

**Goal**: Post-session extraction daemon and approve-workflow integration.

**Files to create/modify:**

| File | Change |
|------|--------|
| `src/lib/memory/extractor.ts` | NEW — LLM-based extraction from session artifacts |
| `src/lib/memory/extraction-prompt.md` | NEW — Prompt for extraction LLM |
| `src/lib/memory/conflict-resolver.ts` | NEW — ADD/REINFORCE/UPDATE/FLAG logic |
| `src/lib/memory/daemon.ts` | NEW — Background extraction daemon (polls for stale sessions) |
| `src/lib/lifecycle/workflows.ts` | Add extraction step after archiveWorkspaceArtifacts() in approve flow (line ~68) |
| `src/lib/cloister/service.ts` | Start/stop memory daemon alongside deacon |
| `src/lib/cloister/deacon.ts` | Add memory decay cron job (monthly confidence decay) |

**Extraction sources (priority order):**
1. `.planning/CONTINUITY.md` — richest structured source
2. `.planning/STATE.md` — planning decisions and status
3. `.planning/feedback/*.md` — specialist review findings
4. Session transcript JSONL (if accessible) — thinking block signals

**Daemon lifecycle:**
- Started by `pan up` (alongside cloister)
- Polls every 60 seconds for sessions with stale heartbeats (>5 min)
- Max 2 concurrent extraction processes
- Stopped by `pan down`

### Phase 6: CLAUDE.md Bootstrap & Graduation

**Goal**: One-time import of existing CLAUDE.md rules into structured memories.

**Files to create/modify:**

| File | Change |
|------|--------|
| `src/lib/memory/bootstrap.ts` | NEW — Parse CLAUDE.md into typed memories |
| `src/cli/commands/memory.ts` | Add `pan memory bootstrap` command |

**Process:**
1. Read project's CLAUDE.md
2. LLM extracts rules/patterns/constraints/gotchas
3. Each becomes a memory with high initial confidence (0.8)
4. Existing memories checked for duplicates before import
5. Human review recommended before committing

## Configuration

### projects.yaml additions

```yaml
projects:
  overdeck:
    memory:
      path: .panopticon/memory/          # Default for monorepo
      embedder: openai                    # or ollama, huggingface
      embedding_model: text-embedding-3-small
      extraction_model: haiku             # Cheap model for extraction/conflict resolution
      max_memories: 500                   # Soft cap, triggers prune warning
      decay_interval_days: 90             # Confidence decay cycle
      prune_threshold: 0.2               # Auto-prune below this confidence

  mind-your-now:
    memory:
      repo: infra                         # Polyrepo: memory lives in infra repo
      path: .panopticon/memory/
```

### .gitignore additions (in memory directory)

```
.index/
```

## Files Modified Summary

| File | Phase | Change | Difficulty |
|------|-------|--------|-----------|
| `src/lib/memory/types.ts` | 1 | NEW — interfaces and types | simple |
| `src/lib/memory/store.ts` | 1 | NEW — JSONL CRUD operations | medium |
| `src/lib/memory/index.ts` | 1 | NEW — barrel export | simple |
| `src/cli/commands/memory.ts` | 1 | NEW — CLI commands | medium |
| `src/lib/config.ts` | 1 | Add memory config to project interface | simple |
| `src/lib/memory/embeddings.ts` | 2 | NEW — embedding API client | medium |
| `src/lib/memory/index-builder.ts` | 2 | NEW — sqlite-vec index builder | hard |
| `src/lib/memory/retrieval.ts` | 2 | NEW — weighted semantic search | medium |
| `src/lib/memory/continuity.ts` | 4 | NEW — continuity file handling | simple |
| `src/lib/cloister/work-agent-prompt.ts` | 3 | Add memory context injection | medium |
| `src/lib/cloister/prompts/work-agent.md` | 3,4 | Add memory + continuity sections | medium |
| `src/lib/workspace-manager.ts` | 3 | Rebuild index on workspace create | simple |
| `src/lib/memory/extractor.ts` | 5 | NEW — LLM extraction pipeline | hard |
| `src/lib/memory/extraction-prompt.md` | 5 | NEW — extraction prompt | medium |
| `src/lib/memory/conflict-resolver.ts` | 5 | NEW — ADD/REINFORCE/UPDATE/FLAG | hard |
| `src/lib/memory/daemon.ts` | 5 | NEW — background extraction daemon | hard |
| `src/lib/lifecycle/workflows.ts` | 5 | Add extraction to approve flow | medium |
| `src/lib/cloister/service.ts` | 5 | Start/stop memory daemon | simple |
| `src/lib/cloister/deacon.ts` | 5 | Add decay cron job | simple |
| `src/lib/memory/bootstrap.ts` | 6 | NEW — CLAUDE.md import | medium |

## Dependencies (DAG)

```
Phase 1 (storage + CLI) → no dependencies, start here
  │
  ├──► Phase 2 (vector index) → depends on Phase 1
  │       │
  │       └──► Phase 3 (prompt injection) → depends on Phase 2
  │
  ├──► Phase 4 (continuity ledgers) → depends on Phase 1 (for types only)
  │       │                            Can run in parallel with Phase 2
  │       │
  │       └──► Phase 5 (automated extraction) → depends on Phase 1 + 2
  │                                              Phase 4 provides richer extraction source
  │
  └──► Phase 6 (CLAUDE.md bootstrap) → depends on Phase 1 + 2
```

## Acceptance Criteria

- [ ] `pan memory add "content" --type PATTERN` creates a memory in project JSONL
- [ ] `pan memory list` shows memories for current project
- [ ] `pan memory search <query>` returns semantically relevant memories (vector search)
- [ ] `pan memory rebuild` regenerates sqlite-vec index from JSONL
- [ ] `pan memory prune` removes memories below confidence threshold
- [ ] `pan memory bootstrap` imports CLAUDE.md rules as structured memories
- [ ] `pan memory stats` shows memory count, types, avg confidence
- [ ] Memory path configurable in `projects.yaml` (monorepo and polyrepo)
- [ ] sqlite-vec index is .gitignored, rebuilt on demand
- [ ] Content-hash caching prevents unnecessary re-embedding
- [ ] Agents receive top 15-20 relevant memories in their spawn prompt
- [ ] Memory relevance scored by: similarity (40%) + confidence (40%) + recency (20%)
- [ ] Continuity ledger instructions in agent prompt
- [ ] Post-approve extraction runs automatically (in approve workflow)
- [ ] Background daemon detects completed sessions and extracts learnings
- [ ] Conflict resolution: ADD/REINFORCE/UPDATE/FLAG per extracted fact
- [ ] Confidence lifecycle: reinforce, decay, prune
- [ ] Memories committed to git and pushed after extraction
- [ ] `npm run build` succeeds with all new modules
- [ ] All existing tests pass

## Supersedes

This PRD replaces and consolidates:
- **PAN-225** (Memory extraction daemon) — covered by Phase 5
- **PAN-179** (Memory-aware agent spawning) — covered by Phase 3
- **PAN-184** (Thinking-block learning extraction) — covered by Phase 5 extraction sources
- **PAN-182** (Continuity ledgers) — covered by Phase 4

These issues have been closed with reference to PAN-293.

## Gap Analysis — Items from Closed Issues Not Fully Covered

After reviewing all four superseded issues against this PRD, the following items were present in the original issues but not fully addressed above:

### 1. Dashboard UI Integration (from PAN-225)
PAN-225 specifies: "Dashboard shows learning count and recent extractions." This PRD has no dashboard/UI component. A future follow-up should add:
- Memory count badge in Mission Control
- Recent extractions activity feed
- Memory browser/search UI in workspace panel
- Extraction status indicator (running/idle)

### 2. FTS5 as Phase 1 Search (from PAN-225, PAN-179)
Both PAN-225 and PAN-179 propose SQLite FTS5 (full-text search) as the initial search mechanism before vector search. This PRD jumps to sqlite-vec in Phase 2. Consider: Phase 1's `pan memory search` could use simple text matching on JSONL (grep-like) as a zero-dependency fallback, with FTS5 or sqlite-vec added in Phase 2. This is implicitly handled by the phased approach but worth noting explicitly.

### 3. Session-Oriented Learning Types (from PAN-225, PAN-184)
PAN-225 defines outcome-oriented types not present in this PRD's taxonomy:
- `WORKING_SOLUTION` — "this approach solved the problem"
- `FAILED_APPROACH` — "this was tried and didn't work"
- `DEBUGGING_APPROACH` — "this debugging strategy was effective"
- `ERROR_FIX` — "this specific error was fixed by..."

The PRD's types (PATTERN, ARCHITECTURE, CONSTRAINT, CONVENTION, GOTCHA, DEPENDENCY) are knowledge-oriented. Both taxonomies are valuable. The extraction LLM should be instructed to capture both — the outcome types are especially useful for preventing agents from repeating failed approaches. **Recommendation**: Add SOLUTION and FAILED_APPROACH to the type enum.

### 4. Specific Thinking-Block Perception Signals (from PAN-184)
PAN-184 lists specific signal patterns to look for in Claude's thinking blocks:
- Realizations: "actually", "realized", "the issue was"
- Corrections: "I was wrong", "that's not right"
- Debugging insights: "the root cause", "fixed by"

These should be documented in the extraction prompt (`extraction-prompt.md` in Phase 5) as heuristics for identifying high-value content.

### 5. Explicit Deduplication Threshold (from PAN-225)
PAN-225 specifies: "Skip if >85% similar to an existing entry." The PRD's conflict resolution covers this conceptually (REINFORCE if same meaning) but doesn't specify a concrete similarity threshold. The extraction implementation should define a cosine similarity threshold (e.g., 0.85) for the REINFORCE vs ADD decision.

---

## References

- **Research**: `docs/research/ai-memory-layer-research.md` — mem0 analysis and adoption strategy
- **mem0 clone**: `/home/eltmon/Projects/mem0` — reference implementation
- **mem0 paper**: [arXiv 2504.19413](https://arxiv.org/abs/2504.19413)
- **sqlite-vec**: [github.com/asg017/sqlite-vec](https://github.com/asg017/sqlite-vec)
- **Agent prompt**: `src/lib/cloister/work-agent-prompt.ts`
- **Approve workflow**: `src/lib/lifecycle/workflows.ts`
- **Cloister service**: `src/lib/cloister/service.ts`
- **Existing SQLite pattern**: `src/lib/cloister/database.ts`
