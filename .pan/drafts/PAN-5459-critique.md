plan-digest: f221d3301ef501815b202156d284f83adfde4e60368d45adf51bf505a723bf56

## blocks-the-design: Load check can finish unloaded

The PRD requires ten runs under CPU load ([PAN-5459.md](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5459/.pan/drafts/PAN-5459.md), line 65). Its command starts the load processes with `timeout 300` at line 435, then runs ten tests without checking that those processes are still alive at lines 436–437. If the runs take over 300 seconds, later runs are unloaded and the command can still exit successfully. The same command is the xBRIEF's final acceptance check.

Keep the load processes alive through all ten runs, verify they remain alive during each run, and clean them up with a shell trap. Then a successful command proves the stated loaded-run criterion.
