VERIFICATION FAILED for PAN-1025 (attempt 1/10):

Failed check: test

Verification FAILED at test (39178ms):

nents/TerminalPanel.test.tsx
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/components/CommandDeck/__tests__/ToolFlash.test.tsx
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/components/inspector/StatusHistory.test.tsx
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/components/ResourceBar.test.tsx
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/hooks/__tests__/useNow.test.ts
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/hooks/__tests__/useConversationUiState.test.ts
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/hooks/useResourceStats.test.ts
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/components/__tests__/IssueAgentCard-harness.test.tsx
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/__tests__/pipeline-state.test.ts
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL |root|  src/lib/channels/__tests__/panopticon-bridge.test.ts > panopticon-bridge subprocess (Bun.serve unix listener) > binds socket at 0o600 and unlinks on SIGTERM
AssertionError: expected 509 to be 384 // Object.is equality

- Expected
+ Received

- 384
+ 509

 ❯ src/lib/channels/__tests__/panopticon-bridge.test.ts:253:20
    251|       expect(existsSync(sockPath)).toBe(true);
    252|       const mode = statSync(sockPath).mode & 0o777;
    253|       expect(mode).toBe(0o600);
       |                    ^
    254| 
    255|       // SIGTERM should unlink

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯



## REQUIRED: Fix the failing check, then invoke the /rebase-and-submit skill

1. Read the error output above carefully
2. Fix the code causing the failure
3. Run the failing check locally to verify it passes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-1025 — this is an atomic task. Because verification already ran once (a PR exists), the skill will run `pan review request PAN-1025 -m "Fixed test"` for you. NEVER curl `/api/review/...` or any dashboard endpoint — `pan review request` is the only supported re-entry point.

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until `pan review request` has completed successfully.