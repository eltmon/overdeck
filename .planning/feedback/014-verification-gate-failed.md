---
specialist: verification-gate
issueId: PAN-946
outcome: failed
timestamp: 2026-05-03T17:41:28Z
---

VERIFICATION FAILED for PAN-946 (attempt 1/10):

Failed check: test

Verification FAILED at test (37152ms):

 getContext() method: without installing the canvas npm package

stderr | src/hooks/useResourceStats.test.ts
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/__tests__/pipeline-state.test.ts
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

⎯⎯⎯⎯⎯⎯ Failed Suites 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL |root|  tests/unit/lib/review-artifacts.test.ts [ tests/unit/lib/review-artifacts.test.ts ]
Error: [vitest] No "execFile" export is defined on the "child_process" mock. Did you forget to return it from "vi.mock"?
If you need to partially mock a module, you can use "importOriginal" helper inside:

vi.mock(import("child_process"), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    // your mocked methods
  }
})

 ❯ src/lib/beads-query.ts:4:33
      2| import { promisify } from 'util';
      3| 
      4| const execFileAsync = promisify(execFile);
       |                                 ^
      5| 
      6| export interface BeadEntry {
 ❯ src/lib/review-artifacts.ts:6:31

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL |panopticon-dashboard|  src/components/CommandDeck/ProjectTree/ProjectNode.test.tsx [ src/dashboard/frontend/src/components/CommandDeck/ProjectTree/ProjectNode.test.tsx ]
Error: [vitest] No "Zap" export is defined on the "lucide-react" mock. Did you forget to return it from "vi.mock"?
If you need to partially mock a module, you can use "importOriginal" helper inside:

vi.mock(import("lucide-react"), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    // your mocked methods
  }
})

 ❯ src/components/CommandDeck/ConversationRow.tsx:14:15
     12| 
     13| const PHASE_ICONS = {
     14|   init:       Zap,
       |               ^
     15|   thinking:   Loader2,
     16|   bash:       Terminal,
 ❯ src/components/CommandDeck/ProjectTree/ProjectNode.tsx:5:31

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯



## REQUIRED: Fix the failing check, then invoke the /rebase-and-submit skill

1. Read the error output above carefully
2. Fix the code causing the failure
3. Run the failing check locally to verify it passes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-946 — this is an atomic task. Because verification already ran once (a PR exists), the skill will run `pan review request PAN-946 -m "Fixed test"` for you. NEVER curl `/api/review/...` or any dashboard endpoint — `pan review request` is the only supported re-entry point.

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until `pan review request` has completed successfully.
