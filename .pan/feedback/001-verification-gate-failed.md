VERIFICATION FAILED for PAN-965 (attempt 1/10):

Failed check: frontend-typecheck

Verification FAILED at frontend-typecheck (7823ms):

src/components/CommandDeck/ProjectTree/ContainerNode.tsx(1,20): error TS6133: 'useCallback' is declared but its value is never read.
src/components/CommandDeck/ProjectTree/FeatureItem.tsx(1260,60): error TS2367: This comparison appears to be unintentional because the types 'AggregateActivityState' and '"ended"' have no overlap.


## REQUIRED: Fix the failing check, then invoke the /rebase-and-submit skill

1. Read the error output above carefully
2. Fix the code causing the failure
3. Run the failing check locally to verify it passes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-965 — this is an atomic task. Because verification already ran once (a PR exists), the skill will run `pan review request PAN-965 -m "Fixed frontend-typecheck"` for you. NEVER curl `/api/review/...` or any dashboard endpoint — `pan review request` is the only supported re-entry point.

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until `pan review request` has completed successfully.