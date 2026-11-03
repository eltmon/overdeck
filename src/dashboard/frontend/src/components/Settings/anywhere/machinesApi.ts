/**
 * Client for the machine-link routes (PAN-4645 WI-20) and the fleet routes
 * (PAN-4654 WI-9): the same routes `pan machines link|list|unlink|versions|update`
 * call. Every fetcher returns `{ status, body }` (see anywhereApi.ts) so the
 * panel can show the server's error text.
 */
import type { FleetProjectsResponse, FleetUpdateMode, FleetUpdateResponse, FleetVersionsResponse, LinkAccess, MachineLinkView, MachinesResponse } from '@overdeck/contracts';

import { dashboardMutationJsonHeaders } from '../../../lib/wsTransport';
import { apiError, type ApiResult, isOk } from './anywhereApi';

export type {
  FleetComponent,
  FleetProjectRow,
  FleetProjectsResponse,
  FleetUpdateJob,
  FleetUpdateResponse,
  FleetVersionRow,
  FleetVersionsResponse,
  InboundMachineView,
  LinkAccess,
  LinkState,
  LoadSample,
  MachineLinkView,
  MachinesResponse,
  SshLinkInfo,
} from '@overdeck/contracts';

export const MACHINES_QUERY_KEY = ['anywhere-machines'] as const;
export const FLEET_VERSIONS_QUERY_KEY = ['anywhere-fleet-versions'] as const;

/** The server's `error` is a code for the link route; `message` carries the sentence. */
interface LinkErrorBody {
  error?: string;
  message?: string;
  detail?: string;
}

async function readResult<T>(response: Response): Promise<ApiResult<T>> {
  const body = (await response.json().catch(() => null)) as T | { error?: string } | null;
  return { status: response.status, body };
}

export async function fetchMachines(): Promise<ApiResult<MachinesResponse>> {
  return readResult(await fetch('/api/machines'));
}

/** Query function for `['anywhere-machines']`: the machines response, or a thrown error. */
export async function loadMachines(): Promise<MachinesResponse> {
  const result = await fetchMachines();
  if (!isOk(result)) throw new Error(apiError(result));
  return result.body;
}

export interface LinkMachineInput {
  pairingUrl: string;
  bothWays: boolean;
  access: LinkAccess;
}

export async function linkMachine(input: LinkMachineInput): Promise<ApiResult<MachineLinkView>> {
  return readResult(await fetch('/api/machines/link', {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify(input),
  }));
}

export interface AddFlyMachineResponse {
  link: MachineLinkView;
  record: { label: string; appName: string; region: string; docker: boolean };
}

/** PAN-4743: POST /api/machines/fly, the route `pan machines add-fly` calls (3–10 min with a clone). */
export async function addFlyMachine(input: { projectKey?: string; region?: string }): Promise<ApiResult<AddFlyMachineResponse>> {
  return readResult(await fetch('/api/machines/fly', {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify(input),
  }));
}

/** PAN-4905: POST /api/machines/fly/enable-remote sets [remote] enabled = true in config.toml. */
export async function enableRemote(): Promise<ApiResult<{ ok: true; changed: boolean; configFile: string }>> {
  return readResult(await fetch('/api/machines/fly/enable-remote', { method: 'POST', headers: await dashboardMutationJsonHeaders() }));
}

export async function unlinkMachine(id: string): Promise<ApiResult<{ ok: true; peerNotified: boolean }>> {
  return readResult(await fetch(`/api/machines/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: await dashboardMutationJsonHeaders(),
  }));
}

export async function removeInboundMachine(tokenId: string): Promise<ApiResult<{ ok: true }>> {
  return readResult(await fetch(`/api/machines/inbound/${encodeURIComponent(tokenId)}`, {
    method: 'DELETE',
    headers: await dashboardMutationJsonHeaders(),
  }));
}

export async function reconnectMachine(id: string): Promise<ApiResult<{ ok: boolean; link: MachineLinkView }>> {
  return readResult(await fetch(`/api/machines/${encodeURIComponent(id)}/reconnect`, {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: '{}',
  }));
}

/** PAN-4650 D-4: Share my conversations with linked machines (or stop). */
export async function setShareConversations(conversations: boolean): Promise<ApiResult<{ conversations: boolean }>> {
  return readResult(await fetch('/api/machines/sharing', {
    method: 'PUT',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify({ conversations }),
  }));
}

/** PAN-4651 D-4651-13: Combine matching repositories across machines (or stop). */
export async function setCombineRepositories(combineRepositories: boolean): Promise<ApiResult<{ conversations: boolean; combineRepositories: boolean }>> {
  return readResult(await fetch('/api/machines/sharing', {
    method: 'PUT',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify({ combineRepositories }),
  }));
}

export const FLEET_PROJECTS_QUERY_KEY = ['fleet-projects'] as const;

/** Query function for `['fleet-projects']`: projects grouped by git origin across machines. */
export async function loadFleetProjects(): Promise<FleetProjectsResponse> {
  const result = await readResult<FleetProjectsResponse>(await fetch('/api/fleet/projects'));
  if (!isOk(result)) throw new Error(apiError(result));
  const body = result.body as Partial<FleetProjectsResponse> | null;
  return { combine: body?.combine !== false, projects: Array.isArray(body?.projects) ? body.projects : [] };
}

/** PAN-4651 D-4651-14: a project's source facts and copyable ignored files on a linked machine. */
export interface OwnerProjectSource {
  key: string;
  name: string;
  issuePrefix: string | null;
  gitOrigin: string | null;
  cloneUrl: string | null;
  ignoredFiles: Array<{ path: string; bytes: number; preselected: boolean }>;
}

export interface AddProjectJob {
  step: 'clone' | 'files' | 'done' | 'failed';
  error?: string;
  projectKey?: string;
  files?: Array<{ path: string; result: 'written' | 'skipped' | 'failed' }>;
}

export async function loadOwnerProjectSource(machine: string, projectKey: string): Promise<OwnerProjectSource> {
  const params = new URLSearchParams({ machine, projectKey });
  const result = await readResult<OwnerProjectSource>(await fetch(`/api/fleet/projects/source?${params.toString()}`));
  if (!isOk(result)) throw new Error(apiError(result));
  return result.body;
}

/** This machine's source facts for one of its projects (Add there). */
export async function loadLocalProjectSource(projectKey: string): Promise<OwnerProjectSource> {
  const result = await readResult<OwnerProjectSource>(await fetch(`/api/fleet/projects/local-source?projectKey=${encodeURIComponent(projectKey)}`));
  if (!isOk(result)) throw new Error(apiError(result));
  return result.body;
}

/** Add there: clone one of this machine's projects on a linked machine and copy `files`. */
export async function addProjectThere(input: { machine: string; projectKey: string; files: string[] }): Promise<ApiResult<{ jobId: string; machine: string }>> {
  return readResult(await fetch('/api/fleet/projects/add-there', {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify(input),
  }));
}

/** Add here: clone the linked machine's project to this machine and copy `files`. */
export async function addProjectHere(input: { machine: string; projectKey: string; files: string[] }): Promise<ApiResult<{ jobId: string }>> {
  return readResult(await fetch('/api/fleet/projects/add-here', {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify(input),
  }));
}

/** An add job here, or (with `machine`) one running on that linked machine. */
export async function loadAddProjectJob(jobId: string, machine?: string): Promise<AddProjectJob> {
  const query = machine ? `?machine=${encodeURIComponent(machine)}` : '';
  const result = await readResult<AddProjectJob>(await fetch(`/api/fleet/projects/add-jobs/${encodeURIComponent(jobId)}${query}`));
  if (!isOk(result)) throw new Error(apiError(result));
  return result.body;
}

/** PAN-4651 D-4651-20: one config.yaml value as Compare settings shows it. */
export type ResolvedSetting = { value: string } | { secret: true; set: boolean };

export interface SettingsCompare {
  machine: { environmentId: string; label: string };
  dashboardUrl: string | null;
  differences: Array<{ key: string; here: ResolvedSetting | null; there: ResolvedSetting | null; copyLine: string | null }>;
}

export async function loadSettingsCompare(machine: string): Promise<SettingsCompare> {
  const result = await readResult<SettingsCompare>(await fetch(`/api/fleet/settings-compare/${encodeURIComponent(machine)}`));
  if (!isOk(result)) throw new Error(apiError(result));
  return result.body;
}

/** PAN-4650: Hide this machine (or show it again) in the conversation list. */
export async function setMachineHidden(id: string, hidden: boolean): Promise<ApiResult<MachineLinkView>> {
  return readResult(await fetch(`/api/machines/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify({ hidden }),
  }));
}

export async function addMachineRoute(id: string, url: string): Promise<ApiResult<MachineLinkView>> {
  return readResult(await fetch(`/api/machines/${encodeURIComponent(id)}/routes`, {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify({ url }),
  }));
}

const LINK_ERROR_TEXT: Record<string, string> = {
  'bad-pairing-url': 'That is not a pairing link. Paste the link the other machine printed.',
  'unreachable': 'Could not reach the other machine at the pairing address.',
  'pairing-refused': 'The other machine refused the pairing link. It expired or was already used; create a new one there.',
  'unsupported': 'The other machine runs an Overdeck version without machine links. Update it and try again.',
  'identity-mismatch': 'The machine that answered is not the one the pairing link names.',
  'exchange-failed': 'The other machine accepted the channel but the link exchange failed.',
};

/** The sentence to show for a failed link attempt: the server's message, else the code's text, else the status. */
export function linkErrorText(result: ApiResult<unknown>): string {
  const body = result.body as LinkErrorBody | null;
  if (typeof body?.message === 'string' && body.message !== '') return body.message;
  if (typeof body?.error === 'string' && LINK_ERROR_TEXT[body.error]) return LINK_ERROR_TEXT[body.error]!;
  return apiError(result);
}

/** Query function for `['anywhere-fleet-versions']`: the fleet table, or a thrown error. */
export async function loadFleetVersions(): Promise<FleetVersionsResponse> {
  const result = await readResult<FleetVersionsResponse>(await fetch('/api/machines/versions'));
  if (!isOk(result)) throw new Error(apiError(result));
  return result.body;
}

export interface FleetUpdateInput {
  mode?: FleetUpdateMode;
  environmentIds?: string[];
  cancel?: boolean;
}

/** Update all (or the listed machines), Update now, or Cancel. */
export async function updateFleet(input: FleetUpdateInput): Promise<ApiResult<FleetUpdateResponse>> {
  return readResult(await fetch('/api/machines/update', {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify(input),
  }));
}
