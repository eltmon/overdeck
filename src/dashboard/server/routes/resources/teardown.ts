import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { emitActivityEntrySync, type EmitActivityOptions } from '../../../../lib/activity-logger.js';
import { jsonResponse } from '../../http-helpers.js';
import { EventStoreService } from '../../services/domain-services.js';
import { httpHandler } from '../http-handler.js';
import { getCurrentDockerStats } from './shared.js';
import { getResourceStacks, type ResourceStack } from './stacks.js';

const execFileAsync = promisify(execFile);
const CONFIRM_TOKEN_TTL_MS = 5 * 60 * 1000;

type DockerTeardownExec = typeof execFileAsync;

interface StackTeardownToken {
  issueId: string;
  composeProject: string;
  expiresAt: number;
}

export interface StackTeardownEstimate {
  issueId: string;
  composeProject: string;
  ramBytes: number;
  diskBytes: number;
  confirmToken: string;
  expiresAt: string;
}

export interface StackTeardownInput {
  confirmToken?: unknown;
  typedText?: unknown;
}

let dockerTeardownExec: DockerTeardownExec = execFileAsync;
let teardownTokenGenerator: () => string = () => `td-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
let activityEmitter: (options: EmitActivityOptions) => void = emitActivityEntrySync;
const teardownTokens = new Map<string, StackTeardownToken>();

export function setStackTeardownDockerExecForTests(execImpl: DockerTeardownExec): void {
  dockerTeardownExec = execImpl;
}

export function setStackTeardownTokenGeneratorForTests(generator: () => string): void {
  teardownTokenGenerator = generator;
}

export function setStackTeardownActivityEmitterForTests(emitter: (options: EmitActivityOptions) => void): void {
  activityEmitter = emitter;
}

export function resetStackTeardownForTests(): void {
  dockerTeardownExec = execFileAsync;
  teardownTokenGenerator = () => `td-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  activityEmitter = emitActivityEntrySync;
  teardownTokens.clear();
}

export const getStackTeardownEstimateRoute = HttpRouter.add(
  'GET',
  '/api/resources/stacks/:issueId/teardown-estimate',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    return yield* getStackTeardownEstimateEffect(params['issueId'] ?? '');
  })),
);

export const postStackTeardownRoute = HttpRouter.add(
  'POST',
  '/api/resources/stacks/:issueId/teardown',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const body = yield* readJsonBody;
    return yield* postStackTeardownEffect(params['issueId'] ?? '', body);
  })),
);

export function getStackTeardownEstimateEffect(issue: string): Effect.Effect<ReturnType<typeof jsonResponse>, never, never> {
  return Effect.gen(function* () {
    const issueId = normalizeIssueId(issue);
    const stack = findStack(issueId);
    if (!stack) {
      return jsonResponse({ error: `Stack not found for ${issueId || issue}` }, { status: 404 });
    }

    const token = teardownTokenGenerator();
    const expiresAt = Date.now() + CONFIRM_TOKEN_TTL_MS;
    teardownTokens.set(token, { issueId, composeProject: stack.composeProject, expiresAt });

    const estimate = buildStackTeardownEstimate(stack, token, expiresAt);
    return jsonResponse(estimate);
  });
}

export function postStackTeardownEffect(
  issue: string,
  input: StackTeardownInput,
): Effect.Effect<ReturnType<typeof jsonResponse>, never, EventStoreService> {
  return Effect.gen(function* () {
    const issueId = normalizeIssueId(issue);
    const confirmToken = typeof input.confirmToken === 'string' ? input.confirmToken : '';
    const typedText = typeof input.typedText === 'string' ? input.typedText : '';
    const token = teardownTokens.get(confirmToken);

    if (!token || token.issueId !== issueId || token.expiresAt <= Date.now()) {
      teardownTokens.delete(confirmToken);
      return jsonResponse({ ok: false, error: 'Invalid or expired confirmation token.' }, { status: 422 });
    }

    if (typedText !== token.composeProject) {
      return jsonResponse({ ok: false, error: `Type ${token.composeProject} to confirm stack teardown.` }, { status: 422 });
    }

    const stack = findStack(issueId);
    if (!stack) {
      return jsonResponse({ ok: false, error: `Stack not found for ${issueId}` }, { status: 404 });
    }

    const estimate = buildStackTeardownEstimate(stack, confirmToken, token.expiresAt);
    const result = yield* runDockerStackTeardown(stack);
    teardownTokens.delete(confirmToken);

    const eventStore = yield* EventStoreService;
    yield* eventStore.append({
      type: 'resources.updated',
      timestamp: new Date().toISOString(),
      payload: { resources: { containers: getCurrentDockerStats() } },
    });

    activityEmitter({
      source: 'dashboard',
      level: 'info',
      issueId,
      message: `Tore down Docker stack for ${issueId}, freeing ${estimate.ramBytes} RAM bytes and ${estimate.diskBytes} disk bytes.`,
      details: JSON.stringify({
        issueId,
        composeProject: stack.composeProject,
        ramBytes: estimate.ramBytes,
        diskBytes: estimate.diskBytes,
        removedContainers: result.containers.length,
        removedNetworks: result.networks.length,
        removedVolumes: result.volumes.length,
      }),
    });

    return jsonResponse({
      ok: true,
      issueId,
      composeProject: stack.composeProject,
      ramBytes: estimate.ramBytes,
      diskBytes: estimate.diskBytes,
      removedContainers: result.containers,
      removedNetworks: result.networks,
      removedVolumes: result.volumes,
    });
  });
}

function buildStackTeardownEstimate(stack: ResourceStack, confirmToken: string, expiresAt: number): StackTeardownEstimate {
  return {
    issueId: stack.issueId ?? stack.id,
    composeProject: stack.composeProject,
    ramBytes: stack.aggregates.memoryBytes,
    diskBytes: stack.aggregates.diskBytes,
    confirmToken,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

function runDockerStackTeardown(stack: ResourceStack): Effect.Effect<{
  containers: string[];
  networks: string[];
  volumes: string[];
}, unknown, never> {
  return Effect.tryPromise({
    try: async () => {
      const containers = stack.services.map((service) => service.id).filter(Boolean);
      for (const container of containers) {
        if (!isDockerIdentifier(container)) throw new Error(`Invalid container ID: ${container}`);
        await dockerTeardownExec('docker', ['stop', '--time', '30', container], { encoding: 'utf-8', timeout: 35000 });
      }
      for (const container of containers) {
        await dockerTeardownExec('docker', ['rm', '-f', container], { encoding: 'utf-8', timeout: 30000 });
      }

      const networkResult = await dockerTeardownExec(
        'docker',
        ['network', 'ls', '--filter', `label=com.docker.compose.project=${stack.composeProject}`, '--format', '{{.Name}}'],
        { encoding: 'utf-8', timeout: 10000 },
      );
      const networks = lines(networkResult.stdout);
      for (const network of networks) {
        if (!isDockerIdentifier(network)) throw new Error(`Invalid network name: ${network}`);
        await dockerTeardownExec('docker', ['network', 'rm', network], { encoding: 'utf-8', timeout: 10000 });
      }

      const volumeResult = await dockerTeardownExec(
        'docker',
        ['volume', 'ls', '--filter', `label=com.docker.compose.project=${stack.composeProject}`, '--format', '{{.Name}}'],
        { encoding: 'utf-8', timeout: 10000 },
      );
      const volumes = lines(volumeResult.stdout);
      for (const volume of volumes) {
        if (!isDockerIdentifier(volume)) throw new Error(`Invalid volume name: ${volume}`);
        await dockerTeardownExec('docker', ['volume', 'rm', volume], { encoding: 'utf-8', timeout: 10000 });
      }

      return { containers, networks, volumes };
    },
    catch: (error) => error,
  });
}

function findStack(issueId: string): ResourceStack | undefined {
  return getResourceStacks(getCurrentDockerStats() as Parameters<typeof getResourceStacks>[0])
    .find((stack) => stack.issueId?.toUpperCase() === issueId);
}

function normalizeIssueId(issue: string): string {
  return issue.trim().toUpperCase();
}

function lines(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean);
}

function isDockerIdentifier(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value);
}

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? JSON.parse(text) as StackTeardownInput : {};
  } catch {
    return {};
  }
});
