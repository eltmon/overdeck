# Computer-use Linux helper

`runtime.py` is a verbatim port of Orca's Linux computer-use bridge
(`stablyai/orca`, MIT, commit `c6b9ac9549b`), recorded in
`scripts/upstream-ports.json` and checked by `npm run lint:upstream-ports`.
Besides the shebang line and the two port-header lines right after it,
nothing in this file differs from upstream — no local edits, no reformatting.
It reads AT-SPI accessibility state, takes screenshots, and sends input
through AT-SPI actions, XTest and `xdotool`. It takes one JSON operation file
as its sole argument and prints one JSON response line.

To re-vendor at a newer Orca commit: copy the file again
(`git -C ~/Projects/orca show <commit>:native/computer-use-linux/runtime.py`),
keep the two port-header lines (bump the commit in both the header and
`scripts/upstream-ports.json`), and run `bash scripts/upstream-port-diff.sh orca`
first to see what changed upstream since the last port.

The helper needs these system packages, not vendored here: `python3-gi`,
`gir1.2-atspi-2.0`, `xdotool`, optionally `xclip` or `xsel` (clipboard paste),
and `grim` on Wayland (screenshots).
