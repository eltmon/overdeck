plan-digest: 0fc17f9f6caa57a82209960d34595fe1c9829861d3dfecdd89e6328086ba955d

## blocks-the-design: Watermark advances before the sequence is committed

WI-1 copies `manifest.json` to `examined-manifest.json` inside `writeSequenceMd`, before WI-2 calls `commitPlanArtifacts` and `pushPlanArtifacts`. The existing CLI order is visible at `src/cli/index.ts:303-315`; `commitPlanArtifacts` can return a failure after resetting staging (`src/lib/overdeck/plan-artifact-commit.ts:58-76`). If the write succeeds but the commit or push fails, the examined key already matches the new manifest. WI-3 will then skip the next automatic pass, so the proposed automatic retry cannot repair the dirty file or stranded local commit. D3's manual re-run still works, but it is no longer triggered automatically. Move advancement of the examined watermark to the CLI after the sequence is safely committed and pushed, or make the skip guard detect and retry pending sequence commits and push failures. Add a failed-commit and failed-push recovery test.

## blocks-the-design: A second spawn can replace the first pass's manifest

The proposed WI-3 writes the shared `.pan/backlog/manifest.json` before calling `clearFinishedSequencerRun` and `spawnRun`, just as the current code does at `src/lib/backlog/sequencer-agent.ts:211-233`. The operator route calls the same spawner without the automatic trigger's `_spawnInFlight` guard (`src/dashboard/server/routes/backlog.ts:179-190`). If an operator requests a pass while one is still working, the second call overwrites the shared manifest. The first agent can submit during the second call's asynchronous reap or spawn; WI-1 then copies the second manifest as the first pass's examined key. Restoring the file after `spawnRun` rejects is too late. Keep an immutable manifest snapshot per pass and have that pass's submission record its own snapshot, or prevent any overwrite while a pass can still submit. Test the interleaving of a live submission and a refused second spawn.

## sharpens-framing: The window-end timer can fire after the window

FR-7 and WI-4 say deltas inside the 30-minute window coalesce into one fire at the window's end. The proposed `triggerDebouncedIncrementalPass` schedules `Math.max(DEBOUNCE_MS, windowEndMs() - Date.now())`. A delta 10 seconds before the end therefore schedules a fire 20 seconds after the end, and another delta can push it later. Change the scheduling rule or state the intended behavior as a 30-second debounce that may extend past the 30-minute minimum. Add a fake-timer case for a delta in the window's last 30 seconds.

## sharpens-framing: The real-git test needs its JSON input outside the repo

WI-2 asks for a JSON input file and `git status --porcelain` to be empty after the unchanged run, but its setup only specifies a seed commit in the temporary repository. If the input file is written inside that repository without being tracked or ignored, the status assertion fails for the input file even when `sequence.md` is clean. Place the input JSON outside the test repository, or explicitly ignore it in the seed commit. The existing command reads an arbitrary path (`src/cli/index.ts:292-303`), so no production change is needed.
