plan-digest: 277d8e303783b23e9ebe275c84f75526ee7a45b6c2589d8a9f83a62606a07f4c

## sharpens-framing: PSI precedence test becomes vacuous

Evidence: `tests/unit/lib/cloister/quality-gate-admission.test.ts:1353-1357` runs “lets PSI win over a high load per core” with identical CPU counters, so utilization is 0. The PRD explicitly leaves it unchanged (`.pan/drafts/PAN-5589.md:202-206`). Under the proposed early return below 0.5 (`.pan/drafts/PAN-5589.md:167-172`), this test returns `pressured: false` even if the implementation incorrectly uses the high load when PSI is available. None of the eight new boundary rows combines available, low PSI with high load at utilization at least 0.5. Smallest fix: call `cpusAt(0.6)` in that existing test and assert utilization is near 0.6; then it still proves PSI takes precedence over load.

## sharpens-framing: Existing-tests acceptance needs an explicit resolution

Evidence: `gh issue view 5589 --repo eltmon/overdeck --json title,body` says “Existing admission tests pass unchanged.” The PRD's D7 and WI-2 (`.pan/drafts/PAN-5589.md:202-206`) direct the implementer to rewrite three existing tests; the current assertions at `tests/unit/lib/cloister/quality-gate-admission.test.ts:1338-1350,1360-1364` require PSI or load alone to pressure a 0%-utilized sample and therefore conflict with the issue's new rule. Smallest fix: explicitly record an acceptance change in the issue or plan: the admission behavior tests remain unchanged, while these sampler assertions are revised to test contention above the 50% floor. This makes the unavoidable test edits reviewable against the stated acceptance criterion.
