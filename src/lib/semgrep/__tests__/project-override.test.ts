import { describe, expect, it } from 'vitest';
import type { ProjectConfig, ProjectsConfig } from '../../projects.js';
import { applyProjectSastOverride, projectSastView } from '../project-override.js';

function configWith(project: Partial<ProjectConfig>): ProjectsConfig {
  return { projects: { demo: { name: 'demo', path: '/repo', ...project } as ProjectConfig } };
}

describe('project sast override (PAN-4594)', () => {
  it('sets verification.sast and keeps verification.tests', () => {
    const config = configWith({ verification: { tests: 'ci' } });
    const mutation = applyProjectSastOverride(config, 'demo', 'blocking');
    expect(mutation.changed).toBe(true);
    expect(mutation.config.projects.demo!.verification).toEqual({ tests: 'ci', sast: 'blocking' });
  });

  it('null removes only sast', () => {
    const config = configWith({ verification: { tests: 'ci', sast: 'off' } });
    const mutation = applyProjectSastOverride(config, 'demo', null);
    expect(mutation.changed).toBe(true);
    expect(mutation.config.projects.demo!.verification).toEqual({ tests: 'ci' });
  });

  it('null removes an emptied verification block', () => {
    const config = configWith({ verification: { sast: 'off' } });
    const mutation = applyProjectSastOverride(config, 'demo', null);
    expect(mutation.changed).toBe(true);
    expect(mutation.config.projects.demo!.verification).toBeUndefined();
  });

  it('unknown project throws', () => {
    const config = configWith({});
    expect(() => applyProjectSastOverride(config, 'nope', 'blocking')).toThrow('Unknown project: nope');
  });

  it('view reports Semgrep off globally', () => {
    const project: ProjectConfig = { name: 'demo', path: '/repo' };
    const view = projectSastView(project, { enabled: false, gate: 'advisory' });
    expect(view).toEqual({ value: null, effective: 'off', reason: 'security.semgrep.enabled is false', semgrepEnabled: false });
  });

  it('view uses the override over the global gate', () => {
    const project: ProjectConfig = { name: 'demo', path: '/repo', verification: { sast: 'blocking' } };
    const view = projectSastView(project, { enabled: true, gate: 'advisory' });
    expect(view.effective).toBe('blocking');
    expect(view.value).toBe('blocking');
  });
});
