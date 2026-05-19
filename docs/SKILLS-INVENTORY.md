# Claude Code Skills Inventory

This page lists the Claude Code skills visible from this workspace's installed skill directories.
It was generated from:

- `~/.claude/skills/*/SKILL.md` — user-level skills
- `/home/eltmon/Projects/.claude/skills/*/SKILL.md` — project-level skills

Claude Code gives user-level skills precedence over project-level skills when names collide. This inventory records 116 unique skills from 120 skill files. Duplicates are shown with both scopes.

## Skills

| Skill | Scope | What it does |
|---|---|---|
| `/pan-flywheel` | Project | pan flywheel — start, pause, resume, inspect, emit, and report on the singleton Fix-All Flywheel orchestrator. |
| `/backups` | User | Check and manage Backblaze B2 backups via restic. View snapshots, check timer status, run manual backups, restore files. Covers home directory and K8s database backups. |
| `/beads` | User, Project | Git-backed issue tracker for multi-session work with dependencies and persistent memory across conversation compaction. Use when work spans sessions, has blockers, or needs context recovery after compaction. |
| `/beads-completion-check` | User, Project | Verify all beads (tasks) in a workspace are closed before review completion. Use as final check in code review workflow. Returns PASS if no open beads, BLOCKED if open beads found. Triggers on "check beads", "verify tasks complete", "beads status", or as subagent in review workflow. |
| `/beads-panopticon-guide` | User, Project | Panopticon-specific beads usage patterns. Covers common mistakes agents make when filtering beads by issue number (PAN-XXX) and working with Linear-synced beads. |
| `/benchmark` | Project | Create a benchmark issue to test Panopticon's agent pipeline. Creates a GitHub issue from a stored template with a scenario label for A/B comparison of models and approaches. |
| `/bug-fix` | Project | Systematic approach to investigating and fixing bugs |
| `/cco` | User | Open Claude Code Organizer dashboard to manage memories, skills, MCP servers across scopes |
| `/check-merged` | Project | Verify whether an issue's feature branch has been merged into main. Checks git history, branch existence, and commit presence. Returns MERGED, NOT_MERGED, or BRANCH_NOT_FOUND with evidence. Designed for cheap models (Haiku) to run quickly. |
| `/clear-writing` | User, Project | Use when writing prose humans will read—documentation, commit messages, error messages, explanations, reports, or UI text. Applies proven rules for clearer, stronger, more professional writing and eliminates common AI writing patterns. |
| `/cliproxy` | Project | Check and restart the CLIProxy sidecar (port 8317). CLIProxy bridges ChatGPT subscription OAuth tokens to an Anthropic-compatible /v1/messages endpoint so Panopticon agents can use GPT models without an OpenAI API key. Use when GPT-model agents are returning API errors or when cliproxy is down. |
| `/code-review` | Project | Comprehensive code review covering correctness, security, performance |
| `/code-review-performance` | Project | Deep performance analysis focusing on algorithms and resources |
| `/code-review-security` | Project | Deep security analysis focusing on OWASP Top 10 |
| `/conv-lookup` | Project | Find, review, read, inspect, summarize, or compare Panopticon conversations. Use when the user references a pan.localhost/conv/<id> URL, a conversation ID (e.g. "conv 371", "conversation 108"), a fuzzy reference ("that GPT conversation", "the last Sonnet session"), or asks to review/read/look at/check/summarize/compare conversations. |
| `/crash-investigation` | Project | Investigate system crashes, OOM kills, and unresponsive episodes. Analyzes previous boot logs, identifies memory hogs, tallies per-process-group consumption, checks agent and workspace state, and produces a recovery summary. Use after a hard reset, freeze, or reboot caused by resource exhaustion. |
| `/dependency-update` | Project | Safe approach to updating dependencies |
| `/eltmon-stream` | User | Start up and manage the eltmon Twitch stream interaction system (chat TTS, character voices, welcome/roast songs, OBS overlay). Checks that OBS, Ollama, TTS daemon, and chat_tts.py are all running before a stream. |
| `/excalidraw` | User | Programmatic canvas toolkit for creating, editing, and refining Excalidraw diagrams via MCP tools with real-time canvas sync. |
| `/exe-backup` | User | exe.dev Backup |
| `/feature-work` | Project | Standard workflow for implementing new features with testing |
| `/github-cli` | Project | GitHub CLI (gh) reference for issues, PRs, and API calls |
| `/graphify` | User | any input (code, docs, papers, images, videos) to knowledge graph. Use when user asks any question about a codebase, documents, or project content - especially if graphify-out/ exists, treat the question as a /graphify query. |
| `/gsap` | User | GSAP animation reference for HyperFrames. Covers gsap.to(), from(), fromTo(), easing, stagger, defaults, timelines (gsap.timeline(), position parameter, labels, nesting, playback), and performance (transforms, will-change, quickTo). Use when writing GSAP animations in HyperFrames compositions. |
| `/hume-evi` | Project | Hume EVI Voice Management |
| `/hyperframes` | User | Create video compositions, animations, title cards, overlays, captions, voiceovers, audio-reactive visuals, and scene transitions in HyperFrames HTML. |
| `/hyperframes-cli` | User | HyperFrames CLI tool — hyperframes init, lint, preview, render, transcribe, tts, doctor, browser, info, upgrade, compositions, docs, benchmark. |
| `/hyperframes-registry` | User | Install and wire registry blocks and components into HyperFrames compositions. Use when running hyperframes add, installing a block or component, wiring an installed item into index.html, or working with hyperframes.json. |
| `/incident-response` | Project | Structured approach to production incidents |
| `/knowledge-capture` | Project | AI self-monitoring skill. Triggers proactively when AI detects confusion or makes corrected mistakes (wrong DB schema, incorrect assumptions, user corrections on key insights). Prompts to capture learnings as project-specific skills. NOT user-invoked - AI should reference this when confused. |
| `/myn-api` | User | Mind Your Now productivity platform REST API. Use when the user asks about tasks, habits, calendar, briefings, timers, grocery lists, or productivity planning. Provides task management, daily compass briefings, habit tracking, calendar events, grocery lists, timers, memory, and AI planning via REST API. |
| `/myn-outreach` | User | Draft personalized LinkedIn outreach messages for Mind Your Now investment and customer acquisition. Manages contact tracking, pitch materials, and follow-ups. Use when the user wants to reach out to someone, draft a message, track outreach progress, or review their pipeline. |
| `/myn-release` | User | MYN version release workflow. Bumps version in frontend package.json and syncs to all platform files (Java, iOS, Android) via pnpm vsync. |
| `/myn-standards` | Project | Mind Your Now coding standards, design system, and component patterns. Auto-applied when writing or reviewing MYN code. |
| `/onboard-codebase` | Project | Systematic approach to understanding a new codebase |
| `/openclaw-deploy` | User | Deploy the eltmon/openclaw fork to exe.dev. Builds from source, pushes changes, updates the running gateway, and verifies health. Handles the full cycle from local commit through production restart. |
| `/openclaw-gmail-reauth` | User | OpenClaw Gmail Reauthorization |
| `/openclaw-model` | User | Switch the OpenClaw MAIN agent model on exe.dev (does NOT affect the financial agent which is pinned to MiniMax M2.7 Highspeed) |
| `/opus-plan` | Project | Opus-driven planning for issues before Sonnet implementation. Creates workspace, PRD.md, STATE.md, beads with dependencies, and updates issue tracker. Ensures strategic decisions are made by Opus, not cheaper models. |
| `/pan` | Project | pan <verb> <args> — umbrella dispatch for all Panopticon CLI commands. Invoke bare to see the six-bucket taxonomy, or pass a full command to run it. |
| `/pan-admin-cloister` | Project | pan admin cloister <cmd> — lifecycle watchdog management: status, start, stop, emergency-stop |
| `/pan-admin-config` | Project | pan admin config <cmd> — view and edit Panopticon project configuration |
| `/pan-admin-hooks` | Project | pan admin hooks install — install Claude Code heartbeat hooks for agent health monitoring |
| `/pan-admin-tldr` | Project | pan admin tldr <cmd> — TLDR daemon management for token-efficient code analysis |
| `/pan-admin-tracker` | Project | pan admin tracker <cmd> — tracker-specific operations (Linear states, cleanup, sync) |
| `/pan-approve` | Project | pan approve has been removed — use the dashboard MERGE button instead |
| `/pan-close` | Project | pan close <id> — close-out ceremony for a completed and merged issue |
| `/pan-code-review` | Project | Orchestrated parallel code review with automatic synthesis |
| `/pan-commit` | Project | Create Panopticon repo commits that satisfy commitlint and husky on the first try |
| `/pan-convoy-synthesis` | Project | Synthesize results from parallel agent work in a convoy |
| `/pan-dev` | Project | Start Panopticon in development mode with Vite HMR for the frontend and the Node 22 server |
| `/pan-diagnose` | Project | Troubleshoot common Panopticon issues |
| `/pan-docker` | Project | Docker template selection and configuration for workspaces |
| `/pan-docs` | Project | Find, update, and structure Panopticon documentation using the docs index and documentation guide |
| `/pan-doctor` | Project | pan doctor [options] — check Panopticon system health, dependencies, and configuration |
| `/pan-done` | Project | pan done <id> — mark work complete and signal the review pipeline |
| `/pan-down` | Project | pan down — stop the Panopticon dashboard and services |
| `/pan-fly` | Project | Fly.io operations for Panopticon remote workspaces and deployed app instances. Use when users ask about Fly.io setup, remote workspaces, machine status, SSH/exec access, tunneling, or deploying/debugging Fly-hosted services. |
| `/pan-health` | Project | pan doctor — check Panopticon system health, dependencies, and configuration |
| `/pan-help` | Project | Overview of all Panopticon commands and capabilities |
| `/pan-install` | Project | Guide through installing Panopticon prerequisites |
| `/pan-issues` | Project | pan issues — list and triage work across all connected issue trackers |
| `/pan-kill` | Project | pan kill <id> — stop a running agent (workspace and branch preserved) |
| `/pan-logs` | Project | View and analyze agent and system logs |
| `/pan-network` | Project | Traefik, local domains, and platform-specific networking setup |
| `/pan-new-project` | Project | Complete setup for registering a new project with Panopticon. Handles project registration, issue prefix, workspace config, trust setup, beads init, tracker config, and validates against working projects. |
| `/pan-oversee` | Project | Test the Panopticon framework by supervising an agent through the full lifecycle, identifying and filing every bug encountered |
| `/pan-plan` | Project | pan plan <id> — start issue planning, including non-interactive --auto mode; also finalize/done planning artifacts |
| `/pan-projects` | Project | pan project <subcommand> — add, remove, and manage Panopticon-monitored projects |
| `/pan-quickstart` | Project | Quick start guide combining installation, setup, and first workspace |
| `/pan-release` | Project | Panopticon-specific stable vs canary release workflow from main |
| `/pan-reload` | Project | Rebuild Panopticon and restart the dashboard after code changes. |
| `/pan-reopen` | Project | pan reopen <id> — re-enter the pipeline for a CLOSED/COMPLETED/CANCELLED issue. NOT for issues already in progress — use `pan review restart` for that. |
| `/pan-resources` | Project | Show RAM usage by agents, conversations, and system processes — model breakdown, workspace agents, orphan detection |
| `/pan-restart` | Project | pan restart — scoped restart (dashboard by default; --cliproxy, --traefik, or --full) that will not strand shared sidecars |
| `/pan-review` | Project | pan review <subcommand> — manage code review lifecycle: pending work, requesting review, restarting with model override, resetting cycles |
| `/pan-show` | Project | pan show <id> — show agent state, work history, context, or health for an issue |
| `/pan-skill-creator` | Project | Guide for Panopticon developers on creating and distributing skills |
| `/pan-start` | Project | pan start <id> — spawn a work agent for an issue in its own tmux session and workspace |
| `/pan-status` | Project | pan status — show running agents overview and system health |
| `/pan-stop-all-agents` | Project | Drain Panopticon: kill every running work agent and its review/test specialists, optionally stop the dashboard, and preserve conversation tmux sessions and shared sidecars. |
| `/pan-subagent-creator` | Project | Create custom Claude Code subagents with isolated context windows, specific tool permissions, and specialized prompts. Use when users want to create a new subagent, configure agent delegation, set up task-specific agents, or define specialized assistants. |
| `/pan-sync` | Project | pan sync — sync skills and agents from devroot to ~/.claude/ |
| `/pan-sync-main` | Project | pan sync-main <id> — merge latest main into the feature branch for an active workspace |
| `/pan-tell` | Project | pan tell <id> <msg> — send a message to a running agent's tmux session |
| `/pan-test-config` | Project | Configure test suites for Panopticon projects in projects.yaml. |
| `/pan-tts` | Project | Optional local text-to-speech sidecar that speaks Panopticon activity log entries through Qwen3-TTS (or any local TTS engine). Subscribes to the public /events/stream SSE feed; no pan-core dependency. Also exposes an ad-hoc speak helper (scripts/say.sh) so agents can announce one-off messages on demand. |
| `/pan-up` | Project | pan up — start the Panopticon dashboard (Node 22, port 3010) |
| `/pan-wake` | User | pan-wake — Resume All Halted Agents |
| `/pan-wipe` | Project | pan wipe <id> — destructive reset to Todo: remove workspace, processes, branches, review state, beads, and tracker status |
| `/pan-workflow` | Project | Complete reference for moving issues through the Panopticon pipeline — from tracker to merge. Covers every phase, the correct commands, API equivalents, and how to recover from each failure mode. |
| `/pan-workspace-config` | Project | Configure Panopticon workspace settings for repos, services, DNS, Docker, and templates. |
| `/pipeline-status` | Project | Cross-room visual status board for every active issue moving through the Panopticon pipeline. One row per issue, one column per phase (agent → review → test → verify → merge → ready), with a checkmark or X in each cell. Designed to be readable from across the room while agents work autonomously. |
| `/plan` | Project | Opus-driven planning for issues before Sonnet implementation. Creates workspace, .pan/continue.json, .pan/spec.vbrief.json with beads, and updates issue tracker. Ensures strategic decisions are made by Opus, not cheaper models. |
| `/react-best-practices` | Project | React and Next.js performance optimization guidelines from Vercel Engineering. This skill should be used when writing, reviewing, or refactoring React/Next.js code to ensure optimal performance patterns. Triggers on tasks involving React components, Next.js pages, data fetching, bundle optimization, or performance improvements. |
| `/rebase-and-submit` | User | Atomic submit flow for a work agent. Use after fixing review/CI feedback, or when a stale PR is cleared and you need to re-enter the review pipeline. Runs pan done which now handles rebase + push + PR submit internally. |
| `/refactor` | Project | Safe refactoring approach with test coverage first |
| `/refactor-radar` | Project | AI self-monitoring skill. Detects architectural debt, confusing schemas, inconsistent patterns that cause repeated AI mistakes. Offers to create refactoring proposals as issues. NOT user-invoked - AI triggers when detecting systemic codebase issues causing confusion. |
| `/release` | Project | Step-by-step release process with versioning |
| `/send-feedback-to-agent` | Project | Send findings and feedback from specialist agents back to issue agents |
| `/session-health` | Project | Detect and clean up stuck or corrupted Claude Code sessions. Use when agents crash with stack overflow, when sessions seem stuck, or for routine maintenance. Triggers on "session health", "check sessions", "stuck agent", "agent crashed", "stack overflow", "cleanup sessions". |
| `/skill-creator` | Project | Guide for creating effective Claude Code skills. Use when users want to create a new skill, update an existing skill, or need guidance on skill best practices. Triggers on requests like "create a skill", "make a new skill", "help me build a skill", "skill development", or "extend Claude's capabilities". |
| `/spec-readiness` | Project | Evaluate an issue or epic's requirements readiness before development begins. Produces a scored report (0-100) across 5 dimensions with detailed findings, actionable blockers, and a JSON sidecar for dashboards. Works with any issue tracker (Linear, GitHub, GitLab, Rally, Jira). |
| `/spec-readiness-setup` | Project | Create a customized wrapper for the spec-readiness skill. Configures branding, issue tracker bindings, field mappings, and org-specific conventions. Generates a ready-to-use wrapper skill directory with config.yaml and SKILL.md. |
| `/stitch-design-md` | Project | Analyze Stitch projects and synthesize a semantic design system into DESIGN.md files |
| `/stitch-react-components` | Project | Converts Stitch designs into modular Vite and React components using system-level networking and AST-based validation. |
| `/stitch-setup` | Project | Set up Google Stitch MCP server for AI-powered UI design generation |
| `/stream` | User | Stream — Twitch Stream Management |
| `/test-specialist-workflow` | Project | Test the full specialist handoff pipeline (review → test → merge) |
| `/unarchive-conversation` | Project | Restore an archived Panopticon conversation by exact conversation name or by matching archived title. Use when the user asks to unarchive, restore, bring back, or reopen a Claude/Panopticon conversation such as "unarchive Models, Models, Models". |
| `/web-design-guidelines` | Project | Review UI code for Web Interface Guidelines compliance. Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices". |
| `/website-to-hyperframes` | User | Capture a website and create a HyperFrames video from it. Use when: (1) a user provides a URL and wants a video, (2) someone says "capture this site", "turn this into a video", "make a promo from my site", (3) the user wants a social ad, product tour, or any video based on an existing website, (4) the user shares a link and asks for any… |
| `/work-complete` | Project | Checklist for agents to properly complete work and signal readiness for review |
| `/workspace-status` | Project | Auto-applied when reporting on agent/workspace status. Displays robust workspace information with URLs and commands. |
| `/write-spec` | Project | Write a feature spec (*-spec.md) for an issue. The spec is the human-written requirements document that feeds into the planning agent. Part of the spec → plan → implement pipeline. |

## Duplicate names

These skills exist in both user and project scopes. Claude Code resolves those names to the user-level copy first.

- `/beads`
- `/beads-completion-check`
- `/beads-panopticon-guide`
- `/clear-writing`

## Maintenance

Keep this page in sync when skills are added, removed, renamed, or materially changed. For Panopticon-owned skills, `skills/` in the repo is the source of truth and `pan sync` installs them into Claude Code's skill directories.
