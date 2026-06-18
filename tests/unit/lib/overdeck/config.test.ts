import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';

import {
  ConfigResolver,
  ConfigResolverLive,
  makeProjectsLive,
  ProjectNotFound,
  type IssueId,
  type ProjectKey,
} from '../../../../src/lib/overdeck/config.js';
import { Projects } from '../../../../src/lib/overdeck/infra.js';
import type { ProjectsConfig } from '../../../../src/lib/projects.js';

const fixtureProjects: ProjectsConfig = {
  projects: {
    panopticon: {
      name: 'Overdeck',
      path: '/repo/panopticon',
      issue_prefix: 'PAN',
      github_repo: 'eltmon/overdeck',
    },
    auricle: {
      name: 'Auricle',
      path: '/repo/auricle',
      issue_prefixes: ['AUR', 'AURX'],
    },
  },
};

function fixtureProjectsLive() {
  return makeProjectsLive(() => fixtureProjects);
}

describe('overdeck Config resolver', () => {
  it('resolves a project from an issue id through projects.yaml data without Db', async () => {
    const project = await Effect.runPromise(
      Effect.gen(function* () {
        const resolver = yield* ConfigResolver;
        return yield* resolver.getProjectForIssue('PAN-1938' as IssueId);
      }).pipe(
        Effect.provide(ConfigResolverLive),
        Effect.provide(fixtureProjectsLive()),
      ),
    );

    expect(project).toMatchObject({
      name: 'Overdeck',
      path: '/repo/panopticon',
      issue_prefix: 'PAN',
    });
  });

  it('lists and gets projects through ConfigResolver', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const resolver = yield* ConfigResolver;
        const list = yield* resolver.listProjects();
        const auricle = yield* resolver.getProject('auricle' as ProjectKey);
        return { list, auricle };
      }).pipe(
        Effect.provide(ConfigResolverLive),
        Effect.provide(fixtureProjectsLive()),
      ),
    );

    expect(result.list.map((project) => project.name).sort()).toEqual(['Auricle', 'Overdeck']);
    expect(result.auricle.issue_prefixes).toEqual(['AUR', 'AURX']);
  });

  it('provides the Projects Tag consumed by later domain Lives', async () => {
    const project = await Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* Projects;
        return yield* projects.resolveIssue('AURX-12');
      }).pipe(Effect.provide(fixtureProjectsLive())),
    );

    expect(project?.name).toBe('Auricle');
  });

  it('fails with ProjectNotFound for unknown issue ids', async () => {
    const failure = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const resolver = yield* ConfigResolver;
        return yield* resolver.getProjectForIssue('NOPE-1' as IssueId);
      }).pipe(
        Effect.provide(ConfigResolverLive),
        Effect.provide(fixtureProjectsLive()),
      ),
    );

    expect(failure._tag).toBe('Failure');
    if (failure._tag === 'Failure') {
      expect(String(failure.cause)).toContain(ProjectNotFound.name);
    }
  });
});
