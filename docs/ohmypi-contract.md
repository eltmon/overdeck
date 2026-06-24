# oh-my-pi (omp) ↔ Pi Contract

> **Status:** Verified against `@oh-my-pi/pi-coding-agent@16.1.16` (binary `omp`,
> `omp/16.1.16`) installed globally and driven with a **real** `omp --mode rpc`
> session. The captured transcript is committed at
> `src/lib/cost-parsers/__tests__/fixtures/ohmypi/rpc-toolcall.jsonl` and
> `src/dashboard/server/services/__tests__/ohmypi-conversation-parser.fixture.jsonl`.
>
> This document is the **single source of truth** the rename/migration beads
> consume. Every flag, path, and field below was observed from real output or
> the installed package's TypeScript types — nothing is assumed. Where a Pi
> surface has no exact omp equivalent, the discovered fallback is recorded.

## AC-1: Binary identity & version

| Property | Pi (current) | omp (verified) |
| --- | --- | --- |
| Binary name | `pi` | `omp` (**no** `pi` alias) |
| npm package | `@earendil-works/pi-coding-agent` | `@oh-my-pi/pi-coding-agent` |
| Package version | `0.79.0` | `16.1.16` |
| `--version` output | `0.79.0` | `omp/16.1.16` |
| Install | `npm i -g @earendil-works/pi-coding-agent` | `npm i -g @oh-my-pi/pi-coding-agent` |
| Upstream | (earendil fork) | `can1357/oh-my-pi` (homepage `omp.sh`) |

`omp --version` exits 0 and prints `omp/16.1.16` (recorded above).

## AC-1b: Runtime — the big divergence (Bun, not Node)

This is the single most important contract difference and was **not** anticipated
by the issue's "runtime contract largely preserved" assumption.

| Property | Pi (current) | omp (verified) |
| --- | --- | --- |
| Shebang of `dist/cli.js` | `#!/usr/bin/env node` | `#!/usr/bin/env bun` |
| Runtime | **Node.js** | **Bun** |
| `engines` requirement | none (Node) | `"bun": ">=1.3.14"` |

**Verified failure:** on a machine with Bun `1.3.11`, omp **cannot even parse its
own bundle** — `omp --version` / `omp --help` fail with
`SyntaxError: Unexpected identifier 'z' at <parse> (.../dist/cli.js:135:1)`
(Bun aborts at parse time before the in-bundle version check can run). After
`bun upgrade` to `1.3.14`, omp works correctly.

**Impact on the runtime bead (`workspace-wvkgj`):** the current Pi runtime
adapter (`src/lib/runtimes/pi.ts`) spawns `pi`, which runs under Node. omp's
shebang resolves to `bun` via `#!/usr/bin/env bun`, so as long as a
`>=1.3.14` `bun` is on `PATH`, invoking `omp` directly is correct — **the
runtime must not hard-code `node omp`** (that would bypass the shebang and fail:
Node cannot parse the Bun bundle). The `checkOhmypi` doctor bead
(`workspace-yki7g`) must assert both that `omp` resolves and that
`bun --version` is `>=1.3.14`.

## AC-3: CLI flag map (Pi launcher → omp)

The Overdeck Pi launcher is built in `src/lib/launcher-generator.ts`
(`buildPiCommand`, ~L703) and emits (rpc mode):

```
pi --mode rpc --model <qualified> --session-dir <dir> --extension <ext>
   --no-context-files --append-system-prompt <...> [--session <resumeId>]
   <> <rpc.in>
```

Each flag mapped against `omp --help` (verified by running omp with each flag):

| Pi flag (launcher today) | omp equivalent (verified) | Notes / fallback |
| --- | --- | --- |
| `pi` (binary token) | `omp` | Direct rename. No `pi` alias shipped. |
| `--mode rpc` | `--mode rpc` | ✅ identical. omp `--mode` ∈ {`text`,`json`,`rpc`,`rpc-ui`}. |
| `--model <id>` | `--model <id>` | ✅ identical. omp accepts fuzzy / `provider/model` (see Model id below). |
| `--session-dir <dir>` | `--session-dir <dir>` | ✅ identical. Session JSONL is written here regardless of `--mode`. |
| `--extension <path>` | `--extension <path>` / `-e` | ✅ identical (repeatable). omp also has `--hook <file>` and `--no-extensions`. |
| `--append-system-prompt <text>` | `--append-system-prompt <text>` | ✅ identical (repeatable). |
| `--no-context-files` | **REMOVED — omp errors `unknown flag: --no-context-files`** | **Fallback: drop the flag.** omp has no direct equivalent; the closest surface is `--no-rules` / `--no-skills` / `--no-extensions`. omp's context-file behavior is now controlled by config/rules discovery, so the launcher must simply stop emitting `--no-context-files` or omp will refuse to start. |
| `--session <resumeId>` (resume) | `--resume <id>` / `-r` (or `--continue` / `-c`) | **Fallback: rename `--session` → `--resume`.** omp documents `--resume=<value>` ("by ID prefix, path, or picker"). omp *accepts* `--session` without an "unknown flag" error, but with a bogus id it silently starts a **fresh** session instead of resuming — so `--session` is not a reliable resume path. Migrate to `--resume`. |
| stdin `<> <rpc.in>` (FIFO wiring) | identical — omp `--mode rpc` reads JSONL RPC commands from stdin | ✅ The bash `<>` read-write redirection onto `rpc.in` works unchanged. See RPC section. |

**Additional omp flags Pi did not surface** (relevant to the launcher/provider
beads, not required for parity): `--smol`, `--slow`, `--plan` (role-specialized
models, env `PI_SMOL_MODEL` / `PI_SLOW_MODEL` / `PI_PLAN_MODEL`), `--profile`,
`--alias`, `--config`, `--thinking`, `--approval-mode`, `--advisor`, `--models`,
`--tools`, `--hook`, `--skills`, `--rules`.

**Model id qualification (`qualifyPiModel`):** the launcher provider-qualifies
bare model ids (e.g. `kimi-k2.6` → `kimi/kimi-k2.6`) so Pi binds the intended
provider (PAN-1799). omp's `--model` accepts the same `provider/model` form and
fuzzy matching, so qualification is preserved. omp's real `model_change`
emits the qualified form (`"model":"zai/glm-4.5-flash"` — see AC-5).

## AC-4: Extension import package, hook names, and config/auth path

### Vendored extension

Overdeck ships `packages/pi-extension/` (`@overdeck/pi-extension`, loaded via
`pi --extension <dist/index.js>`). It does **not** import the pi/omp package —
it declares a local duck-typed `PiExtensionAPI` interface
(`packages/pi-extension/src/index.ts`) and subscribes to three lifecycle events
plus `registerCommand`:

| Vendored-ext hook | Present in omp? | Source |
| --- | --- | --- |
| `on('session_start', …)` | ✅ | `EventBus on(event: "session_start")` in installed `dist/types/extensibility/` |
| `on('tool_execution_end', …)` | ✅ | string literal `"tool_execution_end"` present in installed types; `tool_execution_end` rpc event emitted by real `--mode rpc` run |
| `on('turn_end', …)` | ✅ | `EventBus on(event: "turn_end")`; `TurnEndEvent` in `shared-events.d.ts` |
| `registerCommand(name, cmd)` | ✅ | custom-command loader types under `dist/types/extensibility/custom-commands/` |

All three hook channels the extension depends on are emitted by omp, verified
both in the installed `.d.ts` and in the real rpc stdout stream
(`{"type":"tool_execution_end",…}`, `{"type":"turn_end",…}`).

### Import package (for extensions that DO import the host)

omp ships an explicit **legacy compatibility shim** at
`dist/types/extensibility/legacy-pi-coding-agent-shim.d.ts`. Its docstring:

> Compatibility shim for legacy extensions importing the package root of
> `@oh-my-pi/pi-coding-agent` (or one of its aliased scopes like
> **`@earendil-works/pi-coding-agent`** or **`@mariozechner/pi-coding-agent`**).

So an `import … from '@earendil-works/pi-coding-agent'` (or `@mariozechner/…`)
still resolves under omp via this alias shim. The canonical new import is
`@oh-my-pi/pi-coding-agent`. The extension surface is exported under
`./extensibility/extensions`, `./extensibility/hooks`, `./extensibility/custom-commands`,
`./extensibility/custom-tools`, and the runtime types under `./modes/rpc/*`.

### Config / auth directory (verified on disk)

| Path | Pi | omp |
| --- | --- | --- |
| Config/auth root | `~/.pi/agent/` | `~/.omp/agent/` (created on first run) |
| Credential store | `~/.pi/agent/auth.json` (JSON) | `~/.omp/agent/agent.db` (**SQLite**, +`agent.db-shm`/`-wal`) |
| Model cache | — | `~/.omp/agent/models.db` (SQLite) |
| Settings | `~/.pi/agent/settings.json` | `~/.omp/agent/` (managed via `omp config`) |
| Sessions | `~/.pi/agent/sessions/` | `~/.omp/agent/sessions/` (default; Overdeck overrides with `--session-dir`) |
| Worktrees | — | `~/.omp/wt` (managed via `omp worktree`) |

**Auth env vars (verified — divergence from this machine's Claude Code env):**
omp reads `ANTHROPIC_API_KEY` / `ANTHROPIC_OAUTH_TOKEN` (OAuth takes precedence).
It does **not** read `ANTHROPIC_AUTH_TOKEN` (which this machine has set for
Claude Code / CLIProxy). With only `ANTHROPIC_AUTH_TOKEN` present, omp errors
`No API key found for anthropic` and points at `~/.omp/agent/agent.db`. The
auth bead (`workspace-4lis1`) must source omp's expected env vars or drive
`omp token <provider>` / the device-code login, not the `ANTHROPIC_AUTH_TOKEN`
value. omp also reads `ZAI_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, and
~13 more (see `omp --help` → Environment Variables).

Credential retrieval CLI: `omp token [provider]` (e.g. `omp token anthropic`,
`omp token google-gemini-cli --raw`). Settings CLI: `omp config [list|get|set|reset|path]`.

## AC-5: Session JSONL shape — Pi v3 preserved, with documented divergences

**Verdict: omp preserves the Pi v3 session shape.** The captured
`omp --mode rpc` transcript opens with the identical Pi v3 header:

```json
{"type":"session","version":3,"id":"019ef4f8-…","timestamp":"2026-06-23T14:52:59.543Z","cwd":"/tmp/omp-rpc/proj"}
```

The event stream is line-delimited JSON, one object per line, with `type` +
`id` + `parentId` + `timestamp` on every entry — the same envelope Pi v3 uses.
Content-block shapes (`{"type":"toolCall","name":…,"arguments":…}` and
`role:"toolResult"`) are byte-compatible with the **existing** Pi fixture
(`src/dashboard/server/services/__tests__/pi-conversation-parser.fixture.jsonl`
also uses `toolCall` + `toolResult`, not Anthropic's `tool_use`/`tool_result`).

**Divergences the parsers must handle** (all observed in the committed fixture):

1. **`model_change` field rename (cost-parser relevant).**
   - Pi fixture: `{"type":"model_change",…,"provider":"anthropic","modelId":"claude-sonnet-4-6"}`
   - omp real: `{"type":"model_change",…,"model":"zai/glm-4.5-flash"}` — single
     provider-prefixed `model` field, **no** `provider` / `modelId`.
   - **Impact: low.** `src/lib/cost-parsers/pi-parser.ts` reads the model from
     the *message* entries (`entry.message.model`, L247), not from
     `model_change`, and already lists `model_change` in `KNOWN_TYPES`
     (L102). The cost parser tolerates the new shape. The conversation parser /
     model-attribution surfaces that read `model_change.provider`/`.modelId`
     directly must read `.model` and split on `/` (or fall back to the nearest
     assistant `message.provider`/`.model`).

2. **New event type `thinking_level_change`.**
   - `{"type":"thinking_level_change","id":…,"parentId":…,"timestamp":…,"thinkingLevel":"high","configured":null}`
   - Already in the cost parser's `KNOWN_TYPES`. Other consumers must
     ignore-and-forward (do not treat as an error or a message).

3. **Assistant message: extra usage/cost fields (PAN-1912 data half).**
   Beyond Pi v3's `usage.{input,output,cacheRead,cacheWrite,totalTokens,cost.{…}}`
   (all **unchanged** and present), omp adds:
   - `responseId` (string, provider message id)
   - `duration` (ms, full turn wall-clock)
   - `ttft` (ms, time-to-first-token)
   - `contextSnapshot`: `{ promptTokens, nonMessageTokens }`
   - `api`: e.g. `"anthropic-messages"` (Pi used bare `"anthropic"`/`"openai"`)
   These are the additional fields the "capture extra omp usage/cost fields"
   bead (`workspace-opaff`) surfaces. They are additive — parsers that only
   read `usage` are unaffected.

4. **User message adds `"attribution":"user"`** — additive, ignored by current parsers.

5. **`stopReason:"toolUse"`** (camelCase) — consistent with the `toolCall`
   content type; matches existing Pi fixture conventions.

6. **`thinking` content block** carries `thinkingSignature` (already seen in Pi v3).

### RPC stdout protocol (for the runtime/FIFO bead)

`omp --mode rpc` reads JSON-line **`RpcCommand`s on stdin** and emits JSON-line
events on stdout (verified by piping `{"type":"prompt","message":"…"}`). Command
union (from `dist/types/modes/rpc/rpc-types.d.ts`) includes: `prompt`, `steer`,
`follow_up`, `abort`, `abort_and_prompt`, `new_session`, `get_state`,
`get_available_commands`, `set_todos`, `set_host_tools`, `set_host_uri_schemes`,
`set_subagent_subscription`, `get_subagents`. Emitted stdout events (observed):
`response`, `agent_start`, `turn_start`, `message_start`, `message_update`
(with `assistantMessageEvent` subtypes `thinking_*`, `text_*`, `toolcall_*`),
`message_end`, `tool_execution_start`, `tool_execution_end`, `turn_end`.

The Overdeck delivery path (FIFO `rpc.in` → bash `<>` → omp stdin, plus the
vendored extension's `ready.json` / heartbeat / `/pan-done` markers) is
preserved: omp reads the same stdin RPC stream Pi did, and the three extension
hooks that write those markers all fire under omp.

## Defects disposition (carried into the no-loss audit bead `workspace-5wg5n`)

| Defect | Contract relevance | Resolving bead |
| --- | --- | --- |
| PAN-1859 (RED main resume→FIFO test) | omp stdin/FIFO contract preserved → test renames cleanly | `workspace-wvkgj` |
| PAN-1833 (extension cwd detection) | `session_start` hook fires; `cwd` is in session header + `--cwd` flag | `workspace-ek8s5` |
| PAN-1827 (blank pi conversation view) | v3 shape + `toolCall`/`toolResult` preserved → parser rename is mechanical | `workspace-4vixt` |
| PAN-1912 (hidden tool-call detail) | data half: `toolCall`/`toolResult` + `details.displayContent` captured in fixture | `workspace-opaff` (data) + filed follow-up (UI toggle) |
