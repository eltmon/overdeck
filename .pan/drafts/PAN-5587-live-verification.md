# PAN-5587 live verification (WI-23)

Run on 2026-11-21 against `agy 1.5.14` with this branch's `dist/` (full `npm run build` at commit `46f7e768bd4`, exit 0; the frontend was rebuilt with `npm run build:dashboard:frontend` after the composer fix below). Credential: a Gemini API key copied from the operator config into the throwaway config by a script that never printed it. No check printed, logged or screenshotted the key.

## Setup

- **Throwaway dashboard.** `node /tmp/p5587srv/dashboard/server.js` (a symlink to this branch's `dist/`; the path avoids the host reaper's `dist/dashboard/server.js` match), port 3957, `OVERDECK_DISABLE_DEACON=1` (peer mode), `OVERDECK_TERMINAL_BACKEND=tmux`, its own tmux socket `pan5587live`, and its own `HOME=/tmp/p5587` / `OVERDECK_HOME=/tmp/p5587/.overdeck` (a short symlink into the session scratchpad, for the 108-byte socket-path limit). The operator's live dashboard was not touched. The CLI ran as `node <ws>/dist/cli/index.js` with `OVERDECK_DASHBOARD_URL=http://127.0.0.1:3957`.
- **Test `HOME`** (minimal, HZ-1): only `~/.local/bin/agy` (link to the real binary), `~/.config/gh`, `~/.gitconfig`, and an empty `~/.claude` (so the Claude transcript sweep in the reconcile route does not walk the operator's history). `~/.gemini` was not linked.
- **Throwaway config.** `models.providers.google: { enabled: true, api_key: <literal> }` (mode 0600). Projects: `agyproj` (an empty git repo) for the conversation checks; `ovclone` for `pan start`, a clone whose `origin` is a local bare mirror (no push can reach GitHub), with `issue_prefix: PAN` and `github_repo: eltmon/overdeck`.
- **Browser.** Playwright `chromium.launch()` with a fresh context (no shared profile).
- **`~/.gemini` baseline.** A timestamp file was written before the run; `~/.gemini/antigravity-cli/conversations` held 3 entries (the planning probes).

## `initialize` and ACP methods (issue checkpoint 1)

From the live `agy acp` recording (`src/lib/acp/__tests__/fixtures/replay/antigravity-turn-completion.jsonl`):

```json
{"protocolVersion":1,"agentInfo":{"name":"Antigravity ACP Server","version":"1.5.14"},
 "agentCapabilities":{"loadSession":true,"promptCapabilities":{"image":true,"audio":false,"embeddedContext":true},
   "sessionCapabilities":{"resume":{},"close":{},"load":{},"list":{},"additionalDirectories":{}},
   "auth":{"logout":{}},"_meta":{"antigravity":{"tier":true,"systemPrompt":{"append":true}}}},
 "authMethods":["oauth-personal","oauth-business","gemini-api-key","agent-platform"]}
```

Client methods sent: `initialize`, `authenticate` (`methodId: "gemini-api-key"`), `session/new` (or `session/load` on resume), `session/set_config_option` (`model`, then `thought_level`), `session/prompt`, `session/cancel`. Agent notifications: `session/update` with `config_option_update`, `available_commands_update`, `usage_update`, `session_info_update`, `agent_message_chunk`; permission asks arrive as `session/request_permission`.

## Check 5 — `pan doctor` and the picker catalog

```
$ pan doctor | grep -i antigravity
✓ Antigravity CLI: 1.5.14, auth gemini-api-key. Overdeck never uses Antigravity's Google sign-in (OAuth): Antigravity's terms (clause 6) call accessing the service with it through third-party software a breach.
```

`GET /api/settings/available-models` returned the plain Google rows plus four rows with `harness: "antigravity"`: `Gemini 4 Argon (1M context) — Antigravity` (effort `low`/`medium`/`high`), and `Gemini 3.8 Flash`, `Gemini 3.6 Flash`, `Gemini 3.1 Pro` "— Antigravity" (effort `low`…`xhigh`). The plain `gemini-4-argon` row stayed, without a harness.

**Result: pass.**

## Check 1 — Antigravity conversation renders

`gemini-4-carbon` is not registered (PAN-5586 open), so the run used `gemini-4-argon`.

```
POST /api/conversations
{"message":"Reply with exactly OK.","model":"gemini-4-argon","harness":"antigravity","effort":"high","projectKey":"agyproj","cwd":"/tmp/p5587/proj"}
→ {"name":"20261122-2226","harness":"antigravity","model":"gemini-4-argon", …}
```

Process tree:

```
node <ws>/dist/acp-host.js --agent conv-20261122-2226 --provider antigravity --workspace <SP>/live/home/proj
  --binary-path /home/eltmon/.local/bin/agy --model gemini-4-argon --effort high
  --context-file /tmp/p5587/.overdeck/agents/conv-20261122-2226/acp-context.md
  --mcp-config /tmp/p5587/.overdeck/conversations/conv-20261122-2226/overdeck-mcp.json
  └─ /home/eltmon/.local/bin/agy acp --gemini-dir /tmp/p5587/.overdeck/antigravity
```

Environment variable names only: the `agy` child had `GEMINI_API_KEY` (and no other `GEMINI*`/`GOOGLE*`); the ACP host process had none (D5: the key never enters the pane).

Transcript (`agents/conv-20261122-2226/acp-session.jsonl`):

```
system prompt_queued 'Reply with exactly OK.'
user               'Reply with exactly OK.'
assistant          'OK'
system turn_completed usage={model: gemini-4-argon, source: antigravity, inputTokens: 33144, outputTokens: 24,
                             cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 19}
```

Live effort change (`POST /api/conversations/20261122-2226/thinking-level`): `{"level":"xhigh"}` → `{"ok":true,"effort":"high"}` (clamped to gemini-4-argon's offered levels); `{"level":"medium"}` → `{"ok":true,"effort":"medium"}`.

Screenshot: `scratchpad/live/shots/check1-conversation.png` — user and assistant rows, the MCP tool call of check 6, the conversation list row labelled "Antigravity", and the composer showing "Gemini 4 Argon (1M context) — Antigravity", the Antigravity chip and "Thinking: medium".

**Finding fixed in this item.** The first screenshot showed the composer with the plain Google row and a **Pi** chip: the chat picker's trigger lookup took the first row matching the id whose harness was unset or equal, and the plain Google row comes first. Fixed in `chat/ModelPicker.tsx` (an exact harness match wins), with a test; the second screenshot above is after the fix.

**Result: pass.**

## Check 6 — the agent calls an `overdeck` MCP tool

Message: "Use your overdeck MCP server: call its list_conversations tool once, then reply with the number of conversations it returned and the name of the MCP server you used."

```
system permission_request  offeredOptionIds [allow, deny]
system permission_outcome  chosenOptionId allow
tool   "Run mcp_overdeck_list_conversations"  completed
assistant "The `overdeck` MCP server returned 1 conversation."
system turn_completed usage={model: gemini-4-argon, source: antigravity, inputTokens: 4600, outputTokens: 138, cacheReadTokens: 62316, reasoningTokens: 91}
```

The throwaway dashboard had exactly one conversation, so the managed per-agent server answered. The permission ask was auto-answered `allow` through ACP (no skip flag).

**Result: pass.**

## Check 4 — cost reconcile

`POST /api/costs/reconcile` runs every source:

```
run 1 antigravity: {imported: 2, eventsImported: 2, duplicatesSkipped: 0, sessionsScanned: 1, errors: []}
run 2 antigravity: {imported: 0, eventsImported: 0, duplicatesSkipped: 2, sessionsScanned: 1, errors: []}
```

`cost_events` rows:

```
antigravity|google|gemini-4-argon|33144|24|0|0.066528|antigravity:5b4c4d36-…:b5bce65d-…|conv-20261122-2226
antigravity|google|gemini-4-argon|4600|138|62316|0.016812|antigravity:5b4c4d36-…:f62ee2cb-…|conv-20261122-2226
```

**WI-19 checkpoint (conversation turns and the Cloister tick).** As for Grok: conversations write no `state.json`, so the Cloister tick (`reconcilePiCostEventsForRunningAgents`, running agents only) does not see an Antigravity conversation. Conversation turns are imported by `POST /api/costs/reconcile`, as shown above; `configuration/harnesses.mdx` says so. Work agents are covered by the tick (unit-tested in `pi-cost-reconciler.test.ts`).

**Result: pass.**

## Check 2 — restart and resume

1. The peer server was stopped and started again (`acp-session-id` before: `5b4c4d36-1a0f-4d11-95ab-126c1b5c7cbb`).
2. `POST /api/conversations/restart-all` → `{"restarted":1,"results":[{"name":"20261122-2226","model":"gemini-4-argon","status":"restarted"}]}`. The new host started with `--resume 5b4c4d36-1a0f-4d11-95ab-126c1b5c7cbb` (and `--effort medium`, the live change); `acp-session-id` after: unchanged.
3. Message "What did you reply to my very first message? One word." → `OK`, with `sessionId` `5b4c4d36-1a0f-4d11-95ab-126c1b5c7cbb` on the user, assistant and `turn_completed` entries.

Screenshot: `scratchpad/live/shots/check2-resumed.png`.

The old host (pid 2811115, with its `agy` child) kept running after restart-all, the pre-existing orphan behavior of [#5116](https://github.com/eltmon/overdeck/issues/5116) shared by every ACP harness; it was stopped by pid.

**Result: pass.**

## Check 3 — `pan start --harness antigravity`

```
$ cd /tmp/p5587/ovclone && pan start PAN-5587 --harness antigravity --model gemini-4-argon --plan skip
✔ Agent spawned: agent-pan-5587
  Harness: antigravity   Model: gemini-4-argon   Role: work   Effort: high
  Backend: tmux (session agent-pan-5587)   Attach: tmux -L pan5587live attach -t agent-pan-5587
```

Pane process tree:

```
node <ws>/dist/acp-host.js --agent agent-pan-5587 --provider antigravity
  --workspace /tmp/p5587/ovclone/workspaces/feature-pan-5587 --binary-path /home/eltmon/.local/bin/agy
  --model gemini-4-argon --effort high --context-file …/agents/agent-pan-5587/acp-context.md --mcp-config …/overdeck-mcp.json
  └─ /home/eltmon/.local/bin/agy acp --gemini-dir /tmp/p5587/.overdeck/antigravity
      └─ node <ws>/dist/cli/index.js mcp serve …
```

The agent was stopped right after the capture with `pan kill PAN-5587` (`agent-pan-5587: killed`); no `acp-host` remained. The tracker transition failed for lack of a token (`Could not transition PAN-5587 to in_progress: Token not found`), so nothing was written to GitHub: issue #5587 had state OPEN, labels `enhancement`, `in-progress`, 0 comments before and after. The bare mirror's `feature/pan-5587` head was unchanged (`4d0d2eb5170`).

**Isolation (HZ-1).** After all runs, no file under `~/.gemini` was newer than the baseline timestamp, and `~/.gemini/antigravity-cli/conversations` still held 3 entries; the run's sessions were in `/tmp/p5587/.overdeck/antigravity/antigravity-cli/conversations` (2 entries).

**Result: pass.**

## Check 7 — no credential

The throwaway config was rewritten to `models.providers.google: { enabled: true }` (key removed, provider still enabled), then a new Antigravity conversation was created:

```
acp-context.md      21:23:09.065
acp-launch-error    21:23:09.529   (about 0.5 s after launch; no 60 s spawn timeout)
```

`acp-launch-error`:

```
Antigravity needs a Gemini API key or Agent Platform credentials. Set the Google API key in Overdeck Settings, or set GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION and run gcloud auth application-default login. Overdeck never uses Antigravity's Google sign-in (OAuth): Antigravity's terms (clause 6) call accessing the service with it through third-party software a breach.
```

The conversation's `spawnError` carried the same message (`ACP host conv-20261122-7177 failed to start: …`), and no `agy` process was started for it.

**Result: pass.**

**Finding (not Antigravity-specific; root cause not confirmed).** After the hand edit of `config.yaml`, the *running* peer dashboard kept serving the old config: `/api/settings` still reported a Google key and the picker still listed the four Antigravity rows, although a fresh process resolved no credential and the ACP host (which reads config at launch) failed correctly. After a server restart both were correct. Both config loaders key their cache on the file mtime, so the stale view has another cause; it affects any hand edit of `config.yaml`, not this harness.

## Check 8 — Agent Platform

Not verified live (D18): the host has no `gcloud`, no `~/.config/gcloud/application_default_credentials.json`, and no `GOOGLE_CLOUD_*` / `GOOGLE_APPLICATION_CREDENTIALS` in the environment. Agent Platform is implemented and unit-tested only, and the docs say so.

## Other finding

The conversation view shows the ACP host's permission request and outcome entries as raw JSON rows ("Permissions: {…}"). This comes from the shared ACP transcript rendering, not from Antigravity code; Grok never shows it because it runs with `--always-approve`.

## Spend

Four conversation turns on `gemini-4-argon` (about $0.09 at list prices per the cost rows above for two of them), the `pan start` agent's first turn (stopped early), and the replay-fixture recordings (WI-21, a few cents). The run used the operator's Gemini API key.

## Cleanup

The peer server, the conversation hosts and the private tmux server were stopped; no `acp-host` or `agy` process with the throwaway gemini dir remained. Both scratch config files that held the key were deleted, and the throwaway home and its `/tmp` symlinks were removed.
