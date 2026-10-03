import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createConversation: vi.fn((opts: Record<string, unknown>) => ({
    id: 1,
    status: 'active',
    createdAt: new Date().toISOString(),
    ...opts,
  })),
  emitOnly: vi.fn(),
  home: '',
  project: '',
}));

// Real homedir until the cwd tests set a temp home (paths.ts reads it at load).
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => mocks.home || actual.homedir() };
});

vi.mock('../../../../src/lib/projects.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/projects.js')>()),
  listProjectsAsync: async () => [{ key: 'myapp', config: { name: 'MyApp', path: mocks.project } }],
}));

vi.mock('../../../../src/lib/overdeck/conversations.js', () => ({
  listConversations: vi.fn(() => []),
  getConversationByName: vi.fn(() => null),
  createConversation: mocks.createConversation,
  markConversationEnded: vi.fn(),
  markConversationActive: vi.fn(),
  updateLastAttached: vi.fn(),
  setConversationModel: vi.fn(),
  setConversationHarness: vi.fn(),
  backfillConversationModel: vi.fn(),
  archiveConversation: vi.fn(),
  removeFavorite: vi.fn(),
  updateSpawnError: vi.fn(),
  hasOtherActiveConversationOnTmuxSession: vi.fn(() => false),
}));

vi.mock('../../../../src/dashboard/server/event-store.js', () => ({
  getEventStore: vi.fn(() => ({ emitOnly: mocks.emitOnly })),
}));

vi.mock('../../../../src/lib/harness-binary.js', () => ({
  prepareHarnessLaunch: vi.fn().mockRejectedValue(new Error('stop background spawn')),
}));

vi.mock('../../../../src/lib/harness-resolve.js', () => ({
  resolveHarness: vi.fn(() => 'claude-code'),
}));

import { handleConversationCreate } from '../../../../src/lib/overdeck/conversation-runtime.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleConversationCreate empty model metadata', () => {
  it('passes undefined for empty model and whitespace-only effort', async () => {
    await handleConversationCreate(
      { model: '', effort: '   ' },
      { generateAiTitle: vi.fn().mockResolvedValue(undefined) },
    );

    expect(mocks.createConversation).toHaveBeenCalledWith(expect.objectContaining({
      model: undefined,
      effort: undefined,
    }));
  });

  it('preserves a real model id', async () => {
    await handleConversationCreate(
      { model: 'claude-opus-5' },
      { generateAiTitle: vi.fn().mockResolvedValue(undefined) },
    );

    expect(mocks.createConversation).toHaveBeenCalledWith(expect.objectContaining({
      model: 'claude-opus-5',
    }));
  });
});

describe('handleConversationCreate context opt-outs (PAN-4185)', () => {
  it('stores bareContext and skipClaudeMd from the request on the conversation', async () => {
    const res = await handleConversationCreate(
      { model: 'claude-opus-5', bareContext: true, skipClaudeMd: true },
      { generateAiTitle: vi.fn().mockResolvedValue(undefined) },
    );

    expect(mocks.createConversation).toHaveBeenCalledWith(expect.objectContaining({ bareContext: true, skipClaudeMd: true }));
    const body = (res as unknown as { body: { body: Uint8Array } }).body.body;
    expect(JSON.parse(new TextDecoder().decode(body))).toMatchObject({ bareContext: true, skipClaudeMd: true });
  });

  it('treats absent or non-boolean values as off', async () => {
    await handleConversationCreate(
      { model: 'claude-opus-5', bareContext: 'yes' },
      { generateAiTitle: vi.fn().mockResolvedValue(undefined) },
    );

    expect(mocks.createConversation).toHaveBeenCalledWith(expect.objectContaining({ bareContext: false, skipClaudeMd: false }));
  });
});

describe('handleConversationCreate skillOverrides (PAN-4486)', () => {
  it('stores a valid skill map on the conversation', async () => {
    const res = await handleConversationCreate(
      { model: 'claude-opus-5', skillOverrides: { grilling: false } },
      { generateAiTitle: vi.fn().mockResolvedValue(undefined) },
    );

    expect((res as unknown as { status: number }).status).toBe(201);
    expect(mocks.createConversation).toHaveBeenCalledWith(expect.objectContaining({ skillOverrides: { grilling: false } }));
  });

  it('answers 400 and creates no row for a malformed or core-skill map', async () => {
    mocks.createConversation.mockClear();
    for (const skillOverrides of [{ grilling: 'no' }, { 'pan-done': false }]) {
      const res = await handleConversationCreate(
        { model: 'claude-opus-5', skillOverrides },
        { generateAiTitle: vi.fn().mockResolvedValue(undefined) },
      );
      expect((res as unknown as { status: number }).status).toBe(400);
    }
    expect(mocks.createConversation).not.toHaveBeenCalled();
  });
});

describe('handleConversationCreate cwd (PAN-4486)', () => {
  beforeAll(() => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'create-cwd-home-')));
    mocks.project = join(home, 'Projects', 'myapp');
    mkdirSync(join(mocks.project, 'web'), { recursive: true });
    mkdirSync(join(home, 'elsewhere'), { recursive: true });
    mocks.home = home;
  });

  afterAll(() => {
    rmSync(mocks.home, { recursive: true, force: true });
    mocks.home = '';
  });

  it('answers 400 and creates no row for a cwd outside the project', async () => {
    const res = await handleConversationCreate(
      { model: 'claude-opus-5', projectKey: 'myapp', cwd: join(mocks.home, 'elsewhere') },
      { generateAiTitle: vi.fn().mockResolvedValue(undefined) },
    );

    expect((res as unknown as { status: number }).status).toBe(400);
    expect(mocks.createConversation).not.toHaveBeenCalled();
  });

  it('stores the realpath of a cwd inside the project', async () => {
    const res = await handleConversationCreate(
      { model: 'claude-opus-5', projectKey: 'myapp', cwd: join(mocks.project, 'web', '.') },
      { generateAiTitle: vi.fn().mockResolvedValue(undefined) },
    );

    expect((res as unknown as { status: number }).status).toBe(201);
    expect(mocks.createConversation).toHaveBeenCalledWith(expect.objectContaining({ cwd: join(mocks.project, 'web'), projectKey: 'myapp' }));
  });
});
