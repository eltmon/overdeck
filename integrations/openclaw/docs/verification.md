# Verification

Date: 2026-11-04.

OpenClaw: 2026.10.10 (npm latest on that date; CLI reports `OpenClaw 2026.10.10 (7dc3350)`), installed under Node 24.17.0 in a scratch directory with `OPENCLAW_HOME`, `OPENCLAW_STATE_DIR` and `OPENCLAW_CONFIG_PATH` pointing there.

| Check | Command | Result |
| --- | --- | --- |
| Package build and tests | `npm ci && npm run build && npm test` (Node 22.22.0) | Passed: 8 test files, 93 tests. Root suite: `tests/unit/integrations/openclaw.test.ts` passed. |
| CP-7(a) MCP tools through `mcp.servers` with `streamable-http` | `openclaw mcp probe overdeck --json` with `mcp.servers.overdeck` at the dashboard's `http://127.0.0.1:3011/mcp`, `transport: "streamable-http"`, and a read-only token (`read:state,read:conversations`) in a `${VAR}` header | Passed: 6 tools, `overdeck__list_conversations`, `overdeck__list_machines`, `overdeck__list_pending_input`, `overdeck__list_scheduled`, `overdeck__read_conversation`, `overdeck__search_conversations`; no diagnostics. The answer tools need `approve` and were correctly absent. OpenClaw notes "tools have no safety annotations; calls require approval in prompting session postures". The probe token was revoked right after. |
| CP-7(b) manifest keys (`contracts.tools`, `activation.onStartup`) and `openclaw.extensions` | `openclaw plugins inspect overdeck --runtime --json` with `plugins.load.paths` set to this package; also `openclaw plugins install <path> --force --accept-capabilities` in a second state directory | Passed: `status: loaded`, `format: openclaw`, source `dist/index.js` from `openclaw.extensions`, `toolNames` and `contracts.tools` both `["overdeck_pending", "overdeck_answer"]`, the config JSON schema and the `localToken` sensitive UI hint read from the manifest. A load-path plugin loads with the warning "OpenClaw can't verify where this plugin came from" (`trust.reason: record-missing`). `openclaw plugins validate --root . --entry ./dist/index.js` answers "plugin entry does not expose tool or feature authoring metadata": in 2026.10.10 that command checks only plugins written with `defineToolPlugin` (`docs/plugins/tool-plugins.md`, "Validate in CI"), so it does not apply to a `register` plugin. A local `plugins install` stops twice without a terminal: "rerun with --force after reviewing the source", then "requires capability consent ... with --accept-capabilities". With both flags it installs and loads. |
| CP-7(c) `before_prompt_build` accepts `prependContext` | Docs: `docs/plugins/hooks/prompt-and-session.md`. Runtime: the same `plugins inspect` command | Docs: `prependContext` is a documented result. Runtime: **changed in 2026.10.10**. Without a grant the hook is blocked with "typed hook \"before_prompt_build\" blocked because non-bundled plugins must set plugins.entries.overdeck.hooks.allowConversationAccess=true". With `plugins.entries.overdeck.hooks.allowConversationAccess: true`, `typedHooks` is `[{ "name": "before_prompt_build" }]` and `hookCount` is 1. The README now documents the grant. A live agent turn was not run: it needs a model provider key, which the build host does not have. `tests/summary.test.ts` covers the handler's output. |
| Connector route end to end | (see "Running the live checks", step 7) | Not run: needs the operator's overdeck.ai sign-in for `pan mcp connector login` and a pairing string from Connect a bot. The dashboard `/mcp` probe above uses the same sessionless JSON Streamable HTTP transport as the connector. |

## Running the live checks

1. Build the package on Node 22: `cd integrations/openclaw && npm ci && npm run build`.
2. With Node 24.16 or later first on `PATH`, install the host into a scratch
   directory: `npm install --prefix "$HOME/.overdeck/tmp/pan-4954-cp7/host" openclaw@<version>`.
   Export `OPENCLAW_HOME`, `OPENCLAW_STATE_DIR` and `OPENCLAW_CONFIG_PATH`
   under the same scratch directory.
3. Mint a read-only probe token on the dashboard:
   `pan token create cp7-openclaw-probe --scopes read:state,read:conversations --json`.
   Keep the token only in the shell variable `OVERDECK_CP7_TOKEN` and note
   the `id`. Never write the token into a file.
4. Write `$OPENCLAW_CONFIG_PATH` with `mcp.servers.overdeck` (`url`
   `http://127.0.0.1:3011/mcp`, `transport: "streamable-http"`, header
   `Authorization: "Bearer ${OVERDECK_CP7_TOKEN}"`) and
   `plugins.load.paths: ["<absolute path to integrations/openclaw>"]`,
   `plugins.entries.overdeck` with `enabled: true`,
   `hooks: { allowConversationAccess: true }` and
   `config: { connectorUrl: "http://127.0.0.1:3011/mcp", localToken: "${OVERDECK_CP7_TOKEN}" }`.
5. Run `openclaw mcp probe overdeck --json` and
   `openclaw plugins inspect overdeck --runtime --json`, and compare with the
   table above.
6. Revoke the token: `pan token revoke <id>`. `pan token list` must show it
   revoked.
7. Connector route: run the connector commands from Connect a bot
   (`mcp connector login`, `pair '<pairing string>'`, `serve`), export
   `OVERDECK_CONNECTOR_LOCAL_TOKEN`, use the README's connector config plus
   the hook grant, then run `openclaw mcp probe overdeck` and ask an agent
   to call `overdeck_pending`.
8. Record each result in the table above with the OpenClaw version and the
   date. Never record a token.

## Release boundary

This package is not published or listed in any catalog. See
[`PUBLISHING.md`](../PUBLISHING.md) for the operator-approved release steps.
