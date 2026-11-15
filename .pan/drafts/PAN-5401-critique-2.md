plan-digest: bd16cde538740b14d0f9e2f4bf30df829b71b9f6283ac371569c9a2ff543f471

## sharpens-framing: Matching head SHA is not the full approval rule

The PRD glossary and WI-2 documentation say a trusted APPROVED marker passes when its `sha=` names the PR head. In `src/lib/cloister/pr-facts.ts`, lines 343-347, `markerVerdictFromComments` also rejects that marker when its `createdAt` predates the head commit time; `gitHubFacts` sets `approvedAtHead` only when this effective verdict is APPROVED (lines 419-440). The planned implementation correctly reuses `getPrFacts`, but the explanation and acceptance language overstate what a matching SHA proves. Add the recency condition to the glossary and WI-2 paragraph: when the head commit time is available, the approval comment must be posted at or after it.
