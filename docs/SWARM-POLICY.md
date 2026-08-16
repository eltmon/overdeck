# Swarm policy

Automatic swarming is off by default. An explicit `pan swarm <issue>` remains operator-directed and works for an eligible plan regardless of the inherited automatic-selection mode.

Each field resolves independently in this order: one-run CLI override, issue record, project, global configuration, then built-in default. The fields are `mode`, `maxSlots`, and `autoAdvance`.

- Global values are under **Settings → Swarming** in `~/.overdeck/config.yaml`.
- Project values are in the project's **HOME → Project settings** panel and `~/.overdeck/projects.yaml`.
- Issue values are in Issue Detail and the canonical issue record on `overdeck-state`.

`off` selects serial work and prevents automatic foreman creation. `auto` lets the Deacon janitor create a foreman when xBRIEF readiness proves at least one safe slot candidate. `always` requires swarm readiness instead of silently falling back to serial execution. None of these modes authorizes the Deacon to dispatch a slot; the foreman runs `pan swarm dispatch`.

`maxSlots` caps slot indices available to the dispatch gate. `autoAdvance` controls foreman pacing: `true` allows the next wave after integration checks, while `false` requires operator acknowledgement between waves.

Policy changes do not stop running agents. Use `freeze`, `stop`, `resume`, `recover`, or `reset` for runtime control. A later change to `off` prevents foreman revival, but the janitor can still classify events and garbage-collect completed slot resources.
