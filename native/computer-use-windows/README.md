# Computer-use Windows helper

`runtime.ps1` is a verbatim port of Orca's Windows UI Automation bridge
(`stablyai/orca`, MIT, commit `c6b9ac9549b`), recorded in
`scripts/upstream-ports.json` and checked by `npm run lint:upstream-ports`.
Besides the two port-header lines at the top, nothing in this file differs
from upstream — no local edits, no reformatting. It stays ASCII with LF line
endings and no byte-order mark. It reads UI Automation accessibility state,
takes screenshots, and sends input through UI Automation patterns and Win32
`SendInput`.

Overdeck runs inside WSL2 on Windows, so it drives this helper through WSL
interop. It copies `runtime.ps1` to `%LOCALAPPDATA%\Overdeck\computer-use\`
on the Windows side and runs one PowerShell process per operation:

```
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File runtime.ps1 <op.json>
```

The helper takes the JSON operation file as its sole argument and prints one
JSON response line. It needs only Windows PowerShell 5.1, which ships with
Windows 10 and 11.

To re-vendor at a newer Orca commit: copy the file again
(`git -C ~/Projects/orca show <commit>:native/computer-use-windows/runtime.ps1`),
keep the two port-header lines (bump the commit in both the header and
`scripts/upstream-ports.json`), and run `bash scripts/upstream-port-diff.sh orca`
first to see what changed upstream since the last port.
