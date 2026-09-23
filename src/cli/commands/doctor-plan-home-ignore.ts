/**
 * `pan doctor` row: registered plan homes that git-ignore `.pan/` (PAN-3996).
 *
 * Pre-Cut tooling wrote `.pan/` into project `.gitignore` files. Planning
 * artifacts now live under `.pan/` in the plan home and are committed, so that
 * rule makes every planning commit there fail. This row names each affected
 * plan home with the rule's `file:line` and the repair. Doctor has no `--fix`,
 * so it only reports: `pan admin migrate-plan-home <key> --repair-ignore`
 * removes Overdeck's legacy line and commits `.gitignore` alone, without the
 * migration or a tracker lookup; any other rule is the operator's.
 *
 * Every input is injectable (the doctor-inotify pattern).
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { listProjectsSync } from '../../lib/projects.js';
import { detectPanIgnore, describePanIgnore, type PanIgnoreStatus } from '../../lib/pan-dir/legacy-pan-ignore.js';
import { resolvePlanHome } from '../../lib/pan-dir/paths.js';

// Structurally identical to doctor.ts's CheckResult; re-declared (like
// doctor-inotify.ts) because importing it would create a module cycle.
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export const PLAN_HOME_IGNORE_ROW = 'Plan home .pan/ tracking';

export interface PlanHomeIgnoreDoctorDeps {
  projects: () => ReadonlyArray<{ key: string; config: { path: string } }>;
  resolvePlanHome: (projectPath: string) => string;
  detect: (planHome: string) => Promise<PanIgnoreStatus>;
}

const defaultDeps: PlanHomeIgnoreDoctorDeps = {
  projects: listProjectsSync,
  resolvePlanHome,
  detect: detectPanIgnore,
};

export async function checkPlanHomePanIgnore(partial: Partial<PlanHomeIgnoreDoctorDeps> = {}): Promise<CheckResult> {
  const deps = { ...defaultDeps, ...partial };
  const problems: string[] = [];
  const fixes: string[] = [];
  const seen = new Set<string>();
  let checked = 0;

  for (const { key, config } of deps.projects()) {
    let planHome: string;
    try {
      planHome = resolve(deps.resolvePlanHome(config.path));
    } catch {
      continue; // unresolvable plan home: other rows report broken registrations
    }
    if (seen.has(planHome) || !existsSync(planHome)) continue;
    seen.add(planHome);

    let status: PanIgnoreStatus;
    try {
      status = await deps.detect(planHome);
    } catch (error) {
      problems.push(`${key} (could not check: ${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    if (status.kind === 'not-a-repo') continue;
    checked += 1;
    if (status.kind === 'not-ignored') continue;

    problems.push(`${key} (${describePanIgnore(status)})`);
    fixes.push(status.kind === 'legacy'
      ? `${key}: pan admin migrate-plan-home ${key} --repair-ignore — removes Overdeck's legacy line `
        + `${status.source}:${status.line} and commits .gitignore alone (or delete that line and commit it yourself)`
      : `${key}: ${describePanIgnore(status)} is not Overdeck's legacy line — remove or narrow it yourself`);
  }

  if (problems.length === 0) {
    return {
      name: PLAN_HOME_IGNORE_ROW,
      status: 'ok',
      message: `.pan/ is committable in ${checked} plan home${checked === 1 ? '' : 's'}`,
    };
  }
  return {
    name: PLAN_HOME_IGNORE_ROW,
    status: 'warn',
    message: `${problems.length} plan home${problems.length === 1 ? '' : 's'} ignore .pan/, `
      + `so planning artifacts cannot be committed: ${problems.join('; ')}`,
    fix: fixes.length > 0 ? fixes.join('\n  ') : undefined,
  };
}
