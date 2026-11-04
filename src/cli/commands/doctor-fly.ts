// Structurally identical to doctor.ts's CheckResult; re-declared (like
// doctor-ollama.ts) because importing it would create a module cycle.
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}
import { listFlyMachines } from '../../lib/anywhere/fly/machine-store.js';
import { loadConfig, type RemoteConfig } from '../../lib/config.js';
import {
  createFlyApiClient,
  FLY_TOKEN_FIX,
  FlyApiError,
  isFlyAuthError,
  type FlyApiClient,
} from '../../lib/remote/fly-api.js';

const DEFAULT_APP = 'pan-workspaces';

export interface CheckFlyTokenOptions {
  loadRemote?: () => Promise<RemoteConfig | undefined>;
  hasRecords?: () => Promise<boolean>;
  loadApi?: (remote: RemoteConfig | undefined) => Promise<Pick<FlyApiClient, 'listMachines' | 'tokenOrigin'>>;
}

const defaultLoadRemote = async (): Promise<RemoteConfig | undefined> => (await loadConfig()).remote;
const defaultHasRecords = async (): Promise<boolean> => (await listFlyMachines()).length > 0;
const defaultLoadApi = async (remote: RemoteConfig | undefined): Promise<FlyApiClient> =>
  createFlyApiClient(process.env[remote?.fly?.api_token_env ?? 'FLY_API_TOKEN']);

/**
 * `pan doctor`'s `Fly token` row (PAN-4748): silent unless `remote.enabled` is
 * true or a Fly machine record already exists, since an extra row on a host
 * that never touches Fly costs attention for nothing. The probe is a single
 * read-only `listMachines` call — never `ensureApp`, which would create the
 * app on a 404 as a side effect of a diagnostic question.
 */
export async function checkFlyToken(options: CheckFlyTokenOptions = {}): Promise<CheckResult[]> {
  const loadRemote = options.loadRemote ?? defaultLoadRemote;
  const hasRecords = options.hasRecords ?? defaultHasRecords;
  const loadApi = options.loadApi ?? defaultLoadApi;

  const remote = await loadRemote();
  if (remote?.enabled !== true && !(await hasRecords())) return [];

  const app = remote?.fly?.app ?? DEFAULT_APP;

  let api: Pick<FlyApiClient, 'listMachines' | 'tokenOrigin'>;
  try {
    api = await loadApi(remote);
  } catch {
    return [{ name: 'Fly token', status: 'error', message: 'No Fly API token', fix: FLY_TOKEN_FIX }];
  }

  const origin = api.tokenOrigin === 'explicit'
    ? (remote?.fly?.api_token_env ?? 'FLY_API_TOKEN')
    : '~/.fly/config.yml via flyctl';

  try {
    await api.listMachines(app);
    return [{ name: 'Fly token', status: 'ok', message: `Accepted (${origin})` }];
  } catch (error) {
    if (error instanceof FlyApiError && error.statusCode === 404) {
      return [{ name: 'Fly token', status: 'ok', message: `Accepted (${origin}); app ${app} does not exist yet` }];
    }
    if (isFlyAuthError(error)) {
      return [{ name: 'Fly token', status: 'error', message: `Rejected (${error.statusCode}, ${origin})`, fix: FLY_TOKEN_FIX }];
    }
    return [{ name: 'Fly token', status: 'warn', message: `Could not check: ${(error as Error).message}` }];
  }
}
