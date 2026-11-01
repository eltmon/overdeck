plan-digest: a70055cdc942337c46472fdf468d020a40073f19ebaaa6b71ee8da6a506ead29

## sharpens-framing: Mixed append test releases its gate too early

In [PAN-4680.md](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4680/.pan/drafts/PAN-4680.md), line 266, test 2 queues all three entries and releases the gate before yielding. The proposed `enqueueLedgerAppend` starts its first write in a promise callback (PRD lines 172-175), so the first `mkdir` has not reached the gate when it is released. This test then relies on ordinary I/O timing to expose an implementation that leaves direct appends outside the chain. Wait until the first `mkdir` enters the gate, assert that no later `mkdir` or `appendFile` has started, and only then release it.

## sharpens-framing: The intended failing checkpoint leaves a write pending

In [PAN-4680.md](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4680/.pan/drafts/PAN-4680.md), lines 221 and 265, test 1 intentionally fails its pre-release `mkdir` count against the old implementation. Its gated first write then remains unresolved, while the prescribed `afterEach` awaits `flushLedgerWrites()` before cleanup (line 257). The checkpoint therefore also incurs a hook timeout and leaves cleanup unfinished. Release the gate in a `finally` block around the pre-release assertions, then flush in `afterEach`.

## sharpens-framing: Call order is scoped to an hour file

The PRD's FR-1 and proposed header/docs wording say ledger or file order is call order ([PAN-4680.md](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4680/.pan/drafts/PAN-4680.md), lines 55 and 168-170). But `ledgerFilePath` selects a file from each entry's timestamp ([ledger.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4680/src/lib/github-quota/ledger.ts), lines 103-105 and 117-123), callers can supply `ts` ([sampler.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4680/src/lib/github-quota/sampler.ts), lines 71-73), and `readLedgerWindow` concatenates previous-hour then current-hour files ([ledger.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4680/src/lib/github-quota/ledger.ts), lines 185-193). A later call with an earlier-hour `ts` can appear first in that read. State that the chain starts writes in call order and lines within each hour file follow that order; limit the read-order claim to entries whose timestamps select the same hour file.
