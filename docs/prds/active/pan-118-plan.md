# PAN-118 Planning: Work Type System and Multi-Model Routing

## Discovery Summary

### Current State

I've analyzed the existing model routing infrastructure. Here's what already exists:

#### ✅ What's Working

1. **Settings System** (`src/lib/settings.ts`)
   - TypeScript config structure for models and API keys
   - Specialists: review_agent, test_agent, merge_agent
   - Complexity levels: trivial, simple, medium, complex, expert
   - Planning agent configuration
   - Deep merge for user overrides

2. **Router Infrastructure**
   - `src/lib/router-config.ts` - Generates claude-code-router config
   - `src/lib/cloister/router.ts` - ModelRouter class for complexity-based routing
   - `src/lib/agents.ts` - `determineModel()` function in agent spawning

3. **Settings UI** (`src/dashboard/frontend/src/components/SettingsPage.tsx`)
   - Basic dropdowns for specialists, complexity levels, planning agent
   - API key management (with show/hide)
   - Available models filtered by configured API keys

4. **Specialists** (`src/lib/cloister/specialists.ts`)
   - Properly using settings.models.specialists for model selection
   - Lines 591-600 load settings and map specialist names to model IDs

#### ❌ What's Missing (Core Issue Scope)

1. **20 Work Type IDs** - Not being used anywhere
   - Documentation defines: `issue-agent:exploration`, `issue-agent:planning`, `subagent:plan`, `convoy:security-reviewer`, etc.
   - Code only uses: `specialists.*`, `planning_agent`, `complexity.*`
   - Gap: 15+ work types are documented but not implemented

2. **Preset System** - No implementation
   - Documentation defines: Premium, Balanced, Budget
   - No preset loading or switching logic
   - No preset-specific model mappings

3. **Fallback Strategy** - No implementation
   - Documentation defines fallbacks: `gpt-*` → `claude-sonnet-4-5`, etc.
   - No detection of missing API keys
   - No automatic substitution

4. **Planning vs Decomposition** - Still conflated
   - No separate decomposition agent
   - Planning does both "how to build" and "what tasks"

5. **Settings UI Enhancements** - Missing:
   - Preset selector dropdown
   - Per-work-type override table
   - Visual cost indicators
   - Thinking level controls for Gemini

### Architecture Decisions (User Confirmed)

✅ **Work Type Scope**: Implement all 20 work types (complete)
✅ **Config Levels**: Global + Per-Project (recommended)
✅ **Planning Split**: Now (included in PAN-118)
✅ **Default Preset**: Balanced (recommended)
✅ **Model Family Control**: Add enable/disable toggles for entire model families (Anthropic, OpenAI, Google, Z.AI)

---

## Implementation Plan

### Phase 1: Core Infrastructure (Foundation)

**Goal**: Build the model routing system that supports all 20 work types with presets and fallbacks.

#### 1.1 Work Type Registry (`src/lib/work-types.ts`)

**Purpose**: Central registry of all 20 work type IDs with metadata.

```typescript
export const WORK_TYPES = {
  // Issue agent phases (6)
  'issue-agent:exploration': { phase: 'exploration', category: 'issue-agent' },
  'issue-agent:planning': { phase: 'planning', category: 'issue-agent' },
  'issue-agent:implementation': { phase: 'implementation', category: 'issue-agent' },
  'issue-agent:testing': { phase: 'testing', category: 'issue-agent' },
  'issue-agent:documentation': { phase: 'documentation', category: 'issue-agent' },
  'issue-agent:review-response': { phase: 'review-response', category: 'issue-agent' },

  // Specialist agents (3)
  'specialist-review-agent': { category: 'specialist' },
  'specialist-test-agent': { category: 'specialist' },
  'specialist-merge-agent': { category: 'specialist' },

  // Subagents (4)
  'subagent:explore': { category: 'subagent' },
  'subagent:plan': { category: 'subagent' },
  'subagent:bash': { category: 'subagent' },
  'subagent:general-purpose': { category: 'subagent' },

  // Convoy members (4)
  'convoy:security-reviewer': { category: 'convoy' },
  'convoy:performance-reviewer': { category: 'convoy' },
  'convoy:correctness-reviewer': { category: 'convoy' },
  'convoy:synthesis-agent': { category: 'convoy' },

  // Pre-work agents (4)
  'prd-agent': { category: 'pre-work' },
  'decomposition-agent': { category: 'pre-work' },
  'triage-agent': { category: 'pre-work' },
  'planning-agent': { category: 'pre-work' },

  // CLI contexts (2)
  'cli:interactive': { category: 'cli' },
  'cli:quick-command': { category: 'cli' },
} as const;

export type WorkTypeId = keyof typeof WORK_TYPES;
```

#### 1.2 Preset Definitions (`src/lib/model-presets.ts`)

**Purpose**: Define the three presets (Premium, Balanced, Budget) with model mappings for all 20 work types.

```typescript
export interface PresetConfig {
  name: 'premium' | 'balanced' | 'budget';
  displayName: string;
  description: string;
  models: Record<WorkTypeId, ModelId>;
}

export const PRESETS: Record<string, PresetConfig> = {
  premium: {
    name: 'premium',
    displayName: 'Premium',
    description: 'Best quality - uses top-tier models',
    models: {
      'issue-agent:exploration': 'gemini-3-flash-preview',
      'issue-agent:planning': 'claude-opus-4-5',
      // ... all 20 work types
    }
  },
  balanced: { /* ... */ },
  budget: { /* ... */ }
};
```

#### 1.3 Fallback Strategy (`src/lib/model-fallback.ts`)

**Purpose**: Detect missing API keys and map non-Anthropic models to Anthropic equivalents.

```typescript
export function applyFallback(modelId: ModelId, enabledProviders: Set<string>): ModelId {
  const provider = getModelProvider(modelId);

  if (enabledProviders.has(provider)) {
    return modelId; // Provider enabled, no fallback needed
  }

  // Map to Anthropic equivalent
  const fallbackMap: Record<string, ModelId> = {
    'gpt-5.2-codex': 'claude-sonnet-4-5',
    'gpt-4o': 'claude-sonnet-4-5',
    'gpt-4o-mini': 'claude-haiku-4-5',
    'o3-deep-research': 'claude-opus-4-5',
    'gemini-3-pro-preview': 'claude-sonnet-4-5',
    'gemini-3-flash-preview': 'claude-haiku-4-5',
    'glm-4.7': 'claude-haiku-4-5',
    'glm-4.7-flash': 'claude-haiku-4-5',
  };

  const fallback = fallbackMap[modelId] || 'claude-sonnet-4-5';
  console.warn(`Model ${modelId} requires ${provider} API key - falling back to ${fallback}`);
  return fallback;
}
```

#### 1.4 Model Router Refactor (`src/lib/model-router.ts`)

**Purpose**: Replace the complexity-based router with a work-type-based router.

**Key changes**:
- Load preset from config
- Apply per-project overrides
- Apply fallback strategy
- Resolve model for any work type ID

```typescript
export class WorkTypeRouter {
  private config: RouterConfig;

  constructor() {
    this.config = this.loadConfig();
  }

  /**
   * Get model for a specific work type
   * Resolution order:
   * 1. Per-project override (.panopticon.yaml)
   * 2. Global override (~/.panopticon/config.yaml)
   * 3. Preset default
   * 4. Fallback if provider disabled
   */
  getModel(workTypeId: WorkTypeId): ModelId {
    // ...
  }

  private loadConfig(): RouterConfig {
    // Load global config
    const globalConfig = loadGlobalConfig();

    // Load per-project config (if in project directory)
    const projectConfig = loadProjectConfig();

    // Merge with precedence: project > global > preset
    return mergeConfigs(globalConfig, projectConfig);
  }
}
```

#### 1.5 Config File Schema

**Global**: `~/.panopticon/config.yaml`
```yaml
models:
  # Preset selection
  preset: balanced  # premium | balanced | budget

  # Provider enable/disable
  providers:
    anthropic: true   # Always enabled (required)
    openai: false     # Disabled (no API key or user preference)
    google: true      # Enabled
    zai: false        # Disabled

  # Per-work-type overrides
  overrides:
    issue-agent:implementation: gpt-5.2-codex
    convoy:security-reviewer: claude-opus-4-5

  # API keys
  api_keys:
    openai: $OPENAI_API_KEY
    google: $GOOGLE_API_KEY
```

**Per-Project**: `.panopticon.yaml` (project root)
```yaml
models:
  preset: premium  # Override global preset for this project

  overrides:
    # Never compromise on security, even in budget mode
    convoy:security-reviewer: claude-opus-4-5
```

---

### Phase 2: Agent Integration

**Goal**: Update all agent spawning code to use work type IDs instead of complexity levels or hard-coded models.

#### 2.1 Issue Agent Phases

**Files**: `src/lib/agents.ts`, `src/cli/commands/work/issue.ts`

**Changes**:
- Track current phase in agent state
- Pass work type ID when spawning: `spawnAgent({ workType: 'issue-agent:exploration', ... })`
- Router resolves model based on work type

#### 2.2 Specialist Agents

**Files**: `src/lib/cloister/specialists.ts`

**Changes**:
- Use work type IDs: `specialist-review-agent`, `specialist-test-agent`, `specialist-merge-agent`
- Lines 591-600: Replace manual settings lookup with router call

#### 2.3 Subagents (Task Tool)

**Files**: Need to identify where Task tool spawns subagents

**Changes**:
- Map subagent types to work type IDs: `explore` → `subagent:explore`

#### 2.4 Convoy Members

**Files**: `src/lib/cloister/convoy.ts`, `src/lib/convoy-templates.ts`

**Changes**:
- Use work type IDs: `convoy:security-reviewer`, etc.

#### 2.5 Pre-Work Agents

**New implementations required**:
- `prd-agent` - PRD generation workflow
- `decomposition-agent` - Task decomposition (split from planning)
- `triage-agent` - Issue prioritization
- `planning-agent` - Already exists, just needs work type ID

---

### Phase 3: Planning/Decomposition Separation

**Goal**: Decouple planning (architecture/approach) from decomposition (task breakdown).

#### 3.1 Planning Agent (`src/lib/planning/planning-agent.ts`)

**Focus**: High-level architecture and approach selection
- "How should we build this?"
- Design decisions
- Technology choices
- Architectural patterns

**Output**: Planning document (STATE.md)

#### 3.2 Decomposition Agent (`src/lib/planning/decomposition-agent.ts`)

**Focus**: Breaking work into tasks
- "What are the specific tasks?"
- Beads generation
- Dependency mapping
- Effort estimation

**Input**: Planning document (STATE.md) or PRD
**Output**: Beads tasks with dependencies

#### 3.3 Workflow Integration

**Sequence**:
1. User creates issue or runs `/plan`
2. Planning agent explores and creates STATE.md
3. User approves plan
4. Decomposition agent reads STATE.md and generates beads
5. Work agent starts implementation

---

### Phase 4: Settings UI Complete Redesign (Using Stitch)

**Goal**: Redesign the entire Settings page using Stitch for a modern, intuitive model routing configuration experience.

**Approach**: Use Google Stitch MCP integration to design and generate UI components.

#### 4.1 Stitch Design - Settings Page Mockup

**Process**:
1. Create Stitch project for Settings page
2. Design mockup with all sections:
   - Preset selector (cards with visual indicators)
   - Provider management (toggles + API keys)
   - Work type override table (advanced section)
   - Gemini thinking level controls
3. Generate React components from Stitch design
4. Integrate with existing Settings API

**Design Principles**:
- **Visual hierarchy**: Preset selector prominent, advanced options collapsible
- **Cost awareness**: Show estimated cost impact of preset changes
- **Provider clarity**: Visual indication of enabled/disabled providers
- **Work type discoverability**: Categorized view (issue-agent, specialist, convoy, etc.)
- **Real-time preview**: Show effective model for each work type as config changes

#### 4.2 Component Structure (Stitch-Generated)

```
SettingsPage/
├── PresetSelector/          # Card-based preset chooser
│   ├── PresetCard.tsx       # Individual preset (Premium/Balanced/Budget)
│   └── CostIndicator.tsx    # Visual cost/quality meter
├── ProviderPanel/           # Provider management
│   ├── ProviderToggle.tsx   # Enable/disable with API key input
│   └── ProviderStatus.tsx   # Connection status, model availability
├── WorkTypeOverrides/       # Advanced overrides
│   ├── WorkTypeTable.tsx    # Categorized work type list
│   ├── ModelSelector.tsx    # Dropdown with provider filtering
│   └── OverrideIndicator.tsx # Badge showing override vs preset
└── ThinkingLevelControl/    # Gemini-specific
    └── ThinkingSlider.tsx   # Granular thinking level control
```

#### 4.3 Implementation Steps

1. **Stitch Design Phase**:
   - Generate mockup prompt for Stitch
   - Iterate on design with user feedback
   - Export component specifications

2. **Component Generation**:
   - Use Stitch to generate base components
   - Add state management (React Query)
   - Wire up to Settings API

3. **Integration**:
   - Replace existing SettingsPage.tsx with Stitch-generated version
   - Preserve existing API calls
   - Add Playwright tests for new UI

4. **Polish**:
   - Animations and transitions
   - Error handling and validation
   - Mobile responsiveness

---

### Phase 5: Testing & Documentation

#### 5.1 Unit Tests

**Files**:
- `tests/lib/work-types.test.ts` - Work type registry
- `tests/lib/model-presets.test.ts` - Preset definitions
- `tests/lib/model-fallback.test.ts` - Fallback strategy
- `tests/lib/model-router.test.ts` - Router resolution logic

#### 5.2 Integration Tests

**Files**:
- `tests/integration/agent-spawning.test.ts` - End-to-end agent spawn with work types
- `tests/integration/config-precedence.test.ts` - Global vs project config
- `tests/integration/preset-switching.test.ts` - Preset changes propagate

#### 5.3 Documentation

**Files**:
- `docs/CONFIGURATION.md` - Config file examples and reference
- `docs/WORK-TYPES.md` - Already exists, verify accuracy
- `README.md` - Link to work types and configuration docs
- Settings UI help text - In-app guidance

---

## Risk Assessment

### High Risk
1. **Breaking changes to agent spawning** - All agent spawn code needs updating
   - Mitigation: Backward compatibility shim for old model parameter

2. **Config file migration** - Existing settings.json → new YAML format
   - Mitigation: Auto-migration script, fallback to defaults

### Medium Risk
3. **Planning/decomposition split** - Workflow changes may confuse existing patterns
   - Mitigation: Clear documentation, gradual rollout

4. **Preset system complexity** - Three levels of config (preset, global, project)
   - Mitigation: UI shows effective config, debugging command

### Low Risk
5. **Settings UI changes** - Frontend changes are visible and testable
   - Mitigation: Playwright tests, manual testing

---

## Decisions (Finalized)

✅ **Config file format**: YAML
   - More human-friendly, supports comments
   - Migrate existing settings.json → config.yaml
   - Use `js-yaml` for parsing

✅ **Backward compatibility**: No - breaking change
   - All agent spawning code must use work type IDs
   - Remove old `model` parameter
   - Simpler codebase, clearer semantics

⏭️ **Preset cost preview**: Deferred to future enhancement
   - Not blocking for PAN-118
   - Would require cost modeling system

---

## Success Criteria

- [ ] All 20 work type IDs defined and documented
- [ ] Preset system (Premium, Balanced, Budget) fully functional
- [ ] Fallback strategy works when API keys missing
- [ ] Global and per-project config files supported
- [ ] Provider enable/disable toggles in Settings UI
- [ ] Planning and decomposition are separate workflows
- [ ] All tests pass
- [ ] Documentation complete and accurate

---

## Estimated Effort

**Total**: 12-16 hours focused work

**Breakdown**:
- Phase 1 (Infrastructure): 4-5 hours
- Phase 2 (Agent Integration): 3-4 hours
- Phase 3 (Planning/Decomposition): 2-3 hours
- Phase 4 (Settings UI): 2-3 hours
- Phase 5 (Testing/Docs): 1-2 hours
