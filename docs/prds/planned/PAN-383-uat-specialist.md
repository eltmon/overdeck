# PAN-383: UAT Specialist — Browser-Based Requirement Verification

## Summary

Introduce a **UAT (User Acceptance Testing) Specialist** into the Overdeck specialist pipeline. It runs after the test specialist passes, using Playwright in a real browser to manually verify every requirement against the actual running application. It takes screenshots at each step to provide visual evidence of quality.

**This is the specialist that catches what no other specialist can:**
- CORS errors (browser-only enforcement — E2E tests bypass it)
- Visual regressions (broken layouts, wrong colors, missing animations)
- Auth flow failures (real login, not API shortcuts)
- Mobile responsiveness issues
- Runtime errors that only appear in the browser console

## Motivation

Every MYN workspace has the same problem: the test specialist passes, the review specialist approves, but the actual application doesn't work in the browser. The MIN-796 CORS issue (`X-MindYourNow-Client` not in allowed headers) is a perfect example — E2E tests use `apiUtils.getAuthToken()` which makes direct HTTP calls, bypassing CORS entirely. A real browser would have caught this immediately.

The UAT specialist is the "would a human actually be able to use this?" check.

## Pipeline Position

```
Agent → Inspect (per-bead) → Review (full MR) → Test (suite) → UAT (browser) → Merge
```

UAT runs after the test specialist passes. It's the final gate before merge.

## How It Works

### 1. Triggered After Test Pass

When the test specialist signals `passed`, the system queues the UAT specialist (same pattern as test → merge handoff today).

### 2. UAT Specialist Receives Context

The specialist is spawned with:
- **Workspace URLs** — Frontend (`https://feature-min-xxx.myn.localhost`) and API (`https://api-feature-min-xxx.myn.localhost`)
- **Issue ID** — To find the PRD/requirements
- **PRD/spec file path** — The requirements document to verify against
- **Test credentials** — `appletester@test.com` / `Football#1776`
- **Changed files list** — To focus verification on affected areas

### 3. UAT Specialist Runs Verification

Using Playwright MCP (already configured at `~/.claude/mcp.json`), the specialist:

#### Phase 1: Smoke Test
Before checking requirements, verify the app is actually functional:

1. **Backend health** — `GET /actuator/health` returns 200
2. **Frontend loads** — Navigate to workspace URL, verify page renders (no blank screen)
3. **Auth works** — Complete the magic link login flow in the browser (not via API shortcut)
4. **No console errors** — Check browser console for errors/warnings after page load
5. **CORS works** — Verify API calls succeed from the browser (this alone would have caught every recurring CORS issue)

If smoke test fails → **BLOCKED immediately**. Don't waste time checking requirements.

Screenshot: `01-smoke-frontend-loaded.png`, `02-smoke-logged-in.png`, `03-smoke-console-clean.png`

#### Phase 2: Requirement Verification
Read the PRD/spec/issue description. For each stated requirement:

1. **Navigate** to the relevant page/feature
2. **Interact** with the feature as a user would
3. **Verify** the behavior matches the requirement
4. **Screenshot** the result with a descriptive filename
5. **Log** PASS or FAIL with specific details

Example for MIN-796 (Kaia Chat):
```
Requirement: "Full-screen /chat route with side rail"
→ Navigate to /chat
→ Screenshot: 04-chat-fullscreen-layout.png
→ Verify: side rail visible, message area centered, composer at bottom
→ Result: PASS

Requirement: "OKLCH dark theme by default"
→ Verify: dark background, correct accent colors, no MUI styling bleed
→ Screenshot: 05-dark-theme.png
→ Result: PASS

Requirement: "Command palette opens with Cmd+K"
→ Press Cmd+K
→ Screenshot: 06-command-palette-open.png
→ Verify: palette appears with fuzzy search, MYN navigation items
→ Result: PASS
```

#### Phase 3: Visual Quality Audit
Beyond requirement verification, check that the UI is visually excellent:

1. **Desktop viewport** (1920x1080) — Full layout screenshot
2. **Tablet viewport** (768x1024) — Responsive behavior
3. **Mobile viewport** (375x812) — Mobile layout, thumb-zone compliance
4. **Interactions** — Hover states, focus rings, transitions
5. **Typography** — Font rendering, sizing, spacing
6. **Color consistency** — Accent colors match design system
7. **Broken layouts** — Overlapping elements, overflow, misalignment
8. **Loading states** — Skeleton screens, spinners, empty states

Screenshots: `07-desktop-1920.png`, `08-tablet-768.png`, `09-mobile-375.png`

#### Phase 4: Console & Network Audit
Check browser developer tools:

1. **Console errors** — Any `Error` or `Warning` in console
2. **Failed network requests** — Any 4xx/5xx responses
3. **CORS failures** — Any blocked cross-origin requests
4. **Missing resources** — 404s for fonts, images, scripts
5. **Performance** — Page load time, large bundle warnings

### 4. UAT Specialist Reports

**On PASS:**
```bash
pan tell <issueId> "UAT PASSED:

All requirements verified ✓
Visual quality audit passed ✓
No console errors ✓
No CORS issues ✓

Screenshots saved to: ~/.panopticon/specialists/<project>/uat-agent/runs/<runId>/screenshots/
Ready for merge."

curl -X POST <apiUrl>/api/specialists/done \
  -H "Content-Type: application/json" \
  -d '{"specialist":"uat","issueId":"<issueId>","status":"passed","notes":"All requirements verified, visual quality excellent"}'
```

**On BLOCKED:**
```bash
pan tell <issueId> "UAT BLOCKED:

FAILURES:
1. [SMOKE] CORS error: X-App-Version header blocked on POST /api/v1/customers/generate-magic-link
   Screenshot: 03-cors-error.png
2. [REQ] Side rail does not collapse on mobile viewport (375px)
   Screenshot: 09-mobile-rail-broken.png
3. [VISUAL] Text overlaps composer button at 768px width
   Screenshot: 08-tablet-overlap.png

Fix these issues. The agent must fix and signal pan done again."

curl -X POST <apiUrl>/api/specialists/done \
  -H "Content-Type: application/json" \
  -d '{"specialist":"uat","issueId":"<issueId>","status":"failed","notes":"CORS failure, mobile layout broken, tablet text overlap"}'
```

## Screenshot Storage

Screenshots are stored alongside run logs:

```
~/.panopticon/specialists/<project>/uat-agent/
├── runs/
│   └── <runId>/
│       ├── screenshots/
│       │   ├── 01-smoke-frontend-loaded.png
│       │   ├── 02-smoke-logged-in.png
│       │   ├── 03-smoke-console-clean.png
│       │   ├── 04-chat-fullscreen-layout.png
│       │   ├── 05-dark-theme.png
│       │   ├── 06-command-palette-open.png
│       │   ├── 07-desktop-1920.png
│       │   ├── 08-tablet-768.png
│       │   ├── 09-mobile-375.png
│       │   └── ...
│       └── uat-report.md
```

The `uat-report.md` is a structured report with:
- Summary (pass/fail count)
- Each requirement with PASS/FAIL status and screenshot reference
- Visual quality findings
- Console/network audit results
- Recommendations

## Playwright MCP Integration

The UAT specialist uses the **Playwright MCP server** already configured at `~/.claude/mcp.json`. Available tools:

| Tool | Usage |
|------|-------|
| `browser_navigate` | Navigate to workspace URLs |
| `browser_snapshot` | Get accessibility tree (verify elements exist) |
| `browser_take_screenshot` | Capture visual state |
| `browser_click` | Interact with buttons, links |
| `browser_fill_form` | Enter text in inputs |
| `browser_press_key` | Keyboard shortcuts (Cmd+K for command palette) |
| `browser_console_messages` | Check for console errors |
| `browser_network_requests` | Check for failed API calls |
| `browser_resize` | Test responsive viewports |
| `browser_evaluate` | Run JS in page context |

### Auth Flow

The UAT specialist cannot use the real magic link flow (it sends an email). Instead, it uses the test token shortcut — but critically, it navigates to the token URL **in the browser**, so all subsequent API calls are subject to real CORS enforcement:

```
1. Fetch test token server-side (not in browser — this one call bypasses CORS intentionally):
   curl -s -H "X-API-KEY: myn_test_e2e" https://api-feature-min-xxx.myn.localhost/api/v1/customers/retrieve-test-token

2. browser_navigate → https://feature-min-xxx.myn.localhost/magic-login?directtoken=<token>

3. Wait for redirect to /home

4. browser_take_screenshot → "02-smoke-logged-in.png"
```

From step 2 onward, the app is running in a real browser with real CORS enforcement. Every API call the app makes (fetching tasks, loading conversations, etc.) goes through the browser's preflight checks. This is the key difference from E2E tests — E2E uses `apiUtils` which makes server-side HTTP calls that never touch CORS.

## What Makes UAT Different From E2E Tests

| Aspect | E2E Tests (test-agent) | UAT Specialist |
|--------|----------------------|----------------|
| **What it checks** | Code assertions (`expect(element).toBeVisible()`) | Requirement fulfillment + visual quality |
| **CORS** | Bypassed (direct HTTP calls via apiUtils) | Enforced (real browser XHR/fetch) |
| **Auth** | Shortcut (`apiUtils.getAuthToken()`) | Real magic link flow |
| **Visual** | None (unless explicit screenshot assertions) | Every screen captured and evaluated |
| **Mobile** | Only if mobile test suite exists | Always checks 3 viewports |
| **Console** | Not checked | Always audited |
| **Driven by** | Test code | Requirements document |
| **When** | After review | After tests |

## What UAT Does NOT Do

- **Run the test suite** — That's the test specialist
- **Code review** — That's the review specialist
- **Check spec fidelity** — That's the inspect specialist
- **Fix issues** — It only reports. The agent fixes.
- **Performance benchmarking** — It notes obvious slowness but doesn't run Lighthouse

## Configuration

**`cloister.toml`:**
```toml
[specialists.uat_agent]
enabled = true
auto_wake = true
```

**Model selection:**
```toml
[model_selection.specialist_models]
uat_agent = "sonnet"  # Needs vision for screenshot analysis + browser interaction
```

**Per-project overrides** (`projects.yaml`):
```yaml
specialists:
  prompts:
    uat-agent: |
      Additional project-specific UAT instructions...
  uat:
    viewports:
      - { width: 1920, height: 1080, name: "desktop" }
      - { width: 768, height: 1024, name: "tablet" }
      - { width: 375, height: 812, name: "mobile" }
    skip_visual_audit: false
    auth:
      email: "appletester@test.com"
      token_endpoint: "/api/v1/customers/retrieve-test-token"
      token_header: "X-API-KEY"
      token_value: "myn_test_e2e"
```

## Implementation Scope

### Files to Create

| File | Purpose |
|------|---------|
| `src/lib/cloister/uat-agent.ts` | Agent implementation: context builder, prompt builder, screenshot management |
| `src/lib/cloister/prompts/uat-agent.md` | Prompt template: smoke test, requirement verification, visual audit, console audit |

### Files to Modify

| File | Change |
|------|--------|
| `src/lib/cloister/specialists.ts` | Add `'uat-agent'` to `SpecialistType` |
| `src/lib/review-status.ts` | Add `uatStatus` field |
| `src/cli/commands/specialists/done.ts` | Handle UAT completion |
| `src/cli/commands/specialists/wake.ts` | Add to validNames |
| `src/cli/commands/specialists/reset.ts` | Add to ALL_SPECIALISTS |
| `src/cli/commands/specialists/queue.ts` | Add to validNames |
| `src/cli/commands/specialists/clear-queue.ts` | Add to ALL_SPECIALISTS |
| `src/lib/cloister/handoff.ts` | Add to specialist detection |
| `src/dashboard/server/index.ts` | Add to validNames + done handler, queue UAT after test passes |
| `src/dashboard/frontend/.../AgentDetailView.tsx` | Add to validTypes |
| `docs/SPECIALIST_WORKFLOW.md` | Add UAT section to pipeline |

### Pipeline Wiring

In the test completion handler, when `testStatus === 'passed'`:
```typescript
// After test passes, queue UAT
if (status.testStatus === 'passed') {
  await spawnEphemeralSpecialist(projectKey, 'uat-agent', {
    issueId,
    workspace,
    context: {
      frontendUrl: `https://feature-${issueId.toLowerCase()}.myn.localhost`,
      apiUrl: `https://api-feature-${issueId.toLowerCase()}.myn.localhost`,
      prdPath: findPrdForIssue(issueId, workspace),
    }
  });
}
```

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No PRD/spec exists | UAT runs smoke test only — skip requirement verification, still do visual audit |
| Backend is down | Smoke test fails immediately → BLOCKED with "backend not responding" |
| Playwright MCP not configured | Fail with clear error: "Playwright MCP server not configured" |
| Frontend-only change (no API) | Skip API smoke test, focus on visual verification |
| Backend-only change (no UI) | Skip visual audit, focus on API health + CORS |
| Timeout (>15 minutes) | Auto-BLOCKED with partial results and screenshots taken so far |

## Success Criteria

1. **CORS issues caught** — The MIN-796 `X-MindYourNow-Client` / `X-App-Version` CORS failure would be caught in smoke test Phase 1
2. **Visual regressions caught** — Broken layouts, wrong colors, overflow issues detected via screenshots
3. **Requirements verified** — Each PRD requirement has a PASS/FAIL with screenshot evidence
4. **Fast enough** — Complete verification in < 10 minutes for typical feature
5. **Actionable feedback** — Agent receives specific failures with screenshots, not vague "it looks wrong"

## Updated Full Pipeline

```
Agent finishes bead → Inspect (bead diff)    → PASS → next bead
                                              → BLOCKED → fix → re-inspect

All beads done → Review (full MR)            → APPROVED → Test
                                              → CHANGES_REQUESTED → fix

              → Test (suite)                  → PASSED → UAT
                                              → FAILED → fix

              → UAT (browser)                 → PASSED → Merge
                                              → BLOCKED → fix

              → Merge (push)                  → Post-merge cleanup
```
