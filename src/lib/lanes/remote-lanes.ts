/**
 * Remote lane stand-ins (.pan/drafts/PAN-4638.md WI-1, D-4638-4, NFR-1, NFR-3).
 *
 * A lane that runs on another machine (the owner) has no row in home's
 * `conversations` table (epic D-5). Home keeps `~/.overdeck/remote-lanes/<name>/`:
 *
 * - `lane.json` — the launch facts, written once by the launch (`wx`);
 * - `mirror.json` — the follower's copy of the owner's state, written only by the follower;
 * - `archived.json` — `{ v: 1, at }`, written once by reap (`wx`).
 *
 * Reports are mirrored to `~/.overdeck/agents/conv-<name>/reports/`, so every
 * existing report reader works unchanged. The stand-in is kept after reap,
 * because D7 iteration counts archived lanes.
 *
 * A local critic or verifier of a remote builder cannot carry the critic FK, so
 * its link lives in `~/.overdeck/agents/conv-<critic>/lane-link.json` (D-4638-7).
 *
 * Every file is mode 0600. Rewritable files go through a temp file + rename.
 */
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { LaneActivity } from '@overdeck/contracts';

import type { LaneRole } from '../overdeck/conversations.js';
import { getOverdeckHome } from '../paths.js';
import type { LaneGitFacts } from './types.js';

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface RemoteLaneFacts {
  v: 1;
  name: string;
  environmentId: string;
  label: string;
  run: string;
  key: string;
  role: LaneRole;
  iteration: number;
  parentName: string;
  criticOfName: string | null;
  projectKey: string;
  cwd: string;
  branch: string | null;
  at: string | null;
  model: string;
  harness: string;
  effort: string | null;
  title: string;
  createdAt: string;
}

export interface RemoteLaneMirror {
  v: 1;
  state: 'running' | 'gone';
  activity: LaneActivity;
  lastActivityAt: string | null;
  git: LaneGitFacts | null;
  costUsd: number | null;
  ownerArchived: boolean;
  /** The highest owner report `seq` mirrored into `agents/conv-<name>/reports/`. */
  lastSeq: number;
  lastSeenAt: string | null;
  /** Set while the owner cannot be reached. */
  unreachableSince: string | null;
  lastAssistantMessage: string | null;
  spawnError: string | null;
}

export interface RemoteLane {
  facts: RemoteLaneFacts;
  mirror: RemoteLaneMirror | null;
  archivedAt: string | null;
}

export interface RemoteLaneFilter {
  run?: string;
  key?: string;
  role?: LaneRole;
  parentName?: string;
}

/** `~/.overdeck/remote-lanes`, read per call so a test's OVERDECK_HOME applies. */
export function remoteLanesRoot(): string {
  return join(getOverdeckHome(), 'remote-lanes');
}

function checkedName(name: string): string {
  if (!NAME_PATTERN.test(name)) throw new Error(`invalid lane name ${JSON.stringify(name)}`);
  return name;
}

function laneDir(name: string): string {
  return join(remoteLanesRoot(), checkedName(name));
}

function criticLinkPath(criticName: string): string {
  return join(getOverdeckHome(), 'agents', `conv-${checkedName(criticName)}`, 'lane-link.json');
}

/** Create `target` once; an existing file rejects with EEXIST. */
async function writeOnce(target: string, value: unknown): Promise<void> {
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await chmod(target, 0o600);
}

async function writeReplacing(target: string, value: unknown): Promise<void> {
  const temp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, target);
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isNullableString = (value: unknown): value is string | null => value === null || typeof value === 'string';

function isFacts(value: unknown): value is RemoteLaneFacts {
  const facts = value as Partial<RemoteLaneFacts> | null;
  return !!facts && facts.v === 1
    && isString(facts.name) && isString(facts.environmentId) && isString(facts.label)
    && isString(facts.run) && isString(facts.key) && isString(facts.role)
    && typeof facts.iteration === 'number' && isString(facts.parentName) && isNullableString(facts.criticOfName)
    && isString(facts.projectKey) && isString(facts.cwd) && isNullableString(facts.branch) && isNullableString(facts.at)
    && isString(facts.model) && isString(facts.harness) && isNullableString(facts.effort)
    && isString(facts.title) && isString(facts.createdAt);
}

function isMirror(value: unknown): value is RemoteLaneMirror {
  const mirror = value as Partial<RemoteLaneMirror> | null;
  return !!mirror && mirror.v === 1 && (mirror.state === 'running' || mirror.state === 'gone')
    && isString(mirror.activity) && typeof mirror.lastSeq === 'number';
}

/** D-4638-4: the launch facts, written once; a second write for one name rejects. */
export async function writeRemoteLaneFacts(facts: RemoteLaneFacts): Promise<void> {
  const dir = laneDir(facts.name);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeOnce(join(dir, 'lane.json'), facts);
}

/** One stand-in by name; null when there is none or its `lane.json` is unreadable. */
export async function readRemoteLane(name: string): Promise<RemoteLane | null> {
  const dir = laneDir(name);
  const facts = await readJson(join(dir, 'lane.json'));
  if (!isFacts(facts) || facts.name !== name) return null;
  const mirror = await readJson(join(dir, 'mirror.json'));
  const archived = (await readJson(join(dir, 'archived.json'))) as { v?: unknown; at?: unknown } | null;
  return {
    facts,
    mirror: isMirror(mirror) ? mirror : null,
    archivedAt: archived && archived.v === 1 && isString(archived.at) ? archived.at : null,
  };
}

/** Every readable stand-in that matches `filter`, in `createdAt` then name order. */
export async function listRemoteLanes(filter: RemoteLaneFilter = {}): Promise<RemoteLane[]> {
  const entries = await readdir(remoteLanesRoot(), { withFileTypes: true }).catch(() => []);
  const names = entries.filter((entry) => entry.isDirectory() && NAME_PATTERN.test(entry.name)).map((entry) => entry.name);
  const lanes = (await Promise.all(names.map((name) => readRemoteLane(name)))).filter((lane): lane is RemoteLane => {
    if (!lane) return false;
    const { facts } = lane;
    return (filter.run === undefined || facts.run === filter.run)
      && (filter.key === undefined || facts.key === filter.key)
      && (filter.role === undefined || facts.role === filter.role)
      && (filter.parentName === undefined || facts.parentName === filter.parentName);
  });
  return lanes.sort((a, b) => a.facts.createdAt.localeCompare(b.facts.createdAt) || a.facts.name.localeCompare(b.facts.name));
}

/** The follower's copy of the owner's state; the follower is its only writer. */
export async function writeRemoteLaneMirror(name: string, mirror: RemoteLaneMirror): Promise<void> {
  await writeReplacing(join(laneDir(name), 'mirror.json'), mirror);
}

/** Reap's archive mark, written once; an existing mark is left alone. */
export async function markRemoteLaneArchived(name: string, at: string): Promise<void> {
  try {
    await writeOnce(join(laneDir(name), 'archived.json'), { v: 1, at });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

/**
 * Claim `name` in the store before the owner is called: false when the
 * directory exists. The reservation holds no `lane.json` until the owner
 * answers with the lane's real cwd, so listings skip it.
 */
export async function reserveRemoteLane(name: string): Promise<boolean> {
  const dir = laneDir(name);
  await mkdir(remoteLanesRoot(), { recursive: true, mode: 0o700 });
  try {
    await mkdir(dir, { mode: 0o700 });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

/** Whether `name` is held in the stand-in store (a launched lane or a claim); false for a name the store does not accept. */
export async function remoteLaneNameTaken(name: string): Promise<boolean> {
  if (!NAME_PATTERN.test(name)) return false;
  return stat(laneDir(name)).then(() => true, () => false);
}

/** Remove a stand-in. Only for a launch the owner refused: a launched lane's stand-in is kept (D7). */
export async function removeRemoteLane(name: string): Promise<void> {
  await rm(laneDir(name), { recursive: true, force: true });
}

/** D-4638-7: a local critic's link to a builder that has no local row; written once. */
export async function writeCriticLink(criticName: string, criticOfName: string): Promise<void> {
  checkedName(criticOfName);
  const target = criticLinkPath(criticName);
  await mkdir(dirname(target), { recursive: true });
  await writeOnce(target, { criticOfName });
}

/** The builder name a local critic's sidecar names; null when there is no readable sidecar. */
export async function readCriticLink(criticName: string): Promise<string | null> {
  const link = (await readJson(criticLinkPath(criticName))) as { criticOfName?: unknown } | null;
  return link && isString(link.criticOfName) ? link.criticOfName : null;
}
