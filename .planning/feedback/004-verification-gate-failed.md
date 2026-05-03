---
specialist: verification-gate
issueId: PAN-946
outcome: failed
timestamp: 2026-05-03T16:41:26Z
---

VERIFICATION FAILED for PAN-946 (attempt 1/10):

Failed check: test

Verification FAILED at test (37284ms):

as thrown inside the file itself, but while it was running.
The latest test that might've caused the error is "auto-selects best session when feature is clicked (B5)". It might mean one of the following:
- The error was thrown, while Vitest was running this test.
- If the error occurred after the test had been completed, this was the last documented test before it was thrown.

⎯⎯⎯⎯⎯ Uncaught Exception ⎯⎯⎯⎯⎯
TypeError: registeredProjects is not iterable
 ❯ src/dashboard/frontend/src/components/CommandDeck/index.tsx:372:22
 ❯ updateMemo node_modules/.bun/react-dom@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:16427:19
 ❯ Object.useMemo node_modules/.bun/react-dom@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:17067:16
 ❯ Proxy.useMemo node_modules/.bun/react@18.3.1/node_modules/react/cjs/react.development.js:1650:21
 ❯ CommandDeck src/dashboard/frontend/src/components/CommandDeck/index.tsx:366:52
 ❯ renderWithHooks node_modules/.bun/react-dom@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:15486:18
 ❯ updateFunctionComponent node_modules/.bun/react-dom@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:19617:20
 ❯ beginWork node_modules/.bun/react-dom@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:21640:16
 ❯ beginWork$1 node_modules/.bun/react-dom@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:27465:14
 ❯ performUnitOfWork node_modules/.bun/react-dom@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:26599:12

This error originated in "src/components/CommandDeck/CommandDeck.test.tsx" test file. It doesn't mean the error was thrown inside the file itself, but while it was running.
The latest test that might've caused the error is "clears session view when switching to a conversation". It might mean one of the following:
- The error was thrown, while Vitest was running this test.
- If the error occurred after the test had been completed, this was the last documented test before it was thrown.



## REQUIRED: Fix the failing check, then invoke the /rebase-and-submit skill

1. Read the error output above carefully
2. Fix the code causing the failure
3. Run the failing check locally to verify it passes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-946 — this is an atomic task. Because verification already ran once (a PR exists), the skill will run `pan review request PAN-946 -m "Fixed test"` for you. NEVER curl `/api/review/...` or any dashboard endpoint — `pan review request` is the only supported re-entry point.

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until `pan review request` has completed successfully.
