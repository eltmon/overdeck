plan-digest: 4723d188af23bc355d98a8ed74943b3f459671e34c5a3a42c81e7d4c52a0a470

## blocks-the-design: Gated mkdir never creates the ledger directory

The prescribed mock in [PAN-4680.md](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4680/.pan/drafts/PAN-4680.md), line 259, resolves the first `mkdir` with `undefined` instead of calling the real function. The tests create only `OVERDECK_HOME` (lines 223 and 257); [ledger.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4680/src/lib/github-quota/ledger.ts), lines 93–105 and 124–125, then appends into its missing `github-quota` child. That first `appendFile` rejects with `ENOENT` and is swallowed, so tests 1–3 cannot produce their required first ledger line even after serialization is fixed. Gate the real operation: capture the actual `mkdir` in the test and use `mockImplementationOnce((...args) => gate.promise.then(() => actual.mkdir(...args)))`.

## sharpens-framing: Timestamp test checks only the home

FR-2 in [PAN-4680.md](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4680/.pan/drafts/PAN-4680.md) requires `ts` to be stamped at call time. Yet WI-2 test 3 (line 267) and its acceptance criterion (line 300) inspect only where the files land. An implementation that resolves the home at call time but stamps `ts` when the chain runs would pass this test. Capture a time boundary while the first write is gated and assert the queued entries' `ts` values reflect their queue time.
