# PAN-5349 live check (AC-17, live-check.ac1–ac4)

Run 2026-11-15 against this branch's build (`npm run build`), in a fresh
headless Chromium context (Playwright, no shared profile).

## Setup and deviations

- **Peer dashboard on the host, not the workspace container.** The workspace's
  own containers could not serve an authenticated browser: the frontend
  container's Vite proxy rewrites the host, so `/api/dashboard/session` answers
  403 `Invalid origin`, and the API host is not a trusted origin. (The frontend
  container also fails CSS builds when the shared `frontend/node_modules` links
  point at the host's Bun store; see project memory.) So the branch's
  `dist/dashboard/server.js` ran on `127.0.0.1:3951` in peer mode
  (`OVERDECK_DISABLE_DEACON=1`) with its own `HOME` and `OVERDECK_HOME` under the
  agent scratchpad, started through a `serve.js` symlink, with one registered
  project `pan5349` = this workspace checkout. The browser reached it as a
  loopback peer, so no token workaround was needed.
- **`pan open` ran on the host** with the peer's `HOME`/`OVERDECK_HOME` (so its
  internal token matches) and `OVERDECK_DASHBOARD_URL=http://127.0.0.1:3951`.
- **No real GNOME Files right-click.** The file-manager integration was installed
  into the peer's fake `HOME`, not the operator's desktop, and the generated
  GNOME Files script was run directly with a folder argument, which is what
  right-click → Scripts → Open in Overdeck runs.
- **macOS checkpoint not run.** Machine memory says to ask Edward before using
  the Mac rig, so the Quick Action was not registered on real hardware. The
  documented fallback applies: `features/open-in-overdeck.mdx` carries the
  manual Automator steps.
- **Windows** is covered by unit tests only, as planned.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| `pan open <checkout>/docs` with a tab open | `Opened docs in pan5349`; the Files dock reveals and selects `docs`; toast "Opened docs from pan open" | `01-pan-open-folder.png` |
| `pan open <checkout>/README.md:10` | `Opened README.md in pan5349`; a README.md code tab opens with the cursor on line 10, revealed in the dock | `02-pan-open-file-line-10.png` |
| `/open?path=<checkout>/CLAUDE.md&line=3` in a new tab | Opens CLAUDE.md at line 3; the URL becomes `/command-deck/pan5349` (no `setTimeout` fallback needed, O-D16) | `03-open-link.png` |
| `/open?path=/home/eltmon/Projects` | Dialog "Add it as a project?" naming the folder, with Cancel and Add project | `04-outside-project-dialog.png` |
| `pan open` with no tab listening (earlier run) | `Opening <dashboard>/open?path=… in your browser` | CLI output |
| `pan open /tmp` | `/tmp isn't in a registered project. Add it with: pan project add /tmp`, exit 1 | CLI output |
| `pan integrate file-manager` | Wrote the three Linux entries (`applications/overdeck-open.desktop`, `nautilus/scripts/Open in Overdeck`, `kio/servicemenus/overdeck-open.desktop`); all three exist | CLI output |
| Run the GNOME Files script on `src` | `Opened src in pan5349`; dock reveals `src` | `05-nautilus-script.png` |
| `pan doctor` | `✓ File-manager integration` while installed; after deleting the script, `⚠ File-manager integration is stale: …/Open in Overdeck`, fix `pan integrate file-manager` | CLI output |
| `pan integrate file-manager --remove` | Deleted the three files and the state file; none exist afterwards | CLI output |
