import { Context, Effect, Layer, Schema } from 'effect';

import { Projects } from './infra.js';
import {
  loadProjectsConfigSync,
  type ProjectConfig,
  type ProjectsConfig,
} from '../projects.js';

export const ProjectKey = Schema.String.pipe(Schema.brand('ProjectKey'));
export type ProjectKey = typeof ProjectKey.Type;

export const IssueId = Schema.String.pipe(Schema.brand('IssueId'));
export type IssueId = typeof IssueId.Type;

export class ProjectNotFound extends Schema.TaggedErrorClass<ProjectNotFound>()(
  'ProjectNotFound',
  { key: Schema.String },
) {}

export interface ConfigResolverServiceShape {
  readonly getProject: (key: ProjectKey) => Effect.Effect<ProjectConfig, ProjectNotFound>;
  readonly getProjectForIssue: (issueId: IssueId) => Effect.Effect<ProjectConfig, ProjectNotFound>;
  readonly listProjects: () => Effect.Effect<ReadonlyArray<ProjectConfig>>;
}

export class ConfigResolver extends Context.Service<ConfigResolver, ConfigResolverServiceShape>()(
  'overdeck/ConfigResolver',
) {}

export type ProjectsConfigLoader = () => ProjectsConfig;

function issuePrefix(issueId: string): string | null {
  const match = /^([A-Z][A-Z0-9]*)-\d+$/i.exec(issueId.trim());
  return match?.[1]?.toUpperCase() ?? null;
}

function projectMatchesIssue(project: ProjectConfig, issueId: string): boolean {
  if (project.issue_pattern && new RegExp(project.issue_pattern, 'i').test(issueId)) {
    return true;
  }

  const prefix = issuePrefix(issueId);
  if (!prefix) {
    return false;
  }

  const prefixes = [
    project.issue_prefix,
    ...(project.issue_prefixes ?? []),
  ].filter((value): value is string => Boolean(value));

  return prefixes.some((candidate) => candidate.toUpperCase() === prefix);
}

export function makeProjectsLive(load: ProjectsConfigLoader = loadProjectsConfigSync): Layer.Layer<Projects> {
  return Layer.succeed(
    Projects,
    Projects.of({
      list: () => Effect.sync(() => Object.values(load().projects)),
      get: (projectId) => Effect.sync(() => load().projects[projectId] ?? null),
      resolveIssue: (issueId) =>
        Effect.sync(() =>
          Object.values(load().projects).find((project) => projectMatchesIssue(project, issueId)) ?? null,
        ),
    }),
  );
}

export const ProjectsLive = makeProjectsLive();

export const ConfigResolverLive = Layer.effect(
  ConfigResolver,
  Effect.gen(function* () {
    const projects = yield* Projects;

    const getProject = (key: ProjectKey) =>
      Effect.gen(function* () {
        const project = yield* projects.get(key);
        if (!project) {
          return yield* Effect.fail(new ProjectNotFound({ key }));
        }
        return project;
      });

    const getProjectForIssue = (issueId: IssueId) =>
      Effect.gen(function* () {
        const project = yield* projects.resolveIssue(issueId);
        if (!project) {
          return yield* Effect.fail(new ProjectNotFound({ key: issueId }));
        }
        return project;
      });

    return ConfigResolver.of({
      getProject,
      getProjectForIssue,
      listProjects: () => projects.list(),
    });
  }),
);
