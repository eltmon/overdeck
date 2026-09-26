# Prime Agent integration

The canonical harness ID is `prime-agent`; the executable is `prime-agent`.
Overdeck supports `0.8.0 – <0.9.0` (daemon protocol 7), pinned in
`src/lib/prime-agent/compat.ts`. User-facing documentation is the "Prime Agent"
section of [`configuration/harnesses.mdx`](../configuration/harnesses.mdx).
PRD: [`.pan/drafts/pan-3668.md`](../.pan/drafts/pan-3668.md).

## Architecture

Every Prime launch runs one Overdeck **host** process in the agent's terminal
pane: `node dist/prime-agent-host.js` (source `src/lib/prime-agent/host.ts`,
tsdown entry `prime-agent-host`). The host:

1. reads the recorded `prime-agent-session-id`, then clears the ready files
   (`prime-agent-session-id`, `prime-agent-session-file`,
   `prime-agent-launch-error`) and its socket;
2. checks `prime-agent --version` against `compat.ts` (0.8.0 prints the
   version on **stderr**; `readPrimeAgentVersionOutput` reads both streams);
3. reaps any supervisor left on the agent's daemon socket, or removes a leftover
   socket file and its `.lock` directory;
4. spawns `prime-agent --mode rpc --daemon-socket <socket> --provider <p>
   --model <m> --session-dir <agentDir>/prime-sessions --no-extensions
   [--thinking <level>] [--resume <sessionFile>]` plus the context flags, as an
   argv array in the workspace, with `PI_SKIP_VERSION_CHECK=1`;
5. frames the child's stdout as strict LF JSONL (`jsonl-framing.ts`, 16 MiB
   record limit, U+2028/U+2029 safe) into `PrimeAgentRpcClient`;
6. writes `prime-agent-token`, listens on
   `$OVERDECK_HOME/sockets/prime-agent-<agentId>.sock` (mode 0600), and calls
   `get_state`;
7. on resume, requires `sessionFile` to equal `--resume` and `sessionId` to
   equal the recorded id, else writes the launch error, stops the child, reaps
   the daemon, and exits 1;
8. writes `prime-agent-session-file`, then `prime-agent-session-id` last
   (readiness keys on it), and appends `sessions.json` with
   `{harness: 'prime-agent', path: sessionFile}`.

On `SIGTERM`, `SIGINT` or `SIGHUP` the host sends `abort` (2 s), ends the
child's stdin, waits 3 s, kills the child, reaps the daemon and removes the
socket. If the child exits before ready, the launch error carries the tail of
its stderr.

### Host socket ops

The host serves the same contract as the ACP host (D4): POST only, header
`x-overdeck-bridge-token`, JSON body with `op`.

| Op | Prime RPC | Response |
| --- | --- | --- |
| `status` | — | `200 {state, sessionId, sessionFile, isStreaming}` |
| `message` | `prompt` (idle, with `streamingBehavior: 'steer'`) or `steer` (streaming) | `202 {accepted: true, promptId, command}` |
| `interrupt` | `abort` | `200 {ok: true}` |
| `set-effort` | `set_thinking_level` (`off`…`max`) | `200 {ok: true, effort}`; `400` for another level |

Errors: `405` non-POST, `401` wrong token, `413` body over the limit, `400`
invalid JSON or unknown op, `409` before ready.

`src/lib/runtimes/host-transport.ts` maps `HarnessBehavior.deliveryKind` to a
host transport (`acp-host-rpc` → `acp`, `prime-agent-host-rpc` →
`prime-agent`). Delivery, messaging, readiness and prompt kickoff ask
`hostTransportFor()` instead of comparing harness names (D5).

## Decisions

- **D2/D3 — private daemon.** `--daemon-socket` is
  `$OVERDECK_HOME/sockets/pd-<first 16 hex of sha256(agentId)>.sock`
  (`primeAgentDaemonSocketPath`, ≤ 100 bytes or `PrimeAgentSocketPathTooLong`).
  `reapPrimeAgentDaemon` (`daemon.ts`) finds the `prime-agent status --json`
  entry with that exact `socketPath`, sends `SIGTERM` to `-<pid>`, polls every
  250 ms for 5 s, then sends `SIGKILL`. The host, `stopAgent`,
  `stopConversationRuntime` and the runtime adapter all call it; it is
  idempotent. `prime-agent shutdown` cannot target a non-default socket. Verified
  on 0.8.0: after the group kill, `status --json` lists nothing and no Prime
  process remains; transient kernel forkserver entries are skipped by the exact
  socket match.
- **D7 — session file vs session id.** They are different UUIDs. The pointer
  file holds the `sessionFile`; the id file holds the `sessionId`.
- **D8/D9 — context through argv.** `prime-agent-context.md` is split into
  `--append-system-prompt` values of at most 100,000 bytes, after
  `PRIME_AGENT_MANAGED_POLICY`.
- **D10/D11 — managed session.** Extension dialogs are answered with
  `cancelled: true`. `policy.ts` refuses `send_message`, `agent_messages_*`,
  `*_schedule`, `list_schedules`, `*_heartbeat`, `list_heartbeats`, `observe`,
  `unobserve`, `refine`, `new_session`, `switch_session`, `fork` and `clone`.
- **D12 — credentials.** `provider-map.ts` checks the `auth.json` key names,
  then the env var, then Overdeck settings. The key travels in the pane launch
  env (`paneEnv`); the launcher's provider-env `unset` skips that one name
  (`preserveProviderEnv`). An env-var credential is passed through too, because
  agent panes start with every provider key blanked.
- **D13 — ToS.** `canUseHarness` blocks `prime-agent` + Anthropic +
  subscription.
- **D16 — transcript and cost.** Prime writes the pi v3 session format, so the
  feed parser is the pi parser core in its `prime-agent` dialect
  (`prime-agent-conversation-parser.ts`). `cost-parsers/prime-agent-parser.ts`
  emits one event per assistant message with usage; a
  `child_usage_attributed.aggregateUsage` replaces its target's usage.
  `requestId` is `prime-agent:<sessionId>:<entryId>`.

## Files

| File | Role |
| --- | --- |
| `src/lib/prime-agent/host.ts` | Host process |
| `src/lib/prime-agent/rpc-client.ts`, `jsonl-framing.ts`, `policy.ts` | RPC transport and managed policy |
| `src/lib/prime-agent/provider-map.ts` | Provider and credential mapping |
| `src/lib/prime-agent/daemon.ts` | Supervisor lookup, reaper, orphan listing |
| `src/lib/prime-agent/launcher-fields.ts` | Launcher fields for work, plan, conversation and runtime launches |
| `src/lib/prime-agent/host-client.ts` | One-op client for the host socket (`interrupt`) |
| `src/lib/prime-agent/compat.ts` | Version pin and version parsing |
| `src/lib/runtimes/prime-agent.ts` | Cloister `PrimeAgentRuntimeSync` |
| `src/lib/runtimes/storage/prime-agent.ts` | Every Prime path literal |
| `src/cli/commands/doctor-prime-agent.ts` | `pan doctor` check |

## Bumping the supported version

1. Install the new release and read its `docs/rpc.md`, `docs/daemon.md` and
   `docs/session-format.md` for changes to commands, `get_state`,
   `status --json` or session entries.
2. Update `PRIME_AGENT_SUPPORTED_RANGE` and, if it changed,
   `PRIME_AGENT_PROTOCOL_VERSION` in `compat.ts`, and the install command.
3. Re-run the live verification (`tests/integration/prime-agent-smoke.slow.test.ts`
   with the binary installed) and the host tests.
4. Record the new verified version here and in `configuration/harnesses.mdx`.

Verified versions: 0.8.0 (2026-09-25).
