# Permanent JSONL preservation

Claude Code deletes old local transcripts at startup. Its default
`cleanupPeriodDays` is 30; zero is invalid and older versions interpreted zero
as disabling transcript persistence. Overdeck's conversation metadata can
outlive the JSONL, leaving a title and cost totals without readable history.

`scripts/preserve-transcripts.py` provides a Linux host safeguard independent
of dashboard deployment and Claude's lifecycle:

1. Set `cleanupPeriodDays` to 365000 (1,000 years) in native Claude user
   settings, the canonical Overdeck Claude settings, and existing private
   Claude settings below the agents directory. Future managed launch homes
   inherit the canonical setting. Exact original settings are backed up before
   each change; invalid JSON causes a visible failure instead of replacement.
   A settings failure still allows the independent transcript backup to run.
2. Back up native Claude project JSONL, native Codex current and archived
   session JSONL, and all JSONL beneath Overdeck's agents directory and
   canonical Claude projects directory. This includes nested subagent files.
3. Keep every Restic snapshot indefinitely. The service never invokes
   snapshot expiry or repository pruning. Source removal or truncation does
   not modify older snapshots. Restic deduplicates unchanged data.

Snapshots live in `~/.overdeck/transcript-preservation/repository`, outside
the vendor cleanup roots. The repository password is in the sibling `password`
file with mode 0600. Preserve both when moving or backing up this machine.
Settings originals and their source paths live in `settings-backups/`.

## Install on a Linux host

Requires Python 3, Restic 0.16 or newer, and a user systemd manager. From the
Overdeck source checkout, install the reviewed script and units:

```bash
install -d -m 700 ~/.overdeck/bin ~/.config/systemd/user
install -m 700 scripts/preserve-transcripts.py ~/.overdeck/bin/preserve-transcripts.py
install -m 644 infra/systemd/overdeck-transcript-preservation.* ~/.config/systemd/user/
python3 ~/.overdeck/bin/preserve-transcripts.py backup
systemctl --user daemon-reload
systemctl --user enable --now overdeck-transcript-preservation.timer
```

The timer runs at boot and every five minutes. It also reasserts long retention
for existing Claude homes. A failed or incomplete backup fails the service;
errors remain visible in `systemctl --user status` and the journal. The lock
prevents concurrent writers. This is a host service, not a second Deacon.
The packaged units use the default `~/.overdeck` location; for a custom home,
set `--overdeck-home /absolute/path` in the service's `ExecStart`.

Changing settings does not prove a running Claude process reloaded them.
Project or enterprise policy can override user settings. The timer's snapshots
are the independent safeguard, but new content has up to five minutes of
backup latency while the machine and user manager are running. This local
archive does not protect against loss of the entire disk; include the repository
and password in the machine's external backups. Do not describe a long numeric
retention period alone as an infinite-retention guarantee.

## Inspect and recover

```bash
systemctl --user status overdeck-transcript-preservation.timer
journalctl --user -u overdeck-transcript-preservation.service -n 30
restic -r ~/.overdeck/transcript-preservation/repository \
  -p ~/.overdeck/transcript-preservation/password snapshots
restic -r ~/.overdeck/transcript-preservation/repository \
  -p ~/.overdeck/transcript-preservation/password check
```

Select a snapshot that contains the missing transcript, then restore into a
separate directory. Restoring does not require modifying current transcripts:

```bash
restic -r ~/.overdeck/transcript-preservation/repository \
  -p ~/.overdeck/transcript-preservation/password restore SNAPSHOT_ID \
  --target /tmp/recovered-transcripts --include '/absolute/original/path.jsonl'
```

Overdeck does not automatically read compressed Restic snapshots. After checking
the recovered JSONL, put a copy at its original path if that path is still absent
to make the existing transcript resolver find it. Never overwrite newer history.

## Verification

```bash
python3 -m unittest discover -s scripts/tests -p 'test_preserve_transcripts.py' -v
```

Tests use disposable fixture homes and real Restic repositories. They verify
restoration of original and appended content after fixture truncation/removal,
nested agent transcripts, filenames with spaces and newlines, full repository
integrity, preservation of unrelated settings and symlinks, and refusal to
overwrite malformed settings.
