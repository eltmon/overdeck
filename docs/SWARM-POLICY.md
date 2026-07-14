# Swarm policy

Automatic swarming is off by default. An explicit `pan swarm <issue>` remains an operator-directed action and is not blocked by the automatic-selection policy.

The policy resolves each field independently in this order: one-run CLI override, issue record override, project override, global configuration, then the built-in default. The fields are `mode` (`off`, `auto`, or `always`), `maxSlots`, and `autoAdvance`.

- Global values are edited under **Settings → Swarming** and stored in `~/.overdeck/config.yaml`.
- Project values are edited in the project's overview settings and stored in `~/.overdeck/projects.yaml`.
- Issue values are edited in Issue Detail and stored in the issue's canonical record on `overdeck-state`.

`off` selects a single work agent for future automatic dispatch. `auto` permits a swarm only when vBRIEF readiness proves the work can be partitioned safely. `always` requires swarm readiness rather than silently falling back. Policy changes never stop or resize an already-running swarm; use the existing freeze, stop, resume, recover, and reset controls for runtime operations.

## Existing controls retained

The policy adds selection controls without replacing the swarm lifecycle. `pan swarm`, `status`, `freeze`, `resume`, `stop`, `recover`, and `reset` retain their existing roles, and active swarms continue through merge, cleanup, and finalization even if the inherited policy later changes to `off`.
