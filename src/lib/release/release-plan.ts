import type { ReleaseComponentConfig, ReleaseConfig } from '../projects.js';

export interface ReleaseComponentPlanEntry {
  component: string;
  config: ReleaseComponentConfig;
  dependsOn: string[];
  releaseOrder: number;
  notes: string[];
}

export function resolveReleasePlan(release: ReleaseConfig): ReleaseComponentPlanEntry[] {
  const components = release.components ?? {};
  const activeComponentNames = Object.keys(components).filter((name) => components[name]?.trigger !== 'skip');
  const activeComponents = new Set(activeComponentNames);
  const dependencyNotes = new Map<string, string[]>();

  const activeDependencies = new Map<string, string[]>();
  for (const name of activeComponentNames) {
    const dependencies = components[name]?.depends_on ?? [];
    const active = dependencies.filter((dependency) => {
      if (activeComponents.has(dependency)) return true;
      const reason = components[dependency]?.trigger === 'skip' ? 'skipped' : 'absent';
      const notes = dependencyNotes.get(name) ?? [];
      notes.push(`Dependency "${dependency}" is ${reason}; treated as satisfied.`);
      dependencyNotes.set(name, notes);
      return false;
    });
    activeDependencies.set(name, active);
  }

  const sorted: string[] = [];
  const visitState = new Map<string, 'visiting' | 'visited'>();
  const stack: string[] = [];

  const visit = (name: string): void => {
    const state = visitState.get(name);
    if (state === 'visited') return;
    if (state === 'visiting') {
      const cycleStart = stack.indexOf(name);
      const cycle = [...stack.slice(cycleStart), name];
      throw new Error(`Release dependency cycle detected: ${cycle.join(' -> ')}`);
    }

    visitState.set(name, 'visiting');
    stack.push(name);
    for (const dependency of activeDependencies.get(name) ?? []) {
      visit(dependency);
    }
    stack.pop();
    visitState.set(name, 'visited');
    sorted.push(name);
  };

  for (const name of activeComponentNames) {
    visit(name);
  }

  return sorted.map((component, releaseOrder) => ({
    component,
    config: components[component],
    dependsOn: activeDependencies.get(component) ?? [],
    releaseOrder,
    notes: dependencyNotes.get(component) ?? [],
  }));
}
