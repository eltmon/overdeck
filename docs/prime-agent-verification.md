# Prime Agent live verification (PAN-3668)

Recorded 2026-09-26 on Linux with prime-agent **0.8.0** (daemon protocol 7) and
Node 22.22.0, from branch `feature/pan-3668`. Model: `gpt-5.5` through Prime's
`openai-codex` sign-in. (`k3` through `kimi-coding` was tried first; that
provider returned `403 permission_error` for this account's Kimi Code plan,
which the host showed as a failed turn.)

## Smoke test

`VITEST_INCLUDE_SLOW=1 npx vitest run tests/integration/prime-agent-smoke.slow.test.ts`
passed. With a temporary `OVERDECK_HOME` and a temporary git repository it:

1. started the host with the real binary (version check, daemon reap,
   `prime-agent --mode rpc --daemon-socket …`), and got a session file and id;
2. sent a prompt (`command: prompt`), waited for `isStreaming`, and sent a second
   message that the host delivered as `command: steer`;
3. read a non-empty `prime-agent-stats.json` after the turn;
4. stopped the host, after which `prime-agent status --json` listed no
   supervisor on the agent's socket;
5. resumed from the recorded session file and got the same session id, then
   stopped again with no supervisor left.

A cold host start (version check, reap, spawn, `get_state`) was ready in
**2.5 s**, well inside the 30 s and 60 s readiness waits.

## Dashboard

`npm run build` succeeded and emitted `dist/prime-agent-host.js` and
`dist/dashboard/server.js`. A throwaway Node 22 dashboard ran from that `dist`
on port 3491 with a temporary `OVERDECK_HOME` and `OVERDECK_DISABLE_DEACON=1`
(peer mode, spawns nothing); `GET /api/health` returned **200**. The host was
run once under that home to record a real Prime session with a tool call, and a
`prime-agent` conversation row was registered for it. Screenshots were taken
with Playwright in its own headless Chromium profile.

### Harness picker — `verification/pan-3668/harness-picker.png`

The new-conversation model picker with "Show all harness/model permutations" on.
The Harness section lists **Prime Agent — Prime Intellect coding agent (RPC)**.
The selected model is a Claude model and the throwaway home has Anthropic on
subscription auth, so the row shows the Prime Agent Terms-of-Service block
reason from `canUseHarness` — the policy gate reaching the picker. The popover
is anchored at the conversation-list column and is clipped slightly on the left.

### Conversation feed — `verification/pan-3668/conversation-feed.png`

The Prime conversation rendered from its session JSONL through the
`prime-agent` transcript parser: the user prompt, a **Thinking** row, the
**ipython** tool call (Prime runs bash through its IPython tool), and the
assistant answer "There are 2 files." The conversation list row reads
"Prime Agent · gpt-5.5" with its cost and tokens, and the activity card shows the
Prime Agent icon.

### Context preview — `verification/pan-3668/context-prime-tab.png`

The **Prime Agent** tab of the Agent context page, showing "Overdeck injected
context preview (Prime Agent)" with the global layer and the bundled rules.

## Acceptance criteria

Each xBRIEF acceptance criterion and the evidence for it.

| Criterion | Evidence |
| --- | --- |
| `contracts-harness.ac1` | packages/contracts harness-behavior test; no-loss audit (non-Claude displayName) |
| `contracts-harness.ac2` | packages/contracts context-layers and artifacts tests; KNOWN_HARNESSES in the no-loss audit |
| `contracts-harness.ac3` | HARNESS_MARKERS in the no-loss audit; npm run typecheck exits 0 on the final branch. Caveat: typecheck was red after WI-1 alone (hand-copied lists) until WI-4, as the WI-1 commit recorded |
| `runtime-name-policy.ac1` | src/lib/__tests__/harness-policy.test.ts |
| `runtime-name-policy.ac2` | tests/unit/dashboard/server/routes/settings-harness-policy.test.ts |
| `runtime-name-policy.ac3` | src/lib/__tests__/harness-binary.test.ts |
| `lib-harness-lists.ac1` | tests/lib/config-yaml.test.ts; config validation in the no-loss audit |
| `lib-harness-lists.ac2` | no-loss audit (normalizeHarness, resolveAllowedHarness) |
| `lib-harness-lists.ac3` | src/lib/__tests__/settings-api.test.ts; normalize-harness test |
| `cli-harness-lists.ac1` | `node dist/cli/index.js start --help` lists prime-agent; CLI help check in the no-loss audit |
| `cli-harness-lists.ac2` | src/cli/commands/__tests__/start-harness.test.ts |
| `cli-harness-lists.ac3` | scripts/lint-skills.sh and scripts/lint-slash-commands.sh exit 0 (manifest regenerated after the main merge) |
| `frontend-harness-lists.ac1` | components/chat/__tests__/ModelPicker.test.tsx (row and logo); verification/pan-3668/harness-picker.png |
| `frontend-harness-lists.ac2` | components/shared/branding/__tests__/branding.test.tsx |
| `frontend-harness-lists.ac3` | components/sessionFeed/__tests__/ConversationFeedCard.test.tsx |
| `host-transport.ac1` | src/lib/runtimes/__tests__/host-transport.test.ts |
| `host-transport.ac2` | delivery, messaging and readiness suites pass; only the waitForAcpHostReady rename changed test call sites |
| `host-transport.ac3` | src/lib/agents/__tests__/delivery-prime-agent.test.ts |
| `host-transport.ac4` | src/lib/agents/__tests__/runtime-command.test.ts (Prime readiness, fake timers) |
| `prime-storage.ac1` | src/lib/runtimes/storage/__tests__/prime-agent.test.ts |
| `prime-storage.ac2` | src/lib/runtimes/storage/__tests__/prime-agent.test.ts |
| `prime-storage.ac3` | storage test (null pointer target); lint-harness-storage probe flagged prime-sessions outside storage |
| `prime-provider-map.ac1` | src/lib/prime-agent/__tests__/provider-map.test.ts |
| `prime-provider-map.ac2` | src/lib/prime-agent/__tests__/provider-map.test.ts |
| `prime-provider-map.ac3` | src/lib/prime-agent/__tests__/provider-map.test.ts |
| `prime-provider-map.ac4` | src/lib/prime-agent/__tests__/provider-map.test.ts |
| `rpc-transport.ac1` | src/lib/prime-agent/__tests__/jsonl-framing.test.ts |
| `rpc-transport.ac2` | src/lib/prime-agent/__tests__/rpc-client.test.ts (fake timers) |
| `rpc-transport.ac3` | src/lib/prime-agent/__tests__/rpc-client.test.ts |
| `rpc-transport.ac4` | src/lib/prime-agent/__tests__/rpc-client.test.ts and policy.test.ts |
| `daemon-reaper.ac1` | src/lib/prime-agent/__tests__/daemon.test.ts |
| `daemon-reaper.ac2` | src/lib/prime-agent/__tests__/daemon.test.ts (fake timers) |
| `daemon-reaper.ac3` | src/lib/prime-agent/__tests__/daemon.test.ts |
| `prime-host.ac1` | src/lib/prime-agent/__tests__/host.test.ts |
| `prime-host.ac2` | src/lib/prime-agent/__tests__/host.test.ts |
| `prime-host.ac3` | src/lib/prime-agent/__tests__/host.test.ts |
| `prime-host.ac4` | src/lib/prime-agent/__tests__/host.test.ts |
| `prime-host.ac5` | npm run build emits dist/prime-agent-host.js; host.test.ts 401 case |
| `work-launch.ac1` | tests/unit/lib/launcher-generator-prime-agent.test.ts; agents-spawn-supervisor Prime case |
| `work-launch.ac2` | launcher-generator-prime-agent test; agents-spawn-supervisor Prime recovery case |
| `work-launch.ac3` | src/lib/__tests__/agents-spawn-supervisor.test.ts (no pane on credential error) |
| `work-launch.ac4` | src/lib/__tests__/agents-spawn-supervisor.test.ts |
| `planning-launch.ac1` | src/lib/planning/__tests__/spawn-planning-session-prime.test.ts |
| `planning-launch.ac2` | spawn-planning-session-prime test (launcher uses no prompt file or credential). Note: init-prompt.txt is still written to the agent dir for every harness, unreferenced by the Prime launcher |
| `prime-conversations.ac1` | src/dashboard/server/routes/__tests__/conversations-supervisor.test.ts (handleConversationCreate, Prime) |
| `prime-conversations.ac2` | tests/unit/lib/overdeck/conversation-runtime-prime.test.ts |
| `prime-conversations.ac3` | tests/unit/lib/overdeck/conversation-runtime-prime.test.ts |
| `prime-conversations.ac4` | conversations-supervisor test (Prime teardown on failed prompt) |
| `prime-runtime-adapter.ac1` | src/lib/runtimes/__tests__/prime-agent.test.ts (fake timers) |
| `prime-runtime-adapter.ac2` | src/lib/runtimes/__tests__/prime-agent.test.ts |
| `prime-runtime-adapter.ac3` | src/lib/runtimes/__tests__/prime-agent.test.ts |
| `prime-runtime-adapter.ac4` | prime-agent.test.ts (registry) and prime-agent-spawn.test.ts (no tmuxCreateSession) |
| `recovery-stop.ac1` | src/lib/__tests__/agents-spawn-supervisor.test.ts (Prime recovery) |
| `recovery-stop.ac2` | src/lib/__tests__/agents-stop-terminal-backend.test.ts |
| `context-preview.ac1` | tests/lib/context-layers/harness.test.ts |
| `context-preview.ac2` | tests/unit/dashboard/server/routes/context.test.ts; verification/pan-3668/context-prime-tab.png |
| `context-preview.ac3` | tests/unit/lib/context-layers/prime-agent.test.ts |
| `transcript-feed.ac1` | tests/unit/dashboard/services/prime-agent-conversation-parser.test.ts |
| `transcript-feed.ac2` | prime-agent-conversation-parser test (unknown and malformed lines) |
| `transcript-feed.ac3` | ws-rpc registration; the throwaway dashboard rendered the live Prime session (verification/pan-3668/conversation-feed.png); jsonl-resolver pointer tests |
| `transcript-feed.ac4` | components/CommandDeck/__tests__/ForkModal.test.tsx |
| `cost-ingest.ac1` | tests/unit/lib/cost-parsers/prime-agent-parser.test.ts |
| `cost-ingest.ac2` | tests/unit/lib/cost-parsers/prime-agent-parser.test.ts |
| `cost-ingest.ac3` | src/lib/overdeck/__tests__/cost-prime-agent-reconcile.test.ts |
| `doctor-prereq.ac1` | tests/unit/cli/doctor-prime-agent.test.ts |
| `doctor-prereq.ac2` | tests/unit/cli/doctor-prime-agent.test.ts; live probe returned ok 0.8.0 |
| `doctor-prereq.ac3` | tests/unit/cli/doctor-prime-agent.test.ts |
| `docs.ac1` | grep of configuration/harnesses.mdx |
| `docs.ac2` | grep of docs/PRIME-AGENT-HARNESS.md |
| `docs.ac3` | grep of configuration/context-layers.mdx and docs/TELEMETRY.md |
| `harness-no-loss-audit.ac1` | tests/unit/lib/prime-agent-no-loss-audit.test.ts and the frontend companion |
| `harness-no-loss-audit.ac2` | mutation check: removing prime-agent from src/lib/telemetry/pipeline.ts failed the audit on that file |
| `live-verification.ac1` | tests/integration/prime-agent-smoke.slow.test.ts passed live |
| `live-verification.ac2` | tests/integration/prime-agent-smoke.slow.test.ts passed live |
| `live-verification.ac3` | /api/health 200 on the throwaway dashboard; three screenshots in docs/verification/pan-3668/ |
