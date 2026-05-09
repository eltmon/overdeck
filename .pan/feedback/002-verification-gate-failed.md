VERIFICATION FAILED for PAN-1025 (attempt 1/10):

Failed check: test

Verification FAILED at test (43544ms):

/dep-BK3b2jBa.js:46201:19
 ❯ PluginContainer.resolveId ../../../node_modules/.bun/vite@5.4.21/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:49018:17
 ❯ TransformPluginContext.resolve ../../../node_modules/.bun/vite@5.4.21/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:49178:15
 ❯ normalizeUrl ../../../node_modules/.bun/vite@5.4.21/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:64300:26
 ❯ ../../../node_modules/.bun/vite@5.4.21/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:64439:39

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/5]⎯

 FAIL |panopticon-dashboard|  src/components/inspector/ActionsSection.test.tsx [ src/dashboard/frontend/src/components/inspector/ActionsSection.test.tsx ]
Error: Failed to resolve entry for package "@panctl/contracts". The package may have incorrect main/module/exports specified in its package.json.
  Plugin: vite:import-analysis
  File: /home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1025/src/dashboard/frontend/src/lib/refresh-dashboard-state.ts
 ❯ packageEntryFailure ../../../node_modules/.bun/vite@5.4.21/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:46638:15
 ❯ resolvePackageEntry ../../../node_modules/.bun/vite@5.4.21/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:46635:3
 ❯ tryNodeResolve ../../../node_modules/.bun/vite@5.4.21/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:46451:16
 ❯ ResolveIdContext.resolveId ../../../node_modules/.bun/vite@5.4.21/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:46201:19
 ❯ PluginContainer.resolveId ../../../node_modules/.bun/vite@5.4.21/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:49018:17
 ❯ TransformPluginContext.resolve ../../../node_modules/.bun/vite@5.4.21/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:49178:15
 ❯ normalizeUrl ../../../node_modules/.bun/vite@5.4.21/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:64300:26
 ❯ ../../../node_modules/.bun/vite@5.4.21/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:64439:39

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/5]⎯



## REQUIRED: Fix the failing check, then invoke the /rebase-and-submit skill

1. Read the error output above carefully
2. Fix the code causing the failure
3. Run the failing check locally to verify it passes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-1025 — this is an atomic task. Because verification already ran once (a PR exists), the skill will run `pan review request PAN-1025 -m "Fixed test"` for you. NEVER curl `/api/review/...` or any dashboard endpoint — `pan review request` is the only supported re-entry point.

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until `pan review request` has completed successfully.