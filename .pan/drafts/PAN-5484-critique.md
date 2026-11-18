plan-digest: 996e79d36856ed8d0cf0c3788e9702c2c81c438e6f4144d55382f61d481573d5

## blocks-the-design: Empty backups can evict real backups

The proposed `backupBeforeSync` always calls `cleanOldBackups` after `createBackup` (PRD WI-3). In `src/lib/backup.ts`, lines 23 and 27–29, `createBackup` makes a timestamp directory even when every source is absent; lines 43–47 return a successful result with `targets: []`. `src/cli/commands/sync.ts`, lines 328–332, already treats that result as “No existing content to backup.” After 10 such syncs, the plan would prune every older, content-bearing sync backup while retaining only empty directories. Skip retention when `backup.targets` is empty, or explicitly retain content-bearing backups until a content-bearing replacement exists; add a test with missing source directories and older populated backups.

## blocks-the-design: Timestamp prefix can delete unrelated directories

PRD WI-1 defines `TIMESTAMP_DIR_RE = /^\d{4}-\d{2}-\d{2}T/` and feeds every matching directory to `rmSync` in `cleanOldBackups` (PRD lines 128–130 and 172–184). I reran the match: `2026-11-17Tnotes` and `2026-11-17Tmanual-context` both return `true`, although `createBackupTimestamp()` emits a full `YYYY-MM-DDTHH-MM-SS-sssZ` name (`src/lib/backup.ts`, lines 11–12). A date-prefixed named directory can therefore be deleted, contrary to FR-2. Match a complete, anchored backup timestamp format, including any verified legacy formats that must remain eligible, and test a date-prefixed named directory.

## blocks-the-design: Large keep values bypass CLI validation

PRD WI-4 validates only `/^\d+$/`, then converts the string with `Number(raw)` before calling `cleanOldBackups` (PRD lines 343–351). A 400-digit decimal passes the regex but converts to `Infinity`; the proposed library check throws an uncaught `RangeError` instead of the FR-7 red error and explicit `exitCli(1)`. `9007199254740993` also rounds to `9007199254740992` and passes `Number.isInteger`, so the command accepts a count different from the one supplied. Parse and validate a finite safe integer before calling `cleanOldBackups`, and cover overflow and precision-loss inputs in the CLI tests.

## blocks-the-design: Restore instructions promise an incomplete recovery

PRD WI-5 tells readers to use `pan restore <timestamp>` after showing a backup layout with `skills/`, `commands/`, and `agents/` (PRD lines 373–383). Yet `src/cli/commands/restore.ts`, lines 63–73, maps only skills and commands and then reports success; `src/lib/backup.ts`, lines 99–112, silently skips any unmapped directory. The plan explicitly leaves the missing agents mapping outside scope (PRD line 433). Either make the restore command cover `agents/` in this change, or state in the new restore instructions that it restores only skills and commands and give the manual agents recovery step. Context backups shown by `pan backup list` also need a manual recovery note because `pan restore` silently skips `context/`.
