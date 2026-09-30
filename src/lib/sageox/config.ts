/**
 * Per-project SageOx upload flag (PAN-2444 D14): `sageox_upload: enabled |
 * disabled` in `projects.yaml`. Unset or any other value reads as disabled.
 * Typed here with a local project type (the skill-overrides store pattern)
 * because `projects.ts` is above the file-size ceiling.
 */
import { listProjectsAsync, updateProjectsConfigAsync, type ProjectConfig } from '../projects.js';

type ProjectWithSageox = ProjectConfig & { sageox_upload?: 'enabled' | 'disabled' };

export class SageoxConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SageoxConfigError';
  }
}

const uploadEnabled = (project: ProjectWithSageox | undefined): boolean => project?.sageox_upload === 'enabled';

/** Upload flag for every registered project, in registration order. */
export async function listSageoxUploads(): Promise<Array<{ projectKey: string; upload: boolean }>> {
  return (await listProjectsAsync()).map(({ key, config }) => ({
    projectKey: key,
    upload: uploadEnabled(config as ProjectWithSageox),
  }));
}

export async function readSageoxUpload(projectKey: string): Promise<boolean> {
  const match = (await listProjectsAsync()).find(project => project.key === projectKey);
  return uploadEnabled(match?.config as ProjectWithSageox | undefined);
}

/** Writes `sageox_upload`; throws SageoxConfigError for an unknown project. */
export async function setSageoxUpload(projectKey: string, enabled: boolean): Promise<{ changed: boolean }> {
  const value = enabled ? 'enabled' : 'disabled';
  return updateProjectsConfigAsync<{ changed: boolean }>(config => {
    const current = config.projects[projectKey] as ProjectWithSageox | undefined;
    if (!current) throw new SageoxConfigError(`unknown project: ${projectKey}`);
    if (current.sageox_upload === value) return { config, result: { changed: false }, changed: false };
    current.sageox_upload = value;
    return { config, result: { changed: true }, changed: true };
  });
}
