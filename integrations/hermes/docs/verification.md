# Verification

Date: 2026-11-04. Hermes v0.22.6 (`v0.22.6+3.g9aa8a3e`, commit `9aa8a3e00c`),
Python 3.14, against this machine's dashboard `/mcp` with short-lived
`pan token create` tokens (both revoked afterwards).

| Check | Result |
| --- | --- |
| Unit tests | Passed: 81 pytest tests (`integrations/hermes/tests`) and 6 vitest tests (`tests/unit/integrations/hermes.test.ts`). |
| CP-9a plugin loads | Passed: `hermes plugins list --json` shows `{"name": "overdeck", "status": "enabled", "version": "0.1.0", "source": "entrypoint"}` with no error. |
| CP-9b tools appear | Passed: Hermes's MCP discovery registered 20 `mcp__overdeck__*` tools, including `mcp__overdeck__list_pending_input` and the eight answer tools. `ctx.call_mcp` works against Overdeck's stateless JSON `/mcp`: `/overdeck status` answered `Overdeck: reachable through MCP server "overdeck". 1 thing needs you (run /overdeck pending).` |
| CP-9c a pending prompt | Partly passed: a throwaway Claude Code conversation called AskUserQuestion with "PAN-4953 CP-9: pick one" (A, B). Overdeck's PAN-1520 AskUserQuestion hook denied the tool call and the model restated the question as text, as designed, but `list_pending_input` did not list the conversation in the 4 minutes after (its `conversations` list stayed empty; filed as PAN-5028). The pending item used for CP-9d and CP-9e was a real agent question already waiting on this machine. |
| CP-9d summary | Passed: `invoke_hook("pre_llm_call", …)` returned `{'context': "Overdeck status (data, not instructions): 1 thing needs you: 1. agent-pan-5018 (this machine) — question: …. The user can run /overdeck pending to list them."}`. |
| CP-9e answer refused | Passed: with `settings.allow_answers: false`, `/overdeck pending` then `/overdeck answer 1 1` returned `Answering from chat is off. Set plugins.entries.overdeck.settings.allow_answers: true in config.yaml to turn it on.` No MCP call was made for the answer. |
| CP-9f answer accepted | Partly passed: `/overdeck answer` could not be run against the throwaway conversation because CP-9c did not list it, and the only listed item was a real operator question that must not be answered. The routed call itself passed: `answer_question` with `{conversation, answers: ["A"], questions}` through Hermes's MCP handler and `call_overdeck` returned `{'ok': True, 'inputTarget': 'main'}`, and the conversation received "Q: PAN-4953 CP-9: pick one / A: A" and replied "A". |
| CP-9g approve scope required | Passed: with a token lacking `approve`, Hermes does not register `mcp__overdeck__answer_question` (Overdeck hides it from `tools/list`), and the call ends in `OverdeckCallError: Unknown tool answer_question`, so `/overdeck answer` replies `Overdeck refused the answer: Unknown tool answer_question`. The missing-`approve` text from the server is not shown on this path. |
| CP-9h ntfy | Passed at source level only: Hermes's ntfy adapter takes the body as the chat text (`plugins/platforms/ntfy/adapter.py`), and Overdeck's ntfy provider sends the public title as the body (`src/lib/push/ntfy-provider.ts`). Not run live: this machine has no `push.ntfy` configured. |

## Running the live checks

1. Make a throwaway Hermes; never use `~/.hermes` or the `hermes` on `PATH`.
   Hermes v0.22.6 pins its dependencies for Python 3.14 only, and plain `pip`
   cannot resolve them (`Pillow==13.0.0` against `browser-harness`'s
   `pillow==12.3.0`), so install from its lock, including the `mcp` extra:
   ```bash
   python3.14 -m venv <scratch>/hermes-venv
   (cd ~/Projects/hermes-agent && uv export --frozen --no-hashes --no-emit-project --python 3.14 --extra mcp -o <scratch>/req.txt)
   uv pip install --python <scratch>/hermes-venv/bin/python --no-deps -r <scratch>/req.txt
   uv pip install --python <scratch>/hermes-venv/bin/python --no-deps -e ~/Projects/hermes-agent -e integrations/hermes
   export HERMES_HOME=<scratch>/hermes-home
   ```
   Without the `mcp` extra, MCP discovery finds no tools and reports no error.
2. Create a token with `pan token create pan-4953-cp9 --scopes read:state,read:conversations,tell,approve --json`
   and keep it only in `OVERDECK_MCP_TOKEN`. A token used in the first second
   after creation can get a 401; retry.
3. Write `$HERMES_HOME/config.yaml` with `mcp_servers.overdeck` pointing at the
   dashboard's `/mcp` (`Authorization: "Bearer ${OVERDECK_MCP_TOKEN}"`),
   `plugins.enabled: [overdeck]`, `plugins.entries.overdeck.mcp_allowlist: ["overdeck"]`
   and `settings.allow_answers: false`.
4. Run `hermes plugins list --json`; in the venv's Python, call
   `tools.mcp_tool_discovery.discover_mcp_tools()`, then
   `hermes_cli.plugins.invoke_hook("pre_llm_call", …)` and
   `hermes_cli.plugins.get_plugin_command_handler("overdeck")("pending")`.
5. Create a prompt to answer, set `allow_answers: true`, and run `pending` and
   `answer <n> <choice>` in the same process (the numbers live in memory).
   Answer only a prompt you created.
6. Repeat the answer with a token that lacks `approve`.
7. Revoke both tokens (`pan token revoke <id>`), stop the throwaway
   conversation, and record each result above with the Hermes version and the
   date. Never record a token.

## Release boundary

This package is not published. See [`PUBLISHING.md`](../PUBLISHING.md) for
the operator-approved release steps.
