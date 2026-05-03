---
specialist: verification-gate
issueId: PAN-946
outcome: failed
timestamp: 2026-05-03T17:13:23Z
---

VERIFICATION FAILED for PAN-946 (attempt 1/10):

Failed check: test

Verification FAILED at test (35138ms):

.ts:45:19
     43|     const tasks = readBeadsTasks(WORKSPACE_DIR, PROJECT_ROOT, 'PAN-412…
     44| 
     45|     expect(tasks).toHaveLength(2);
       |                   ^
     46|     expect(tasks[0]).toContain('PAN-412: Implement feature A');
     47|     expect(tasks[1]).toContain('PAN-412: Implement feature B');

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[19/22]⎯

 FAIL |root|  src/lib/cloister/__tests__/beads-scoping.test.ts > readBeadsTasks label scoping > matches beads using labels field (not just tags)
AssertionError: expected Promise{…} to have property 'length'
 ❯ src/lib/cloister/__tests__/beads-scoping.test.ts:58:19
     56|     const tasks = readBeadsTasks(WORKSPACE_DIR, PROJECT_ROOT, 'PAN-419…
     57| 
     58|     expect(tasks).toHaveLength(1);
       |                   ^
     59|     expect(tasks[0]).toContain('Some generic title');
     60|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[20/22]⎯

 FAIL |root|  src/lib/cloister/__tests__/beads-scoping.test.ts > readBeadsTasks label scoping > handles legacy workspace: prefixed labels
AssertionError: expected Promise{…} to have property 'length'
 ❯ src/lib/cloister/__tests__/beads-scoping.test.ts:72:19
     70| 
     71|     // Should match both workspace: prefixed and bare labels containin…
     72|     expect(tasks).toHaveLength(2);
       |                   ^
     73|     expect(tasks.some(t => t.includes('Implementation'))).toBe(true);
     74|     expect(tasks.some(t => t.includes('Feature'))).toBe(true);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[21/22]⎯

 FAIL |root|  src/lib/cloister/__tests__/beads-scoping.test.ts > readBeadsTasks label scoping > deduplicates beads found in both workspace and project root
AssertionError: expected Promise{…} to have property 'length'
 ❯ src/lib/cloister/__tests__/beads-scoping.test.ts:89:19
     87|     const tasks = readBeadsTasks(WORKSPACE_DIR, PROJECT_ROOT, 'PAN-412…
     88| 
     89|     expect(tasks).toHaveLength(1);
       |                   ^
     90|   });
     91| });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[22/22]⎯



## REQUIRED: Fix the failing check, then invoke the /rebase-and-submit skill

1. Read the error output above carefully
2. Fix the code causing the failure
3. Run the failing check locally to verify it passes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-946 — this is an atomic task. Because verification already ran once (a PR exists), the skill will run `pan review request PAN-946 -m "Fixed test"` for you. NEVER curl `/api/review/...` or any dashboard endpoint — `pan review request` is the only supported re-entry point.

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until `pan review request` has completed successfully.
