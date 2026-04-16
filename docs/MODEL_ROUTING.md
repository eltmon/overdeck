# Model Routing

Panopticon routes LLM models by **work type**. A work type is a canonical routing identifier that represents a specific job slot in the Panopticon workflow (e.g., `issue-agent:implementation`, `convoy:security-reviewer`). Every time a workflow step needs to call an LLM, Panopticon looks up which model is assigned to that step's work type.

## Terminology

| Term | What it means | Example |
|------|---------------|---------|
| **Work Type** | Internal routing identifier for a model assignment | `issue-agent:implementation`, `specialist-review-agent` |
| **Override** | Explicit per-work-type model assignment set by you | You assign `kimi-k2.5` to the Implementation phase |
| **Smart Selection** | Capability-based automatic model selection when no override exists | Panopticon picks the best model for code generation automatically |
| **Provider** | LLM API provider | Anthropic, OpenAI, Google, Kimi, MiniMax, Z.AI, OpenRouter |
| **Favorite** | A model you've starred in the OpenRouter catalog so it's available for assignment | `qwen/qwen3.6-plus` |

**Important:** The terms "agent type" and "work type" are often confused. An agent type is the runtime process (e.g., the work-agent process), while a work type is the routing slot *within* that workflow. One agent type can have multiple work types — for example, the Issue Agent is a single process but has five work types (Exploration, Implementation, Testing, Documentation, Review Response). Throughout this doc and the UI, the term **work type** is used.

## How Model Resolution Works

When Panopticon needs to make an LLM call, it resolves the model through this chain:

1. **User Override** — If you've explicitly assigned a model to this work type via the dashboard, use it
2. **Smart Selection** — If no override exists, score all enabled provider models against the work type's capability requirements (code-generation, reasoning, speed, etc.) and pick the best match
3. **Provider Fallback** — If the winning model's provider is disabled, fall back to the next best model from an enabled provider
4. **Hard Fallback** — `claude-sonnet-4-6`

**Code path:** `src/lib/work-type-router.ts` → `src/lib/smart-model-selector.ts` → `src/lib/model-capabilities.ts`

## Available Providers

Panopticon supports seven LLM providers:

| Provider | Auth Method | Notes |
|----------|-------------|-------|
| **Anthropic** | Claude Code subscription login (default, always enabled) | Opus 4.6, Sonnet 4.6, Haiku 4.5 |
| **OpenAI** | Codex subscription login (via CLIProxyAPI sidecar) or API key | GPT-5.4, O3, O4 Mini |
| **Google** | API key | Gemini 3.1 Pro, 3 Flash, 3.1 Flash Lite |
| **Kimi (Moonshot)** | API key | K2.6-code-preview, K2.5 |
| **MiniMax** | API key | M2.7, M2.7 Highspeed |
| **Z.AI** | API key | GLM 5.1 |
| **OpenRouter** | API key (optional provider) | 200+ models including Qwen, DeepSeek, Llama |

### Provider Configuration

Each provider can be toggled on/off from the **Provider Configuration** cards in Settings. When a provider is disabled, all its models are excluded from routing and from the model assignment modal.

To configure a provider:
1. Navigate to **Settings → Provider Configuration**
2. Toggle the provider on
3. Enter the API key (or use Codex/Claude Code subscription login)
4. Optionally click **Test 2+3** to verify the key works with a simple prompt test

## OpenRouter

OpenRouter is a special provider that routes requests to models from multiple companies (Alibaba/Qwen, DeepSeek, Meta/Llama, Mistral, and more) through a single API key.

### Setup

1. Navigate to **Settings → OpenRouter**
2. Enter your OpenRouter API key (get one at `openrouter.ai/settings/keys`)
3. Click **Save Key**
4. Toggle the provider **ON**

### Favorites

**To assign an OpenRouter model to any work type, you must first favorite it.**

1. In the OpenRouter section, scroll to the **Model Catalog**
2. Click the star icon on any model to add it to your favorites
3. The model will now appear in the model selection modal for any work type

The note above the catalog reads: *"Must star a model to assign it to an agent via Model Assignments"* — this is enforced by the model chooser: only favorited OpenRouter models will appear in the dropdown.

Favorites are persisted on the server and synced to `~/.panopticon/config.yaml` when you save settings.

### Pricing

OpenRouter models show input/output pricing per million tokens on each model card in the catalog. Use the **free** filter to see zero-cost models. The cheapest models are highlighted with a `FREE` badge.

## Configuring Model Assignments

Model assignments are configured in **Settings → Model Assignments**. This section displays all routable work types grouped by agent family:

- **Issue Agent** — Exploration, Implementation, Testing, Documentation, Review Response (5 work types)
- **Specialist Agents** — Review, Test, Merge, Inspect, UAT (5 work types)  
- **Convoy (Parallel Review Panel)** — Security, Performance, Correctness, Synthesis (4 work types)
- **Subagents** — Explore, Plan, Bash, General Purpose (4 work types)
- **Workflow Jobs** — Status Review (1 work type)
- **Planning** — Planning Agent (1 work type)
- **CLI Modes** — Interactive, Quick Command (2 work types)

### Changing a Model Assignment

1. Click any card in the Model Assignments section
2. The **Select Model** modal opens, showing:
   - **Work Type** — which routing slot you're configuring
   - **What this means** — explanation of what this work type does
   - **Required capabilities** — what skills this work type needs from its model
3. Browse models grouped by provider
4. Select a model and click **Apply Selection**
5. Click **Save Changes** in the footer to persist

### Resetting to Smart Selection

If you want Panopticon to automatically pick the best model:
1. Click **Remove Override** in the model modal, or
2. Click **Reset all to smart selection** in the summary bar at the bottom of the section

### Bulk Reset

Click **Optimal Defaults** in the footer to restore research-based optimal assignments across all work types at once.

### Advanced: Work Type Table

Below the card-based view, there's an expandable **Advanced: Work Type Overrides** section that shows all work types in a compact table format with override/preset badges and quick configure/remove actions.

## Configuration File

Model assignments are persisted in your config file (`~/.panopticon/config.yaml`):

```yaml
models:
  providers:
    anthropic: true    # always enabled
    openai: true
    google: false
    openrouter: true
    kimi: true
    minimax: false
    zai: false

  overrides:
    # Agent-specific model assignments
    issue-agent:implementation: kimi-k2.5
    specialist-review-agent: claude-opus-4-6
    specialist-uat-agent: claude-opus-4-6
    subagent:explore: claude-haiku-4-5
    status-review: claude-sonnet-4-6

  gemini_thinking_level: 3
```

For OpenRouter:

```yaml
openrouter:
  favorites:
    - qwen/qwen3.6-plus
    - deepseek/deepseek-chat
```

The `models.overrides` section stores your explicit per-work-type assignments. Any work type not listed uses smart selection.

## Runtime Resolution

### Primary Agents

The `work-agent` (which handles all issue-processing phases) and `planning-agent` resolve models through `determineModel()` in `src/lib/agents.ts:537`:

1. Explicit CLI/API override (`--model` / `options.model`)
2. Explicit work type ID (`options.workType`)
3. Phase-derived work type (`issue-agent:<phase>`)
4. Cloister config default (`model_selection.default_model`)
5. Hard fallback: `claude-sonnet-4-6`

### Specialist Agents

Specialists (`review`, `test`, `merge`, `inspect`, `uat`) resolve through `specialists.ts:722`:

1. Cloister specialist override (`model_selection.specialist_models.<agent_name>`)
2. Work-type router via `specialist-<agent>`
3. Hard fallback: `claude-sonnet-4-6`

### Convoy

Convoy reviewers are spawned from the convoy coordinator and resolve their models through the same work-type router using their `convoy:*` work type ID.

### Subagents

Subagents (`explore`, `plan`, `bash`, `general-purpose`) are spawned via the Agent tool and resolve their models through the work-type router using their `subagent:*` work type ID.

## Model Capability Matching

Each work type declares the capabilities it needs:

| Work Type | Required Capabilities |
|-----------|----------------------|
| `issue-agent:exploration` | reasoning, large-context |
| `issue-agent:implementation` | code, reasoning, agentic |
| `issue-agent:testing` | code, reasoning |
| `specialist-review-agent` | reasoning, code |
| `subagent:explore` | fast, reasoning |
| `subagent:bash` | fast, code |
| `cli:quick-command` | fast |

The smart selector scores each available model's skills against these requirements and picks the highest-scoring model. When you open the model modal, you'll see a match percentage for each model — Green (100%), Amber (50%+), Red (<50%).

## Deprecation and Migration

Older model IDs (e.g., `claude-opus-4-5`, `claude-sonnet-4-5`, `gpt-4o`) are automatically migrated to their current equivalents when you save settings. A deprecation warning banner shows which work types have old model IDs pending migration.

## Full Work Type Registry

The canonical registry of all routable work types lives in `src/lib/work-types.ts`. When adding a new work type, update:

- `src/lib/work-types.ts` — canonical type definition
- `src/lib/settings-api.ts` — optimal defaults
- `src/dashboard/frontend/src/components/Settings/modelDefaults.ts` — UI fallback defaults
- `src/dashboard/frontend/src/components/Settings/AgentCards/ModelOverrideModal.tsx` — capability requirements mapping
- `docs/WORK-TYPES.md` — documented routing slots
- `docs/AGENT_TYPES_INDEX.md` — runtime agent inventory

## Canonical Sources

| Surface | File |
|---------|------|
| Work type registry | `src/lib/work-types.ts` |
| Smart model selector | `src/lib/smart-model-selector.ts` |
| Model capability database | `src/lib/model-capabilities.ts` |
| Work type router | `src/lib/work-type-router.ts` |
| Settings API | `src/lib/settings-api.ts` |
| Agent model resolution | `src/lib/agents.ts:537` |
| Specialist model resolution | `src/lib/cloister/specialists.ts:722` |
| Settings UI (Model Override Modal) | `src/dashboard/frontend/src/components/Settings/AgentCards/ModelOverrideModal.tsx` |
| Settings UI (Main page) | `src/dashboard/frontend/src/components/Settings/SettingsPage.tsx` |
| OpenRouter service | `src/dashboard/server/services/openrouter-service.ts` |
| OpenRouter UI | `src/dashboard/frontend/src/components/Settings/OpenRouterPage.tsx` |
| UI fallback defaults | `src/dashboard/frontend/src/components/Settings/modelDefaults.ts` |
