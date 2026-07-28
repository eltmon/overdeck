# PAN-2565 — Feedback: Traycer A2A code review, standards landscape, and UX mockups

**Issue:** [PAN-2565](https://github.com/eltmon/overdeck/issues/2565)
**Feedback model:** k3[1m] (Claude Code, 2026-07-25)
**Feeds:** the draft PRD `drafts/pan-2565.md` (same directory); cross-refs [PAN-2566](https://github.com/eltmon/overdeck/issues/2566) (Traycer parity epic, gap #1), [PAN-3015](https://github.com/eltmon/overdeck/issues/3015) (`pan monitor` transport), [PAN-606](https://github.com/eltmon/overdeck/issues/606) (MCP Agent Mail eval), [PAN-2668](https://github.com/eltmon/overdeck/issues/2668) (queue durability)

**Mockups (open locally, Chrome renders them):**

- `drafts/pan-2565-mockup-architecture.html` — Traycer review + interactive broker-flow sequence diagrams + concept-mapping table + proposed agent-facing CLI surface
- `drafts/pan-2565-mockup-ux.html` — interactive UX: the task "room" (merged timeline + lineage tree + presence + member tabs) and the "council" flow (fan-out one question to 5 agents, synthesizer rollup)

---

## 1. What was done

Cloned `traycerai/traycer` (2026-07-25, `main`) to `~/Projects/traycer` and reviewed the agent-to-agent machinery end-to-end (two parallel exploration passes + direct reads of the core contracts). Researched the 2026 A2A standards landscape. Built the two interactive mockups above: first de novo from the Traycer review, then discovered this PRD — which independently converged on the same design. This file records findings the PRD should absorb at planning time.

## 2. Traycer review — key facts (verified against the cloned repo)

**The open-source repo is protocol + clients only.** The host broker (queues, sweep, MCP server, hook installation) is closed-source; the wire contracts carry the whole design anyway.

- **Five unary RPCs are the entire A2A surface:** `agent.create`, `agent.list`, `agent.sendMessage`, `agent.getTranscript`, `agent.stop` (`protocol/src/host/agent/contracts.ts`, `shared.ts:768-791`).
- **Brokered, never peer-to-peer:** `agent.sendMessage` enqueues onto a **RAM-only** per-receiver inbox queue in the host (`protocol/src/host/agent/inbox.ts:1-31`). Queued messages are lost on host restart — our durable `a2a_messages` table is strictly better; keep it.
- **Threading:** `expectReply: true` mints a `responseId` naming the **thread**, not the message — follow-ups share it, one reply closes it (`shared.ts:754-766`). Matches the PRD's `replyId` semantics exactly.
- **TUI delivery needs a sidecar *there*:** `traycer monitor`, a background process inside the Claude Code session, subscribes to `agent.inbox.subscribe` (versioned stream RPC) and prints frames to **stdout**, which Claude Code's background-output surface injects into context (`clients/traycer-cli/src/commands/monitor.ts`). Needed because they can't push into a TUI. **We can** (PTY supervisor) — the PRD's no-sidecar call is correct. Note [PAN-3015](https://github.com/eltmon/overdeck/issues/3015) proposes the monitor pattern anyway for delivery-fragility reasons; that is a transport decision orthogonal to A2A and should stay in PAN-3015.
- **Stalled-receiver notices, 7 reasons:** `turn-ended` (primary signal: Claude Code Stop hook → `agent.tui.turnEnded`), `exited`, `quiet`, `user-stopped`, `errored`, `awaiting-input`, `receiver-cancelled` (`inbox.ts:97-170`). **The PRD's FR-6 lists five — adopt `errored` and `receiver-cancelled` too** (they change what the sender may do next: `receiver-cancelled` means "do not re-send", `errored` carries the raw error text).
- **Every message teaches the receiver how to reply:** `[traycer:agent-message]` prefix with the exact reply command + responseId inline (`protocol/src/agent/a2a-message-format.ts`). The PRD's provenance-header block should copy this shape verbatim (with our nouns).
- **Capability gating is honest:** `agent.list` rows carry `{readTranscript, sendMessage}` booleans; `sendMessage = sameUser ∧ isLocal ∧ canParticipate` (`shared.ts:607-648`, `622-625`). Only Claude Code among TUI harnesses may participate.
- **Versioning discipline:** every shipped schema version is frozen with explicit upgrade/downgrade bridge functions (`contracts.ts` is ~700 lines of bridges). We ship all clients from one repo, so bridges are unnecessary — but keep the attitude: wire shape is a contract; the receiver's version is authoritative.

## 3. Standards landscape (2026-07) and the recommendation

- **Google A2A** is the de-facto agent↔agent standard: launched 2025-04, donated to the Linux Foundation 2025-06, v1.0 shipped 2026-03, v1.2 at I/O 2026 (gRPC, signed Agent Cards). Core concepts: Agent Card at `/.well-known/agent.json`, task lifecycle (`submitted|working|input-required|completed|failed|canceled`), JSON-RPC over HTTP+SSE.
- **IBM ACP** merged into A2A (2025-08); **AGNTCY** (Cisco) conceded the protocol race and repositioned as discovery/identity/observability infrastructure. **MCP** (Anthropic, also Linux Foundation now) remains the agent↔tool layer. The 2026 stack is "MCP for tools, A2A for peers."
- **MCP Agent Mail** ([PAN-606](https://github.com/eltmon/overdeck/issues/606)) is an implementation, not a standard — persistent inboxes + file reservations via an MCP server. Its file-reservation idea (advisory leases on file patterns for convoy mode) is the only piece worth a second look; disposition belongs to WI-8.

**Recommendation — do not adopt A2A's transport inside the machine.** A2A solves cross-org problems (signed cards, OAuth, discovery directories) that don't exist in the one-machine-one-operator trust domain; importing it would force auth and versioning decisions before a single production thread exists. The high-value, low-cost move is **vocabulary alignment**, decided up front so it isn't retrofitted:

- Thread states `open|closed|stalled` (PRD) mapped 1:1 onto A2A task vocabulary at the API/DTO layer (`submitted|working|input-required|completed`); `awaiting-input` stays a **liveness notice reason**, not a thread state (an agent can be blocked on the operator while its thread is legitimately open).
- Discovery rows (`pan task list` / `pan msg list`) carry **Agent-Card-shaped capability fields** (`capabilities: {readTranscript, sendMessage}`) — our list row is already ~80% of an Agent Card.
- Result: a future A2A facade for external callers becomes a mechanical adapter, not a translation project. File a deferred spike issue for the facade; revisit after the council pattern (below) has run in production.

## 4. The council use case — proposed PRD additions

The operator's headline scenario: **ask 5 agents the same question; a synthesizer rolls up the answers and their differences.** The mockup (`pan-2565-mockup-ux.html`, "council" pane) implements this end-to-end on PRD machinery alone — fan-out is N `expectReply` sends, synthesis is one more member whose kickoff brief is the question + the reply bodies **read from `a2a_messages`, never scraped from panes**. Two additions to the PRD are proposed:

1. **New acceptance criterion (WI-2/WI-5):** *Council pattern* — from the task surface, the operator sends one question to N members with `expectReply`; answers return on N threads at independent latencies; a synthesizer member receives the question plus all reply bodies via broker state and posts a rollup; a stalled member produces a liveness notice and the council can proceed without them ("synthesize now"). No new broker machinery is permitted for this — if it needs any, the broker API is wrong.
2. **New surface in WI-5 (or a follow-up): Room merged timeline.** The PRD's task surface is tree + tabs. The mockup's **Room** tab merges everything the broker sees (all member A2A traffic + operator messages + liveness notices) into one chronological, provenance-marked timeline — this is the view that makes "agents discussing an issue" legible to the operator. It is a read model over `a2a_messages` + member turns, not a transport. Recommend adding it to WI-5 as an alternate tab, default when a task has ≥2 members.

## 5. Decision points for planning (where mockup and PRD diverge)

- **Verb shape:** the PRD extends `pan tell` (`--expect-reply`, `--reply-to`) — ride the sanctioned door. The architecture mockup sketched a separate `pan msg send|list|inbox|transcript` family. Recommendation: **follow the PRD** (`pan tell` extensions for send; `pan inbox`, `pan transcript`, `pan task list|show` as new verbs). Rationale: one delivery door, one verb to teach; `tell` with a sender that is another agent is a semantic extension, not a new transport. The mockup's `pan msg list` maps onto `pan task list --members`.
- **Liveness reasons:** adopt all 7 Traycer reasons (§2), not the PRD's 5.
- **Delivery timing:** PRD FR-5 queues to busy receivers and delivers at turn end. Traycer delivers immediately and lets the harness's own queueing handle it. Keep FR-5 as drafted (turn-boundary injection is what our hardening stack already guarantees) — but note the trade-off: immediate delivery is what makes fast agent-to-agent *debate* feel live in Traycer's UX. If turn-boundary queuing makes councils feel sluggish in UAT, revisit per-harness.

## 6. What this feedback asks the planner to do

1. Add the council acceptance criterion and the Room-timeline surface item (§4).
2. Add the vocabulary-alignment work item: thread states and discovery-row capability fields mapped 1:1 to A2A vocabulary (§3).
3. Adopt the 7-reason liveness taxonomy (§2).
4. File the deferred "A2A facade for external callers" spike issue.
5. Resolve the verb-shape decision point per §5 (`pan tell` extensions, PRD as drafted).
6. WI-8: record MCP Agent Mail disposition — build per this PRD; the only idea worth salvaging is file reservations, tracked separately if wanted.

## 7. IA placement — it IS a conversation (operator direction, 2026-07-25)

The operator reviewed the UX mockup against the live dashboard and steered the surface model: **a room is a conversation with N member sessions, not a new top-level "Task" surface.** Concretely:

- A multi-agent conversation lives in the project's **CONVERSATIONS** list in the Command Deck like every other conversation, at `/conv/<id>`, project-scoped, with only a "N members" chip as the list-level difference. One member = today's conversation, unchanged (PRD's degenerate-case invariant already says this — take it all the way and drop the separate surface).
- The conversation view gains a **Room** tab (default when members > 1): the merged, provenance-marked timeline — question, answers landing inline as threads close, liveness notices as system rows, synthesis. Member tabs remain as drill-down into each member's own transcript (tools and all).
- The composer becomes "Message the room…" with member chips; "Ask the room" is the council trigger (fan-out + arm synthesizer).
- **Naming:** the PRD's "Task" noun should not ship as user-facing language — it collides with the xBRIEF `pan task` checklist verbs ([PAN-2648](https://github.com/eltmon/overdeck/issues/2648)). User-facing noun: **room** (or just "conversation with members"). Planner should rename the internal column (`tasks` table / `task_id` → `rooms` / `room_id`) and reconcile `pan task list|show` (PRD CLI section) against the existing checklist verb.
- The mockup (`pan-2565-mockup-ux.html`) has been reframed to this model: both panes render inside the Command Deck conversation chrome (`/conv/1042`, "6 members" chip).
