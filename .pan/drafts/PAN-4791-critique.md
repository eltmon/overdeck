plan-digest: cb3a2882ca3befd66bc35a802c3f066a61ac68dfa533facb332bc02c91e3e0bb

## blocks-the-design: Started is not the rollback boundary

PRD WI-1 lines 75–79 and FR-1 line 42 disagree: FR-1 correctly names the point where `createVm` resolves, but the prescribed text promises cleanup after the machine reaches `started`. In [fly-provider.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4791/src/lib/remote/fly-provider.ts), lines 271–285, `createVm` still calls `getMachine` after the wait succeeds. If that call fails, the machine has reached `started` but `createVm` rejects. [remote-workspace.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4791/src/lib/remote-workspace.ts), lines 165–169, enters the rollback block only after `createVm` resolves. Change both proposed doc passages to say cleanup applies to failures in setup after `createVm` returns successfully, rather than to every failure after `started`.

## blocks-the-design: Startup recovery command requires missing metadata

PRD WI-1 line 78 tells operators to run `pan workspace start <issue>` after a startup-wait failure. [remote-workspace.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4791/src/lib/remote-workspace.ts), lines 165 and 267–284, saves metadata only after `createVm` and the remaining setup succeed. [workspace-remote.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4791/src/cli/commands/workspace-remote.ts), lines 123–136, refuses `start` when that metadata is absent. [fly-provider.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4791/src/lib/remote/fly-provider.ts), lines 188–195 and 239–244, already adopts and starts a leftover machine on a new creation attempt. Replace the unusable `pan workspace start` instruction with `pan workspace create --remote <issue>` once the machine can start, or give the direct `fly machines start` command for manual recovery.

## blocks-the-design: Durable volume deletion is not guaranteed

PRD WI-1 line 76 newly promises deletion of the durable volume before reporting a post-creation error. [fly-provider.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4791/src/lib/remote/fly-provider.ts), lines 293–316, catches and discards failures from both `listVolumes` and `deleteVolume`; [remote-workspace.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4791/src/lib/remote-workspace.ts), lines 77–79, then reports the original error as though rollback succeeded. This leaves a billable volume while the new doc says it was deleted. Since changing `deleteVm` is explicitly out of scope, say that rollback attempts to remove the durable volume and add a volume-list check to the troubleshooting text when creation fails.

## sharpens-framing: Zero-match grep has a failing status

The xBRIEF's `wi1-docs` verification command and PRD AC-1 line 132 use `grep -c "120 s\|120 seconds"` and expect `0`. I reproduced the no-match case with `printf '' | grep -c '120 s\|120 seconds'`: it printed `0` and exited `1`. A command gate that treats nonzero exit as failure would reject the correct document. Use `! grep -Eq '120 s|120 seconds' docs/fly-provider.md` for an exit-status check, or explicitly handle grep's status `1` as success.
