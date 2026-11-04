# Verification

Date: 2026-11-04.

| Check | Result |
| --- | --- |
| Package structure | Passed: tests/unit/integrations/grok-bot.test.ts (manifest keys, one https server, LICENSE, skill copy). |
| xAI request shape (TypeScript, Python) | Passed against a local fake xAI API: tests/unit/integrations/grok-bot-example-ts.test.ts, grok-bot-example-py.test.ts |
| xAI field names | Matches docs.x.ai/developers/tools/remote-mcp on 2026-11-04: server_url, server_label (required), allowed_tools, authorization |
| CP-8a Grok Bot install, OAuth sign-in, list_conversations | Not run: needs the operator's Grok Bot account, Public MCP switched on, and the three Funnel paths published; the build host has no tailscale CLI. |
| CP-8b xAI example against the live API | Not run: no XAI_API_KEY on the build host, and Public MCP is off. |
| CP-8c authorization value: bare token vs "Bearer <token>" | Not run: depends on CP-8b. |
| CP-8d client needs GET /mcp or SSE responses | Not run: depends on CP-8a and CP-8b. Overdeck answers GET /mcp with 405 and POST with JSON. |

## Running the live checks

1. Turn Public MCP on and run the three `tailscale funnel` commands from
   Settings → Anywhere.
2. Confirm `curl https://<host>:8443/.well-known/oauth-authorization-server`
   answers from outside the tailnet.
3. Install the plugin with the real URL, sign in, approve the sign-in, and
   ask for the conversation list.
4. Run `pan mcp oauth issue --name xai-api --level read`, export the
   variables it prints, and run both examples.
5. If `/mcp` logs a 401 for the xAI call (an activity entry reading
   `Public MCP POST /mcp 401`), set the `authorization` field to
   `Bearer <token>` in both examples and in `botSnippets.xaiExample`, then
   re-run.
6. Record each result in the table above with the Grok Bot version and the
   date. Never record a token.

## Release boundary

This package is not published or listed in any catalog. See
[`PUBLISHING.md`](../PUBLISHING.md) for the operator-approved submission
steps.
