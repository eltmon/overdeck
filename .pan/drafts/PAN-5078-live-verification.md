# PAN-5078 live verification (WI-24)

Run on 2026-11-10 against `grok 1.0.77 (50ca579fa996) [stable]`, signed in, with this branch's `dist/` (full `npm run build` at commit `1c2414841dc` plus the uncommitted feed-label fix, which does not affect these checks).

## Setup

- **Throwaway dashboard.** `node <symlink>/dashboard/server.js` from this branch's `dist/`, port 3941, `OVERDECK_DISABLE_DEACON=1` (peer mode), `OVERDECK_TERMINAL_BACKEND=tmux`, its own tmux socket `pan5078live`, and its own `HOME`/`OVERDECK_HOME`. The operator's live dashboard was not touched. The CLI ran as `node <ws>/dist/cli/index.js` with `OVERDECK_DASHBOARD_URL=http://127.0.0.1:3941`.
- **Test `HOME`** (a scratchpad directory reached through the short symlink `/tmp/p5078`): links to the real `~/.grok` (whole directory, so the operator's real Grok config, including the enabled Overdeck bot plugin, applied), `~/.config`, `~/.gitconfig`, `~/.local` and `~/.overdeck/skills`.
- **Throwaway config.** `models.providers.grok: { enabled: true, harness: grok }`; project `grokproj` (an empty git repo) for the conversation checks; project `ovclone` for `pan start`: a clone whose `origin` is a local bare mirror of the repo (so no push can reach GitHub), with `issue_prefix: PAN` and `github_repo: eltmon/overdeck` for issue reads.
- **Browser.** Playwright `chromium.launch()` with a fresh context (no shared profile).

### Test-setup hazards hit (not product bugs)

1. **Unix socket path limit.** With `OVERDECK_HOME` under the long scratchpad path, the ACP host failed with `ENOENT: … chmod '…/sockets/acp-conv-….sock'`: the socket path exceeded the 108-byte limit. A short `HOME` symlink (`/tmp/p5078`) fixed it.
2. **Host orphan reaper.** The first short server symlink, `/tmp/p5078dist/dashboard/server.js`, contains the substring `dist/dashboard/server.js`, so the host deacon's orphan reaper killed the peer server (the PAN-4734 hazard). The conversation's ACP host survived in tmux. `/tmp/p5078srv/…` was used from then on.
3. **Claude transcript sweep.** `POST /api/costs/reconcile` also runs the Claude transcript sweep. With the real `~/.claude` linked into the test `HOME`, it walked the operator's full transcript history for over 25 minutes and the server stopped answering. Replacing the link with an empty directory made the reconcile return in seconds.

## Check 5 — `pan doctor`

```
$ pan doctor | grep -i grok
✓ Grok Build CLI: grok 1.0.77 (50ca579fa996) [stable], signed in
```

The settings catalog on the throwaway dashboard (`GET /api/settings/available-models`) returned the `grok` group with all four models (`grok/grok-4.7`, `grok/grok-4.7-build-fast`, `grok/grok-4.6`, `grok/grok-4.5`, harness `grok`, effort `low`/`medium`/`high`/`xhigh`).

**Result: pass.**

## Check 1 — Grok conversation renders

```
POST /api/conversations
{"message":"Reply with exactly OK.","model":"grok/grok-4.6","harness":"grok","effort":"high","projectKey":"grokproj","cwd":"/tmp/p5078/proj"}
→ {"name":"20261110-8143","harness":"grok","model":"grok/grok-4.6", …}
```

ACP host command line:

```
node …/dist/acp-host.js --agent conv-20261110-8143 --provider grok --workspace …/proj
  --binary-path …/bin/grok --model grok/grok-4.6 --effort high --context-file …
  --mcp-config …/conversations/conv-20261110-8143/overdeck-mcp.json
```

Child process: `grok` (executable `…/@xai-official/grok/bin/grok-native`). `acp-session-id`: `01a1c65b-b208-7630-bd1b-07624089e991`.

Transcript (`agents/conv-20261110-8143/acp-session.jsonl`):

```
system prompt_queued 'Reply with exactly OK.'
user               'Reply with exactly OK.'
assistant          'OK'
system turn_completed usage={model: grok/grok-4.6, inputTokens: 44260, outputTokens: 28,
                             cacheReadTokens: 640, cacheWriteTokens: 0, reasoningTokens: 27, costUsd: 0.089008}
```

Screenshot: `scratchpad/live/shots/check1-conversation.png` (user and assistant rows, the tool call of check 6, the conversation list row "Grok Build · grok/grok-4.6", the composer showing "Grok 4.6 · High · set").

**Result: pass.**

## Check 6 — the agent calls an `overdeck` MCP tool

`~/.grok/config.toml` has `[plugins] enabled = [ "mind-your-now", "overdeck" ]`, so the Overdeck Grok Build bot plugin was active (HZ-1).

Message: "Use your overdeck MCP server: call its list_conversations tool once, then reply with the number of conversations it returned and the name of the MCP server you used."

Transcript: a tool-search call that found server `overdeck`, tool `overdeck__list_conversations`; then the `overdeck__list_conversations` tool call with status `completed`; the reply "1 conversation from the overdeck MCP server." The throwaway dashboard had exactly one conversation, while the operator's live dashboard (reached by the bot plugin) has many, so the managed per-agent server answered. The managed server config is a stdio `node …/dist/cli/index.js mcp serve` with `OVERDECK_MCP_TOKEN_FILE`, `OVERDECK_HOME` and `OVERDECK_DASHBOARD_URL` (values not recorded). Turn cost: $0.07165.

**Result: pass.** HZ-1 did not occur.

## Check 4 — cost reconcile

`POST /api/costs/reconcile` runs every source (it takes no `source` field):

```
run 1 grok: {imported: 2, eventsImported: 2, duplicatesSkipped: 0, sessionsScanned: 1, errors: []}
run 2 grok: {imported: 0, eventsImported: 0, duplicatesSkipped: 2, sessionsScanned: 1, errors: []}
```

`cost_events` rows:

```
grok|custom|grok/grok-4.6|44260|28|640|0.089008|grok:01a1c65b-…:97605a0f-…|conv-20261110-8143
grok|custom|grok/grok-4.6|1428|159|135680|0.07165|grok:01a1c65b-…:915c0f38-…|conv-20261110-8143
```

**Result: pass.**

**WI-20 checkpoint (conversation turns and the Cloister tick).** Conversations write no `state.json`, so `listRunningAgents` (and the Cloister tick that calls `reconcilePiCostEventsForRunningAgents`) never sees a Grok conversation, and the dashboard's five-minute sweep (`cost-reconcile-service.ts`) covers only Pi and Codex. Per the PRD fallback, Grok conversation turns are imported by `POST /api/costs/reconcile`; `configuration/harnesses.mdx` now says so. Work agents (which do write `state.json` with `harness: grok`) are covered by the tick.

## Check 2 — restart and resume

1. The peer server restarted twice during the run (the reaper kill and the reconcile hang). The conversation's tmux-hosted ACP host kept running each time.
2. `POST /api/conversations/restart-all` → `{"restarted":1,"results":[{"name":"20261110-8143","model":"grok/grok-4.6","status":"restarted"}]}`. The new host (pid 56722) started with `--resume 01a1c65b-b208-7630-bd1b-07624089e991`; `acp-session-id` was unchanged before and after.
3. Message "What was the very first thing I asked you in this conversation? Answer in one short sentence." → "You asked me to reply with exactly OK.", with `turn_completed.sessionId` `01a1c65b-b208-7630-bd1b-07624089e991`.

Screenshot: `scratchpad/live/shots/check2-resumed.png`.

**Result: pass.**

**Finding (pre-existing, filed as [#5116](https://github.com/eltmon/overdeck/issues/5116)).** restart-all left the old host (pid 3148759, with its `grok` child) running: the conversation `launcher.sh` runs `trap '' HUP`, so closing the pane does not stop the host. The code path is shared by every ACP-hosted harness. The orphan was cleaned up by killing its process group.

## Check 3 — `pan start --harness grok`

```
$ cd /tmp/p5078/ovclone && pan start PAN-5078 --harness grok --model grok/grok-4.6 --plan skip
  Role: work   Effort: high
  Backend: tmux (session agent-pan-5078)
```

Pane process tree:

```
node,100281 …/dist/acp-host.js --agent agent-pan-5078 --provider grok …
  |-grok,100336 agent --always-approve --no-leader stdio
  |   |-node,100445 …/dist/cli/index.js mcp serve
```

Host arguments: `--provider grok --workspace /tmp/p5078/ovclone/workspaces/feature-pan-5078 --binary-path …/bin/grok --model grok/grok-4.6 --effort high --context-file …/agents/agent-pan-5078/acp-context.md --mcp-config …/agents/agent-pan-5078/overdeck-mcp.json`. The `grok` child's executable is `…/@xai-official/grok/bin/grok-native`.

The agent was stopped right after the capture with `pan kill PAN-5078` (`agent-pan-5078: killed`); no `acp-host` or `grok` process remained. The bare mirror's `feature/pan-5078` head was unchanged (`1c2414841dc`), so nothing was pushed. GitHub issue #5078 was unchanged: no new comments, and the labels (`enhancement`, `in-progress`, `harness`) were as before.

**Result: pass.**

## Other finding

The dashboard Awareness feed labelled the Grok conversation "Kimi". The feed maps the shared ACP feed kind to "Kimi", which also mislabels OpenCode conversations. Fixed in this item: feed entries carry the conversation's harness, and OpenCode and Grok Build conversations are named by their harness brand (`ConversationFeedCard.tsx`, `useConversationFeed.ts`, `sessionFeed/types.ts`, with tests). The screenshots predate the fix, because the throwaway `dist/` was built before it.

## Spend

Three conversation turns on grok-4.6 ($0.089008, $0.07165, and the resumed turn) and the `pan start` agent's first turn, stopped early. The first conversation attempt never launched a host (the socket-path hazard), so it cost nothing. The fixture recordings (WI-22) cost about $0.10 more.
