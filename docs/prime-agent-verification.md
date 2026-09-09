# Prime Agent verification

Verified on 2026-08-12 for PAN-3668 with Prime Agent 0.7.2 and Node.js 22.22.0.

## Automated gates

| Gate | Result |
| --- | --- |
| `npm run build` | Passed, including contracts, CLI, dashboard server, dashboard frontend, and dist-externals checks. |
| `npm run typecheck` | Passed. The dashboard ratchet fell from 30 known errors to 28 after the Prime runtime types were propagated. |
| `npm run lint` | Passed through the focused rerun after removing the new Prime transcript-adapter cycle. |
| `npm test` | 13,664 tests passed and 51 skipped. Two unrelated 5-second setup hooks timed out under full-suite load; both files passed immediately in a focused rerun (5/5 tests). |
| Prime focused and no-loss tests | Passed, including the live smoke, runtime registry, parser, policy, picker, transcript, artifact, telemetry, and canonical-harness matrices. |

The opt-in live test is `tests/integration/prime-agent-smoke.test.ts`. Run it with `OVERDECK_PRIME_AGENT_LIVE=1 npx vitest run tests/integration/prime-agent-smoke.test.ts`. Provider and model overrides are available through `OVERDECK_PRIME_AGENT_PROVIDER` and `OVERDECK_PRIME_AGENT_MODEL`.

## Live Prime Agent smoke

The smoke used a disposable directory and the installed `prime-agent` binary. It verified:

1. RPC launch with an explicit provider, model, working directory, and session directory.
2. Correlated `get_state`, `prompt`, `steer`, `get_session_stats`, `abort`, `get_messages`, and resumed-session requests.
3. A real Bash tool execution that wrote the expected marker inside the disposable directory.
4. Non-zero token accounting, non-negative cost accounting, graceful stop, and resume from the saved session file.
5. The freshly built doctor diagnostic: `Prime Agent: v0.7.2 (RPC mode available)`.

## Dashboard boot and UI

The production dashboard bundle booted under Node.js 22 on isolated port 33668 with an isolated `OVERDECK_HOME`, `OVERDECK_DISABLE_DEACON=1`, and `OVERDECK_NO_RESUME=1`. `/api/health` returned `status: ok`, `mode: peer`, and the feature branch build metadata. The log order confirmed the HTTP listener before boot-cache completion, and Cloister stayed disabled.

Playwright opened the isolated dashboard, enabled the throwaway harness-permutation setting, opened the runtime picker, and confirmed that `Prime Agent` was visible with the description `Managed persistent Prime RPC session`. The inspected screenshot is [the Prime Agent runtime picker](evidence/pan-3668/prime-agent-runtime-picker.png).

## Release decision

The Prime Agent path is verified for managed launch, RPC delivery, tool use, transcript persistence, cost reporting, stop/resume, diagnostics, and operator-facing selection. The only full-suite exceptions were two unrelated setup-hook timeouts that passed outside the saturated run.
