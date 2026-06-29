import { getMergeBackendStatus, type MergeBackendStatus } from '../../lib/github-app.js';

export function formatMergeBackendStatus(status: MergeBackendStatus): string {
  if (status.available) {
    return `Merge backend: ${status.mode} (${status.detail})`;
  }
  return `Merge backend: UNAVAILABLE - ${status.detail}`;
}

export async function loadMergeBackendStatusForCli(): Promise<MergeBackendStatus> {
  try {
    return await getMergeBackendStatus();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      available: false,
      mode: 'none',
      detail: `Unable to determine merge backend: ${message}`,
    };
  }
}
