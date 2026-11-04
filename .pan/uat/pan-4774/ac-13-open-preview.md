# PAN-4774 — AC-13 UI half: Open preview in a browser

- **Commit tested:** `566db45dc87` (`feature/pan-4774`, `npm run build` of this tree; no `src/` change since the build).
- **Date:** 2026-11-02, host `eltmon-z790`.
- **Pair:** `node scripts/anywhere/two-machine-smoke.mjs --hold` printed
  `HOLD a=http://127.0.0.1:3041 b=http://127.0.0.1:3042 dev=33861 conversation=@9b70a06e-fb1c-4ce9-9355-b3f4e6d9f2e7/smoke-desk`.
- **Browser:** Playwright 1.63 Chromium (headless), persistent context with its own `userDataDir` at `.tmp/pan-4774/pw-ac13`, viewport 1440×900.

## Steps

1. Open A at `http://127.0.0.1:3041/conv/%40<B env>%2Fsmoke-desk#overdeck_token=<redacted>` (A's internal token, the one-time sign-in link `pan serve` prints).
2. Click **Preview** (`title="Open preview: forward a dev-server port from eltmon-z790"`) in the conversation title bar.
3. Type the held dev port `33861` into **Other port** and click **Open preview**.
4. Read the new tab and the popover.

## Output

```
open http://127.0.0.1:3041/conv/%409b70a06e-fb1c-4ce9-9355-b3f4e6d9f2e7%2Fsmoke-desk#overdeck_token=<redacted>
preview tab http://127.0.0.1:46745/ body "hello from b"
popover: Forwarding eltmon-z790:33861 → 127.0.0.1:46745
PASS
```

Screenshots: [ac-13-open-preview.png](ac-13-open-preview.png) (A's conversation with the **Preview :33861** popover: "Forwarding eltmon-z790:33861 → 127.0.0.1:46745 … Forwarded through the secure channel") and [ac-13-open-preview-tab.png](ac-13-open-preview-tab.png) (the new tab showing `hello from b`).

## Notes

- **Signing in to a linked dashboard needs the token link.** A plain loopback browser got `Dashboard session could not be established (HTTP 401)`: `POST /api/dashboard/session` answered `401 {"error":"unauthorized"}`. This is intended. `readRemoteAccessConfig()` (`src/lib/remote-access/config.ts`) turns `require_token_mint` on automatically once the machine has an active link (`autoReasons: machine-link`), and then only the internal token mints a session (`docs/DASHBOARD-AUTH.md`, "Session mint"). The run therefore opens A through the `#overdeck_token=` link. The release checklist records this step.
- The CLI half of AC-13 (`pan machines forward`, and B's dashboard port refused) is the smoke's `forward` step in [local-smoke.md](local-smoke.md).

Status: passed
