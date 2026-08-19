# t3code Fork + Plugin Feasibility

**Question:** Should Overdeck fork t3code, layer everything Overdeck-specific on top as a
module, and keep the upstream-facing diff so small that the t3code folks would only need to
adopt minimal hook points?

**Date:** 2026-08-19. Evidence gathered by six parallel subagent investigations against
Overdeck `main` (`96717a5f79`) and t3code `main` (`f2d5fc91e`, current with upstream) plus
the unmerged upstream branch `feat/plugin-command-catalog`. Companion docs (both stale,
written against an April-2026 alpha snapshot): [`t3code-research.md`](./t3code-research.md),
[`t3code-drift-plan.md`](./t3code-drift-plan.md).

---

## Verdict up front

**Do not fork now.** Three facts drive it:

1. **The shared code is tiny.** Under 2% of Overdeck by volume derives from t3code
   (~6–7k LOC of recognizably ported chat/diff/terminal UI plus the 12.8k-LOC vendored
   `packages/effect-acp`). Overdeck's bulk — Cloister/Deacon (~100 files), the pipeline,
   flywheel, state branch, trackers, ~120 CLI commands, ~590 orchestration UI files —
   has no t3code counterpart. A fork "reclaims" almost nothing and re-homes ~420k LOC
   onto a foreign base.
2. **t3code has no extension seams today.** Every surface is a closed union hand-wired in
   core files: the RPC catalog, the right-panel pane kinds, the settings schema, auth
   scopes, the CLI subcommand array, the provider-driver array. There is no plugin
   architecture on `main` at all. "Overdeck as a big module with a minimal upstream diff"
   is not expressible against the current codebase.
3. **The upstream channel is closed.** t3code is MIT (forking is clean) but CONTRIBUTING.md
   says they are not accepting contributions, large PRs get closed, and external
   contributors are `vouch:unvouched` by default. "The t3code folks adopt our minimum hook
   pieces" is not a realistic PR outcome today. The influence channel is their Ideas
   discussions, nothing more.

**But the door is opening.** Upstream is actively building exactly the extension surface we
would want — `packages/plugin-runtime` on `feat/plugin-command-catalog` (unmerged, ~4,200
lines, last commit 2026-08-19). The runtime engine is production-grade; the ecosystem
around it is scaffolding. When their `views` catalog and manifest loading land, the real
opportunity is **Overdeck as a plugin against upstream proper — no fork at all**. Until
then: keep vendoring discrete packages, keep cherry-picking per the drift plan, and watch
that branch.

---

## What upstream's plugin runtime actually is (the crux finding)

Branch `feat/plugin-command-catalog`, 36 files, +4,215 LOC. Commit chain shows genuine
review iteration (three interruption-hardening fixes, two review-findings passes, a race
fix at HEAD) — this is a feature being built seriously, not a prototype.

**What exists and is solid:**

- An in-process Effect-based plugin runtime (`packages/plugin-runtime/src/runtime.ts`,
  809 lines; a 1,057-line shared contract spec). Plugins are Effect-scoped: per-plugin
  child scopes, topological activation over `requires`/`provides` capability handshakes,
  atomic reconcile with rollback (a failed replacement leaves the old plugin live),
  reverse-order finalizers, reentrancy guards, transition serialization via semaphore.
- A **command catalog** wired end-to-end: server (`PluginCommandCatalog.ts`) → three WS RPC
  methods (`pluginCommands.list`/`invoke`, `subscribePluginCommands`) with auth scopes →
  web command palette and mobile composer popover. Handlers stay server-side; only frozen
  JSON metadata crosses the RPC boundary.
- A manifest schema (`manifest.ts`) with namespaced ids, semver, `engines.t3`,
  per-surface entrypoints (`server`/`web`/`desktop`), `permissions` (`network:…`,
  `secrets:…` patterns), and a contribution catalog declaring four categories:
  **`commands`, `settings`, `views`, `mobileCards`**.

**What does not exist:**

- Only `commands` is implemented. `settings`/`views`/`mobileCards` are schema fields with
  no decoder, no catalog service, no UI surfacing.
- **No manifest discovery or loading whatsoever.** Nothing scans a plugins directory,
  resolves npm packages, or loads `entrypoints.web` bundles. The only call site feeding
  the runtime is `reconcile([])` plus one hardcoded built-in command
  (`t3.plugin-runtime.status`). The `permissions` field parses but nothing enforces it.

**Implication:** today, "a t3code plugin" means "a command palette entry." Overdeck needs
views (Command Deck, kanban, pipeline, God view, cockpit), settings panels, server
services, RPC streams, and storage. The manifest schema *anticipates* views and
per-surface bundles — the direction is right — but the gap between "commands only, no
loader" and "host a 590-file orchestration frontend" is the entire product. That gap is
also precisely the answer to "what is the minimum upstream would need to adopt" (see the
list near the end).

## t3code's current architecture, and where a module could actually hook in

t3code has outgrown the April research doc substantially: five provider drivers (Codex via
`app-server`, Claude via the Agent SDK in-process, Cursor and Grok via ACP, OpenCode via
its SDK), an Expo mobile app, auth/pairing with scoped bearer/DPoP tokens, Tailscale
Serve + a hosted Cloudflare relay ("T3 Connect", cleanly compile-flagged off for
self-hosting), a libghostty-WASM terminal, a PR review surface, worktree management, and —
notably — **an event-sourced orchestration core that convergently matches Overdeck's own
architecture**: append-only `orchestration_events` in SQLite, mutable projections, and
client-side reducers replaying the event stream over WS subscriptions
(`packages/client-runtime/src/state/threadReducer.ts`). Both teams independently arrived
at the same state model, which is the strongest argument that long-term convergence is
natural rather than forced.

Seam-by-seam verdict for an external module (from the architecture survey):

| Seam | Verdict |
| --- | --- |
| Raw HTTP route layers | **Best seam in the codebase** — define a whole route tree in your own module, merge one `Layer` into `makeRoutesLayer` in `server.ts` (pattern already used by the OTLP proxy and asset routes) |
| SQLite migrations | Append-only registration in one file; low conflict risk; clean `Service.ts`/`Layer.ts` per-table pattern worth mimicking |
| CLI subcommands | Isolated per-command files; one array line in `bin.ts` |
| New server services | One `Layer.provideMerge` line in the ~690-line hand-built composition root |
| WS RPC methods | High-conflict: closed `as const` catalogs in `packages/contracts` plus a giant handler literal in the 2,370-line `ws.ts`, plus auth-scope mapping |
| Sidebar/nav, top-level views | Routes are file-based and additive; nav entries are hand-wired (some inside `ChatView.tsx`) |
| Thread-view panes | **Worst seam**: closed `RightPanelSurface` union with 5+ switch sites across `RightPanelTabs.tsx`, `rightPanelStore.ts`, and the 6,744-line `ChatView.tsx` |
| Settings fields, auth scopes | Closed schemas in `packages/contracts`; every addition patches core |

So even the fork variant would not produce a "minimal diff": Overdeck needs the
high-conflict seams (RPC, panes or new views, settings, scopes), and upstream actively
churns exactly those files (they rewrote the client connection architecture, split the
terminal store, and migrated build tooling since April — refactors that already orphaned
three files Overdeck vendored: `wsTransport.ts`, `terminalStateStore.ts`,
`diffRouteSearch.ts`).

## What Overdeck would have to re-home, and where it collides

The three Overdeck inventories partition the system as follows.

**Could be plugin contributions (if upstream's `views` catalog existed):** essentially the
whole orchestration frontend — Command Deck, Stage/cockpit, kanban, pipeline list,
backlog/sequencer, God view, issue views, merge train, flywheel console, resource
monitors, xBRIEF viewer — roughly 590 of 664 frontend files (~89%; chat is only ~11%).
Plus skills/context distribution (text artifacts, no host coupling) and cost display.

**Sibling processes a plugin merely fronts:** the tmux substrate (`tmux -L overdeck`),
harness runtimes spawning external CLIs, work/plan/review/test/merge agents, the `pan`
CLI. These never run "inside" a web-app plugin runtime under any architecture.

**Host-internals — the genuinely hard part:** Cloister/Deacon **is** Overdeck's dashboard
server, not a sibling: it owns the SQLite event store and read model, the GitHub webhook
ingestion, merge execution, patrol loops, the state-branch write door, and operator gates
(AskUserQuestion/plan approval) woven into the pipeline. Under a fork this whole plane
must either run inside the forked server's Effect runtime (as new services — mechanically
possible via seam (a), but it drags ~100 Cloister files plus the event store into the
fork) or be extracted into a standalone orchestrator daemon the UI talks to.

**Direct collisions where both sides own the same concern** (each needs a one-owner
decision under any fork): agent execution (t3code providers run in-process/SDK sessions vs
Overdeck's tmux subprocesses — who owns a Codex session?), conversation transcripts
(t3code's SQLite projections vs Overdeck's JSONL parsing and mid-session compaction —
concurrent writers would corrupt), terminal stacks (thread-scoped PTY manager vs tmux
attach hub), worktrees (both create them), event stores (two parallel event-sourced
SQLites), cost tracking (double-counting), and provider/model resolution (two resolvers).

## Options weighed

**A. Fork t3code as the base, Overdeck as a big module on top.**
Gains: polished and fast-improving chat UX (their chat components are now 2–6× ours in
LOC), desktop + mobile apps, auth/pairing/remote access, five provider drivers, terminal
stack — real features Overdeck lacks. Costs: re-homing 98%-original code onto closed
seams; resolving every collision above; permanent rebase burden against an upstream that
refactors aggressively and owes us nothing; and the "minimal adoptable diff" goal is
unachievable because the seams Overdeck needs are the high-conflict ones. **Rejected for
now** — the upside is features, not code reuse, and those features can be tracked by
vendoring or waiting for the plugin surface.

**B. Overdeck as a plugin against upstream proper (no fork) + small PR set.**
This is the actual end-state the question is reaching for. **Blocked today** (commands
only, no loader), but upstream's own manifest schema shows they intend views, settings,
per-surface bundles, and permissions. Revisit when `feat/plugin-command-catalog` merges
and a views catalog or manifest loader appears. Influence route: Ideas discussions, plus
being visibly the first serious external consumer of the plugin runtime.

**C. Status quo + drift plan (incumbent).**
Keep Overdeck sovereign; cherry-pick chat-component fixes; re-sync `effect-acp`
(currently one month stale at pinned `5ca32661`, drift is unexamined upstream changes, not
local edits). Cheapest, loses nothing, gains none of t3code's platform features.

**D. Sidecar integration (no fork, no plugin).**
Run stock t3code alongside Overdeck as the *chat client*, driving it through its
documented surfaces: pairing/auth tokens, `POST /api/orchestration/dispatch`, the
orchestration snapshot/subscribe APIs. Overdeck stays the orchestrator daemon; t3code
becomes one more front-end. Viable today without touching their code, but it makes
Overdeck's UI story worse, not better, unless we only want their thread UX for
conversations.

## Recommendation

Stay on **C** now, position for **B**, and steal one specific thing from the branch:

1. **Vendor `packages/plugin-runtime` itself when it merges** (MIT, self-contained,
   dependency-free by design, 1,000+ lines of contract tests). Overdeck has its own
   extensibility ambitions; adopting their runtime as Overdeck's plugin substrate keeps
   the two ecosystems contract-compatible, so an eventual Overdeck-as-t3code-plugin is a
   packaging exercise rather than a rewrite. This is the same play as `effect-acp`.
2. **Watch `feat/plugin-command-catalog` and successors** (cheap: the local clone tracks
   upstream; check for `ViewsCatalog`/manifest-loader work). The moment views + loading
   exist, prototype one Overdeck surface (e.g. the pipeline board) as a t3code plugin
   against stock upstream and measure the remaining gap.
3. **Post in their Ideas discussions** describing the orchestrator-as-plugin use case —
   views catalog, server-service contributions, settings contributions, a scope-registration
   hook. That is the entire "minimum pieces upstream must adopt" list, and a discussion is
   the only channel they accept. Concretely: (a) manifest discovery/loading, (b) a
   `views` catalog with a web-bundle entrypoint, (c) a `settings` catalog, (d) plugin-
   provided server services/RPC (or blessing the raw-HTTP-route seam), (e) open (or
   registrable) auth scopes.
4. **Continue the drift plan's chat cherry-picks and re-sync `effect-acp`** — with the
   caveat from the overlap audit that three of our vendored files now cite upstream
   patterns that no longer exist; those should be re-based on the new upstream shapes
   (`rpc/transportError` et al., `terminalUiStateStore`) or declared permanently ours.

**The condition that would flip the whole call:** if upstream ships manifest loading plus
a views catalog and starts vouching external plugin authors, option B becomes real and
strictly dominates a fork — Overdeck rides a maintained host with zero rebase burden and
the t3code folks adopt nothing on our behalf beyond what they already built for
themselves.
