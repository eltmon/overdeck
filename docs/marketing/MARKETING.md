# Overdeck — Marketing Copy Bank

> **What this is:** copy-paste-ready marketing material covering all of Overdeck's
> functionality. Grab a tagline, a boilerplate paragraph, a feature blurb, or a social
> snippet and drop it straight into a landing page, README, deck, tweet, or email.
>
> **What this is not:** the public docs site. The Mintlify site lives at the repo root
> (`introduction.mdx`, `quickstart.mdx`, …) and is published at
> [overdeck.ai](https://overdeck.ai). This file is internal collateral —
> the raw material we draw from when we write external-facing pages, posts, and scripts.
>
> Everything here is grounded in shipped functionality. When a claim changes, update it
> here. See the companion marketing **plan** (SEO, video list, channels) tracked in its
> own GitHub issue.

---

## 1. The one-liner

**Overdeck is the IDE for the agent era.**

Pick the register that fits the surface:

| Length | Copy |
|:---|:---|
| Logo lockup | *The IDE for the agent era* |
| Sub-head | *Watch agents code, review their diffs live, and ship — without leaving the conversation.* |
| Category | *A live development environment for directing AI coding agents.* |
| Tweet bio | *Command Deck: spawn agents, watch them work, stay in control. `npx @overdeck/cli`* |

---

## 2. The positioning statement

> IDEs were built for humans who **type** code. Overdeck is built for humans who
> **direct** code.

Command Deck is a live development environment where you spawn agents, watch them work,
and stay in control. You see every file change as it lands, review diffs without leaving
the conversation, talk to agents to course-correct, hot-swap the model behind them when
the task shifts, and branch a conversation to try a different approach without losing the
original. When you like where things are headed, the built-in specialist pipeline picks
it up — automated code review, tests, and merge — so you never context-switch to a
separate CI tab.

**Category we own:** the *agent IDE* / *agent command deck* — the cockpit between "chat
with one agent in a terminal" and "fully autonomous swarm." You can sit anywhere on that
spectrum and slide along it without changing tools.

---

## 3. Elevator pitches (three lengths)

**15 words**
Overdeck is a live cockpit for directing AI coding agents — watch them work, review, ship.

**50 words**
Overdeck is the IDE for the agent era. Spawn coding agents, watch every diff land in
real time, steer them mid-task, hot-swap models, and fork conversations to explore. When
the code looks right, a built-in specialist pipeline runs review, tests, and merge — so
you ship without switching tabs.

**100 words**
IDEs were built for humans who type code. Overdeck is built for humans who direct it.
Command Deck is a live development surface where you spawn AI agents and watch them code
in real time — every file change appears inline, no waiting for a PR. Talk to an agent to
course-correct, hot-swap from Sonnet to Opus to Kimi mid-task, branch the conversation to
try another approach, or roll back to a checkpoint if it drifts. When the implementation
looks right, five specialist agents take over — code review, tests, inspection, browser
UAT, and merge. You click Merge; you never babysit CI. Free and open source.

---

## 4. Value propositions (benefit-first)

Lead with the benefit, prove it with the feature.

- **You stay in the loop without being in the way.**
  Watch agents code, review their diffs live, send a message when they drift. You're
  pair-programming, not babysitting a terminal.

- **The right model for every phase.**
  Opus plans the architecture, Kimi or Sonnet writes the code, Haiku handles quick
  commands. Overdeck routes automatically across six providers — or you override with
  two clicks when you know better.

- **Context that outlasts the conversation.**
  PRDs, plans, checkpoints, beads, and skills carry forward across sessions. Agents pick
  up where the last one left off, not from a blank slate.

- **One skill format, every tool.**
  Write a `SKILL.md` once and it works across Claude Code, Codex, Cursor, and Gemini CLI.
  70+ ship out of the box.

- **A pipeline that ships while you move on.**
  When the implementation looks right, hand it to the specialist pipeline — automated code
  review, tests, and merge. You click Merge when you're satisfied, or keep working on the
  next issue.

- **Your code never leaves your machine.**
  Local-first by design — the dashboard, database, agent orchestration, and git worktrees
  all run on your own hardware. Works offline (agent workspaces excepted).

---

## 5. Feature catalog (with marketing copy)

Each entry: the headline, then a one-or-two-sentence benefit blurb you can lift directly.

### Command Deck
**The cockpit for the agent era.** A live development surface — project sidebar, tabbed
panes, and an awareness rail — where every event animates in as it happens. No refresh
buttons, no polling. Watch agents reason turn-by-turn, review diffs inline, and keep every
project, issue, and conversation one click away.

### Live inline diffs
**See the code as it's written.** Every file change appears inline as the agent works.
Open the diff panel for a turn-by-turn view, or hit "vs main" to see the full picture —
no waiting for a PR to review code.

### Talk to your agents
**Steer mid-task, don't restart.** Type in the composer to course-correct an agent while
it works — point it at the right file, correct its approach, tell it to rethink.
Pair-programming, not prompt-and-pray.

### Model hot-swap
**Right model, right moment.** Switch an agent from Sonnet to Opus to Kimi (or GPT,
Gemini, MiniMax) mid-conversation without losing context. Six providers, automatic
capability-based routing, or manual override.

### Conversation forking
**Explore without losing your place.** Branch any conversation to try a different
approach. Keep the original intact, compare both, merge the one that works.

### Automatic checkpoints
**Undo for agents.** Command Deck snapshots agent state as work progresses. If an agent
goes sideways, roll back to any earlier checkpoint instead of starting over.

### Visual plans (vBRIEF)
**See the whole plan before a line is written.** Work plans render as interactive DAGs —
dependencies, acceptance criteria, and live status. Know what's done and what's blocked at
a glance.

### Specialist pipeline
**Ship without switching tabs.** Five dedicated agents handle the quality lifecycle
automatically — code **review**, **tests**, per-step **inspection**, browser-based **UAT**,
and **merge**. The only manual step is clicking Merge when you're satisfied.

### Cloister (lifecycle manager)
**The orchestrator that never sleeps.** Cloister routes models by capability, detects
stuck agents, tracks costs, and triggers specialist handoffs on a continuous patrol loop —
so the pipeline keeps moving while you're heads-down or away.

### PRD-driven workflow
**Strategy before syntax.** Opus writes a detailed plan before any code is written —
agents literally can't start without one. The strongest model makes the architectural
calls; cheaper models execute them.

### 70+ universal skills
**Write once, run everywhere.** A single `SKILL.md` works across Claude Code, Codex,
Cursor, Gemini CLI, and Google Antigravity. 70+ ship out of the box and sync on every
`pan up` — feature work, code review, incident response, onboarding, and more.

### Multi-tracker support
**One board for every backlog.** GitHub Issues, Linear, GitLab, and Rally — all visible
in one unified kanban board, all driveable from the same surface.

### Workspaces
**Isolation without the clone.** Every issue gets its own git worktree on its own feature
branch — shared history, no separate checkout. Add Docker for a full environment, run
locally, or offload to Fly.io for cloud-hosted agents.

### Convoys
**Parallel agents, synthesized results.** Run multiple agents on related issues — security
audits, performance sweeps, or an epic split into concurrent streams — and a dedicated
synthesis agent merges the findings into one report.

### Swarm
**Whole-plan parallelism.** Dispatch parallel work agents across a vBRIEF plan using
dependency-wave scheduling, so independent beads run at once and dependent ones wait their
turn.

### Cost tracking
**Know what every issue costs.** Per-issue, per-stage token costs with model attribution
and daily rollups. See exactly where the spend goes and which model spent it.

### TLDR code analysis
**Agents that stay in context.** Token-efficient codebase understanding — 500–1,200 tokens
per file instead of 10–25k — so agents explore large codebases without burning their
window.

### Beads
**Memory that survives compaction.** Git-backed task tracking that works offline. When a
conversation gets compressed, the agent recovers its task state from beads instead of
losing the thread.

### Desktop app
**A real app, not a browser tab.** Command Deck ships as a packaged desktop app
(`@overdeck/desktop`) built on Electron — or run the same surface headless via the CLI and
REST API.

### Fix-All Flywheel
**Point it at a backlog and let go.** An autonomous orchestrator that drains your issue
tracker: it scores and prioritizes open issues, plans them, dispatches work agents, and
runs the review→test→merge pipeline continuously — with budgets, brakes, and a pause
switch always one click away.

### Merge train
**Merges that never pile up.** A conflict-aware merge queue with rolling rebases,
agent-driven conflict reconciliation, and automatic UAT candidate assembly — so ten
parallel agents don't end in ten conflicting PRs.

### Deacon (self-healing agents)
**Agents that don't get stuck.** A continuous health patrol watches every agent for
stuck patterns — context overflow, dead-end loops, orphaned processes, silent crashes —
and recovers them automatically: nudge, compact, resume, or escalate. You find out it
happened; you don't have to fix it.

### GitHub-native audit trail
**No "trust me, the agent did it."** A GitHub App bot identity opens real PRs, posts
real reviews, reports CI status checks, and squash-merges through branch protection.
Every agent change leaves the same audit trail a human team leaves — in GitHub, where
engineering leadership already looks.

### Automated browser UAT
**The agent opens the app and checks.** A dedicated UAT agent drives a real browser
(Playwright) against your running app to verify the issue's acceptance criteria are
actually observable end-to-end — before merge, not after deploy.

### Remote workspaces
**Your laptop is not the ceiling.** Offload agent workspaces to cloud machines (Fly.io)
with one command — agents keep working with full isolation while your machine stays
cool. Migrate work out, reap machines when done.

### Multi-harness
**Bring your agent.** Claude Code and Pi today, harness-agnostic by architecture: roles,
model routing, and pipeline gates apply to whichever CLI agent runs underneath.

### Needs-you inbox
**Never miss an agent's question.** When any agent asks a question or proposes a plan,
it surfaces as a dashboard popup and a persistent "Needs you" queue — answer from the
cockpit instead of hunting through terminals.

### Agent memory
**Agents that remember the project.** A persistent memory layer of observations and
summaries carries decisions, hazards, and history across sessions and compactions — so
the tenth agent on a project knows what the first nine learned.

### RTK output compression
**Stop paying for log spam.** Command outputs are compressed before they hit the agent's
context — 15–50KB of build noise becomes a 2KB preview — cutting token spend 10–40% on
command-heavy work.

### Event stream API
**Build on the pipeline.** A language-agnostic SSE event stream with resumable sequence
numbers exposes every pipeline event — wire up dashboards, notifications, or your own
automation without touching internals.

### Safety controls
**Brakes, not just throttle.** Per-agent pause gates, troubled-agent quarantine,
boot-time no-resume flags, and a global emergency stop. Autonomy you can halt at any
altitude — per agent, per issue, or everything at once.

### Inspection gates
**Verify each step, not just the end.** Optional per-task inspection agents check every
bead of a plan against its spec before work proceeds — fine-grained verification for
high-stakes changes.

### Spec-readiness scoring
**Know it's buildable before you build.** Issues get a 0–100 readiness score across five
dimensions with concrete blockers — so agents start from requirements, not guesses.

### Conversation handoff
**Sessions end; work doesn't.** Any conversation can hand off to a fresh one with full
context — decisions, state, and next steps — written by the outgoing agent itself.

### Command palette
**Cmd+K to anywhere.** Jump to any agent, issue, conversation, or view from a single
keystroke.

### Voice narration
**Hear the pipeline.** Optional TTS narrates pipeline activity — merges, failures,
questions — so you can stay across ten agents while looking at none of them.

---

## 6. How it works (the flow)

```
 Issue          PRD            Agent          Review        Test          Merge
┌──────┐     ┌──────┐     ┌──────────┐     ┌──────┐     ┌──────┐     ┌──────────┐
│ Task │ ──► │ Plan │ ──► │ Write    │ ──► │ Code │ ──► │ Run  │ ──► │ PR       │
│ from │     │ with │     │ code in  │     │ rev. │     │ test │     │ merged   │
│ any  │     │ Opus │     │ isolated │     │      │     │      │     │          │
│track-│     │      │     │ worktree │     │      │     │      │     │          │
└──────┘     └──────┘     └──────────┘     └──────┘     └──────┘     └──────────┘
 GitHub        Opus         Kimi/Sonnet     Opus         Sonnet       Sonnet
 Linear                     (routed)
 GitLab
 Rally
```

You can drive any stage from the dashboard, the CLI, or a webhook. Engage as much or as
little as you want — from hands-on pair programming with a single agent to a fully
autonomous pipeline across dozens of issues.

---

## 7. Differentiators ("why Overdeck")

Use these when the reader is comparing against a plain terminal agent, a chat IDE plugin,
or a hosted autonomous-agent service.

- **It's a cockpit, not a chat box.** You see the diff, the plan DAG, the cost, the
  pipeline stage, and the agent's live reasoning in one surface — not a scrollback buffer.
- **You can change your mind mid-flight.** Hot-swap the model, fork the conversation, roll
  back a checkpoint, or take the keyboard. Most tools make you start over.
- **The pipeline is built in.** Review, test, inspect, UAT, and merge are first-class
  agents, not a separate CI tab you babysit.
- **Model-agnostic by design.** Six providers, capability-based routing, one keystroke to
  override. You're never locked to a single vendor's model.
- **Local-first and open source (MIT).** Your source stays on your machine; the whole
  thing is on GitHub and free to run.
- **One skill format across every tool.** Skills aren't Claude-only — the same `SKILL.md`
  drives Codex, Cursor, Gemini CLI, and Antigravity.

### Against the named competition (mid-2026)

The "run agents in parallel in worktrees and review the diffs" feature set is now
**table stakes** — Conductor, Sculptor, Vibe Kanban, Claude Squad, Cursor 2.0, and
OpenAI Codex all ship it, and several companies that shipped *only* that have already
shut down. Overdeck's defensible layer is everything *after* the diff: the automated
pipeline, the gates, the routing, and the autonomy loop. Use these head-to-heads:

| They ship | Overdeck ships |
|:---|:---|
| **Conductor** ($22M Series A, Mar 2026): parallel Claude Code/Codex agents on a Mac; a human reviews and merges every diff | The same cockpit **plus the assembly line**: automated review convoy → tests → per-step inspection → browser UAT → merge train. The human's only job is the final Merge click |
| **Devin / Cognition** ($1B raise at ~$26B, May 2026): autonomous cloud engineer, usage tiers up to $500/mo | Autonomy that's **yours**: open source, local-first, BYO models and subscriptions, full per-issue cost visibility |
| **GitHub Agent HQ / Copilot mission control**: agent orchestration bundled into the Copilot seat | Tracker-agnostic (GitHub, Linear, GitLab, Rally), model-agnostic (six providers), and policy-deep — capability routing, quality gates, budgets, and brakes, not just spawning |
| **Subspace**: a multi-agent workspace with shared cross-agent memory | A **pipeline**, not just a desk: immutable plans, quality gates, a merge train, and a flywheel that drains the backlog on its own |
| **Factory / Blitzy** ($1.5B / $1.4B valuations, 2026): enterprise sales-led autonomous delivery | The same end-to-end ambition, installable today with `npx @overdeck/cli` — no sales call, no cloud commitment |

Three claims in this category that, as of mid-2026, **nobody else can make together**:
1. **Automated browser UAT as a pipeline gate** — agents verify acceptance criteria in a
   real browser before merge. Competitors' "browser preview" is for humans to look at.
2. **An autonomous backlog-draining loop with quality gates, running locally on open
   source.** Charlie Labs sells this closed and cloud-only; Ralph-loop hacks have no gates.
3. **A merge train for agent fleets** — conflict-aware queueing and rolling rebases built
   for the failure mode every parallel-agent tool creates and none of them solve.

Full competitor profiles, funding history, and category analysis:
[`docs/marketing/COMPETITIVE-LANDSCAPE.md`](COMPETITIVE-LANDSCAPE.md).

---

## 8. Audiences / personas

| Persona | The hook | The line that lands |
|:---|:---|:---|
| **Solo builder / indie hacker** | Wants leverage without losing control | "Direct a team of agents from one screen — and still review every diff." |
| **Tech lead / staff eng** | Wants throughput across many issues | "Run an autonomous pipeline across dozens of issues; click Merge when it's right." |
| **AI-tooling enthusiast** | Already lives in Claude Code / Codex | "Keep your agent and your skills — Overdeck is the cockpit around them." |
| **Pragmatic skeptic** | Burned by 'autonomous' hype | "Watch every change land, roll back when it drifts. You're always in the loop." |
| **Cost-conscious team** | Token spend is real money | "Per-issue cost tracking and model routing so Opus only runs where Opus earns its price." |

---

## 9. Maturity & proof points

Use these as the credibility strip. Update the numbers as they grow.

- **70+ skills** shipped and synced across tools
- **80+ CLI commands** — every pipeline action scriptable and self-documenting
- **4 tracker integrations** — GitHub, Linear, GitLab, Rally
- **6 AI providers** — Anthropic, OpenAI, Google, Kimi, MiniMax, OpenRouter — with
  capability-based model routing
- **5 specialist agents** in the automated quality pipeline
- **Hundreds of issues** completed through the full pipeline
- **7,000+ commits, ~275K lines of TypeScript, 280+ test files** — built by one person
  directing agents through Overdeck itself
- **Self-hosting proof:** Overdeck is built using Overdeck, in production, every day —
  765+ commits in the last 10 weeks alone were written by agents working through the
  pipeline, across four production projects.

---

## 10. Boilerplate ("About Overdeck")

**Short (1 sentence)**
Overdeck is the IDE for the agent era — a live development environment for spawning,
directing, and shipping the work of AI coding agents.

**Medium (1 paragraph)**
Overdeck is an open-source, local-first development environment for directing AI coding
agents. Its live Command Deck lets you watch agents code in real time, review diffs inline,
steer them mid-task, and hot-swap models across six providers — then hand finished work to
a built-in specialist pipeline that runs code review, tests, and merge automatically. It
works with Claude Code, Codex, Cursor, and Gemini CLI, and tracks work from GitHub, Linear,
GitLab, and Rally.

**Long (boilerplate footer)**
Overdeck is the IDE for the agent era. Where traditional IDEs were built for humans who
type code, Overdeck is built for humans who direct it. Its Command Deck is a live cockpit
where you spawn AI agents, watch every file change land in real time, talk to agents to
course-correct, swap the model behind them when the task shifts, and branch conversations
to explore alternatives — all without losing context. When implementation looks right, five
specialist agents handle code review, testing, inspection, browser UAT, and merge, so you
ship without ever switching to a separate CI tab. Overdeck is open source (MIT),
local-first, and model-agnostic, with capability-based routing across Anthropic, OpenAI,
Google, Kimi, MiniMax, and OpenRouter. Get started with `npx @overdeck/cli`.

---

## 11. Headlines & CTAs

**Hero headlines (A/B candidates)**
- The IDE for the agent era.
- Watch your agents work. Stay in control.
- Direct code. Don't type it.
- Spawn agents. Review diffs. Ship. Without switching tabs.
- Your agents, your cockpit.

**Sub-heads**
- A live development environment for AI coding agents — diffs, models, and merge, all in one place.
- Pair-program with a fleet of agents, then let the pipeline ship while you move on.

**Calls to action**
- `npx @overdeck/cli` — no install step.
- Open Command Deck in your browser in 30 seconds.
- Read the docs → overdeck.ai
- Star it on GitHub.

---

## 12. Social snippets (ready to post)

**X / Twitter (≤280)**
- IDEs were built for people who type code. Overdeck is built for people who *direct* it. Spawn agents, watch every diff land live, hot-swap models mid-task, then let the pipeline review + test + merge. `npx @overdeck/cli` ⌁ open source.
- Stop babysitting one agent in a terminal. Command Deck gives you a live cockpit: inline diffs, model hot-swap, conversation forking, checkpoints, and an automated review→test→merge pipeline. The IDE for the agent era.
- New: fork a conversation to try a different approach, keep the original, compare both. Because "undo" should work on agents too. 🧵

**LinkedIn (opening line)**
- Most "AI coding" tools give you a chat box. Overdeck gives you a cockpit — live diffs, six-provider model routing, and a built-in review/test/merge pipeline — so you direct a fleet of agents instead of babysitting one.

**Hacker News (Show HN title)**
- Show HN: Overdeck — a live IDE for directing AI coding agents (open source)

**Tagline pool (for chips, banners, sticker copy)**
- The IDE for the agent era
- Direct, don't type
- Watch agents work. Stay in control.
- Built for humans who direct code
- Ship without switching tabs

---

## 13. FAQ-style copy

**Q: How is this different from using Claude Code (or Codex) directly?**
Overdeck wraps your agent in a cockpit. You keep the harness you like — and gain live
diffs, model hot-swap, conversation forking, checkpoints, cost tracking, and an automated
review→test→merge pipeline around it.

**Q: Do I have to give up control to an autonomous swarm?**
No. The whole point is the dial. Pair-program hands-on with a single agent, or launch a
fully autonomous pipeline across dozens of issues — and slide between the two without
changing tools.

**Q: Which models and tools does it support?**
Six providers (Anthropic, OpenAI, Google, Kimi, MiniMax, OpenRouter) with automatic
capability-based routing, and harnesses including Claude Code, Codex, Cursor, Gemini CLI,
and Google Antigravity.

**Q: Where does my code run?**
Local-first. The dashboard, database, orchestration, and git worktrees run on your machine.
Agent workspaces can optionally offload to Fly.io when you want the RAM/CPU/disk elsewhere.

**Q: How do I start?**
`npx @overdeck/cli`. No install step — it starts Command Deck and opens the dashboard in your
browser.

---

## 14. Quick links

- **Site:** https://overdeck.ai
- **npm:** https://www.npmjs.com/package/@overdeck/cli
- **GitHub:** https://github.com/eltmon/overdeck
- **Install:** `npx @overdeck/cli`
- **Desktop app:** `@overdeck/desktop`

---

*This is a living document. The expanded marketing kit (long-form pages, SEO keyword map,
video scripts, channel plan) is tracked in a dedicated GitHub issue — see the marketing
plan referenced there. Competitor profiles and funding history live in
[`COMPETITIVE-LANDSCAPE.md`](COMPETITIVE-LANDSCAPE.md).*
