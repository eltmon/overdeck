plan-digest: c3538017ce16ddf8819729cf1329faaa0f21729cb795731e3dfe7a4da042c508

## blocks-the-design: An unchanged retry can strand an uncommitted sequence

The proposed WI-2 branch skips `commitPlanArtifacts` whenever the on-disk sequence matches the new rendering (`.pan/drafts/PAN-5357.md`, lines 252–263). But `commitPlanArtifacts` can fail after `writeSequenceMd` changes the file; its failure path only resets staging and leaves the worktree change in place (`src/lib/overdeck/plan-artifact-commit.ts`, lines 58–76). Re-running the same sequence then returns `written: false`, skips the commit, and pushes no sequence change. The current CLI retries the commit on every run (`src/cli/index.ts`, lines 303–315). Smallest fix: call `commitPlanArtifacts` on an unchanged rendering too, relying on its existing `nothing to commit` result for a clean tree; change FR-4 and the zero-call acceptance test to require zero new commits instead.

## blocks-the-design: File mtime does not prove the sequencer finished

FR-5 and `priorPassFinished` equate `sequence.md` mtime at or after `manifest.json` mtime with a completed pass (`.pan/drafts/PAN-5357.md`, lines 106–110 and 324–332). The existing operator planning route also calls `writeSequenceMd` on that file (`src/dashboard/server/routes/backlog.ts`, lines 282–298); its write updates mtime without the sequencer submitting anything. If an agent fails after its manifest write and an operator changes planning, later automatic calls with the same manifest skip indefinitely. Smallest fix: use a completion marker written by the sequencer submission path, keyed to the manifest, and leave operator edits unable to advance it. Add a test for an operator edit after a failed pass.

## blocks-the-design: Equal-key edges still make order-dependent commits

WI-1's proposed `sortEdges` compares only `from`, `to`, `type`, and `source` (`.pan/drafts/PAN-5357.md`, lines 174–177), while `SequenceEdge` also contains `confidence` (`src/lib/backlog/types.ts`, lines 30–36). `parseSequenceJson` accepts and preserves two edges with the same four fields and different confidence values (`src/lib/backlog/types.ts`, lines 128–132). Reversing those two edges leaves the comparator tied and changes the JSON bytes; I reproduced the different serialized orders with the proposed comparator in Node. That violates FR-1's deterministic rendering and causes a needless commit. Smallest fix: include `confidence` as the final sort key and test reversed equal-key edges.
