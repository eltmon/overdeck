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
browser device-flow. Run them all in **one shell**: the exported
`VERIFY_TOKEN_FILE` and `OVERDECK_CONNECTOR_HOME` variables must stay in
scope from setup through cleanup, and step 6's pairing and its `logout`
must use the same temporary connector home.

1. **(Operator)** Sign `grok` in: `grok login` (opens a browser) or
   `grok login --device-code` (headless). Confirm with `grok --version`
   and any `grok -p "hello" --output-format json` smoke call.
2. Create a private, temporary token and an isolated connector home —
   never the real default token file or connector home, in case either
   already holds a real credential for this host:
   ```bash
   TOKEN_JSON="$(pan token create grok-build-verify --scopes read:state,read:conversations --json)"
   TOKEN_ID="$(printf '%s' "$TOKEN_JSON" | jq -r '.id')"   # keep for cleanup; the id is not secret
   VERIFY_TOKEN_FILE="$(mktemp)"
   umask 077
   printf '%s' "$(printf '%s' "$TOKEN_JSON" | jq -r '.token')" > "$VERIFY_TOKEN_FILE"
   chmod 600 "$VERIFY_TOKEN_FILE"
   unset TOKEN_JSON
   export OVERDECK_MCP_TOKEN_FILE="$VERIFY_TOKEN_FILE"
   export OVERDECK_CONNECTOR_HOME="$(mktemp -d)"
   ```
   Nothing above prints or records the token itself. The empty
   `OVERDECK_CONNECTOR_HOME` has no `pairing.json`, so `run-mcp.sh` takes
   the `pan mcp serve` branch for the local check below even when this
   host already has a real connector paired elsewhere.
3. `grok plugin install "$PWD/integrations/grok-build" --trust && grok plugin enable overdeck`.
   Confirm with `grok inspect --json` as in the table above.
4. Ground truth for the **local** check — keep the bearer token out of
   process arguments (other local users can read `curl`'s argv) by piping
   it through `curl`'s stdin config instead of `-H`:
   ```bash
   needs_you() {
     curl -s --config - "http://127.0.0.1:3011$1" <<CFG
   header = "Authorization: Bearer $(cat "$VERIFY_TOKEN_FILE")"
   CFG
   }
   LOCAL_COUNT=$(( $(needs_you /api/needs-you | jq '.conversations | length + (.agents | length)') \
                  + $(needs_you /api/fleet/needs-you | jq '[.machines[].conversations, .machines[].agents] | flatten | length') ))
   ```
   Record `$LOCAL_COUNT` only, never content. `/api/fleet/needs-you` is a
   local dashboard-only route; it is not reachable through the connector
   (fact above), so this combined count is the **local** baseline only —
   the connector check in step 6 computes its own, smaller baseline.
5. Local check: `grok -p "/overdeck:overdeck pending" --always-approve --output-format json`
   from a scratch directory (the token is read-only, so auto-approval
   cannot change anything). Pass: the answer's item count matches
   `$LOCAL_COUNT`, or says nothing waits when it is 0, and the transcript
   shows a `list_pending_input` call. Also run `grok -p "/overdeck pending" …`
   once and record what the bare form did (the `pan` alias, the plugin,
   or an ambiguity message).
   - If `grok -p` treats `/overdeck:overdeck pending` as plain text instead
     of running the skill, record the slash check as "Not run: headless
     grok does not expand slash entries", then run
     `grok -p "Use the overdeck MCP tool list_pending_input and list what waits for me" --always-approve --output-format json`
     as partial evidence (the tool loads and its item count matches
     `$LOCAL_COUNT`).
6. Connector check, in the same shell as step 2's `OVERDECK_CONNECTOR_HOME`:
   create a pairing string via Connect a bot (Grok Build, Overdeck
   connector) in the dashboard, run `pan mcp connector login` and approve
   its device code in a browser, then `pan mcp connector pair '<string>'`
   (both write into the temporary `$OVERDECK_CONNECTOR_HOME`, never the
   operator's real one). Recompute the baseline for this path —
   `CONNECTOR_COUNT=$(needs_you /api/needs-you | jq '.conversations | length + (.agents | length)')`,
   the paired machine's own count, since the connector cannot reach
   `/api/fleet/needs-you`. Repeat step 5 against `$CONNECTOR_COUNT` (now
   through the connector branch; `/overdeck:overdeck status` reports one
   paired machine), then `pan mcp connector logout` (same shell, same
   temporary home — it never touches a real pairing).
7. Clean up, always: `grok plugin uninstall overdeck --confirm`;
   `pan token revoke "$TOKEN_ID"`; `rm -f "$VERIFY_TOKEN_FILE"`;
   `rm -rf "$OVERDECK_CONNECTOR_HOME"`. Never touch any other installed
   plugin (for example `mind-your-now`) or the real
   `$HOME/.overdeck/grok-build-mcp-token` / `$HOME/.overdeck-connector`.

## Release boundary

This package is not published to any marketplace. See
[`PUBLISHING.md`](../PUBLISHING.md) for the operator-approved submission
steps.
