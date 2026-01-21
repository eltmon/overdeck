# Cloister: Agent Watchdog Framework

> *"The Cloister Bell only rings when something catastrophic is about to happen."*

## Overview

Cloister is Panopticon's agent monitoring and emergency control system. Named after the TARDIS's emergency alarm, Cloister watches over all running agents, detects stuck or failing agents, and provides emergency stop capabilities.

## Goals

1. **Detect stuck agents** - Identify agents that have stopped making progress
2. **Prevent runaway costs** - Kill agents burning tokens without progress
3. **Enable overnight runs** - "Set it and forget it" with confidence
4. **Provide emergency control** - One-click stop for all agents

## Agent Taxonomy

### Specialist Agents (Permanent)

Long-lived agents with persistent session IDs. Sleep until triggered, wake with `--resume` to maintain context.

| Agent | Trigger | Responsibility |
|-------|---------|----------------|
| `merge-agent` | PR approved | Resolve conflicts, merge PRs, handle CI failures |
| `review-agent` | PR opened | Code review, security checks, suggest changes |
| `test-agent` | Push to branch | Run test suites, report failures |

**Characteristics:**
- Persistent session ID stored in `~/.panopticon/specialists/<name>.session`
- Accumulate context over time (merge patterns, project knowledge)
- Never truly "die" - just sleep between tasks
- Session rotation when context gets too large

### Issue Agents (Ephemeral)

Short-lived agents spawned for specific Linear issues. Die when work is complete.

| Naming | Example | Lifecycle |
|--------|---------|-----------|
| `agent-<issue-id>` | `agent-pan-18` | Spawn → Work → PR → Die |

**Characteristics:**
- Created by `/work-issue` command
- Run in tmux sessions
- Workspace in `workspaces/feature-<issue-id>/`
- Terminated after PR merged or manually killed

## Model Selection & Task Handoff

Cloister intelligently routes tasks to the most cost-effective model based on task complexity. As work progresses through beads, tasks can be handed off between models.

### Model Tiers

| Tier | Model | Cost | Best For |
|------|-------|------|----------|
| 💎 **Opus** | claude-opus-4 | $$$$$ | Architecture, complex debugging, planning, ambiguous requirements |
| 🔷 **Sonnet** | claude-sonnet-4 | $$$ | Feature implementation, bug fixes, code review, most development work |
| 💠 **Haiku** | claude-haiku-3.5 | $ | Tests, simple fixes, formatting, docs, repetitive tasks |

**Cost ratio:** Opus is ~15x more expensive than Haiku, Sonnet is ~5x more expensive than Haiku.

### Task Complexity Classification

Tasks in beads can have a `complexity` field:

```json
{
  "id": "pan-1a2",
  "title": "Implement Cloister heartbeat monitor",
  "complexity": "medium",
  "suggested_model": "sonnet",
  "tags": ["feature", "cloister"]
}
```

| Complexity | Model | Examples |
|------------|-------|----------|
| `trivial` | Haiku | Fix typo, update version, add comment |
| `simple` | Haiku | Run tests, format code, simple refactor |
| `medium` | Sonnet | Implement feature, fix bug, write tests |
| `complex` | Sonnet/Opus | Multi-file refactor, new architecture component |
| `expert` | Opus | System design, complex debugging, security review |

### Automatic Complexity Detection

If no complexity is specified, Cloister infers it from:

1. **Task type tags:** `docs` → trivial, `feature` → medium, `architecture` → expert
2. **File count:** Single file → simple, 3+ files → complex
3. **Keywords:** "refactor", "redesign", "migrate" → complex
4. **Parent task:** Subtasks inherit parent complexity unless specified

### Handoff Triggers

```
┌─────────────────────────────────────────────────────────────┐
│                    Task Lifecycle                            │
│                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │  Plan    │───▶│  Build   │───▶│  Test    │              │
│  │  (Opus)  │    │ (Sonnet) │    │ (Haiku)  │              │
│  └──────────┘    └──────────┘    └──────────┘              │
│       │               │               │                     │
│       │               │               │                     │
│       ▼               ▼               ▼                     │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │ Complex  │    │  Stuck?  │    │  Failed? │              │
│  │ decision │    │ Escalate │    │ Escalate │              │
│  │  needed  │    │ to Opus  │    │ to Sonnet│              │
│  └──────────┘    └──────────┘    └──────────┘              │
└─────────────────────────────────────────────────────────────┘
```

**Downgrade triggers (save cost):**
- Planning complete → hand to Sonnet for implementation
- Implementation complete → hand to Haiku for tests
- Code review approved → hand to Haiku for formatting/cleanup

**Escalation triggers (need more capability):**
- Haiku stuck > 10 min → escalate to Sonnet
- Sonnet stuck > 20 min → escalate to Opus
- Test failures after 2 attempts → escalate
- Merge conflict → escalate to merge-agent (Sonnet)
- Security concern flagged → escalate to Opus

### Beads Integration

When a beads task is marked complete, Cloister checks for the next task and determines if a model handoff is needed:

```typescript
// Example: Task completion triggers handoff
async function onTaskComplete(taskId: string) {
  const completedTask = await beads.getTask(taskId);
  const nextTask = await beads.getNextUnblockedTask(completedTask.parentId);

  if (!nextTask) return; // No more work

  const currentModel = getCurrentAgentModel();
  const suggestedModel = getModelForComplexity(nextTask.complexity);

  if (suggestedModel !== currentModel) {
    // Handoff needed
    await handoffToModel(nextTask, suggestedModel);
  }
}
```

### Handoff Mechanics

Cloister supports three handoff methods depending on the scenario:

#### Method 1: Kill & Spawn (Issue Agents)

The simplest approach for ephemeral issue agents. Kill current agent, spawn new one with context.

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Opus       │────▶│  Cloister   │────▶│  Sonnet     │
│  (planning) │     │  (handoff)  │     │  (building) │
└─────────────┘     └─────────────┘     └─────────────┘
      │                   │                   │
      ▼                   ▼                   ▼
   STATE.md           Reads STATE.md      Continues from
   updated            + beads status      STATE.md
```

```typescript
async function killAndSpawnHandoff(
  fromAgent: string,
  toModel: string,
  toRuntime: RuntimeName
): Promise<Agent> {
  // 1. Signal current agent to save state
  await sendMessage(fromAgent,
    "Update STATE.md with current progress and stop. " +
    "A different model will continue from your STATE.md."
  );

  // 2. Wait for agent to update STATE.md and become idle
  await waitForStateUpdate(fromAgent, 60_000);
  await waitForIdle(fromAgent, 30_000);

  // 3. Capture context before killing
  const workspace = getAgentWorkspace(fromAgent);
  const context = await captureHandoffContext(workspace);

  // 4. Kill current agent
  await killAgent(fromAgent);

  // 5. Build prompt for new agent
  const prompt = buildHandoffPrompt(context);

  // 6. Spawn new agent
  return spawnAgent({
    agentId: fromAgent,  // Reuse same agent ID
    workspace,
    model: toModel,
    runtime: toRuntime,
    prompt
  });
}

function buildHandoffPrompt(context: HandoffContext): string {
  return `
# Continuing Work: ${context.issueId}

You are continuing work started by a previous agent (${context.previousModel}).
The previous agent has updated STATE.md with current progress.

## CRITICAL: Read These Files First
1. \`.planning/STATE.md\` - Full context and current status
2. \`CLAUDE.md\` - Workspace instructions

## Quick Summary
**What was done:** ${context.whatWasDone}
**What remains:** ${context.whatRemains}
**Git branch:** ${context.gitBranch}
**Uncommitted files:** ${context.uncommittedFiles.length > 0 ? context.uncommittedFiles.join(', ') : 'None'}

## Remaining Beads Tasks
${context.remainingTasks.map(t => `- [${t.status}] ${t.title} (${t.id})`).join('\n')}

## Your Instructions
1. Read STATE.md for full context
2. Continue from where the previous agent stopped
3. Update STATE.md as you make progress
4. Complete the remaining beads tasks
`;
}
```

**Pros:** Clean separation, simple to implement
**Cons:** Loses in-memory context, requires good STATE.md discipline

#### Method 2: Specialist Wake (--resume)

For permanent specialist agents that maintain expertise across sessions:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Issue      │────▶│  Cloister   │────▶│  test-agent │
│  Agent      │     │  (triggers  │     │  (wakes up) │
│  (signals   │     │   handoff)  │     │             │
│   "ready    │     └─────────────┘     └─────────────┘
│   for test")│            │                   │
└─────────────┘            ▼                   ▼
                    Reads specialist     claude --resume $SESSION
                    session ID           -p "Run tests for pan-18"
```

```typescript
async function wakeSpecialist(
  specialist: SpecialistName,
  task: SpecialistTask
): Promise<Agent> {
  const specialistConfig = getSpecialistConfig(specialist);
  const sessionFile = `~/.panopticon/specialists/${specialist}.session`;

  // Check if specialist has existing session
  const sessionId = existsSync(sessionFile)
    ? readFileSync(sessionFile, 'utf-8').trim()
    : null;

  const runtime = getRuntime(specialistConfig.runtime);

  if (sessionId) {
    // Wake existing specialist with --resume
    return runtime.spawnAgent({
      agentId: `specialist-${specialist}`,
      sessionId,  // This triggers --resume
      prompt: buildSpecialistPrompt(specialist, task),
      model: specialistConfig.model
    });
  } else {
    // Initialize new specialist
    return initializeSpecialist(specialist, task);
  }
}

function buildSpecialistPrompt(specialist: string, task: SpecialistTask): string {
  switch (specialist) {
    case 'test-agent':
      return `
# Test Request

Run tests for: ${task.workspace}
Branch: ${task.branch}
Trigger: ${task.trigger}

## Instructions
1. cd to workspace
2. Run full test suite
3. If failures:
   - Analyze root cause
   - Fix if simple (< 5 min)
   - Otherwise report back
4. Report results

${task.additionalContext || ''}
`;

    case 'merge-agent':
      return `
# Merge Request

PR: ${task.prUrl}
Source: ${task.sourceBranch}
Target: ${task.targetBranch}

## Instructions
1. Check for merge conflicts
2. If conflicts exist, resolve them intelligently
3. Ensure CI passes
4. Complete the merge
5. Report any issues

${task.additionalContext || ''}
`;

    // ... other specialists
  }
}
```

**Pros:** Specialist retains expertise, faster context loading
**Cons:** Session can grow large, needs rotation strategy

#### Method 3: Runtime Switch (Cross-Runtime Handoff)

When handing off to a different runtime (e.g., Claude Code → OpenCode):

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Claude Code │────▶│  Cloister   │────▶│  OpenCode   │
│  (Sonnet)   │     │  (runtime   │     │ (DeepSeek)  │
│  $$$        │     │   switch)   │     │  $          │
└─────────────┘     └─────────────┘     └─────────────┘
      │                   │                   │
      ▼                   ▼                   ▼
   STATE.md           Converts context    opencode --model
   (Claude fmt)       to new runtime      deepseek-v3 -p "..."
```

```typescript
async function crossRuntimeHandoff(
  fromAgent: string,
  toModel: string,
  toRuntime: RuntimeName
): Promise<Agent> {
  const fromRuntime = getAgentRuntime(fromAgent);
  const toRuntimeImpl = getRuntime(toRuntime);

  // 1. Ensure state is saved
  await sendMessage(fromAgent, "Update STATE.md and commit any changes.");
  await waitForIdle(fromAgent);

  // 2. Capture context in runtime-agnostic format
  const context = await captureHandoffContext(getAgentWorkspace(fromAgent));

  // 3. Kill old agent
  await fromRuntime.killAgent(fromAgent);

  // 4. Spawn on new runtime
  // Note: Different runtimes may have different prompt formats
  const prompt = toRuntimeImpl.formatHandoffPrompt(context);

  return toRuntimeImpl.spawnAgent({
    agentId: fromAgent,
    workspace: context.workspace,
    model: toModel,
    prompt
  });
}
```

### Handoff Triggers

| Trigger | Condition | From | To | Method |
|---------|-----------|------|-----|--------|
| **Planning complete** | Beads "plan" task closed | Opus | Sonnet | Kill & Spawn |
| **Implementation complete** | Beads "implement" tasks closed | Sonnet | test-agent | Specialist Wake |
| **Tests pass** | test-agent reports success | test-agent | Sonnet | Specialist Wake |
| **Stuck (Haiku)** | No activity > 10 min | Haiku/Cheap | Sonnet | Kill & Spawn (escalate) |
| **Stuck (Sonnet)** | No activity > 20 min | Sonnet | Opus | Kill & Spawn (escalate) |
| **Test failures x2** | Repeated test failures | Haiku | Sonnet | Specialist Wake |
| **Cost threshold** | Agent exceeds $X | Expensive | Cheaper | Kill & Spawn (downgrade) |
| **Trivial task** | Next beads task is trivial | Any | Cheap model | Kill & Spawn |

### Handoff Trigger Configuration

```yaml
# ~/.panopticon/cloister.yaml

handoffs:
  # Automatic triggers
  auto_triggers:
    planning_complete:
      enabled: true
      from_model: opus
      to_model: sonnet

    implementation_complete:
      enabled: true
      to_specialist: test-agent

    stuck_escalation:
      enabled: true
      thresholds:
        haiku_to_sonnet_minutes: 10
        sonnet_to_opus_minutes: 20

    cost_downgrade:
      enabled: false  # Manual by default
      threshold_usd: 5.00

  # Beads complexity routing
  complexity_routing:
    trivial: { model: deepseek-v3, runtime: opencode }
    simple: { model: deepseek-v3, runtime: opencode }
    medium: { model: sonnet, runtime: claude-code }
    complex: { model: sonnet, runtime: claude-code }
    expert: { model: opus, runtime: claude-code }

  # Manual approval required for these
  require_approval:
    - cross_runtime  # Claude Code ↔ OpenCode
    - escalate_to_opus
    - downgrade_from_opus
```

### Context Preservation

The `HandoffContext` captures everything needed for seamless continuation:

```typescript
interface HandoffContext {
  // Identity
  issueId: string;
  agentId: string;
  workspace: string;

  // Previous agent info
  previousModel: string;
  previousRuntime: RuntimeName;
  previousSessionId?: string;

  // Files to read
  stateFile: string;           // .planning/STATE.md
  claudeMd: string;            // CLAUDE.md

  // Git state
  gitBranch: string;
  uncommittedFiles: string[];
  lastCommit: string;

  // Beads state
  activeBeadsTasks: BeadsTask[];
  remainingTasks: BeadsTask[];
  completedTasks: BeadsTask[];

  // AI-generated summaries
  whatWasDone: string;         // Summary of completed work
  whatRemains: string;         // Summary of remaining work
  blockers: string[];          // Any issues encountered
  decisions: string[];         // Key decisions made

  // Metrics
  tokenUsage: TokenUsage;
  costSoFar: number;
  handoffCount: number;        // How many times this issue has been handed off
}

async function captureHandoffContext(workspace: string): Promise<HandoffContext> {
  // Read STATE.md
  const stateContent = readFileSync(`${workspace}/.planning/STATE.md`, 'utf-8');

  // Parse beads tasks
  const beadsTasks = await getBeadsTasks(workspace);

  // Get git info
  const gitBranch = execSync('git branch --show-current', { cwd: workspace }).toString().trim();
  const uncommitted = execSync('git status --porcelain', { cwd: workspace }).toString().trim();

  // Generate summaries (could use AI for this)
  const { whatWasDone, whatRemains } = parseStateFile(stateContent);

  return {
    workspace,
    stateFile: `${workspace}/.planning/STATE.md`,
    gitBranch,
    uncommittedFiles: uncommitted.split('\n').filter(Boolean),
    activeBeadsTasks: beadsTasks.filter(t => t.status === 'in_progress'),
    remainingTasks: beadsTasks.filter(t => t.status === 'open'),
    completedTasks: beadsTasks.filter(t => t.status === 'closed'),
    whatWasDone,
    whatRemains,
    // ... etc
  };
}
```

### Dashboard Handoff UI

```
┌─────────────────────────────────────────────────────────────┐
│  agent-pan-18                              🟢 Active        │
├─────────────────────────────────────────────────────────────┤
│  Model: Sonnet (Claude Code)         Cost so far: $2.45    │
│  Current task: Implement heartbeat monitor                  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Beads Progress                                      │   │
│  │  ████████████████░░░░ 4/5 tasks                     │   │
│  │                                                      │   │
│  │  ✓ Plan architecture (Opus)                         │   │
│  │  ✓ Implement heartbeat service (Sonnet)             │   │
│  │  ✓ Implement health evaluator (Sonnet)              │   │
│  │  ● Add emergency stop [in progress] (Sonnet)        │   │
│  │  ○ Write tests (simple) ← Suggested: DeepSeek       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  💡 Handoff Suggestion                              │   │
│  │                                                      │   │
│  │  When "Add emergency stop" completes, hand off to:  │   │
│  │  • test-agent (DeepSeek via OpenCode)               │   │
│  │  • Estimated savings: $1.20 → $0.08                 │   │
│  │                                                      │   │
│  │  [Auto-handoff: ON ▼]  [Configure...]               │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Manual Handoff                                      │   │
│  │                                                      │   │
│  │  [▼ Select Model    ] [▼ Select Runtime ]           │   │
│  │                                                      │   │
│  │  [Handoff Now]  [Escalate to Opus]  [Downgrade]     │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Handoff History

Track all handoffs for debugging and optimization:

```typescript
interface HandoffEvent {
  timestamp: Date;
  agentId: string;
  issueId: string;

  from: {
    model: string;
    runtime: RuntimeName;
    sessionId?: string;
  };

  to: {
    model: string;
    runtime: RuntimeName;
    sessionId?: string;
  };

  trigger: HandoffTrigger;
  reason: string;

  context: {
    beadsTaskCompleted?: string;
    stuckMinutes?: number;
    costAtHandoff?: number;
  };

  success: boolean;
  errorMessage?: string;
}

// Stored in ~/.panopticon/handoffs.jsonl
```

### Handoff API Endpoints

```typescript
// Get suggested handoff for an agent
GET /api/agents/:id/handoff/suggestion
→ {
    suggested: true,
    trigger: "next_task_complexity",
    currentModel: "sonnet",
    suggestedModel: "deepseek-v3",
    suggestedRuntime: "opencode",
    reason: "Next task 'Write tests' has complexity 'simple'",
    estimatedSavings: { from: 1.20, to: 0.08 }
  }

// Trigger manual handoff
POST /api/agents/:id/handoff
← {
    toModel: "opus",
    toRuntime: "claude-code",
    reason: "Manual escalation - agent seems confused"
  }
→ { success: true, newSessionId: "..." }

// Get handoff history for an issue
GET /api/issues/:id/handoffs
→ { handoffs: [HandoffEvent, ...] }
```

### Specialist Agent Models

| Specialist | Default Model | Rationale |
|------------|---------------|-----------|
| `merge-agent` | Sonnet | Needs reasoning for conflicts, but routine work |
| `review-agent` | Sonnet | Code understanding, security awareness |
| `test-agent` | Haiku | Mostly running commands, simple fixes |
| `planning-agent` | Opus | Complex decisions, architecture |

### Cost Tracking

Cloister tracks token usage per agent and model:

```json
{
  "agent": "agent-pan-18",
  "session": {
    "started": "2026-01-20T10:00:00Z",
    "models_used": {
      "opus": { "input_tokens": 50000, "output_tokens": 10000, "cost_usd": 1.50 },
      "sonnet": { "input_tokens": 200000, "output_tokens": 50000, "cost_usd": 1.25 },
      "haiku": { "input_tokens": 100000, "output_tokens": 20000, "cost_usd": 0.05 }
    },
    "total_cost_usd": 2.80,
    "handoffs": 3
  }
}
```

Dashboard shows:
- Cost per agent
- Cost per issue
- Model usage breakdown
- Cost savings from handoffs (estimated vs if all Opus)

### Configuration

```yaml
# ~/.panopticon/cloister.yaml

model_selection:
  default_model: sonnet

  # Complexity → Model mapping
  complexity_routing:
    trivial: haiku
    simple: haiku
    medium: sonnet
    complex: sonnet
    expert: opus

  # Specialist models
  specialists:
    merge-agent: sonnet
    review-agent: sonnet
    test-agent: haiku
    planning-agent: opus

  # Escalation settings
  escalation:
    haiku_stuck_minutes: 10
    sonnet_stuck_minutes: 20
    auto_escalate: true
    max_escalations: 2  # Don't escalate more than twice per task

  # Cost controls
  cost_limits:
    per_agent_usd: 10.00      # Alert if agent exceeds
    per_issue_usd: 25.00      # Alert if issue exceeds
    daily_total_usd: 100.00   # Emergency stop if exceeded
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Panopticon Dashboard                      │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                    Cloister Service                    │  │
│  │  ┌───────────┐ ┌───────────┐ ┌─────────┐ ┌─────────┐  │  │
│  │  │ Heartbeat │ │  Health   │ │  Model  │ │Emergency│  │  │
│  │  │  Monitor  │ │ Evaluator │ │ Router  │ │  Stop   │  │  │
│  │  └─────┬─────┘ └─────┬─────┘ └────┬────┘ └────┬────┘  │  │
│  └────────┼─────────────┼────────────┼───────────┼───────┘  │
│           │             │            │           │           │
│           └─────────────┴─────┬──────┴───────────┘           │
│                               │                              │
│  ┌────────────────────────────┴────────────────────────────┐│
│  │              Runtime Abstraction Layer                   ││
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐     ││
│  │  │ Claude Code  │ │   OpenCode   │ │    Codex     │     ││
│  │  │   Runtime    │ │   Runtime    │ │   Runtime    │     ││
│  │  │    JSONL     │ │ SQLite+JSON  │ │    JSONL     │     ││
│  │  └──────────────┘ └──────────────┘ └──────────────┘     ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
            │             │            │           │
            ▼             ▼            ▼           ▼
┌─────────────────────────────────────────────────────────────┐
│                      Agent Layer                             │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  Model Tiers                                            ││
│  │  💎 Opus    → planning-agent, complex escalations       ││
│  │  🔷 Sonnet  → merge-agent, review-agent, features       ││
│  │  💠 Haiku   → test-agent, simple tasks, cleanup         ││
│  │  💰 Cheap   → DeepSeek, Qwen, GLM via OpenCode          ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌─────────────────────┐    ┌─────────────────────────────┐ │
│  │  Specialist Agents  │    │      Issue Agents           │ │
│  │  ┌───────────────┐  │    │  ┌───────┐ ┌───────┐       │ │
│  │  │ merge-agent 🔷│  │    │  │pan-18 │ │pan-19 │ ...   │ │
│  │  │ review-agent🔷│  │    │  │  🔷   │ │  💰   │       │ │
│  │  │ test-agent 💰 │  │    │  └───────┘ └───────┘       │ │
│  │  │ planning   💎 │  │    │                             │ │
│  │  └───────────────┘  │    │                             │ │
│  └─────────────────────┘    └─────────────────────────────┘ │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  Beads Task Queue                                       ││
│  │  [trivial💰] [simple💰] [medium🔷] [complex🔷] [expert💎]││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## Multi-Runtime Support

Cloister is designed to work with multiple AI coding agents through a runtime abstraction layer. This allows organizations to:

1. **Use the best tool for the job** - Claude Code for complex work, OpenCode for cheap models
2. **Avoid vendor lock-in** - Switch between runtimes as needed
3. **Optimize costs** - Route trivial tasks to 10-30x cheaper models

### Supported Runtimes

| Runtime | Storage | Session Resume | Models | Status |
|---------|---------|----------------|--------|--------|
| **Claude Code** | JSONL in `~/.claude/` | `--resume <id>` | Claude family | Primary |
| **OpenCode** | SQLite in `~/.local/share/opencode/` | `--continue` | 75+ providers | Planned |
| **Codex** | JSONL in `~/.codex/sessions/` | `--resume`, `--continue` | OpenAI family | Planned |

### Runtime Interface

```typescript
interface AgentRuntime {
  name: 'claude-code' | 'opencode' | 'codex';

  // Session management
  getSessionPath(agentId: string): string;
  listSessions(workspace: string): Session[];
  resumeSession(sessionId: string, prompt: string): void;

  // Health monitoring
  getLastActivity(agentId: string): Date;
  getHeartbeat(agentId: string): Heartbeat;

  // Cost tracking
  getTokenUsage(agentId: string): TokenUsage;
  getSessionCost(sessionId: string): CostBreakdown;

  // Communication
  sendMessage(agentId: string, message: string): void;
  killAgent(agentId: string): void;

  // Spawning
  spawnAgent(config: SpawnConfig): Agent;
}

interface SpawnConfig {
  workspace: string;
  prompt: string;
  model?: string;          // e.g., 'sonnet', 'deepseek-v3', 'gpt-4'
  sessionId?: string;      // For --resume
  runtime?: RuntimeName;   // Override default
}
```

### Claude Code Runtime

```typescript
class ClaudeCodeRuntime implements AgentRuntime {
  name = 'claude-code' as const;

  getSessionPath(agentId: string): string {
    // Read ~/.panopticon/agents/{agentId}/state.json for workspace
    // Transform workspace to Claude project dir
    // Read sessions-index.json for active session
    // Return JSONL path
  }

  getLastActivity(agentId: string): Date {
    const jsonlPath = this.getSessionPath(agentId);
    return fs.statSync(jsonlPath).mtime;
  }

  getTokenUsage(agentId: string): TokenUsage {
    // Parse JSONL for usage entries
    // Sum input_tokens, output_tokens, cache_read, cache_write
  }

  spawnAgent(config: SpawnConfig): Agent {
    // tmux new-session -d -s {agentId}
    // claude --model {model} -p "{prompt}"
  }
}
```

### OpenCode Runtime (Future)

```typescript
class OpenCodeRuntime implements AgentRuntime {
  name = 'opencode' as const;

  getSessionPath(agentId: string): string {
    // Query SQLite at ~/.local/share/opencode/storage/
    // Find session by workspace/agent mapping
  }

  getLastActivity(agentId: string): Date {
    // Query SQLite for last message timestamp
    // Or check session JSON file mtime
  }

  getTokenUsage(agentId: string): TokenUsage {
    // Use opencode-tokenscope or parse storage directly
  }

  spawnAgent(config: SpawnConfig): Agent {
    // tmux new-session -d -s {agentId}
    // opencode --model {model} -p "{prompt}"
  }
}
```

### Codex Runtime (Future)

```typescript
class CodexRuntime implements AgentRuntime {
  name = 'codex' as const;

  getSessionPath(agentId: string): string {
    // Find in ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
    // Match by agent state mapping
  }

  getLastActivity(agentId: string): Date {
    const jsonlPath = this.getSessionPath(agentId);
    return fs.statSync(jsonlPath).mtime;
  }

  spawnAgent(config: SpawnConfig): Agent {
    // tmux new-session -d -s {agentId}
    // codex --model {model} -p "{prompt}"
  }
}
```

### Runtime Selection

```yaml
# ~/.panopticon/cloister.yaml

runtimes:
  default: claude-code

  # Model → Runtime mapping
  model_routing:
    # Claude models use Claude Code
    opus: claude-code
    sonnet: claude-code
    haiku: claude-code

    # Cheap models use OpenCode
    deepseek-v3: opencode
    qwen3-coder: opencode
    glm-4: opencode
    kimi-k2: opencode

    # OpenAI models use Codex
    gpt-4: codex
    o1: codex
    o3-mini: codex

  # Override per specialist
  specialists:
    test-agent:
      runtime: opencode
      model: deepseek-v3  # 15x cheaper than Haiku
    planning-agent:
      runtime: claude-code
      model: opus
```

### Cost Comparison by Runtime

| Task Type | Claude Code (Haiku) | OpenCode (DeepSeek) | Savings |
|-----------|---------------------|---------------------|---------|
| Run tests | $0.25/1M in, $1.25/1M out | $0.27/1M in, $1.10/1M out | ~15% |
| Simple fix | $0.25/1M in, $1.25/1M out | $0.15/1M in (Kimi) | ~50% |
| Formatting | $0.25/1M in, $1.25/1M out | $0.35/1M in (Qwen) | ~30% |

For trivial tasks running overnight, using OpenCode with cheap models could reduce costs by 50-90%.

## Heartbeat System

### Overview

Agents need to signal they're alive. Two approaches:

1. **Passive Detection** (no agent changes) - Cloister infers activity from file timestamps
2. **Active Heartbeats** (via hooks) - Agents explicitly write heartbeat files

### Approach 1: Passive Detection (MVP)

Cloister monitors existing artifacts without any agent modification:

```typescript
interface PassiveHeartbeat {
  agentId: string;
  lastActivity: Date;
  source: 'jsonl' | 'tmux' | 'git';
}

function getPassiveHeartbeat(agentId: string): PassiveHeartbeat {
  // Check JSONL file mtime (Claude Code writes here continuously)
  const jsonlPath = getAgentJsonlPath(agentId);
  const jsonlMtime = fs.statSync(jsonlPath).mtime;

  // Check tmux activity
  const tmuxActivity = exec(`tmux display -p -t ${agentId} '#{window_activity}'`);

  // Check git status in workspace
  const gitMtime = getLatestFileChange(workspace);

  // Return most recent
  return mostRecent([jsonlMtime, tmuxActivity, gitMtime]);
}
```

**Pros:** Zero agent changes, works immediately
**Cons:** Less rich data (no "what are you doing" info)

### Approach 2: Active Heartbeats (via Claude Code Hooks)

Claude Code supports hooks that run on events. We can use `PostToolUse` hook to write heartbeats:

**Hook configuration** (`~/.claude/settings.json`):
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": ".*",
        "command": "~/.panopticon/bin/heartbeat-hook"
      }
    ]
  }
}
```

**Heartbeat hook script** (`~/.panopticon/bin/heartbeat-hook`):
```bash
#!/bin/bash
# Called after every tool use with JSON on stdin

# Parse tool info from stdin
TOOL_INFO=$(cat)
TOOL_NAME=$(echo "$TOOL_INFO" | jq -r '.tool_name // "unknown"')
TOOL_INPUT=$(echo "$TOOL_INFO" | jq -r '.tool_input | tostring | .[0:100]')

# Determine agent ID from tmux session or env
AGENT_ID="${PANOPTICON_AGENT_ID:-$(tmux display-message -p '#S' 2>/dev/null || echo 'unknown')}"

# Write heartbeat
HEARTBEAT_DIR="$HOME/.panopticon/agents/$AGENT_ID"
mkdir -p "$HEARTBEAT_DIR"

cat > "$HEARTBEAT_DIR/heartbeat.json" << EOF
{
  "timestamp": "$(date -Iseconds)",
  "agent_id": "$AGENT_ID",
  "tool_name": "$TOOL_NAME",
  "last_action": "$TOOL_INPUT",
  "pid": $$,
  "session_id": "${CLAUDE_SESSION_ID:-unknown}"
}
EOF
```

**Heartbeat file format:**
```json
{
  "timestamp": "2026-01-20T15:30:00.000Z",
  "agent_id": "agent-pan-18",
  "tool_name": "Edit",
  "last_action": "Editing src/components/Button.tsx",
  "pid": 12345,
  "session_id": "286e638d-add1-490d-b6f4-6b99c8514f58"
}
```

**Pros:** Rich data (what tool, what action), explicit signal
**Cons:** Requires hook setup, slight overhead per tool call

### Approach 3: Hybrid (Recommended)

Use **passive detection** as the primary signal, with **optional active heartbeats** for richer data when hooks are configured:

```typescript
function getHeartbeat(agentId: string): Heartbeat {
  // Try active heartbeat first (richer data)
  const activeHeartbeat = readActiveHeartbeat(agentId);
  if (activeHeartbeat && isRecent(activeHeartbeat.timestamp, 5 * 60 * 1000)) {
    return {
      ...activeHeartbeat,
      source: 'active',
      confidence: 'high'
    };
  }

  // Fall back to passive detection
  const passiveHeartbeat = getPassiveHeartbeat(agentId);
  return {
    timestamp: passiveHeartbeat.lastActivity,
    agent_id: agentId,
    tool_name: null,
    last_action: `Activity detected via ${passiveHeartbeat.source}`,
    source: 'passive',
    confidence: 'medium'
  };
}
```

### Setting Up Active Heartbeats

When spawning an agent, Panopticon can:

1. **Set environment variable** for agent ID:
   ```bash
   PANOPTICON_AGENT_ID=agent-pan-18 claude -p "..."
   ```

2. **Ensure hooks are configured** (one-time setup):
   ```bash
   pan setup hooks  # Adds heartbeat hook to Claude Code config
   ```

3. **Verify heartbeats are flowing**:
   ```bash
   pan cloister status  # Shows which agents have active vs passive heartbeats
   ```

### Heartbeat Sources Summary

| Source | Detection Method | Latency | Rich Data |
|--------|------------------|---------|-----------|
| **JSONL mtime** | `stat` on session file | Real-time | No |
| **tmux activity** | `#{window_activity}` | ~1 sec | No |
| **Git activity** | `find` workspace | ~5 sec | File names |
| **Active hook** | Read heartbeat.json | Real-time | Tool + action |

### Health States

| State | Condition | UI | Action |
|-------|-----------|-----|--------|
| 🟢 **Active** | Activity < 5 min ago | Green indicator | None |
| 🟡 **Stale** | 5-15 min since activity | Yellow indicator | Monitor |
| 🟠 **Warning** | 15-30 min since activity | Orange indicator | Poke available |
| 🔴 **Stuck** | > 30 min since activity | Red indicator | Auto-kill (if enabled) |

### Configurable Thresholds

```yaml
# ~/.panopticon/cloister.yaml
thresholds:
  stale_minutes: 5
  warning_minutes: 15
  stuck_minutes: 30

auto_actions:
  poke_on_warning: true
  kill_on_stuck: false  # Manual by default for safety

startup:
  auto_start: true  # Start Cloister when Panopticon starts
```

## Dashboard UI

### Cloister Control Bar

```
┌─────────────────────────────────────────────────────────────┐
│  🔔 Cloister: Running          [Pause]  [⏹ EMERGENCY STOP] │
│  Last check: 30 seconds ago    Watching: 5 agents           │
└─────────────────────────────────────────────────────────────┘
```

When Cloister detects issues:

```
┌─────────────────────────────────────────────────────────────┐
│  🔔 Cloister: ⚠️ 2 AGENTS NEED ATTENTION    [⏹ EMERGENCY STOP] │
│  Last check: 10 seconds ago                                  │
└─────────────────────────────────────────────────────────────┘
```

### Agents Page Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Agents                                    [+ New Agent]    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  SPECIALIST AGENTS (Permanent)                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 😴 merge-agent     Sleeping    Last: 2 hrs ago      │   │
│  │    Session: 286e638d...  Context: 45K tokens        │   │
│  │                                      [Wake] [Reset] │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ 😴 review-agent    Sleeping    Last: 1 day ago      │   │
│  │    Session: 7af617dd...  Context: 23K tokens        │   │
│  │                                      [Wake] [Reset] │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ ⚪ test-agent      Not initialized                  │   │
│  │                                    [Initialize]     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ISSUE AGENTS (Ephemeral)                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🟢 agent-pan-18    Active      2 min ago            │   │
│  │    Issue: PAN-18 - Add Cloister framework           │   │
│  │    Branch: feature/pan-18                           │   │
│  │                          [View] [Poke] [Kill]       │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ 🟠 agent-pan-19    Warning     22 min ago           │   │
│  │    Issue: PAN-19 - Fix login bug                    │   │
│  │    Branch: feature/pan-19                           │   │
│  │                          [View] [Poke] [Kill]       │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ 🔴 agent-min-241   Stuck       47 min ago           │   │
│  │    Issue: MIN-241 - Database migration              │   │
│  │    Branch: feature/min-241                          │   │
│  │                          [View] [Poke] [Kill]       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Agent Detail View

Clicking an agent shows:

```
┌─────────────────────────────────────────────────────────────┐
│  agent-pan-18                              🟢 Active        │
│  Issue: PAN-18 - Add Cloister framework                     │
├─────────────────────────────────────────────────────────────┤
│  Status      │ Working                                      │
│  Last Active │ 2 minutes ago                                │
│  Session     │ 286e638d-add1-490d-b6f4-6b99c8514f58        │
│  Workspace   │ /home/.../workspaces/feature-pan-18         │
│  Branch      │ feature/pan-18                               │
│  Heartbeats  │ 142 (since spawn)                            │
├─────────────────────────────────────────────────────────────┤
│  Terminal Output                              [Attach]      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ $ Editing src/cloister/monitor.ts                   │   │
│  │ $ Running tests...                                  │   │
│  │ $ ✓ 42 tests passed                                 │   │
│  │ $ Committing changes...                             │   │
│  └─────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│  Pending Questions                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ❓ "Which testing framework should we use?"         │   │
│  │    ○ Jest (Recommended)                             │   │
│  │    ○ Vitest                                         │   │
│  │    ○ Mocha                                [Submit]  │   │
│  └─────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│                    [Send Message]  [Poke]  [Kill]           │
└─────────────────────────────────────────────────────────────┘
```

## API Endpoints

### Cloister Control

```typescript
// Get Cloister status
GET /api/cloister/status
→ {
    running: true,
    lastCheck: "2026-01-20T15:30:00.000Z",
    config: { autoStart: true, thresholds: {...} },
    summary: { active: 3, stale: 1, warning: 1, stuck: 0 }
  }

// Start Cloister
POST /api/cloister/start

// Stop Cloister (pause monitoring, don't kill agents)
POST /api/cloister/stop

// Emergency stop (kill ALL agents immediately)
POST /api/cloister/emergency-stop
→ { killed: ["agent-pan-18", "agent-pan-19", "agent-min-241"] }

// Update Cloister config
PUT /api/cloister/config
← { autoStart: false, thresholds: { stuck_minutes: 45 } }
```

### Agent Management

```typescript
// List all agents (specialists + issue agents)
GET /api/agents
→ {
    specialists: [
      { id: "merge-agent", status: "sleeping", lastActive: "..." },
      ...
    ],
    issueAgents: [
      { id: "agent-pan-18", status: "active", issue: "PAN-18", ... },
      ...
    ]
  }

// Get agent details
GET /api/agents/:id
→ { id, status, health, lastActive, sessionId, workspace, ... }

// Get agent health history
GET /api/agents/:id/health
→ { history: [{ timestamp, state, activity }, ...] }

// Poke agent (send "are you stuck?" message)
POST /api/agents/:id/poke

// Kill agent
POST /api/agents/:id/kill

// Send message to agent
POST /api/agents/:id/message
← { message: "Please commit your changes" }
```

### Specialist Management

```typescript
// Initialize a specialist agent
POST /api/specialists/:name/initialize
← { name: "merge-agent", prompt: "You are the merge specialist..." }

// Wake a sleeping specialist
POST /api/specialists/:name/wake
← { task: "PR #42 is ready to merge", context: "..." }

// Reset specialist (clear session, start fresh)
POST /api/specialists/:name/reset

// Get specialist session info
GET /api/specialists/:name/session
→ { sessionId: "...", contextTokens: 45000, lastWake: "..." }
```

## CLI Commands

```bash
# Cloister control
pan cloister status        # Show Cloister status
pan cloister start         # Start Cloister monitoring
pan cloister stop          # Stop Cloister (agents continue)
pan cloister emergency-stop # Kill all agents NOW

# Agent management
pan agents list            # List all agents
pan agents health          # Show health summary
pan agents poke <id>       # Poke a specific agent
pan agents kill <id>       # Kill a specific agent

# Specialist management
pan specialists list       # List specialist agents
pan specialists init <name> # Initialize a specialist
pan specialists wake <name> # Wake a specialist with task
pan specialists reset <name> # Reset specialist session
```

## Configuration

### Default Config File

```yaml
# ~/.panopticon/cloister.yaml

# Startup behavior
startup:
  auto_start: true          # Start Cloister when dashboard starts

# Health thresholds (minutes)
thresholds:
  stale: 5                  # 🟡 Yellow - monitoring
  warning: 15               # 🟠 Orange - poke available
  stuck: 30                 # 🔴 Red - intervention needed

# Automatic actions
auto_actions:
  poke_on_warning: true     # Auto-send "are you stuck?" at warning
  kill_on_stuck: false      # Auto-kill at stuck (DANGEROUS - off by default)
  restart_on_kill: false    # Auto-restart after kill

# Monitoring
monitoring:
  check_interval: 60        # Seconds between health checks
  heartbeat_sources:        # How to detect agent activity
    - jsonl_mtime           # Claude Code session file modification
    - tmux_activity         # Terminal output
    - git_activity          # Commits/file changes

# Notifications (future)
notifications:
  slack_webhook: null
  email: null

# Specialist agents
specialists:
  merge-agent:
    enabled: true
    auto_wake: true         # Wake when PR approved
  review-agent:
    enabled: true
    auto_wake: true         # Wake when PR opened
  test-agent:
    enabled: false          # Not yet implemented
```

### Environment Variables

```bash
# Override config file location
CLOISTER_CONFIG=~/.panopticon/cloister.yaml

# Quick overrides
CLOISTER_AUTO_START=true
CLOISTER_STUCK_THRESHOLD=45
CLOISTER_AUTO_KILL=false
```

## Implementation Phases

### Phase 1: Core Watchdog (MVP)

- [ ] Cloister service in dashboard server
- [ ] Passive heartbeat detection (JSONL mtime, tmux activity)
- [ ] Basic health states (active/stale/warning/stuck)
- [ ] Emergency stop button (kills all agents)
- [ ] Cloister control bar in dashboard header
- [ ] Agent health indicators in existing agents list
- [ ] `pan cloister status` and `pan cloister emergency-stop` CLI
- [ ] Configuration file (`~/.panopticon/cloister.yaml`)
- [ ] Auto-start option (start Cloister when dashboard starts)

### Phase 2: Agent Management UI

- [ ] New Agents page with two sections:
  - Specialist Agents (permanent, sleeping/active)
  - Issue Agents (ephemeral, from /work-issue)
- [ ] Agent detail view with:
  - Terminal output stream
  - Health history timeline
  - Git status
- [ ] Action buttons: Poke, Kill, Send Message
- [ ] Health history graph (last 24 hours)

### Phase 3: Active Heartbeats & Hooks

- [ ] Heartbeat hook script (`~/.panopticon/bin/heartbeat-hook`)
- [ ] `pan setup hooks` command to configure Claude Code
- [ ] Agent ID environment variable injection
- [ ] Rich heartbeat data (tool name, last action)
- [ ] Hybrid detection (active + passive fallback)

### Phase 4: Model Routing & Handoffs

- [ ] Beads complexity field support
- [ ] Automatic complexity detection (tags, keywords, file count)
- [ ] Model router component in Cloister
- [ ] Complexity → Model mapping configuration
- [ ] Handoff triggers:
  - Task completion → check next task's complexity
  - Stuck detection → escalate to higher model
  - Test failures → escalate
- [ ] Context preservation during handoff:
  - STATE.md summary
  - Active beads tasks
  - Git state
- [ ] Cost tracking per agent/model
- [ ] Dashboard cost display

### Phase 5: Specialist Agents

- [ ] Specialist registry (`~/.panopticon/specialists/`)
- [ ] Session persistence (store session IDs)
- [ ] Initialize/Wake/Reset CLI commands
- [ ] merge-agent implementation (Sonnet)
- [ ] review-agent implementation (Sonnet)
- [ ] test-agent implementation (Haiku)
- [ ] planning-agent implementation (Opus)
- [ ] Auto-wake on triggers (webhook from GitHub/Linear)

### Phase 6: Advanced Features

- [ ] AskUserQuestion interception (PAN-20)
- [ ] Notifications (Slack webhook, email)
- [ ] Auto-restart on crash (with backoff)
- [ ] Mass death detection (3+ deaths in 30 sec)
- [ ] GUPP violation detection (work sitting idle)
- [ ] Cost limits and alerts
- [ ] Session rotation for long-running specialists
- [ ] Metrics and analytics dashboard

## Open Questions

1. **Session rotation for specialists** - How often? Preserve key memories?
2. **Poke message format** - What message best un-sticks an agent?
3. **Multi-machine support** - Can Cloister monitor agents on remote machines?
4. **Cost tracking** - Show token usage per agent?

## References

- [Gastown stuck detection](../../../gastown/internal/deacon/stuck.go) - Inspiration for thresholds
- [PAN-20 AskUserQuestion Plan](../.planning/PAN-20-PLAN.md) - Question interception design
- [Doctor Who Cloister Bell](https://tardis.fandom.com/wiki/Cloister_Bell) - Naming inspiration
