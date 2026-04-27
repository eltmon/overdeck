---
specialist: verification-gate
issueId: PAN-865
outcome: failed
timestamp: 2026-04-27T12:10:50Z
---

VERIFICATION FAILED for PAN-865 (attempt 1/10):

Failed check: test

Verification FAILED at test (29693ms):

st.tsx > IssueWorkbench > renders issue-selected mode when the slice explicitly clears session focus
 FAIL |panopticon-dashboard|  src/components/CommandDeck/__tests__/IssueWorkbench.test.tsx > IssueWorkbench > falls back to issue-selected when slice points at a missing session
Error: [vitest] No "usePlanningSummaryQuery" export is defined on the "../ZoneCOverviewTabs/queries" mock. Did you forget to return it from "vi.mock"?
If you need to partially mock a module, you can use "importOriginal" helper inside:

vi.mock(import("../ZoneCOverviewTabs/queries"), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    // your mocked methods
  }
})

 ❯ OverviewTab src/components/CommandDeck/ZoneCOverviewTabs/OverviewTab.tsx:214:20
    212|   const queryClient = useQueryClient();
    213|   const [isRecoverPending, setIsRecoverPending] = useState(false);
    214|   const planning = usePlanningSummaryQuery(issueId);
       |                    ^
    215|   const activity = useActivityQuery(issueId);
    216|   const costs = useIssueCostsQuery(issueId);
 ❯ renderWithHooks ../../../node_modules/.bun/react-dom@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:15486:18
 ❯ mountIndeterminateComponent ../../../node_modules/.bun/react-dom@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:20103:13
 ❯ beginWork ../../../node_modules/.bun/react-dom@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:21626:16
 ❯ beginWork$1 ../../../node_modules/.bun/react-dom@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:27465:14
 ❯ performUnitOfWork ../../../node_modules/.bun/react-dom@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:26599:12
 ❯ workLoopSync ../../../node_modules/.bun/react-dom@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:26505:5
 ❯ renderRootSync ../../../node_modules/.bun/react-dom@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:26473:7

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯



## REQUIRED: Fix the failing check, then invoke the /rebase-and-submit skill

1. Read the error output above carefully
2. Fix the code causing the failure
3. Run the failing check locally to verify it passes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-865 — this is an atomic task. Because verification already ran once (a PR exists), the skill will run `pan review request PAN-865 -m "Fixed test"` for you. NEVER curl `/api/review/...` or any dashboard endpoint — `pan review request` is the only supported re-entry point.

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until `pan review request` has completed successfully.
