---
specialist: verification-gate
issueId: PAN-821
outcome: failed
timestamp: 2026-04-25T23:56:05Z
---

VERIFICATION FAILED for PAN-821 (attempt 1/10):

Failed check: test

Verification FAILED at test (25490ms):

api/review/TEST-2/status \
+   -H "Content-Type: application/json" \
+   -d '{"testStatus":"passed","testNotes":"[summary including pre-existing failures if any, and which suites were tested]"}' | jq .
+ ```
+
+ **If NEW regressions found (tests FAIL):**
+ ```bash
+ curl -s -X POST https://pan.localhost/api/review/TEST-2/status \
+   -H "Content-Type: application/json" \
+   -d '{"testStatus":"failed","testNotes":"[describe NEW failures only — specify which suite/repo]"}' | jq .
+ ```
+
+ Then use `pan tell TEST-2 "..."` to notify the issue agent of NEW failures only.
+
+ **VERIFICATION:** After running curl, confirm you see valid JSON output with the updated status. If you get an error or empty response, the update FAILED — report this.
+
+ **NEVER run test commands without redirecting to a file.** This is not optional.
+
+ ## REQUIRED: Container Smoke Test
+
+ After unit tests pass, verify the Docker workspace frontend is accessible.
+ This is NOT optional — UI changes that pass unit tests but break in containers must be caught.
+
+ ```bash
+ # Check if containers are running for this workspace
+ docker ps --filter "name=test-2" --format "{{.Names}} {{.Status}}" 2>/dev/null
+ ```
+
+
+ ## Never Close GitHub Issues
+
+ You are a specialist agent, not the work agent. You do NOT have permission to close issues or merge.
+
+ - **NEVER** run `gh issue close` — that is only for humans or the merge-agent
+ - **NEVER** say "Merged to main" — humans click the Merge button
+ - **NEVER** hand off to merge-agent — the human decides when to merge
+ - **ONLY** call the `/api/review/TEST-2/status` endpoint
+

 ❯ src/lib/cloister/__tests__/build-test-prompt.test.ts:25:20
     23|   it('defaults to localhost:3011 API URL when no env vars set', async …
     24|     const result = await buildTestAgentPromptContent({ issueId: 'TEST-…
     25|     expect(result).toContain('http://localhost:3011');
       |                    ^
     26|   });
     27| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯



## REQUIRED: Fix the failing check, then invoke the /rebase-and-submit skill

1. Read the error output above carefully
2. Fix the code causing the failure
3. Run the failing check locally to verify it passes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-821 — this is an atomic task. Because verification already ran once (a PR exists), the skill will run `pan review request PAN-821 -m "Fixed test"` for you. NEVER curl `/api/review/...` or any dashboard endpoint — `pan review request` is the only supported re-entry point.

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until `pan review request` has completed successfully.
