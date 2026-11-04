plan-digest: 6aea88e884f5f6e0b0f6e60b9d9ab798a3ff01d040f8a5f8e556cfc501fc1182

## blocks-the-design: Ledger failure admits competing starts

PRD WI-1, lines 240–242, tells `reserveDiskFloor` to ignore all live reservations when `mkdir`, listing, or `withFileLock` fails. At 16 GiB free, six 2 GiB starts can then all pass the independent `available - bytes >= 10 GiB` check, reproducing the reported exhaustion. The existing `checkDiskFloor` in `src/lib/disk-floor.ts:18-31` has no reservation state to recover this. Refuse new disk-heavy phases when the ledger cannot be read or locked; retain the fail-open behavior only for the separately documented `statfs` failure if that policy is intentional. Add a ledger-failure test with concurrent callers.

## blocks-the-design: Containerize route bypasses the planned gate

PRD WI-5, lines 439–455, changes only `WorkspaceService.containerize` at `src/dashboard/server/services/workspace-service.ts:285-343`. The actual `POST /api/workspaces/:issueId/containerize` route in `src/dashboard/server/routes/workspaces/container-ops.ts:59-64,115-149` never calls that service; it spawns `./new-feature`, then `./dev all` to start containers. Thus the planned check will not run for this endpoint, and concurrent requests can start stacks without any reservation. Apply stack-cost admission to the route's real Docker launch path, holding its reservation until the child exits, or route the operation through a shared guarded service. Also use a reservation in the service method if it remains callable; its proposed plain check alone does not count concurrent work.

## blocks-the-design: Live reservations expire mid-install

PRD FR-3 and WI-1, lines 157–158 and 233–238, delete a reservation after two hours even when its PID is alive. `src/lib/workspace-manager/create.ts:471-475` explicitly gives a dependency install no timeout, so an active install can outlive the lease. Later starts then subtract zero for a phase still writing. Reclaim dead-PID entries, but retain live-PID reservations until release, or add a renewable lease whose heartbeat cannot expire while the phase runs. Test an old reservation with a live PID.

## blocks-the-design: Unmeasured project cost has no safe bound

PRD WI-2, lines 318–325, substitutes the machine's 2 GiB stack seed when a project has no finished sibling; lines 300–316 similarly seed host cost at 0.5 GiB. Those numbers come from one Overdeck measurement, while `src/lib/projects.ts:436-458` supports other projects with different workspace costs. For a first stack that needs 5 GiB, 13 GiB free passes the 2 GiB reservation and the plain pre-compose check, then falls below the 10 GiB floor. Specify a verified per-project bound for unmeasurable components, or hold creation until the cost can be bounded. Test the no-sibling case with an actual cost above the seed.

## blocks-the-design: Per-repo installs skip later checks

PRD WI-3, lines 377–389, puts one floor re-check before the polyrepo install loop. `src/lib/workspace-manager/create.ts:489-500` can run several independent package installs; after the first consumes space, the next starts without a fresh check. Move the re-check immediately before each per-repo `execAsync` and test a refusal between two repos.

## blocks-the-design: HTTP hold uses a different workspace path

PRD WI-6, lines 476–490, passes the route's `workspacePath` into `resolveStackDiskHold`. `src/dashboard/server/routes/agents/spawn-issue.ts:330` hardcodes `workspaces`, while `src/lib/workspace/rebuild-stack.ts:159-163` uses configured `workspace.workspaces_dir`. For a custom directory, `previewDiskFloor` reads a nonexistent path and fails open, then the real rebuild may refuse under the ledger and the route returns its generic 422 stack-health response instead of FR-9's 507 `diskLow`. Derive the HTTP preview path from the same configured workspace resolver used by the rebuild, and test a custom directory.

## blocks-the-design: Shell command embeds project paths

PRD WI-2, lines 309–315, builds `find "<dir>" ... | awk ...` through `shell(command)`. A project path containing a double quote, command substitution, or a shell metacharacter can change what executes; the path is configuration data (`src/lib/workspace-config.ts:263-272`). Run `find` with `execFile` argument vectors and sum its block output in JavaScript, or use filesystem APIs. Test a path containing shell syntax without executing it.
