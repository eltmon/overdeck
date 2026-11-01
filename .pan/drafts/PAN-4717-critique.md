plan-digest: d89680b592a535fcd1e7f6643b502f8cfcef25e9b46bab929d3ee45d535f2841

## blocks-the-design: screenshot fallback waives FR-7

The PRD requires a screenshot in the PR at `.pan/drafts/PAN-4717.md`, lines 113–114. WI-5 says browser UAT captures one if local Playwright fails (lines 375–377), but its acceptance criterion explicitly accepts only an error in the PR instead (line 412). The draft xBRIEF repeats that alternative in `evidence-screenshot-and-coderabbit-reply.ac1`. A PR can therefore satisfy the plan without the required screenshot. Make the screenshot mandatory for completion; the fallback can transfer capture to browser UAT, but its result must still be committed and embedded before WI-5 passes.

## sharpens-framing: render the drawer before opening the test issue

WI-1 says to copy the `renderDrawer` harness and open MIN-658 before the drawer renders (`.pan/drafts/PAN-4717.md`, lines 218–226). In the existing harness, tests call `openIssue` and then `renderDrawer` (`src/dashboard/frontend/src/components/drawer/IssueDrawer.test.tsx`, lines 185–191). `IssueDrawer` calls `syncDrawerFromUrl()` on mount (`src/dashboard/frontend/src/components/drawer/IssueDrawer.tsx`, lines 30–32), and that store action rebuilds the drawer from `issue` and `tab` URL parameters (`src/dashboard/frontend/src/lib/store.ts`, lines 166–174 and 256–260). The new `trackerUrl` is intentionally absent from those parameters, so copying that sequence erases it before the fallback assertion. Specify that the new test first mounts the drawer, then calls `openIssue(..., trackerUrl)` inside `act`; test URL-sync clearing separately.

## sharpens-framing: file-size rule is misstated

NFR-2 forbids any file from exceeding its `origin/main` line count (`.pan/drafts/PAN-4717.md`, lines 116–119), while WI-1 and WI-3 prescribe additions to existing source files. The actual guard permits growth up to 1,000 lines for files below that ceiling (`scripts/lint-file-size.sh`, lines 3–6, 39, and 153–166). `wc -l` reports 723 lines for `store.ts`, 147 for `IssueDrawer.tsx`, and 55 for `TranscriptIssueLink.tsx`. Rewrite NFR-2 to match the guard's 1,000-line ceiling and any allowlist cap, so the implementer can meet both the work items and the stated requirement.
