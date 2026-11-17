plan-digest: 727bc6f5d24b85e0220becaa25053d83e4aadcc98afaa7533dfe29aa1feb3082

## blocks-the-design: Skipped symlink sources can evict usable backups

`src/lib/backup.ts:27-40` checks `existsSync(sourceDir)`, copies with a filter that rejects symlinks, then unconditionally pushes the source name into `targets`. I reproduced the root-source case with Node's `cpSync`: `sourceExists=true targetExists=false` when the source is a symlink and the filter rejects it. WI-3 uses `backup.targets.length > 0` as proof that content was copied, so a sync whose source directories are symlinks can create an empty timestamp dir and prune older, populated backups. Make `createBackup` omit skipped root sources from `targets` (or otherwise verify that a usable copy exists) and test that this case does not prune populated history.

## blocks-the-design: Failed copies take retention slots

`src/lib/backup.ts:23-40` creates the timestamp directory before `cpSync`, and a copy error leaves that directory behind. WI-1's proposed `listBackups()` accepts every matching timestamp directory and WI-3's `cleanOldBackups()` counts it without a completion check. After several copy failures, the next successful sync can keep partial backups in its ten slots and delete older complete backups. The PRD explicitly excludes cleanup after `ENOSPC`, so this defect would survive implementation. Make incomplete writes distinguishable from completed backups and exclude them from retention; staging under a non-timestamp name until the copy succeeds is one way. Add a failed-copy fixture to the retention test.

## sharpens-framing: A full disk still needs manual recovery

The PRD's D3 and NonGoals deliberately prune only after `createBackup` succeeds. `src/lib/backup.ts:23-39` allocates and copies before that point, so on the incident machine's full disk, the first upgraded `pan sync` can still fail before freeing any of the 9 GB. The repository already has `pan backup clean --keep 10` (`src/cli/index.ts:223-227`, `src/cli/commands/backup.ts:30-39`) as a recovery path. State in the retention docs and release note that an already full disk needs that one-time clean before sync, unless the plan is expanded to prune before copying.
