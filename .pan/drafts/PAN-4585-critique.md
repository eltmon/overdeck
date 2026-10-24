plan-digest: 906cb4dbfc482d662c19f0d08c16773fb8cc93ff37730c6dc187f3b61a7b0e80

## blocks-the-design: Disabled Semgrep remains registered

The PRD says the disabled default “registers” nothing (FR-1, [PAN-4585.md](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4585/.pan/drafts/PAN-4585.md), line 59), but WI-5 requires unconditional `useSemgrep` and `INSTALLABLE_TOOLS` entries (lines 436–438). The existing `GET /api/prereqs` serializes both static collections without checking config ([prereqs.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4585/src/dashboard/server/routes/prereqs.ts), lines 36–47), and `GET /api/prereqs/useSemgrep` would probe the binary while disabled (lines 52–85). The proposed guard covers only installation. Filter Semgrep from both GET responses when disabled, or revise FR-1 to explicitly permit registration and probing while off; add a disabled-state route test.

## blocks-the-design: Installer overwrites an unowned launcher

WI-3 specifies `unlink(linkPath)` before creating the managed symlink, with no ownership check ([PAN-4585.md](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4585/.pan/drafts/PAN-4585.md), lines 364–366). If `~/.overdeck/bin/semgrep` is an existing regular file or a symlink to the user's own Semgrep with a different version, step 2 proceeds to installation and step 5 deletes that launcher. This contradicts NFR-7’s “never touches the user's own Semgrep” (lines 89–91). This bin directory already contains a manifest-based ownership mechanism for hook cleanup ([sync-hooks.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4585/src/lib/sync-hooks.ts), lines 49–56 and 123–130). Check the existing path with `lstat`/`readlink`; replace only a symlink to the managed target and return a failed outcome for any other occupant. Test both conflicting file types.

## blocks-the-design: Injected command runner is bypassed for version checks

WI-3 exposes `SemgrepInstallDeps.execFile` and requires tests with injected dependencies so no real process runs ([PAN-4585.md](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4585/.pan/drafts/PAN-4585.md), lines 338–346 and 380–393). Yet its exact install steps call `readSemgrepVersion(managedSemgrepPath(home))` before and after installation (lines 355 and 367), omitting the `deps` argument in the declared signature (line 326). Those checks would use the real command runner, so the present, installed, and mismatch cases cannot be simulated as specified. Pass `deps` to both version checks and make the test runner fail on any unexpected real process call.
