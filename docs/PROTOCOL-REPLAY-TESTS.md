# Protocol Replay Tests

Replay tests check Overdeck's structured harness clients against recorded
provider behavior instead of hand-written mocks. A hand-written mock behaves the
way its author expects; a recording behaves the way the provider actually did,
including event ordering. When a CLI update changes ordering or adds fields,
re-recording turns that change into a failing test instead of a broken dashboard.

The transports in scope are the Codex app-server (`codex app-server`, stdio) and
ACP (`kimi acp`). Issue: PAN-4563.

## What replay tests are

- **Client** — Overdeck's side of the connection: `CodexAppServerManager` for
  Codex, `AcpSessionRuntime` (built on `effect-acp`) for ACP.
- **Provider** — the agent process on the other side.
- **Frame** — one JSON-RPC message on the wire (one NDJSON line). Direction `out`
  is Overdeck to the provider; `in` is the provider to Overdeck.
- **Frame kind** — derived from keys: a *request* has `id` and `method`, a
  *notification* has `method` and no `id`, a *response* has `id` and no
  `method`. effect-acp writes notifications with `"id":""`, so under this rule
  its notifications count as requests. Recording and replay classify them the
  same way, so matching still works.
- **Capture** — recording every frame of a live session, in observed order, to a
  fixture file.
- **Scrub** — rewriting each frame at capture time, before it touches disk.
- **Fixture** — one JSONL file in the `overdeck-protocol-capture/1` format.
- **Replay** — a test-only stand-in for the provider. It plays the fixture's `in`
  frames to the real client code in recorded order and checks the client's `out`
  frames against the recording.
- **Optional tail** — `out` frames after the last `in` frame (for example the
  `session/cancel` that `AcpHost.stop()` sends). Replay matches them if they
  arrive and never waits for them.

Code lives in `src/lib/protocol-capture/`: `fixture.ts` (format and parser),
`scrub.ts`, `capture.ts` (sink and Codex transport wrapper), `acp-logging.ts`
(ACP adapter), `replay.ts` (engine), and `record.ts` (recorder). Harness
adapters live next to their tests: `src/lib/codex/__tests__/replay-app-server.ts`
and `src/lib/acp/__tests__/fixtures/replay-spawner.ts`.

## Capture mode

Capture is a developer tool and is off by default. Set
`OVERDECK_PROTOCOL_CAPTURE_DIR` to an absolute directory and every Codex
app-server connection (stdio or native socket) and every ACP host session writes
one fixture there, named `<harness>-<recordedAt>-<pid>.jsonl`. With the variable
unset, empty, or relative, nothing changes and no file is written.

- **Codex:** `CodexAppServerManager` wraps its transport in `useTransport`, so
  both stdio and native connections are captured. The header gets the CLI
  version from the startup version check.
- **ACP:** `host.ts main()` passes `protocolLogging` into the runtime, and the
  raw effect-acp events are split into one frame per line in each direction.

Writes are async and go through one promise chain, so file order equals call
order. A write failure is reported once on stderr and never reaches the session.

## Recording a fixture

Fixtures come from the recorder only. Do not hand-edit them.

```bash
node --import tsx src/lib/protocol-capture/record.ts \
  --harness <codex|acp> --scenario <name> --out <path> \
  [--model <id>] [--effort <level>] [--note <text>]
```

`--help` prints the scenario table; an unknown harness or scenario exits 2. Each
run has a 300 s timeout. After the scenario's terminal event (the owner
`turn/completed` for Codex, `waitForIdle()` for ACP) the recorder keeps
capturing until no frame has moved for 2 s, so frames that arrive after the turn
boundary stay in the fixture. A failed run deletes its partial fixture.

| Harness | Scenario | Prompt | Scripted actions | Fixture |
| --- | --- | --- | --- | --- |
| codex | `turn-idle` | `Reply with exactly OK.` | none | `src/lib/codex/__fixtures__/replay/turn-idle.jsonl` |
| codex | `interrupt` | count from 1 to 400 | interrupt on the first owner `item/*` notification after `turn/started` | `…/replay/interrupt.jsonl` |
| codex | `subagent` | spawn one sub-agent that replies PONG, then reply DONE | accept any approval | `…/replay/subagent.jsonl` |
| codex | `approval` | `printf hi > $HOME/.overdeck-approval-probe-<pid>.txt` | accept each `*/requestApproval`; the probe file is deleted afterwards | `…/replay/approval.jsonl` |
| codex | `user-input` | ask me one question with `request_user_input` (red or blue) | answer each question with its first option | `…/replay/user-input.jsonl` |
| acp | `turn-completion` | `Reply with exactly OK.` | none | `src/lib/acp/__tests__/fixtures/replay/kimi-turn-completion.jsonl` |
| acp | `interrupt` | count from 1 to 400 | interrupt on the first `[assistant]` pane line | `…/replay/kimi-interrupt.jsonl` |

Defaults: Codex `gpt-5.6-luna`, effort `low`; ACP (Kimi) `k3`, effort `low`
(K3 refuses to launch without an effort level).

**Prerequisites.** Codex needs `~/.codex/auth.json`; the recorder builds a temp
`CODEX_HOME` with `initCodexHome`, which links it. The `user-input` scenario
turns on `[features] default_mode_request_user_input = true` in that temp home.
Kimi needs a working `kimi` login, or a Kimi home whose model backend is
reachable (see the provenance note below).

**Approval prompt.** The planned prompt was a network `curl`, but in the
`workspace-write` sandbox it fails at DNS without asking for approval
(codex-cli 0.159.0), and `/tmp` is writable there. A write under `$HOME` asks.

### Provenance of the committed Kimi ACP fixtures

The two Kimi fixtures were **not** recorded against a Kimi model. The local Kimi
login had expired and no Kimi credits were available, so they were recorded with
the real Kimi Code CLI 2.0.2 (`kimi acp`) driving **gpt-6-luna through the local
CLIProxy** (model alias `luna`, `--model luna`), using a throwaway Kimi home.

To build that Kimi home on a machine that lacks it (CLIProxy must be running on
port 8317), create the directory and write its config. Replace the `api_key`
placeholder with the first entry under `api-keys` in
`~/.overdeck/cliproxy/config.yaml`; never paste a real key into this doc or a
commit.

```bash
mkdir -p ~/.overdeck/kimi-cliproxy-home
chmod 700 ~/.overdeck/kimi-cliproxy-home
cat > ~/.overdeck/kimi-cliproxy-home/config.toml <<'EOF'
default_model = "luna"

[models."luna"]
provider = "cliproxy"
model = "gpt-6-luna"
max_context_size = 200000
capabilities = []

[providers."cliproxy"]
type = "openai"
base_url = "http://localhost:8317/v1"
api_key = "<first entry under api-keys in ~/.overdeck/cliproxy/config.yaml>"
EOF
chmod 600 ~/.overdeck/kimi-cliproxy-home/config.toml
```

Smoke-test it; the reply should be `OK`:

```bash
KIMI_CODE_HOME=$HOME/.overdeck/kimi-cliproxy-home kimi -p 'Reply with exactly OK.' -m luna
```

Then record:

```bash
KIMI_CODE_HOME=$HOME/.overdeck/kimi-cliproxy-home KIMI_CLI_NO_AUTO_UPDATE=1 \
  node --import tsx src/lib/protocol-capture/record.ts --harness acp \
  --scenario <turn-completion|interrupt> --out <fixture> --model luna \
  --note "Recorded with Kimi Code CLI 2.0.2 (kimi acp) driving gpt-6-luna through the local CLIProxy …"
```

The ACP wire protocol and Kimi's JSON-RPC handling are the real CLI's, but
model-side behavior, such as whether thought chunks appear and how text is
chunked, may differ from K3. Each fixture's header `note` field says so. Never
commit anything from that Kimi home: its `config.toml` holds the CLIProxy key.
Re-record against K3 once a Kimi login is available.

## Scrubbing and review

Every frame is scrubbed before it is written:

1. **Paths and host name.** The cwd, Codex home, Overdeck home, home directory,
   and host name become `<CWD>`, `<CODEX_HOME>`, `<OVERDECK_HOME>`, `<HOME>`,
   and `<HOSTNAME>`, longest value first. Host names shorter than 4 characters
   are skipped so they cannot rewrite ordinary text.
2. **Secret keys.** A value under an anchored secret key name (`access_token`,
   `apiKey`, `authorization`, `cookie`, `password`, `installationId`, …)
   becomes `<REDACTED>`. Anchoring keeps `tokenUsage` and `inputTokens`.
3. **Secret values.** `sk-…` keys, GitHub and Slack tokens, JWTs, and `Bearer`
   headers inside any string become `<REDACTED>`.
4. **Emails** become `<EMAIL>`.
5. **Size.** A string longer than 8192 characters becomes `<TRUNCATED:<length>>`.

Codex reports the machine host name (`serverName`) and a stable device id
(`installationId`) in `remoteControl/status/changed`; rules 1 and 2 cover them.

Before committing a fixture, review it by hand:

- Search for your username, host name, project names, and any `isSecret`
  user-input answers.
- For ACP, `available_commands_update` lists every skill and command installed
  on the recording machine, names and descriptions. Check it holds nothing
  private.
- For CLIProxy-backed Kimi recordings, search for the CLIProxy key.

`src/lib/protocol-capture/__tests__/fixture-hygiene.test.ts` is the backstop: it
checks that every committed fixture parses, is at most 256 KiB, has no
`/home/`, `/Users/`, or `/root/` path, no secret-shaped value or email, no
string over the scrub limit, and that a synthetic header carries
`followUpIssue` and `syntheticNote`. It also asserts the seven expected
fixtures exist.

## Fixture format

Line 1 is the header; every later line is a frame.

```jsonc
// header
{"type":"header","format":"overdeck-protocol-capture/1","harness":"codex-app-server","provider":null,
 "cliVersion":"0.159.0","scenario":"interrupt","recordedAt":"2026-10-20T03:27:28.412Z",
 "hostOptions":{"model":"gpt-5.6-luna","effort":"low","prompt":"Count from 1 to 400, …"},
 "scrubbed":true}
// optional header keys: "synthetic": true, "syntheticNote", "followUpIssue", "note"
// frame
{"type":"frame","seq":0,"dir":"out","t":0,"message":{"id":1,"method":"initialize","params":{…}}}
{"type":"frame","seq":1,"dir":"in","t":41,"message":{"id":1,"result":{…}}}
// a line that was not valid JSON is kept verbatim:
{"type":"frame","seq":7,"dir":"in","t":90,"text":"<raw line>"}
```

`harness` is `codex-app-server` or `acp`; `provider` is `kimi` for ACP and `null`
for Codex. `t` is milliseconds since capture start and is diagnostic only.
`scenario` and `hostOptions` are `null` for env-var captures. `seq` must be
consecutive from 0; `parseProtocolFixture` rejects anything else.

## Writing a replay test

Replay matching rules: kinds must match; requests and notifications match by
`method`; client responses match by `id` and a deep-equal `result` (or both carry
an `error`). Client request params are not compared. The live id of each client
request replaces the recorded id in the recorded response. A mismatch rejects
`replay.done` with a `ReplayMismatchError` naming the seq, the expected frame,
and the actual line.

Breakpoints keep tests independent of tick timing:

- `pauseBefore(matcher)` holds delivery before the next matching `in` frame
  until `resume()`.
- `awaitingClient(matcher)` resolves when the cursor reaches a matching `out`
  frame and is waiting for the client.

Both pick their target by a forward scan when armed and reject at once if no
later frame matches. Arm a breakpoint before dispatching the op that leads to
its frame.

```ts
const { replay, manager, host } = await startCodexReplay('interrupt', { overdeckHome });
const facts = fixtureFacts(replay.fixture);           // ids come from the fixture
expect(interruptResponseIndex, 're-check case 2 against the new CLI').toBeLessThan(facts.ownerCompletedIndex);

const completed = replay.pauseBefore({ method: 'turn/completed', threadId: facts.ownerThreadId });
await host.handleOp({ op: 'message', content: prompt(replay) });
await host.handleOp({ op: 'interrupt' });
await completed;
expect(manager.getState().activeTurnId).toBe(facts.ownerTurnId);
replay.resume();
await replay.done;
```

Rules that keep re-recordings cheap:

- **Fixture preconditions.** When a test relies on an ordering, assert that
  ordering on the fixture's frame list first, with a message that says
  "re-check case N against the new CLI". A re-recording that flips the order
  then fails loudly instead of deadlocking.
- **Expected values from the fixture.** Read turn ids, request ids, thread ids,
  and stop reasons from the frames, never from literals.
- **Timers.** Codex replay tests fake `setTimeout`/`clearTimeout`/`setInterval`/
  `clearInterval` only (`vi.useFakeTimers({ toFake: [...] })`), which parks the
  host's rollout-path poll and the manager's request timeouts. `setImmediate`
  stays real because replay schedules on it. ACP replay tests use real timers;
  a fixture that exercises `session/load` must fake timers.
- **No `skipIf` or `.only`.** Branch on fixture facts with assertions instead.

## Re-recording after a CLI update

Re-run every scenario, then run:

```bash
npx vitest run src/lib/codex/__tests__/app-server-replay.test.ts \
  src/lib/acp/__tests__/host-replay.test.ts \
  src/lib/protocol-capture/__tests__/fixture-hygiene.test.ts
```

Read each failure as a protocol change: a failed precondition means the
provider's ordering changed, and a `ReplayMismatchError` means Overdeck's client
now sends something different from what the recording expects.

## Synthetic fixtures

Hand-written fixtures are forbidden with one exception: if a Codex CLI never
emits `item/tool/requestUserInput`, the user-input fixture may be built from the
live approval recording. Its header must set `synthetic: true`, a
`syntheticNote` saying what was tried, and a `followUpIssue` to re-record live.
No committed fixture is synthetic: `user-input.jsonl` was recorded live from
codex-cli 0.159.0.

## Findings

| Defect or observation | Fixture | Disposition |
| --- | --- | --- |
| D-1: Codex state could not report an interrupted turn | `interrupt.jsonl` | Fixed in [PAN-4563](https://github.com/eltmon/overdeck/issues/4563): `lastTurnStatus` on manager state and host `status()` |
| Recorded Codex interrupt order (codex-cli 0.159.0): the `turn/interrupt` response, then the owner idle status, then `turn/completed` with `turn.status: interrupted`; case 2 asserts this order and fails naming case 2 if it changes | `interrupt.jsonl` | Observed ordering, no defect |
| D-2: user-input answers were sent as `string[]` instead of `{ answers: string[] }` | `user-input.jsonl` | Fixed in [PAN-4563](https://github.com/eltmon/overdeck/issues/4563); checked against the codex-cli 0.159.0 schema, and Codex answered with the chosen color |
| A Codex sub-agent's `turn/started` arrives before the `spawnAgent` item that names it, so its start line is labeled `thread:` instead of `sub:` | `subagent.jsonl` | Filed as [PAN-4568](https://github.com/eltmon/overdeck/issues/4568); pinned in case 3 |
| Kimi interrupt: effect-acp sends `session/cancel` with `"id":""`, Kimi answers "Method not found" and keeps streaming; late chunks land in the transcript after `turn_completed`; effect-rpc also writes `@effect/rpc/Interrupt` to the ACP wire | `kimi-interrupt.jsonl` | Filed as [PAN-4575](https://github.com/eltmon/overdeck/issues/4575); pinned in the ACP interrupt case |
| Codex sends the host name and a stable `installationId` in `remoteControl/status/changed` | all Codex fixtures | Scrubbed (`<HOSTNAME>`, `installationId` redacted) |
| With an invalid OAuth grant, `kimi acp` answered `session/prompt` with `stopReason: end_turn` and no error, so a failed turn looks like a successful empty one | not committed (failed recording) | Recorded here; outside Overdeck's control |
| A network `curl` in the `workspace-write` sandbox fails without asking for approval (codex-cli 0.159.0) | `approval.jsonl` | Recorder uses a `$HOME` write instead |
