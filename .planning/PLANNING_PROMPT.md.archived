<!-- panopticon:orchestration-context-start -->
<!-- This is Panopticon orchestration context injected automatically.
     It contains planning session setup instructions, not agent reasoning.
     Session summarizers should SKIP this block and focus on the agent's
     actual work, decisions, and tradeoffs that follow. -->

# Planning Session: PAN-598

## CRITICAL: PLANNING ONLY - NO IMPLEMENTATION

**YOU ARE IN PLANNING MODE. DO NOT:**
- Write or modify any code files (except STATE.md)
- Run implementation commands (npm install, docker compose, make, etc.)
- Create actual features or functionality
- Start implementing the solution

**YOU SHOULD ONLY:**
- Ask clarifying questions (use AskUserQuestion tool)
- Explore the codebase to understand context (read files, grep)
- Generate planning artifacts:
  - STATE.md (decisions, approach, architecture)
  - Beads tasks (via `bd create`)
  - Implementation plan at `docs/prds/active/{issue-id}/STATE.md` (copy of STATE.md, required for dashboard)
- Present options and tradeoffs for the user to decide

When planning is complete, STOP and tell the user: "Planning complete - click Done when ready to hand off to an agent for implementation."

---

## Issue Details
- **ID:** PAN-598
- **Title:** Support latest ChatGPT/OpenAI models with subscription tier awareness
- **URL:** https://github.com/eltmon/panopticon-cli/issues/598

## Description
## Summary

Integrate [claudish](https://github.com/MadAppGang/claudish) as the multi-model router (replacing `claude-code-router`) and add support for the latest ChatGPT/OpenAI models with awareness of subscription tiers vs API key access.

Claudish supports **OAuth-based ChatGPT Plus/Pro subscriptions** via the `cx@` prefix (e.g. `cx@gpt-4o`), allowing users to leverage their existing subscription instead of paying per-token via API keys (`oai@gpt-4o`). This is the key capability that `claude-code-router` lacks.

**Absorbs:** #601 (route work agents to OpenAI models) — once claudish is integrated, Cloister routes work agents to OpenAI models transparently. The agents stay Claude Code runtime; claudish handles the model routing.

## Current State

- Panopticon references `claude-code-router` (`@musistudio/claude-code-router`) but hasn't actively used it beyond early experiments
- 4 OpenAI models in `src/lib/model-capabilities.ts`: gpt-5.2-codex, o3-deep-research, gpt-4o, gpt-4o-mini
- No concept of subscription tier — all models treated as equally available if an API key exists
- No OAuth support for ChatGPT subscriptions

## Claudish Integration

Claudish (v6.12.0) provides:
- **OAuth login** (`claudish login`) for ChatGPT Plus/Pro, Gemini Code Assist, Kimi
- **Provider prefixes**: `cx@` (ChatGPT OAuth), `oai@` (OpenAI API key), `go@` (Google OAuth), `g@` (Gemini API key), etc.
- **580+ models** via OpenRouter as default backend
- Pre-built Linux/macOS binaries

### Auth Modes
| Prefix | Auth Method | Payment Model |
|--------|------------|---------------|
| `cx@`  | ChatGPT OAuth | Subscription (Plus/Pro) |
| `oai@` | OpenAI API key | Pay-per-token |
| `go@`  | Google OAuth | Subscription |
| `g@`   | Gemini API key | Pay-per-token |
| `kc@`  | Kimi OAuth | Subscription |

## What's Needed

1. **Replace `claude-code-router` with `claudish`** — update `pan install`, `pan sync`, and the `ccr` command to use claudish instead
2. **Add missing recent OpenAI models** to the capability registry (o3, o4-mini, gpt-4.1, gpt-4.1-mini, gpt-4.1-nano, etc.)
3. **Subscription tier configuration** — allow users to declare their auth mode per provider in `config.yaml`:
   ```yaml
   providers:
     openai:
       auth: subscription  # or "api-key"
       plan: pro            # free, plus, pro (only relevant for subscription)
   ```
4. **Provider prefix mapping in Cloister** — when routing to an OpenAI model, use the correct claudish prefix (`cx@` for subscription, `oai@` for API key) based on the user's configured auth mode
5. **Model availability filtering** — smart selector should only consider models available at the user's subscription tier
6. **Graceful fallback** — if a selected model requires a tier the user doesn't have, fall back via existing `model-fallback.ts` logic
7. **`claudish login` integration** — `pan install` or `pan setup` should guide users through `claudish login` for OAuth providers

## Work Agent Routing (from #601)

Once claudish is integrated, Cloister can route work agents to OpenAI models transparently:

- **Smart model selector** picks an OpenAI model when appropriate for the task
- **Claude Code spawns with claudish prefix** (e.g. `claude --model cx@o3 -p "..."`)
- **Agent lifecycle is unchanged** — same JSONL, same tmux, same health checks, same specialist handoffs
- **Dashboard shows the backing model** (e.g. "o3 via claudish") so the user knows what's running
- **Token usage and cost tracking** reflects actual OpenAI model usage from Claude Code's JSONL

This means Panopticon gets OpenAI model access for work agents **without a new runtime adapter** — it's all Claude Code under the hood.

## Files Likely Affected

- `src/lib/model-capabilities.ts` — model registry, new models
- `src/lib/providers.ts` — claudish provider config, prefix mapping
- `src/lib/config-yaml.ts` — subscription tier config schema
- `src/lib/smart-model-selector.ts` — tier-aware filtering
- `src/lib/model-fallback.ts` — tier-based fallback
- `src/lib/router-config.ts` — replace claude-code-router config generation with claudish
- `src/cli/commands/ccr/index.ts` — replace with claudish invocation
- `src/cli/commands/install.ts` — install claudish instead of claude-code-router
- `src/cli/commands/sync.ts` — check for claudish instead of claude-code-router

## Note: Homebrew Formula Bug

The claudish Homebrew formula (`madappgang/tap/claudish`) ships macOS-only binaries on Linux. Until this is fixed upstream, `pan install` should download the Linux binary directly from GitHub releases rather than using `brew install`.

## Acceptance Criteria

- [ ] claudish replaces claude-code-router as the multi-model router
- [ ] All current OpenAI API models are represented in the capability registry
- [ ] Users can configure OAuth (subscription) vs API key auth per provider
- [ ] Cloister routes with correct claudish prefix based on auth mode
- [ ] Smart selector only considers models available at the user's tier
- [ ] Graceful fallback when a model is tier-restricted
- [ ] `pan install` installs claudish correctly on Linux
- [ ] Work agents can be routed to OpenAI models via Cloister smart selector
- [ ] Spawned agents use correct claudish model prefix (e.g. `cx@o3`)
- [ ] Dashboard displays backing model for claudish-routed agents
- [ ] Token usage tracking works for OpenAI-routed agents

---

## Your Mission

You are a planning agent conducting a **discovery session** for this issue.

### Phase 1: Understand Context
1. **If a spec file was provided above**, read it thoroughly — it's your primary input
2. Read the codebase to understand relevant files and patterns
3. Identify what subsystems/files this issue affects
4. Note any existing patterns we should follow

### Phase 2: Discovery Conversation
Use AskUserQuestion tool to ask contextual questions:
- What's the scope? What's explicitly OUT of scope?
- Any technical constraints or preferences?
- What does "done" look like?
- Are there edge cases we need to handle?

### Difficulty Estimation

For each sub-task, estimate difficulty using this rubric:

| Level | When to Use | Model |
|-------|-------------|-------|
| `trivial` | Typo, comment, formatting only | haiku |
| `simple` | Bug fix, single file, obvious change | haiku |
| `medium` | New feature, 3-5 files, standard patterns | sonnet |
| `complex` | Refactor, migration, 6+ files, some risk | sonnet |
| `expert` | Architecture, security, performance, high risk | opus |

### Phase 3: Generate Artifacts (NO CODE!)
When discovery is complete:
1. Create STATE.md with decisions made
2. Copy STATE.md to implementation plan at `docs/prds/active/{issue-id}/STATE.md` (required for dashboard)
3. Create a vBRIEF plan file at `.planning/plan.vbrief.json` — **MUST follow the exact format below**
4. Summarize the plan and STOP

**DO NOT run `bd create` commands.** Beads tasks are created automatically from `plan.vbrief.json` by Cloister when planning completes.

### vBRIEF Plan Format (REQUIRED)

The plan file MUST conform to vBRIEF v0.5 spec (https://github.com/deftai/vBRIEF).
It MUST have exactly two top-level keys: `vBRIEFInfo` and `plan`.

```json
{
  "vBRIEFInfo": {
    "version": "0.5",
    "created": "<ISO 8601 timestamp>",
    "author": "panopticon-cli/0.0.0",
    "description": "Plan for PAN-598: <issue title>"
  },
  "plan": {
    "id": "pan-598",
    "title": "<issue title>",
    "status": "approved",
    "uid": "<generate a UUID v4>",
    "author": "agent:claude-opus-4-6",
    "sequence": 1,
    "created": "<ISO 8601 timestamp — same as vBRIEFInfo.created>",
    "updated": "<ISO 8601 timestamp — same as created>",
    "references": [
      { "uri": "https://github.com/eltmon/panopticon-cli/issues/598", "label": "PAN-598", "type": "issue" }
    ],
    "tags": ["<relevant tags>"],
    "narratives": {
      "Problem": "<what problem this solves>",
      "Proposal": "<the approach chosen>"
    },
    "items": [
      {
        "id": "<short-kebab-id>",
        "title": "<task title>",
        "status": "pending",
        "priority": "medium",
        "created": "<ISO 8601 timestamp>",
        "metadata": {
          "difficulty": "trivial|simple|medium|complex|expert",
          "issueLabel": "pan-598"
        },
        "narrative": { "Action": "<what needs to be done>" },
        "subItems": [
          {
            "id": "<parent-id>.ac1",
            "title": "<specific testable acceptance criterion>",
            "status": "pending",
            "metadata": { "kind": "acceptance_criterion" }
          }
        ]
      }
    ],
    "edges": [
      { "from": "<source-item-id>", "to": "<target-item-id>", "type": "blocks" }
    ]
  }
}
```

**CRITICAL vBRIEF rules:**
- The file MUST have `vBRIEFInfo` and `plan` as the ONLY top-level keys
- `plan.id` MUST be the issue ID in lowercase (e.g., "pan-598")
- `plan.uid` MUST be a freshly generated UUID v4
- Do NOT use `issue`, `issueId`, or `issue_id` — use `plan.id`
- `items[].status` MUST be one of: draft, proposed, approved, pending, running, completed, blocked, cancelled
- Acceptance criteria MUST be `subItems` with `metadata.kind: "acceptance_criterion"`
- `metadata.difficulty` and `metadata.issueLabel` are Panopticon extensions to the vBRIEF spec
- Edge types: `blocks` (hard dependency), `informs` (soft), `invalidates`, `suggests`

**IMPORTANT:** Create the plan file BEFORE creating beads tasks.
**NOTE:** `*-spec.md` files are human-written specs — do NOT overwrite them. Your output is `*-plan.md`.

**Remember:** Be a thinking partner, not an interviewer. Ask questions that help clarify.

Start by exploring the codebase to understand the context, then begin the discovery conversation.

<!-- panopticon:orchestration-context-end -->
