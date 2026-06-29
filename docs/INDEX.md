# Overdeck Documentation Index

**Master index of all Overdeck documentation organized by category.**

---

## Getting Started

| Document | Description |
|----------|-------------|
| [README.md](../README.md) | Project overview, installation, and quickstart guide |
| [QUICK-REFERENCE.md](./QUICK-REFERENCE.md) | Command taxonomy cheat sheet — all `pan` commands, organized by bucket (lifecycle, observation, nouns, system, admin), including current `pan admin config` scope |
| [USAGE.md](./USAGE.md) | Detailed CLI usage examples |
| [RELEASING.md](./RELEASING.md) | Stable vs canary release policy and intentional tag-driven workflow |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Contribution guidelines and development setup |

---

## Architecture & Design

| Document | Description |
|----------|-------------|
| [AGENTS.md](./AGENTS.md) | Agent directory structure, naming patterns, standard contents, and cleanup |
| [AGENT-STATE-PLANES.md](./AGENT-STATE-PLANES.md) | Three-plane state model: permanent git records, local SQLite runtime registry, and tmux liveness oracle |
| [CODEBASE-HEALTH-ROADMAP.md](./CODEBASE-HEALTH-ROADMAP.md) | Architecture debt-reduction roadmap (four epics A–D): why fix-work dominates feature-work, the deep-module diagnosis, and the handoff-orchestration execution model. PRDs under [codebase-health/](./codebase-health/) |
| [PAN-1908-POST-MERGE-RUNBOOK.md](./PAN-1908-POST-MERGE-RUNBOOK.md) | Post-merge close-out runbook for superseded/narrowed issues tracked by PAN-1908 |
| [Architecture Diagram](./diagrams/overdeck-architecture.png) | Visual overview of Overdeck system architecture (UI → Core → Agents → Infrastructure → Pipeline)
| [Specialist Pipeline Diagram](./diagrams/overdeck-specialist-pipeline.png) | Visual overview of the work-agent → verification gate → specialist handoff flow |
| [AGENT_TYPES_INDEX.md](./AGENT_TYPES_INDEX.md) | Newcomer-friendly map of Overdeck agent roles, categories, and where they appear in the workflow |
| [ROLES.md](./ROLES.md) | Mental model for Roles, sub-roles, and the three on-disk file shapes (`roles/*.md`, `agents/pan-*-agent.md`, `.claude/agents/*.md`) — what each is, when to use it, and how a run actually gets its instructions |
| [SPECIALIST_WORKFLOW.md](./SPECIALIST_WORKFLOW.md) | Deeper workflow guide for how the work agent and specialist agents interact |
| [REVIEW-AGENT-ARCHITECTURE.md](./REVIEW-AGENT-ARCHITECTURE.md) | End-to-end code review architecture: synthesis-as-review, convoy reviewers as harness-agnostic prompt templates inlined by the orchestrator, output-file contract, and verdict signaling |
| [SKILL-DISTRIBUTION-ANALYSIS.md](./SKILL-DISTRIBUTION-ANALYSIS.md) | Skill distribution architecture: Claude Code precedence, symlink issues, proposed changes |
| [SKILLS-INVENTORY.md](./SKILLS-INVENTORY.md) | Installed Claude Code skills inventory, including scope and one-line purpose for each skill |
| [SKILLS-CONVENTION.md](./SKILLS-CONVENTION.md) | How Overdeck's `pan-*` skills relate to the `pan` CLI binary, the four skill shapes, and the linter that keeps them in sync |
| [configuration/harnesses.mdx](../configuration/harnesses.mdx) | Operational guide for the two supported coding-agent harnesses (`claude-code`, `pi`): install, picker locations, ToS rules, troubleshooting. *Published — `docs/HARNESSES.md` is now a redirect stub.* |
| [reference/harness-landscape.mdx](../reference/harness-landscape.mdx) | Planning survey of 13 coding-agent harnesses — extensibility mechanisms, skill/AGENTS.md/MCP support, headless interfaces, and harness-adoption implications |
| [reference/template-conversations.mdx](../reference/template-conversations.mdx) | Proposal: loading curated skill bundles into a single conversation without touching the global `pan sync` skill set |
| [REPO-ARTIFACTS.md](./REPO-ARTIFACTS.md) | What lives in a project's repo: `.pan/`, skills hierarchy, `vbrief/` lifecycle dirs, PRD vs vBRIEF, multi-tool sync |
| [VISION.md](./VISION.md) | Product vision and deployment model roadmap (local → shared → SaaS) |
| [PRD.md](./PRD.md) | Product requirements document for Overdeck |
| [PRD-CLOISTER.md](./PRD-CLOISTER.md) | Cloister lifecycle manager requirements (historical — see DEACON doc for current state) |
| [DEACON-HEALTH-MONITORING.md](./DEACON-HEALTH-MONITORING.md) | Deacon health monitoring: all 10 stuck detection mechanisms, thresholds, escalation, recovery |
| [PRD-REMOTE-WORKSPACES.md](./PRD-REMOTE-WORKSPACES.md) | Remote workspace requirements |
| [VBRIEF.md](./VBRIEF.md) | vBRIEF plan format, lifecycle directories, continue state, `pan scope` commands |
| [HIERARCHICAL-PLANNING.md](./HIERARCHICAL-PLANNING.md) | vBRIEF planning, DAG scheduling, acceptance criteria pipeline |
| [SWARM.md](./SWARM.md) | Per-item DAG dispatch, synthesis agents at convergence points, file-overlap serialization, slot-merge auto-advance, `pan swarm` CLI + `--task` operations, HTTP routes, `SwarmRuntime` continue-state shape, DAG library API |
| [FLYWHEEL.md](./FLYWHEEL.md) | Flywheel contract, lifecycle, role settings, brief authoring, status vs state, and skill → CLI → API → UI mapping |
| [flywheel-brief.md](./flywheel-brief.md) | Default operating contract the Flywheel orchestrator reads at the start of every run |
| [UAT-BATCH-TRAINS.md](./UAT-BATCH-TRAINS.md) | UAT batch trains (PAN-1737): auto-assembled rolling `uat/*` generations with in-batch conflict resolution, promote-the-batch merge, on-demand live UAT stacks, the reconciler, API, and the "UAT batches" card |
| [MERGE-WORKFLOW.md](./MERGE-WORKFLOW.md) | Per-issue merge state machine (work-done → review-passed → rebased → merged); the escape-hatch path that batch promotion sits above |
| [MERGE-TRAIN.md](./MERGE-TRAIN.md) | Historical PAN-1691 merge-train PRD — superseded by UAT-BATCH-TRAINS.md; retained for the engine/policy decision record |
| [FIX-ALL-PRD.md](./FIX-ALL-PRD.md) | Consolidated into `flywheel-brief.md` and `FLYWHEEL.md` (redirect only — original content in git history) |
| [OPERATION-FIX-ALL.md](./OPERATION-FIX-ALL.md) | Consolidated into `flywheel-brief.md` (redirect only — original content in git history) |

---

## Configuration

| Document | Description |
|----------|-------------|
| [CONFIGURATION.md](./CONFIGURATION.md) | Capability-based model routing, provider auth, subscription vs API-key setup, overrides, and fallback behavior |
| [CODEX-AUTH.md](./CODEX-AUTH.md) | Codex CLI OAuth authentication: JWT expiry detection, burned-token handling, and the dashboard re-authentication flow |
| [WORK-TYPES.md](./WORK-TYPES.md) | Router-backed job settings: every work type, when it runs, and what each override controls |
| [MODEL_RECOMMENDATIONS.md](./MODEL_RECOMMENDATIONS.md) | Practical guidance for choosing model families for implementation, review, planning, helpers, and CLI work |
| [projects.mdx](../configuration/projects.mdx) | Project registry and configuration fields (tracker, issue_prefixes, progressive) |
| [polyrepo.mdx](../configuration/polyrepo.mdx) | Multi-repository workspace management (links to progressive for 10+ repos) |
| [progressive-polyrepo.mdx](../configuration/progressive-polyrepo.mdx) | Large-scale polyrepo with on-demand repo checkout |
| [setup-wizard.mdx](../configuration/setup-wizard.mdx) | Interactive project setup with AI-assisted configuration |
| [meta-repos.mdx](../configuration/meta-repos.mdx) | Team conventions, shared skills, and onboarding via meta repos |
| [issue-trackers.mdx](../configuration/issue-trackers.mdx) | Connecting to Linear, GitHub, GitLab, and Rally |

---

## Infrastructure

| Document | Description |
|----------|-------------|
| [BUILD.md](./BUILD.md) | Build pipeline (tsdown + Vite), `__dirname` resolution, prompt template copying |
| [TERMINAL-INTERACTION-LAYERS.md](./TERMINAL-INTERACTION-LAYERS.md) | Browser/app shell vs wrapper vs xterm vs tmux ownership for right-click, wheel, selection, and terminal history |
| [WORKSPACE-DEPENDENCIES.md](./WORKSPACE-DEPENDENCIES.md) | Workspace dependency isolation: host vs container node_modules, package_manager config, Docker volumes |
| [ARCHITECTURE-CACHING.md](./ARCHITECTURE-CACHING.md) | Dashboard API caching, real-time push, and rate limit management |
| [DNS_SETUP.md](./DNS_SETUP.md) | Local DNS resolution for development |
| [cost-tracking.md](./cost-tracking.md) | Cost tracking: live recording, reconciler, session-to-agent mapping, SQLite schema |
| [TLDR.md](./TLDR.md) | TLDR code analysis — architecture, hooks, index lifecycle, API |
| [CONFIGURATION.md § External Services](./CONFIGURATION.md#external-service-integrations) | Cloudflare tunnels, Hume EVI, and adding new integrations |
| [FORKS.md](./FORKS.md) | Conversation forking: summary fork vs plain fork, options, thinking block handling, model switching |

---

## External Integrations

| Document | Description |
|----------|-------------|
| [EXTERNAL-EVENT-STREAM.md](./EXTERNAL-EVENT-STREAM.md) | Public SSE event feed at `/events/stream` — contract, event catalog, stability policy, example consumers (curl, Python, Node), and the `pan-tts` reference sidecar |

---

## Testing

| Document | Description |
|----------|-------------|
| [TESTING.md](./TESTING.md) | Testing guide: test suites, Playwright conventions, `data-testid` patterns |
| [E2E_TEST_PLAN.md](./E2E_TEST_PLAN.md) | End-to-end test plan and coverage |
| [TESTING-PROVIDERS.md](./TESTING-PROVIDERS.md) | Provider testing guide |

---

## Agent Guidance

| Document | Description |
|----------|-------------|
| [CLAUDE.md](../CLAUDE.md) | Agent instructions (commit rules, messaging API, completion requirements) |
| [.claude/rules/dashboard-node22-only.md](../.claude/rules/dashboard-node22-only.md) | Why dashboard must run under Node 22 (not Bun): node-pty PTY exits, circular ESM deps |

---

## UI/UX Design

| Document | Description |
|----------|-------------|
| [SETTINGS-UI-DESIGN.md](./SETTINGS-UI-DESIGN.md) | Settings page design and implementation |
| [god-view.md](./god-view.md) | God View — real-time agent activity command center (PAN-341) |
| [DESKTOP-APP.md](./DESKTOP-APP.md) | Electron desktop app — tray, notifications, auto-start, IPC bridge, protocol handler |
| [React Architecture Diagram](./diagrams/react-architecture.png) | Dashboard frontend component hierarchy (src/dashboard/frontend/src) — Zustand state, Effect RPC transport, feature pages, shared components, custom hooks |

---

## Planning (PRDs)

| Location | Description |
|----------|-------------|
| [docs/prds/active/](./prds/active/) | 13 active product requirement documents |
| [docs/prds/planned/PAN-724-agent-usage-analytics-dashboard.md](./prds/planned/PAN-724-agent-usage-analytics-dashboard.md) | Planned PRD for agent usage analytics, one-shot rates, and TLDR impact reporting |
| [docs/prds/completed/](./prds/completed/) | 31 completed product requirement documents |

---

## Topic Quick-Find

**Search by keyword to find relevant documentation:**

### General Topics
- **"getting started"** → README.md, CONTRIBUTING.md
- **"install"** / **"setup"** → README.md, CONTRIBUTING.md, DNS_SETUP.md
- **"quickstart"** → README.md
- **"release"** / **"releasing"** / **"stable"** / **"canary"** / **"tag"** → RELEASING.md, USAGE.md, QUICK-REFERENCE.md
- **"contribution"** / **"contributing"** → CONTRIBUTING.md

### Configuration & Models
- **"model routing"** / **"smart selection"** → CONFIGURATION.md, WORK-TYPES.md, MODEL_RECOMMENDATIONS.md
- **"shadow mode"** / **"pan admin config shadow"** → CONFIGURATION.md, QUICK-REFERENCE.md
- **"API keys"** / **"environment variables"** / **"subscription auth"** → CONFIGURATION.md
- **"codex auth"** / **"codex login"** / **"OAuth"** / **"JWT"** / **"re-authenticate"** / **"burned token"** → CODEX-AUTH.md
- **"providers"** / **"Kimi"** / **"Anthropic"** → CONFIGURATION.md, TESTING-PROVIDERS.md
- **"work types"** → WORK-TYPES.md
- **"presets"** / **"overrides"** → CONFIGURATION.md
- **"model recommendations"** → MODEL_RECOMMENDATIONS.md

### Agent System
- **"agent"** / **"agents"** → AGENTS.md, SPECIALIST_WORKFLOW.md, CLAUDE.md
- **"lifecycle"** → AGENTS.md, PRD-CLOISTER.md
- **"specialist"** / **"specialists"** → SPECIALIST_WORKFLOW.md
- **"worker"** → SPECIALIST_WORKFLOW.md
- **"cloister"** → AGENTS.md, PRD-CLOISTER.md
- **"handoff"** / **"handoffs"** → SPECIALIST_WORKFLOW.md
- **"stuck detection"** / **"stuck"** / **"nudge"** → DEACON-HEALTH-MONITORING.md
- **"session ID"** / **"session persistence"** → SPECIALIST_WORKFLOW.md (Session Persistence & Memory)
- **"deterministic UUID"** → SPECIALIST_WORKFLOW.md (Session Persistence & Memory)
- **"merge"** / **"merge validation"** → PRD-CLOISTER.md (Merge Validation Pipeline section)
- **"vBRIEF"** / **"DAG"** / **"acceptance criteria"** / **"planning"** → VBRIEF.md, HIERARCHICAL-PLANNING.md, SPECIALIST_WORKFLOW.md
- **"swarm"** / **"pan swarm"** / **"per-item dispatch"** / **"synthesis agent"** / **"files_scope"** / **"slot-merged"** / **"SwarmRuntime"** → SWARM.md
- **"beads conversion"** / **"createBeadsFromVBrief"** → HIERARCHICAL-PLANNING.md
- **"sync with main"** / **"sync-main"** → SPECIALIST_WORKFLOW.md (Sync with Main section)
- **"deacon"** / **"health monitor"** / **"health"** / **"patrol"** → DEACON-HEALTH-MONITORING.md
- **"rollback"** / **"revert"** / **"ORIG_HEAD"** → PRD-CLOISTER.md
- **"baseline"** / **"test baseline"** → PRD-CLOISTER.md
- **"review pipeline"** / **"specialist pipeline"** → PRD-CLOISTER.md, SPECIALIST_WORKFLOW.md
- **"role primitive"** / **"what is a Role"** / **"Role vs subagent"** / **"sub-role"** → ROLES.md
- **"roles/ directory"** / **"agents/ vs .claude/agents/"** / **"workflow-injected prompt"** → ROLES.md
- **"review architecture"** / **"review orchestrator"** / **"synthesis model"** / **"review invariants"** → REVIEW-AGENT-ARCHITECTURE.md
- **"convoy reviewers"** / **"reviewer prompts"** / **"synthesis prompt"** / **"roles/review-*.md"** → REVIEW-AGENT-ARCHITECTURE.md
- **"dashboard restart"** / **"review survives restart"** → REVIEW-AGENT-ARCHITECTURE.md (invariants)
- **"planning"** / **"planning agent"** / **"PLANNING_PROMPT"** → SPECIALIST_WORKFLOW.md (Planning → Implementation Transition)
- **"environment variables"** / **"agent env"** → SPECIALIST_WORKFLOW.md (Agent Environment Variables), CONFIGURATION.md
- **"suggested prompts"** → SPECIALIST_WORKFLOW.md (Agent Environment Variables)

### Infrastructure
- **"workspace"** / **"workspaces"** → README.md, PRD-REMOTE-WORKSPACES.md
- **"Docker"** / **"Docker networks"** / **"network pool"** → README.md, DNS_SETUP.md, CLAUDE.md (postMergeLifecycle Docker Cleanup)
- **"project resolution"** / **"issue prefix"** / **"linear_team"** → CLAUDE.md (Project Resolution from Issue IDs)
- **"Hume"** / **"EVI"** / **"voice"** / **"BYOLLM"** → CONFIGURATION.md (External Service Integrations)
- **"tunnel"** / **"Cloudflare"** → CONFIGURATION.md (External Service Integrations)
- **"external services"** / **"integrations"** → CONFIGURATION.md (External Service Integrations)
- **"DNS"** / **"domains"** → DNS_SETUP.md
- **"remote"** → PRD-REMOTE-WORKSPACES.md
- **"git"** / **"worktree"** → README.md, CLAUDE.md
- **"terminal"** / **"WebSocket"** / **"PTY"** / **"tmux attach"** → CLAUDE.md (Dashboard Terminal WebSocket Architecture), TERMINAL-INTERACTION-LAYERS.md
- **"context menu"** / **"right-click"** / **"wheel"** / **"trackpad"** / **"two-finger scroll"** → TERMINAL-INTERACTION-LAYERS.md
- **"capture-pane"** / **"send-keys"** → CLAUDE.md (Dashboard Terminal WebSocket Architecture, tmux Message Delivery)

### External Integrations & Event Stream
- **"external event"** / **"event stream"** / **"SSE"** / **"/events/stream"** → EXTERNAL-EVENT-STREAM.md
- **"webhook"** / **"subscriber"** / **"sidecar"** / **"third-party integration"** → EXTERNAL-EVENT-STREAM.md
- **"activity.entry"** / **"public event catalog"** / **"DomainEvent"** → EXTERNAL-EVENT-STREAM.md
- **"TTS"** / **"text-to-speech"** / **"pan-tts"** → EXTERNAL-EVENT-STREAM.md, `skills/pan-tts/SKILL.md`
- **"Last-Event-ID"** / **"event replay"** / **"resume"** → EXTERNAL-EVENT-STREAM.md

### Monitoring & Cost
- **"cost"** / **"billing"** / **"tracking"** → cost-tracking.md, CONFIGURATION.md
- **"monitoring"** / **"heartbeat"** → AGENTS.md
- **"metrics"** → cost-tracking.md
- **"caching"** / **"cache"** / **"rate limit"** → ARCHITECTURE-CACHING.md
- **"socket.io"** / **"real-time"** / **"push"** → ARCHITECTURE-CACHING.md
- **"ETag"** / **"304"** / **"backoff"** → ARCHITECTURE-CACHING.md

### Build & Development
- **"build"** / **"tsdown"** / **"rolldown"** / **"vite"** → BUILD.md
- **"__dirname"** / **"bundled server"** / **"prompt template"** → BUILD.md
- **"dist"** / **"production build"** → BUILD.md
- **"node-pty"** / **"bun dashboard"** / **"pan up node"** / **"terminal PTY"** / **"circular ESM"** → `.claude/rules/dashboard-node22-only.md`, CLAUDE.md
- **"electron"** / **"desktop"** / **"AppImage"** / **"DMG"** / **"electron-builder"** → DESKTOP-APP.md, BUILD.md
- **"tray"** / **"system tray"** / **"notification"** / **"auto-start"** / **"nag"** → DESKTOP-APP.md
- **"command palette"** / **"Cmd+K"** / **"Ctrl+K"** → DESKTOP-APP.md
- **"contextBridge"** / **"IPC bridge"** / **"overdeckBridge"** / **"preload"** → DESKTOP-APP.md
- **"overdeck://"** / **"custom protocol"** / **"path traversal"** → DESKTOP-APP.md
- **"npx overdeck serve"** / **"browser-only"** → DESKTOP-APP.md, USAGE.md

### Testing
- **"test"** / **"testing"** → TESTING.md, E2E_TEST_PLAN.md, TESTING-PROVIDERS.md
- **"E2E"** / **"end-to-end"** → E2E_TEST_PLAN.md
- **"coverage"** → E2E_TEST_PLAN.md
- **"playwright"** / **"data-testid"** / **"smoke test"** → TESTING.md
- **"test-agent"** / **"test specialist"** → TESTING.md, SPECIALIST_WORKFLOW.md

### Development
- **"skills"** → README.md, CLAUDE.md, REPO-ARTIFACTS.md
- **".pan"** / **".pan.yaml"** / **"repo artifacts"** → REPO-ARTIFACTS.md
- **"STATE.md archive"** / **"vBRIEF archive"** / **"planning artifacts"** / **"continue state"** → REPO-ARTIFACTS.md, VBRIEF.md
- **"lifecycle"** / **"vbrief lifecycle"** / **"proposed"** / **"active"** / **"completed"** / **"cancelled"** → VBRIEF.md, REPO-ARTIFACTS.md
- **"pan scope"** / **"scope list"** / **"scope approve"** / **"scope restore"** → VBRIEF.md
- **"also_sync"** / **"multi-tool sync"** / **"cursor sync"** / **"codex sync"** → REPO-ARTIFACTS.md
- **"commit"** / **"git commit"** → CLAUDE.md
- **"messaging"** / **"messageAgent"** → CLAUDE.md
- **"completion"** / **"work complete"** → CLAUDE.md
- **"beads"** / **"tasks"** → CLAUDE.md
- **"verification gate"** / **"quality gates"** → SPECIALIST_WORKFLOW.md (Full Review Flow), `src/lib/cloister/verification-gate.ts`

### UI/UX
- **"settings"** / **"settings page"** → SETTINGS-UI-DESIGN.md
- **"dashboard"** → README.md
- **"UI"** / **"frontend"** → SETTINGS-UI-DESIGN.md
- **"desktop app"** / **"electron"** / **"tray"** / **"command palette"** → DESKTOP-APP.md

### Planning
- **"PRD"** / **"requirements"** → PRD.md, prds/active/, prds/completed/
- **"roadmap"** / **"planning"** → prds/active/

---

## Documentation Maintenance

**When updating documentation:**
1. Update the relevant document(s)
2. If adding a new file, add it to this index under the appropriate category
3. If adding new topic coverage, add keywords to Topic Quick-Find section
4. Verify all links in this index remain valid

For Overdeck documentation work, use the `pan-docs` skill. It is the primary docs skill and points to the documentation guide, location guide, and update examples.
