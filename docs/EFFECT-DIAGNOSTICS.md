# Effect diagnostics

## Purpose

`@effect/language-service` provides Effect-aware TypeScript diagnostics that stock
TypeScript cannot produce. The `lint:effect-diagnostics` ratchet makes those
diagnostics a required CI and agent feedback gate, so constructed-but-unrun Effects
and related Effect mistakes are visible without relying on reviewer attention.

PAN-3567 is the motivating bug class: a floating Effect can make a side effect look
implemented while nothing actually runs.

## Diagnostic lanes

The ratchet runs these configuration variants:

- `tsconfig.effect-diag.json`
- `src/dashboard/server/tsconfig.effect-diag.json`
- `packages/contracts/tsconfig.effect-diag.json`
- `packages/effect-acp/tsconfig.effect-diag.json`

Each variant extends the sibling production tsconfig and only adds the
`@effect/language-service` plugin. Production tsconfigs intentionally remain
plugin-free: ordinary `npm run typecheck`, the dashboard type ratchets, and other
existing gates keep their established output and ownership. The variants inherit the
same include and exclude rules, so a diagnostic lane checks the same files as its
base configuration.

## Patching TypeScript

Stock `tsc` ignores language-service plugins. `effect-language-service patch` updates
the local TypeScript install so the diagnostic variants produce plugin findings.
`prepare` runs the patch during installation, and
`scripts/lint-effect-diagnostics.sh` runs it unconditionally before every lane. The
command is idempotent, which makes the ratchet independent of package-manager
lifecycle behavior.

The patch is build-isolation checked: `npm run build` must produce the same emitted
content before and after patching. If that check ever fails, do not weaken the gate or
patch production TypeScript. Instead, install TypeScript and
`@effect/language-service` under `scripts/effect-diag/`, patch that isolated install,
and run its `tsc` from the ratchet. Record the isolated install step here when that
fallback is adopted.

## Finding format and filtering

A plugin finding ends with this marker:

```text
file(line,col): <category> TS<ruleCode>: <message>    effect(<ruleName>)
```

The ratchet matches the trailing `effect(<ruleName>)` marker, not a severity label or
numeric diagnostic code. Numeric codes are unsafe: `floatingEffect` renders as
`error TS3`, which collides with ordinary TypeScript diagnostic codes. Plain
TypeScript errors still belong to their owning typecheck gates and do not count as
Effect-ratchet findings.

## Ratchet operations

Run the gate directly with:

```bash
npm run lint:effect-diagnostics
```

A `NEW:` line is a finding introduced by the branch and must be fixed before the
change can pass. A `known:` line is already in
`scripts/effect-diagnostics-baseline.txt`; it is pre-existing debt and is not the
author's responsibility.

After fixing findings, lower the baseline with:

```bash
bash scripts/lint-effect-diagnostics.sh --update
```

`--update` only lowers an existing baseline. The first invocation initializes a
missing baseline from the current findings. `scripts/lint-ratchet-audit.sh` requires
an issue reference in a commit message for any later baseline increase, while
shrinking the baseline and editing its comment headers are free.

## Local escape hatches

Use an inline suppression only when the diagnosis is intentionally accepted and a
narrower code change cannot express that decision:

```ts
// @effect-diagnostics effect/<rule>:off # PAN-1234
```

Every suppression must carry a trailing issue reference. The issue records why the
rule is disabled and owns removing the escape hatch later.

## Future work

When a rule's baseline slice reaches zero, its severity can be promoted to a hard
error deliberately and per rule. Do not promote all rules at once: existing baseline
findings are intentionally ratcheted down incrementally.

`@effect/tsgo` is the successor path, but it requires TypeScript 7. Revisit that
migration when the repository upgrades TypeScript; it is not part of this gate.

## Scope

This is development-repository tooling, so it has no Mintlify product documentation
page.
