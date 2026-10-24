plan-digest: a278f841474e9720ca44056a338bd5a5a86a165620bf2244b2c6f0f6164e19df

## blocks-the-design: A foreign launcher passes the managed install check

PRD WI-3, lines 365–371, runs `~/.overdeck/bin/semgrep --version` and returns `present` on a pin match **before** checking whether that path is the managed symlink. A regular file or foreign symlink that prints `1.180.0` is therefore executed and accepted as Overdeck-managed. WI-5, lines 466–473, also treats its version alone as proof of installation; WI-6, lines 515–536, proposes the same probe for `pan doctor`. This defeats the managed-install boundary in FR-2 and the promise that Overdeck uses its own Semgrep. Move launcher ownership inspection before the first version execution, reuse an ownership-aware probe in the prereq and doctor checks, and add a test where a foreign launcher reports the pinned version.

## blocks-the-design: The CLI config imports collide

PRD WI-4, lines 429–455, instructs both CLI files to import `loadConfigSync` from `../../lib/config-yaml.js`. They already import `loadConfigSync` from `../../lib/config.js` at `src/cli/commands/sync.ts:7` and `src/cli/commands/install.ts:20`. The former returns YAML `{ config }` (`src/lib/config-yaml/load.ts:334–347`); the latter returns the legacy TOML `OverdeckConfig` (`src/lib/config.ts:323–333`). Adding the prescribed imports verbatim creates a duplicate binding, while using the existing binding cannot evaluate `.config.security.semgrep.enabled`. Alias the new import in both files, as `doctor.ts` already does with `loadYamlConfig` (`src/cli/commands/doctor.ts:37`), and use that alias in every Semgrep guard.
