# AI Memory Layer Research: mem0 and Adoption Strategy for Panopticon

**Date**: 2026-03-02
**Status**: Research Complete
**Related**: Future PRD for project-scoped agent memory

---

## 1. mem0 Overview

[mem0](https://github.com/mem0ai/mem0) is an open-source (Apache 2.0) persistent memory layer for AI applications. It sits between your application and LLM, extracting facts from conversations, storing them in a hybrid datastore, and retrieving relevant memories for future interactions.

- **Y Combinator S24**, raised $24M (Oct 2025)
- **Version**: 1.0.4
- **SDKs**: Python (`pip install mem0ai`), TypeScript (`npm install mem0ai`)
- **License**: Apache 2.0 (fully functional self-hosted, zero feature gating)

### The Core Problem It Solves

LLMs are stateless. Every session starts from scratch. mem0 compresses conversation history into optimized memory representations, then retrieves only what's relevant — cutting token usage by ~90% while preserving context fidelity.

---

## 2. Architecture

### Hybrid Datastore (Three Layers)

```
APPLICATION LAYER
  Memory.add / search / update / delete
         |
PROCESSING LAYER
  Embedder (OpenAI, Ollama, HF, etc.)
  LLM (OpenAI, Claude, Groq, etc.)
  Reranker (Cohere, Sentence Transformer, etc.)
         |
DATA PERSISTENCE LAYER
  Vector Store (20+: Qdrant, Pinecone, Chroma, PgVector, Redis, etc.)
  Graph Store (optional: Neo4j, Memgraph, Neptune, Kuzu)
  History DB (SQLite — audit trail of add/update/delete events)
```

### Memory Processing Pipeline (on `add()`)

1. **Fact Extraction (LLM Call #1)**: Messages sent to LLM with FACT_RETRIEVAL_PROMPT. Extracts structured facts: `{"facts": ["fact1", "fact2", ...]}`. Separate prompts for user vs assistant memory extraction.

2. **Vector Store Search**: Each new fact is embedded and searched against existing memories (top 5 by cosine similarity).

3. **Conflict Resolution (LLM Call #2)**: Combined prompt with current memories + new facts. LLM decides per-memory: `ADD`, `UPDATE`, `DELETE`, or `NONE`. Returns JSON with memory IDs and actions. Handles UUID hallucinations with temp ID mapping.

4. **Execute Operations**: ADD creates embedding + inserts; UPDATE re-embeds + updates payload; DELETE removes; NONE updates session IDs only. Vector + graph operations run in parallel via ThreadPoolExecutor.

### Memory Scopes

- **user_id**: Persists across all sessions for a given user
- **agent_id**: Per-agent memories (agent learns its own patterns)
- **run_id**: Per-session ephemeral memories

### Search Pipeline

1. Embed query
2. Vector similarity search with metadata filters
3. Optional graph search (entity relationships)
4. Optional reranking (Cohere, SentenceTransformer, LLM-based)
5. Return scored results

---

## 3. Key Technical Details

### Default LLM

`gpt-4.1-nano-2025-04-14` (OpenAI) — tiny, fast, cheap. Used for both fact extraction and conflict resolution. Configurable to any provider.

### Memory Types

Untyped — just text blobs with metadata payloads:
```python
{
  "data": "memory text",
  "hash": "md5 of text",
  "created_at": "ISO timestamp",
  "updated_at": "ISO timestamp",
  "user_id": "user123",
  "agent_id": "agent456",
  "run_id": "run789",
  "custom_metadata": {...}
}
```

No confidence scoring, no lifecycle management, no decay.

### Graph Memory (Optional)

Extracts entities and relationships from memories. Enables structured reasoning and multi-hop queries. Configurable graph relationship sensitivity and strength via threshold settings (0.0-1.0).

### Self-Hosted Server

FastAPI REST server at `/server/main.py`. Endpoints: `/configure`, `/memories` (POST/GET), `/memories/{id}`, `/search`. No built-in authentication — deploy behind a gateway.

### Smart Proxy Pattern

```python
class Mem0:
    def __init__(self, config=None, api_key=None):
        if api_key:
            self.mem0_client = MemoryClient(api_key)  # Cloud
        else:
            self.mem0_client = Memory.from_config(config)  # Self-hosted
```

---

## 4. Managed Platform vs Open Source

The open-source code is **fully functional** with zero feature gating. The paid tiers are for their managed platform (`api.mem0.ai`):

| Tier | Price | Limits |
|------|-------|--------|
| Hobby | Free | 10K memories, 1K retrieval/month |
| Starter | $19/mo | 50K memories |
| Pro | $249/mo | Unlimited, graph memory, analytics |
| Enterprise | Custom | On-prem, SOC 2, HIPAA, BYOK, SSO |

**What you pay for**: Infrastructure management, quotas/rate-limiting, multi-tenant isolation, compliance certifications, analytics dashboard. Graph memory is paywalled on platform Pro tier but fully available in OSS.

---

## 5. Performance Claims

- 26% accuracy improvement over OpenAI memory (LLM-as-Judge)
- 91% reduction in p95 latency vs full-context approaches
- 90% token reduction (~1.8K tokens/conversation vs 26K for full context)
- Sub-50ms retrieval latency

---

## 6. Panopticon Adoption Analysis

### The Gap Today

Panopticon has **zero semantic memory**. Agent knowledge dies with workspace teardown:

| What Exists | What It Is | Limitation |
|-------------|-----------|------------|
| STATE.md | Per-workspace planning state | Destroyed on teardown |
| CLAUDE.md | Static project rules | Hand-written, never learns |
| Skills (SKILL.md) | Shared knowledge docs | Static, no adaptation |
| Beads | Task tracking | No semantic content |
| PRDs | Requirements | Archived, never queried semantically |
| Archives | Post-completion snapshots | Never read again |
| cloister.db | Health events only | No knowledge storage |

### Proposed: Project-Scoped Agent Memory

Each Panopticon **project** gets a semantic memory store. Agents read from and write to it. Knowledge accumulates across issues.

#### Storage Options

**Option A: sqlite-vec (full vector search)**
```sql
CREATE TABLE project_memory (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL,  -- PATTERN, ARCHITECTURE, CONSTRAINT, CONVENTION, GOTCHA, DEPENDENCY
  content TEXT NOT NULL,
  confidence REAL DEFAULT 0.5,
  embedding BLOB,
  source_issue TEXT,
  source_agent TEXT,
  created_at TEXT,
  last_reinforced_at TEXT,
  reinforcement_count INTEGER DEFAULT 0,
  tags TEXT  -- JSON array
);
```
- Uses sqlite-vec extension (production-grade, zero-setup)
- Full semantic search capability
- Requires embedding API calls

**Option B: JSONL export + git sharing (pragmatic)**
```
docs/memory/project-memories.jsonl
```
- Each line: `{"id":"...","content":"...","type":"...","confidence":0.8,"tags":[...]}`
- Embeddings NOT stored — regenerated on import
- Git-native, human-readable
- No new dependencies

**Option C: Structured markdown (simplest)**
```
docs/memory/PROJECT_MEMORY.md
```
- Skip embeddings entirely
- Agents update it; git merge handles conflicts
- What CLAUDE.md already partially does — with structure and lifecycle

#### Recommended Approach

Start with **Option C** (structured markdown with confidence annotations), graduate to **Option B** (JSONL + sqlite-vec) when memory count exceeds prompt capacity (~50-100 memories).

#### Memory Types for Code Projects

| Type | What It Captures | Example |
|------|-----------------|---------|
| PATTERN | Recurring code patterns | "All API routes use withAuth() wrapper" |
| ARCHITECTURE | Structural decisions | "Dashboard uses Socket.io, not REST polling" |
| CONSTRAINT | Hard rules | "NEVER use execSync in dashboard server" |
| CONVENTION | Style/naming norms | "Test files use .spec.ts not .test.ts" |
| GOTCHA | Non-obvious traps | "tmux send-keys needs 300ms delay before C-m" |
| DEPENDENCY | Integration knowledge | "node-pty needs npm rebuild after Node upgrade" |

#### Extraction Triggers

1. **Post-merge extraction**: After issue merged, LLM reviews STATE.md + diff → extracts learnings
2. **Specialist feedback**: Review agents discover patterns → extract from feedback files
3. **CLAUDE.md bootstrap**: One-time parse of existing CLAUDE.md into structured memories
4. **Explicit agent writes**: Agent calls `pan memory add "..."` during work

#### Retrieval

During `buildWorkAgentPrompt()`, add new context layer. Embed current issue description, find top 15-20 relevant memories via weighted scoring (confidence x 0.4 + relevance x 0.4 + recency x 0.2), inject as formatted section.

#### Git Distribution

The hard constraint: Panopticon shares everything via git.

- **Markdown memories**: Native to git, zero friction
- **JSONL export**: Git-trackable, embed at `docs/memory/`, agents on remote VMs get it via git pull
- **sqlite-vec DB**: NOT git-friendly (binary), would need JSONL sidecar for distribution
- Conflict resolution: last-write-wins per ID, or merge by content hash

### Key Patterns to Steal

| From | Pattern | Value |
|------|---------|-------|
| **mem0** | LLM-driven conflict resolution (ADD/UPDATE/DELETE/NONE per fact) | Prevents stale/contradictory memories |
| **mem0** | Triple scoping (user/agent/run) | Maps to project/agent/issue |
| **Kaia (MYN)** | Confidence lifecycle (reinforce/contradict/decay/prune) | Memories self-maintain quality |
| **Kaia (MYN)** | Weighted retrieval scoring (confidence + relevance + recency) | Better than pure similarity |
| **Kaia (MYN)** | Multi-signal extraction (conversations, compass, goals) | Multiple triggers, not just conversation |

---

## 7. References

- [mem0 GitHub](https://github.com/mem0ai/mem0)
- [mem0 Documentation](https://docs.mem0.ai)
- [mem0 Research Paper (arXiv 2504.19413)](https://arxiv.org/abs/2504.19413)
- [sqlite-vec](https://github.com/asg017/sqlite-vec)
- Local clone: `/home/eltmon/Projects/mem0`
