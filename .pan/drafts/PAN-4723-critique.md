plan-digest: 3400bee013e1e2fc00267b0959abe8387a679403384722e810b5fbd741b2c86e

## blocks-the-design: required low-disk gate cannot run

The draft xBRIEF makes `mkdir -p /run/user/1000/pan4723 && TMPDIR=/run/user/1000/pan4723 npx vitest …` a required verification command for all three work items, and its ACs require a pass there. In this worker environment, `mkdir -p /run/user/1000/pan4723` exits 1 with `Read-only file system`. `df -h /run/user/1000 /tmp` shows that `/run/user/1000` has 6.3 GiB free while writable `/tmp` has 54 GiB. The PRD's Verification section permits skipping the low-disk run when a suitable mount is unavailable, but its AC-1, AC-4, and AC-5 and the xBRIEF commands still require it. This leaves the implementer with an impossible gate even if the fix is correct.

Make the default test runs and WI-1's injected disk-floor refusal test the required checks. Treat the actual low-disk mount run as conditional on finding a writable mount below 10 GiB, and align AC-1, AC-4, AC-5 and the xBRIEF `verify_commands`/`expected_outputs` with that condition. Remove the hard-coded `mkdir`/`rm -rf` commands for `/run/user/1000/pan4723` from required verification.
