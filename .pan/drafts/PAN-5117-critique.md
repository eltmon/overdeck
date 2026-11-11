plan-digest: ccba42ff762187762aebdcfaf302b6445c2c0c21a434824a25b7130c873d8fbb

## blocks-the-design: Probe can pass without injecting either race

The PRD's probe uses `set -u` at `.pan/drafts/PAN-5117.md:163`, but its `sed` substitutions at lines 167–168 and `grep -c` at line 169 do not assert that each scratch copy contains the injected sleep. If an anchor stops matching, `grep -c` prints `0` and the script continues: `bash -c 'set -u; grep -c impossible /dev/null; echo continued'` printed `0` and `continued`. The checks can then exercise the unmodified timing path, pass, and exit 0 at line 181, falsely certifying WI-1. Make the script exit nonzero unless each scratch copy contains exactly one injected `/bin/sleep 0.3` before running either check.

## blocks-the-design: Probe cleanup deletes other runs' scratch directories

The probe creates a unique directory with `mktemp` at `.pan/drafts/PAN-5117.md:165`, then runs `rm -rf ~/.overdeck/tmp/pan-5117-probe.*` at line 180. That glob also matches another agent's active probe and any unrelated matching directory. Remove the broad cleanup command; leaving this small scratch directory is safer than deleting paths the probe did not create.
