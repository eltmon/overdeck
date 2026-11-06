plan-digest: 91ff4c0b582e72df855d2e477b65c22356cb47e12bdc4610d9223d83e042349f

## blocks-the-design: reservation ends before the lane writes

The PRD's WI-2/WI-3 release the lease in `withProjectLock(...).finally(...)`, but `src/lib/lanes/launch.ts:667-674` and `src/lib/lanes/owner-launch.ts:265-272` start the runtime without awaiting its work. The estimate explicitly includes an install (`src/lib/workspace/disk-cost.ts:4-8`), which the gauntlet skill requires inside the lane rather than the primary checkout (`sync-sources/skills/pan-gauntlet-loop/SKILL.md:288-296`). Several launches can therefore release their leases after small checkouts, all pass the next admission, and install dependencies concurrently until the floor is breached. Specify a lease lifetime that covers the installation (or the lane's work until report/stop/reap), and test overlapping launches while the first lane is still writing.

## blocks-the-design: workspace estimate can omit lane dependencies

WI-1 uses `estimateWorkspaceDiskCost(project).hostBytes` as the lane cost. `src/lib/workspace/disk-cost.ts:148-172,201-223` only looks for `node_modules` in a finished `feature-*` workspace or the primary checkout; `sumUnsharedBytes` treats a missing directory as zero (`:108-145`). A gauntlet project with neither can reserve only tracked bytes, while each new lane installs its own dependencies. This defeats the proposed per-lane margin even if lease lifetime is fixed. Add a lane-aware measurement from existing lane worktrees or a conservative fallback when no installed workspace sample exists, and test that case.

## blocks-the-design: disk-check can inspect the wrong filesystem

FR-9/WI-8 say `pan lane disk-check --project` checks `config.projectPath` if the lanes root is absent. `src/lib/lanes/config.ts:30-35` permits a separate lanes root; `src/lib/lanes/launch.ts:243-259` creates it before the actual launch admission. If a configured lanes root is under a different mounted filesystem and does not exist yet, the mandatory preflight can return exit 0 using the project's free space while the destination has less than 10 GiB. Resolve the nearest existing ancestor of `config.lanesRoot` for the preview, or create and validate the lanes root before checking it; test separate filesystems or injected path-dependent free-space reads.

## sharpens-framing: force test contradicts the CPU rule

PRD WI-2 line 300 and draft `home-door-disk.ac2` require `cpuPressure` to be called with `force: true`. The current door deliberately skips that call (`src/lib/lanes/launch.ts:440-451`), and FR-4 says force continues to bypass the CPU check. Change that acceptance criterion to assert that disk admission still runs while `cpuPressure` is not called.

## sharpens-framing: reapable does not guarantee a successful reap

FR-6 and the proposed `--reapable` help text define the flag as a lane `pan lane reap` can remove now. The proposed pure rule sees only activity and reports, while `src/lib/lanes/reap.ts:138-153,177-182` also refuses processes in the directory, dirty trees without `--park`, and worktree removal failures. Define the flag as a superseded, inactive candidate, and make the skill handle ordinary reap refusals; or include the missing checks before claiming immediate removability.

## sharpens-framing: wait hint can delay a completed report

WI-7 awaits a best-effort `GET /api/lanes` before printing the existing report status. The shared `api` helper uses a 120-second timeout (`src/cli/commands/lane.ts:123-133`), so an unresponsive dashboard can delay a completed `pan lane wait` by two minutes despite the plan's promise that failed reads print nothing. Give this optional hint a short timeout, or print the report first and fetch the hint separately, then test the timeout path.
