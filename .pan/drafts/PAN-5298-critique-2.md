plan-digest: a1f107b37cd8c86f9fcc56444a5bb47405353d4c52701ef9b23b3632c2290a6b

## sharpens-framing: Navigation failures bypass cleanup and evidence

The proposed `try/finally` starts after `openCockpit()` returns (PRD WI-2, lines 154–166), while `openCockpit()` creates a context and awaits `page.goto` before returning (`tests/e2e/issue-tree.spec.ts:217–223`). If Vite makes navigation reject, that context remains open during the retry, and `waitForDetailsTab` never emits the captured Vite log or request failures (PRD WI-3, lines 190–215). This is a plausible failure path for the server fault being investigated. Add a catch inside `openCockpit()` that closes its context and reports the already collected request, page, and Vite evidence when navigation fails; keep the test-level `finally` for failures after navigation.

## sharpens-framing: Verification command hides a failed suite

PRD WI-8 line 241 and the xBRIEF `repeat-evidence` verify command end with `; echo "vitest exit: $?"`. In a shell, that command itself exits 0 after a failed Vitest run because `echo` is last. The text says to inspect the printed status, but an automated command gate would mark the check successful. Capture the status, print it, and exit with it, so the command fails when Vitest fails; keep the separate log checks.
