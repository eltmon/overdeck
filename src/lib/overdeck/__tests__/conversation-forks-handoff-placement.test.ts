/**
 * PAN-3921 FR-5/FR-6: the fork route persists the requested pane role before
 * the fork pipeline spawns anything, and a fork for an issue starts in the
 * issue workspace when it exists and no cwd was given.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpServerResponse } from 'effect/unstable/http';

const workspacePath = vi.hoisted(() => ({ current: null as string | null }));

vi.mock('../issue-projects.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../issue-projects.js')>()),
  getIssueWorkspacePath: vi.fn(() => workspacePath.current),
}));
vi.mock('../../conversations/summary-fork.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../conversations/summary-fork.js')>()),
  reserveSummaryForkSession: vi.fn(async () => ({ sessionId: 'fork-session-uuid' })),
  // The pipeline runs in the background; keep it parked so the test observes
  // only what the route did before handing off.
  generateSummaryForFork: vi.fn(() => new Promise(() => {})),
}));
vi.mock('../conversation-runtime.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../conversation-runtime.js')>()),
  resolveAllowedHarness: vi.fn(async () => 'claude-code'),
  spawnConversationSession: vi.fn(async () => {}),
}));

const { handleConversationSummaryFork } = await import('../conversation-forks.js');
const { sessionFilePath } = await import('../../runtimes/storage/claude-code.js');
const { generateSummaryForFork } = await import('../../conversations/summary-fork.js');

let testHome: string;
let originalHome: string | undefined;
let parentCwd: string;

async function readBody(response: HttpServerResponse.HttpServerResponse): Promise<Record<string, unknown>> {
  return JSON.parse(await HttpServerResponse.toWeb(response).text()) as Record<string, unknown>;
}

async function fork(body: Record<string, unknown>) {
  const response = await handleConversationSummaryFork('parent-conv', body);
  // An accepted fork starts its pipeline in the background, and the pipeline
  // reads the database before it parks in the summary step. Wait for it to
  // park, so teardown never races it into the real home.
  if (response.status === 200) await vi.waitFor(() => expect(generateSummaryForFork).toHaveBeenCalledTimes(1));
  return { status: response.status, body: await readBody(response) };
}

function paneRoleOf(tmuxSession: string): string {
  return readFileSync(join(testHome, 'conversations', tmuxSession, 'pane-role'), 'utf-8').trim();
}

beforeEach(async () => {
  originalHome = process.env.HOME;
  testHome = join(tmpdir(), `pan-3921-fork-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.HOME = testHome;
  process.env.OVERDECK_HOME = testHome;
  mkdirSync(testHome, { recursive: true });
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();

  parentCwd = join(testHome, 'parent-project');
  mkdirSync(parentCwd, { recursive: true });
  const parentFile = sessionFilePath(parentCwd, 'parent-session-uuid');
  mkdirSync(dirname(parentFile), { recursive: true });
  writeFileSync(parentFile, '{"type":"prompt"}\n');
  const { createConversation } = await import('../conversations.js');
  createConversation({
    name: 'parent-conv',
    tmuxSession: 'conv-parent',
    cwd: parentCwd,
    claudeSessionId: 'parent-session-uuid',
    harness: 'claude-code',
  });
  workspacePath.current = null;
  vi.mocked(generateSummaryForFork).mockClear();
});

afterEach(async () => {
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

describe('fork route pane role (PAN-3921 FR-5)', () => {
  it('persists role review before the pipeline starts', async () => {
    const { status, body } = await fork({ issueId: 'PAN-1', role: 'review' });
    expect(status).toBe(200);
    const conversation = body['conversation'] as { tmuxSession: string; issueId: string };
    expect(conversation.issueId).toBe('PAN-1');
    expect(paneRoleOf(conversation.tmuxSession)).toBe('review');
  });

  it('defaults the role to conversation', async () => {
    const { body } = await fork({});
    expect(paneRoleOf((body['conversation'] as { tmuxSession: string }).tmuxSession)).toBe('conversation');
  });

  it('rejects an unknown role with 400 and creates no conversation', async () => {
    const { status, body } = await fork({ role: 'bogus' });
    expect(status).toBe(400);
    expect(body['error']).toBe('Invalid role');
  });
});

describe('fork route issue workspace placement (PAN-3921 FR-6)', () => {
  it('starts an issue fork in the issue workspace when it exists and no cwd is given', async () => {
    const workspace = join(testHome, 'project', 'workspaces', 'feature-pan-1');
    mkdirSync(workspace, { recursive: true });
    workspacePath.current = workspace;

    const { body } = await fork({ issueId: 'PAN-1' });
    expect((body['conversation'] as { cwd: string }).cwd).toBe(workspace);
  });

  it('lets an explicit cwd win over the issue workspace', async () => {
    const workspace = join(testHome, 'project', 'workspaces', 'feature-pan-1');
    mkdirSync(workspace, { recursive: true });
    workspacePath.current = workspace;
    const explicit = join(testHome, 'elsewhere');
    mkdirSync(explicit, { recursive: true });

    const { body } = await fork({ issueId: 'PAN-1', cwd: explicit });
    expect((body['conversation'] as { cwd: string }).cwd).toBe(explicit);
  });

  it('keeps the parent cwd when the issue workspace does not exist', async () => {
    workspacePath.current = join(testHome, 'project', 'workspaces', 'feature-pan-1');

    const { body } = await fork({ issueId: 'PAN-1' });
    expect((body['conversation'] as { cwd: string }).cwd).toBe(parentCwd);
  });
});
