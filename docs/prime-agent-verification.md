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
