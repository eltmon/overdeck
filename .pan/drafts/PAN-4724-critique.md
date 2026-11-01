plan-digest: 56f34d441444694be3d9b1a92f1296952360621e52eb842eaf29de07e892414a

## sharpens-framing: benchmark has too few grains

The PRD says live data has 3,006 grains for 771,393 events (`.pan/drafts/PAN-4724.md`, lines 95–108), but WI-4's proposed seed (`.pan/drafts/PAN-4724.md`, lines 525–537) produces only **924** grains for 750,000 events. I ran that recursive CTE in an in-memory SQLite database and counted `GROUP BY UPPER(issue_id), model, session_type, provider`; the result was `(750000 rows, 924 grains, 901 issues)`. The issue, stage, and model moduli correlate, so the 901-issue assertion passes while the rollup read processes less than a third of the live grain count. Change the seed to produce roughly 3,000 grains and assert that count before applying the 50 ms threshold.

## sharpens-framing: slow-log check ignores queue wait

`formatSlowJobLine` logs when **either** `waitMs` or `runMs` exceeds 1,000 ms (`src/dashboard/server/services/dashboard-db-task.ts`, lines 135–145). WI-4 passes `waitMs: 0` (`.pan/drafts/PAN-4724.md`, lines 539–543), so its assertion proves only that a fast read avoids a run-time warning in an idle queue. NFR-1 says no slow line is logged in steady state (`.pan/drafts/PAN-4724.md`, lines 227–231). Narrow that claim to `runMs` below the warning threshold, and make the post-deploy check inspect `waitMs` and `runMs` separately if the full no-warning claim matters.

## sharpens-framing: schema documentation would disagree

WI-5 updates the cost-polling paragraph in `docs/DASHBOARD-ARCHITECTURE.md` and adds an exception in `docs/overdeck-db-erd-notes.md` (`.pan/drafts/PAN-4724.md`, lines 548–566). Yet the architecture document still states that every new table goes in the init migration and bumps `OVERDECK_TABLE_COUNT` (`docs/DASHBOARD-ARCHITECTURE.md`, lines 437–439). The rollup deliberately does neither. Update that sentence with the derived-table exception in the same work item so the two schema guides agree.

## footnote: installed check makes two metadata reads

NFR-3 promises one `sqlite_master` read on an already installed database (`.pan/drafts/PAN-4724.md`, lines 234–235). WI-1 first calls `hasTable(db, 'cost_events')` and then `isInstalled(db)` (`.pan/drafts/PAN-4724.md`, lines 310–315); each is specified as a schema lookup. Combine them into one query or change NFR-3 to allow two reads. The no-write-lock guarantee remains valid.

## footnote: schema note retains an obsolete sentinel

WI-5 removes the stale schema-audit paragraph from `docs/overdeck-db-erd-notes.md`, but line 13 of that same section says the init migration stops running once the `agents` table exists. The current implementation checks for `events` instead (`src/lib/overdeck/infra.ts`, lines 52–60). Correct that sentence while editing the section.
