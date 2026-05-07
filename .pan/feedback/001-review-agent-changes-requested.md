# Verdict: CHANGES_REQUESTED

## Summary
PR surfaces Docker service health in the workspace inspector pane: backend probes containers via `docker inspect` and active port checks, frontend chips render ✓/✗/starting icons with an expandable detail panel. Verdict is `changes_requested` because a single Blocker finding forces it: serial `docker inspect` calls on a dashboard-polled endpoint create O(n) latency. Two additional High-priority UI regressions (unknown health shown as green, uptime hidden for healthy containers) and a High-priority command-construction issue (shell-form `execAsync` in probe) should also be fixed before merge.

## Blockers (MUST fix before merge)

### 1. Serial `docker inspect` calls in workspace status hot path — `src/dashboard/server/routes/workspaces.ts:643` — `!`
**Raised by**: performance
**Why it blocks**: Dashboard polls workspace status every few seconds; each poll awaits `docker inspect` serially for every running container. A workspace with 5 containers adds 250 ms–1 s of serial subprocess latency to every request.

Parallelize the health probes inside `getContainerStatusAsync`. Prefer batching into a single `docker inspect <name1> <name2> ...` call and mapping results back by `.Name`, which eliminates both serial wait and repeated spawn overhead:

```typescript
const runningNames = Object.entries(result)
  .filter(([, info]) => info.running)
  .map(([name]) => name);

if (runningNames.length > 0) {
  const { stdout } = await execFileAsync(
    'docker',
    ['inspect', ...runningNames],
    { encoding: 'utf-8', timeout: 10000 }
  );
  const inspects = JSON.parse(stdout);
  // map inspects back to result by .Name
}
```

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. `probeContainerPortAsync` uses `execAsync` with shell-form command — `src/dashboard/server/routes/workspaces.ts:735` — `~`
**Raised by**: correctness, security, performance
**Why it matters**: Spawns an unnecessary host `/bin/sh` wrapper around `docker exec`, adding subprocess overhead and creating a correctness cliff if container-name constraints ever relax. The project already uses `execFileAsync` for all other Docker and `gh` invocations.

Replace `execAsync` with `execFileAsync`, passing the command as an argv array:

```typescript
await execFileAsync(
  'docker',
  ['exec', containerName, 'sh', '-c', probeCmd],
  { encoding: 'utf-8', timeout: 5000 }
);
```

This removes the outer shell layer and keeps the probe aligned with the codebase's safer command-execution pattern.

### 2. Running container with `health: 'unknown'` renders as green/success — `src/dashboard/frontend/src/components/inspector/ContainerSection.tsx:64-71` — `~`
**Raised by**: correctness
**Why it matters**: The `chipStyle` ternary falls through to `'badge-bg-success text-success'` for `serviceHealth === 'unknown'` (and for `undefined`). Users cannot visually distinguish a confirmed-healthy container from one with no health data.

Add an explicit `unknown` branch with a neutral style:

```typescript
serviceHealth === 'healthy' ? 'badge-bg-success text-success' :
serviceHealth === 'unhealthy' ? 'badge-bg-destructive text-destructive' :
serviceHealth === 'starting' ? 'badge-bg-warning text-warning animate-pulse' :
serviceHealth === 'unknown' ? 'bg-card text-muted-foreground' :
'badge-bg-success text-success';
```

### 3. Uptime hidden for containers with known health status — `src/dashboard/frontend/src/components/inspector/ContainerSection.tsx:95` — `~`
**Raised by**: correctness
**Why it matters**: The guard `(serviceHealth === 'unknown' || !serviceHealth)` suppresses uptime for healthy, unhealthy, and starting containers. This removes useful duration information from the majority of running containers.

Show uptime for all running containers:

```typescript
{status.running && status.uptime && (
  <span className="ml-1 text-muted-foreground">{status.uptime}</span>
)}
```

## Nits (advisory — safe to defer)

- `src/dashboard/frontend/src/components/inspector/ContainerSection.test.tsx:98-114` — `?` — Test names claim icon verification but only assert text presence. Add assertions that query the rendered icon (by `aria-label` or `data-testid`) so removing or swapping an icon fails the test. (correctness)
- `src/dashboard/server/routes/workspaces.ts:631` — `?` — `docker ps` filter uses `.includes(search)`, which also matches `span-957` or `pan-9570`. Pre-existing code, unchanged by this PR. Use a stricter prefix or delimiter match if touched. (correctness)
- `src/dashboard/server/routes/workspaces.ts:~643` — `?` — Health state is recomputed on every dashboard poll. A short cache (even 5 s) would reduce `docker inspect` subprocess load ~80% under steady-state viewing. (performance)
- `src/dashboard/frontend/src/components/inspector/ContainerSection.tsx:78-84` — Medium — Hover tooltip omits `lastProbeAt`; it is only visible after clicking to expand the detail panel. The requirements reviewer classifies this as a partial implementation gap, not a blocker, because the data is still accessible via click. Add `lastProbeAt` to the tooltip string to fully satisfy the hover/click requirement. (requirements)

## Cross-cutting groups

**Docker command execution hardening** (fix together):
- [high-1] `probeContainerPortAsync` uses `execAsync` with shell-form command

**ContainerSection chip rendering regressions** (fix together):
- [high-2] Running container with `health: 'unknown'` renders as green/success
- [high-3] Uptime hidden for containers with known health status

## What's good
- Clean separation of health-probe logic between Docker healthcheck, Traefik label parsing, and active port probes.
- Expanded detail panel is well-structured and tested (ports, probe timestamp, failure reason).
- Backend uses proper `execFileAsync` for `docker ps` and `docker inspect`; only the new probe path deviated.

## Review stats
- Blockers: 1   High: 3   Medium: 1   Nits: 4
- By reviewer: correctness=3, security=0 (best-practice only), performance=2, requirements=1
- Files touched: 4   Files with findings: 4

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-957 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
