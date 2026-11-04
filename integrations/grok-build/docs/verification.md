# Verification

Date: 2026-11-04. Grok Build version: `grok 1.0.34 (3736acbc8658) [stable]`.

| Check | Result |
| --- | --- |
| Package structure | Passed: tests/unit/integrations/grok-build.test.ts, grok-build-run-mcp.test.ts, grok-build-readme.test.ts (manifests, `.mcp.json`, command file, LICENSE, dispatch script, README/PUBLISHING snippets). |
| `grok plugin validate` | Passed: `Plugin manifest is valid.` / `name: overdeck` / `version: 0.1.0` / `components: 1 skill dir(s), 1 command dir(s), 0 agent dir(s), MCP servers`. |
| Install + `grok inspect` | Passed: `grok plugin install "$PWD/integrations/grok-build" --trust && grok plugin enable overdeck`, then `grok inspect --json` from `$HOME` listed `mcpServers` entry `{ "name": "overdeck", "transport": "stdio", "target": "~/.grok/installed-plugins/grok-build-<hash>/scripts/run-mcp.sh", "source": { "type": "plugin", "plugin_name": "overdeck" } }` and a skill `overdeck` with `invocableAs: "overdeck:overdeck"`, alongside Overdeck's own `overdeck` user skill at `invocableAs: "user:overdeck"` — both marked `collidesWith: "overdeck"`, exactly as predicted (D-4). |
| AC-27 local (pan mcp serve) | Not run: the `grok` CLI has no active sign-in on this host (no `~/.grok/auth.json`, `XAI_API_KEY` unset), so `grok -p` fails before it can load the skill ("Not signed in. To authenticate without a browser, run: grok login --device-code"). Ground truth was still collected: `GET /api/needs-you` and `GET /api/fleet/needs-you` (the two calls behind `list_pending_input`) both returned 0 pending items on this host at the time of the check. |
| Bare `/overdeck` on an Overdeck computer | Not run: same `grok -p` sign-in blocker as the row above. |
| AC-27 connector | Not run: needs the operator's overdeck.ai device-flow approval for `pan mcp connector login`, and, once paired, the same `grok -p` sign-in from the row above (the dispatch to `mcp connector serve --stdio` is covered either way by `grok-build-run-mcp.test.ts`). |

## Running the live checks

Steps 2-7 below need an operator who can sign in to `grok` and approve a
browser device-flow:

1. **(Operator)** Sign `grok` in: `grok login` (opens a browser) or
   `grok login --device-code` (headless). Confirm with `grok --version`
   and any `grok -p "hello" --output-format json` smoke call.
2. `pan token create grok-build-verify --scopes read:state,read:conversations --json`.
   Keep the `id` for cleanup; never print or record the `token`. Write it
   with the "This computer" token-setup lines (`README.md`) to
   `$HOME/.overdeck/grok-build-mcp-token`, mode 0600.
3. `grok plugin install "$PWD/integrations/grok-build" --trust && grok plugin enable overdeck`.
   Confirm with `grok inspect --json` as in the table above.
4. Ground truth:
   `curl -s -H "Authorization: Bearer $(cat ~/.overdeck/grok-build-mcp-token)" http://127.0.0.1:3011/api/needs-you`
   and the `/api/fleet/needs-you` route — record the item **count** only,
   never content.
5. Local check: `grok -p "/overdeck:overdeck pending" --always-approve --output-format json`
   from a scratch directory (the token is read-only, so auto-approval
   cannot change anything). Pass: the answer's item count matches step 4,
   or says nothing waits when the count is 0, and the transcript shows a
   `list_pending_input` call. Also run `grok -p "/overdeck pending" …` once
   and record what the bare form did (the `pan` alias, the plugin, or an
   ambiguity message).
   - If `grok -p` treats `/overdeck:overdeck pending` as plain text instead
     of running the skill, record the slash check as "Not run: headless
     grok does not expand slash entries", then run
     `grok -p "Use the overdeck MCP tool list_pending_input and list what waits for me" --always-approve --output-format json`
     as partial evidence (the tool loads and its item count matches step
     4).
6. Connector check: create a pairing string via Connect a bot (Grok Build,
   Overdeck connector) in the dashboard, run `pan mcp connector login` and
   approve its device code in a browser, then
   `pan mcp connector pair '<string>'`. Repeat step 5 (now through the
   connector branch; `/overdeck:overdeck status` reports one paired
   machine), then `pan mcp connector logout`.
7. Clean up, always: `grok plugin uninstall overdeck --confirm`;
   `pan token revoke <id of grok-build-verify>`;
   `rm -f "$HOME/.overdeck/grok-build-mcp-token"` (only if this run created
   it). Never touch any other installed plugin (for example `mind-your-now`).

## Release boundary

This package is not published to any marketplace. See
[`PUBLISHING.md`](../PUBLISHING.md) for the operator-approved submission
steps.
