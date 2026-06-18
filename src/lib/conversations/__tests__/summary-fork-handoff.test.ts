import { afterEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { mkdir, writeFile } from 'node:fs/promises';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import type { LegacyConversation as Conversation } from '../../overdeck/conversations.js';
import { createConversation, getConversationByName } from '../../overdeck/conversations.js';
import { createOverdeckDatabase } from '../../../../scripts/create-overdeck-db.js';
import { closeOverdeckDatabaseSync } from '../../overdeck/infra.js';
import { resetDiscoveredSessionsSchemaBootstrap } from '../../overdeck/discovered-sessions.js';
import { sessionFilePath } from '../../paths.js';
import { createHandoffPaths } from '../handoff-paths.js';
import {
  HandoffStallError,
  authorHandoffExternal,
  createSummaryFork,
  prependFallbackFocus,
  requestHandoffFromAgent,
  validateHandoffDoc,
} from '../summary-fork.js';
import { access } from 'node:fs/promises';
import { deliverAgentMessage } from '../../agents.js';

vi.mock('../../agents.js', () => ({
  deliverAgentMessage: vi.fn().mockResolvedValue(undefined),
}));

// Mock the smart-compaction module so external-authoring tests don't actually
// spawn an LLM. Default impl is overridden per-test via vi.mocked(...).
vi.mock('../smart-compaction.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../smart-compaction.js')>();
  return {
    ...actual,
    runModelSummary: vi.fn((prompt: string) => {
      // Default: return whatever the test set as the mock impl. If unset, throw.
      void prompt;
      throw new Error('runModelSummary mock not configured for this test');
    }),
  };
});
import { runModelSummary as mockedRunModelSummary } from '../smart-compaction.js';
import { Effect as EffectMod } from 'effect';

const originalOverdeckHome = process.env.OVERDECK_HOME;
const originalHome = process.env.HOME;
const fixedNow = new Date('2026-05-23T04:35:00.000Z');

function sourceConversation(): Conversation {
  return {
    id: 1,
    name: 'conv-source',
    tmuxSession: 'conv-source-session',
    status: 'active',
    createdAt: new Date().toISOString(),
    endedAt: null,
    lastAttachedAt: null,
    cwd: '/tmp/project',
    issueId: null,
    claudeSessionId: 'session-123',
    model: null,
    effort: null,
    title: null,
    titleSource: null,
    titleSeed: null,
    archivedAt: null,
    totalCost: 0,
    totalTokens: 0,
    harness: 'claude-code',
    deliveryMethod: null,
    spawnError: null,
    handoffDocPath: null,
    handoffTargetConvId: null,
    forkFallbackReason: null,
    forkStatus: null,
    forkError: null,
    clearedToConvId: null,
    forkRequest: null,
    forkRetryCount: 0,
  };
}

function validDoc(): string {
  return [
    '## Current objective',
    'Continue implementing the handoff fork workflow for PAN-1358 with the live source conversation authoring the transfer document.',
    '## What has been done',
    'The prompt and handoff path helpers are already in place, and this document exists to satisfy the request handshake.',
    '## Suggested skills',
    '- /pan-workflow: use when checking Overdeck bead sequencing and completion flow.',
  ].join('\n\n');
}

function invalidLongDoc(): string {
  return [
    '## Current objective',
    'This document is intentionally long enough to pass the minimum length requirement but it omits the required suggested skills heading.',
    '## Open work',
    'The fallback path should detect this validation failure and downgrade the request to a summary fork without surfacing a failed fork to the caller.',
  ].join('\n\n');
}

function docWithSuggestedSkillsHeading(heading: string): string {
  return [
    '## Current objective',
    'Continue implementing the handoff fork workflow for PAN-1358 with enough detail to satisfy the validation length requirement.',
    '## Current state',
    'The source agent has written a curated transfer document that references project artifacts without duplicating full PRD or plan content.',
    heading,
    '- /pan-workflow: use when checking Overdeck bead sequencing and completion flow.',
  ].join('\n\n');
}

// Track the overdeck DB paths we created so afterEach can clean up the handles.
const _testDbPaths: string[] = [];

async function createSourceConversation(home: string, overrides: Partial<Conversation> = {}): Promise<Conversation> {
  // Set up a fresh overdeck.db at this test's home directory.
  closeOverdeckDatabaseSync();
  resetDiscoveredSessionsSchemaBootstrap();
  mkdirSync(home, { recursive: true });
  const dbPath = join(home, 'overdeck.db');
  createOverdeckDatabase({ dbPath });
  _testDbPaths.push(dbPath);

  process.env.OVERDECK_HOME = home;
  process.env.HOME = home;

  const cwd = overrides.cwd ?? '/home/test/project';
  const sessionId = overrides.claudeSessionId ?? 'source-session-123';
  const sourceFile = sessionFilePath(cwd, sessionId);
  await mkdir(dirname(sourceFile), { recursive: true });
  await writeFile(sourceFile, `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'Continue this work' } })}\n`, 'utf-8');

  const source = createConversation({
    name: overrides.name ?? 'conv-source',
    tmuxSession: overrides.tmuxSession ?? 'conv-source-session',
    cwd,
    issueId: overrides.issueId ?? 'PAN-1358',
    claudeSessionId: sessionId,
    title: overrides.title ?? 'Source title',
    titleSource: 'manual',
  });

  return { ...source, ...overrides };
}

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(deliverAgentMessage).mockReset();
  vi.mocked(deliverAgentMessage).mockResolvedValue(undefined);
  closeOverdeckDatabaseSync();
  resetDiscoveredSessionsSchemaBootstrap();
  _testDbPaths.length = 0;
  if (originalOverdeckHome === undefined) {
    delete process.env.OVERDECK_HOME;
  } else {
    process.env.OVERDECK_HOME = originalOverdeckHome;
  }
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
});

describe('validateHandoffDoc', () => {
  it('rejects an empty document', () => {
    expect(validateHandoffDoc('')).toEqual({
      ok: false,
      reason: 'handoff document must be at least 200 characters',
    });
  });

  it('rejects a short document', () => {
    expect(validateHandoffDoc('## Suggested skills\nshort')).toEqual({
      ok: false,
      reason: 'handoff document must be at least 200 characters',
    });
  });

  it('rejects a document missing the Suggested skills heading', () => {
    expect(validateHandoffDoc(invalidLongDoc())).toEqual({
      ok: false,
      reason: 'handoff document must contain a Suggested skills heading',
    });
  });

  it('accepts a document with capitalized Suggested Skills heading', () => {
    expect(validateHandoffDoc(docWithSuggestedSkillsHeading('## Suggested Skills'))).toEqual({ ok: true });
  });

  it('accepts a document with lowercase suggested skills heading', () => {
    expect(validateHandoffDoc(docWithSuggestedSkillsHeading('## suggested skills'))).toEqual({ ok: true });
  });

  it('accepts a Suggested skills heading at H3 depth', () => {
    expect(validateHandoffDoc(docWithSuggestedSkillsHeading('### Suggested skills'))).toEqual({ ok: true });
  });

  it('accepts a Suggested skills heading at H1 depth', () => {
    expect(validateHandoffDoc(docWithSuggestedSkillsHeading('# Suggested skills'))).toEqual({ ok: true });
  });

  it('accepts a Suggested skills heading with trailing colon', () => {
    expect(validateHandoffDoc(docWithSuggestedSkillsHeading('## Suggested skills:'))).toEqual({ ok: true });
  });

  it('strips a wrapping ```markdown fence before validating', () => {
    const inner = docWithSuggestedSkillsHeading('## Suggested skills');
    const fenced = `\`\`\`markdown\n${inner}\n\`\`\``;
    expect(validateHandoffDoc(fenced)).toEqual({ ok: true });
  });

  it('strips a wrapping ``` (no language) fence before validating', () => {
    const inner = docWithSuggestedSkillsHeading('## Suggested skills');
    const fenced = `\`\`\`\n${inner}\n\`\`\``;
    expect(validateHandoffDoc(fenced)).toEqual({ ok: true });
  });
});

describe('handoff fork handshake', () => {
  it('delivers the rendered handoff prompt and returns the validated document', async () => {
    const home = join(tmpdir(), `pan-handoff-request-${Date.now()}`);
    process.env.OVERDECK_HOME = home;
    const paths = createHandoffPaths('conv-source', fixedNow.toISOString());
    const docText = validDoc();

    vi.mocked(deliverAgentMessage).mockImplementation(async (_agentId, message) => {
      expect(message).toContain('Focus on dashboard follow-up work.');
      expect(message).toContain(paths.docPath);
      await mkdir(join(home, 'handoffs'), { recursive: true });
      await writeFile(paths.docPath, docText, 'utf-8');
      await writeFile(paths.sentinelPath, '', 'utf-8');
    });

    const result = await requestHandoffFromAgent(sourceConversation(), 'Focus on dashboard follow-up work.', {
      now: fixedNow,
    });

    expect(deliverAgentMessage).toHaveBeenCalledWith(
      'conv-source-session',
      expect.stringContaining('Agent-authored handoff request'),
      'handoff-request',
    );
    expect(result).toEqual({ docPath: paths.docPath, docText });
    rmSync(home, { recursive: true, force: true });
  });

  it('uses the handoff document as the fork seed and records source/target metadata', async () => {
    const home = join(tmpdir(), `pan-handoff-fork-${Date.now()}`);
    // Set up a fresh overdeck.db at this test's home directory.
    closeOverdeckDatabaseSync();
    resetDiscoveredSessionsSchemaBootstrap();
    mkdirSync(home, { recursive: true });
    createOverdeckDatabase({ dbPath: join(home, 'overdeck.db') });
    _testDbPaths.push(join(home, 'overdeck.db'));
    process.env.OVERDECK_HOME = home;
    process.env.HOME = home;

    const cwd = '/home/test/project';
    const sessionId = 'source-session-123';
    const sourceFile = sessionFilePath(cwd, sessionId);
    await mkdir(dirname(sourceFile), { recursive: true });
    await writeFile(sourceFile, `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'Continue this work' } })}\n`, 'utf-8');

    const source = createConversation({
      name: 'conv-source',
      tmuxSession: 'conv-source-session',
      cwd,
      issueId: 'PAN-1358',
      claudeSessionId: sessionId,
      title: 'Source title',
      titleSource: 'manual',
    });
    const docText = validDoc();

    vi.mocked(deliverAgentMessage).mockImplementation(async (_agentId, message) => {
      const outputPath = message.match(/`([^`]+\/handoffs\/[^`]+\.md)`/)?.[1];
      if (!outputPath) throw new Error('missing output path');
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, docText, 'utf-8');
      await writeFile(`${outputPath}.done`, '', 'utf-8');
    });

    const result = await Effect.runPromise(createSummaryFork(source, { forkMode: 'handoff', handoffAuthor: 'source' }));

    expect(result.summary).toBe(docText);
    expect(result.summaryModel).toBeNull();
    expect(result.forkMode).toBe('handoff');
    expect(result.handoffDocPath).toBeTruthy();
    expect(result.conversation.title).toBe('Handoff: Source title');
    expect(result.conversation.issueId).toBe('PAN-1358');
    expect(result.conversation.cwd).toBe(cwd);

    const targetRow = getConversationByName(result.conversation.name);
    const sourceRow = getConversationByName(source.name);
    expect(targetRow?.handoffDocPath).toBe(result.handoffDocPath);
    expect(sourceRow?.handoffTargetConvId).toBe(result.conversation.id);
    rmSync(home, { recursive: true, force: true });
  });

  it('falls back to summary fork when the source conversation has ended', async () => {
    const home = join(tmpdir(), `pan-handoff-ended-${Date.now()}`);
    const source = await createSourceConversation(home, { status: 'ended' });

    const result = await Effect.runPromise(createSummaryFork(source, {
      forkMode: 'handoff',
      handoffAuthor: 'source',
      localSummaryOnly: true,
    }));

    expect(deliverAgentMessage).not.toHaveBeenCalled();
    expect(result.forkMode).toBe('summary');
    expect(result.forkFallbackReason).toBe('source-ended');
    expect(result.summary).toContain('## Conversation Summary Fork');
    expect(result.conversation.title).toBe('Summary Fork: Source title');
    expect(getConversationByName(result.conversation.name)?.forkFallbackReason).toBe('source-ended');
    rmSync(home, { recursive: true, force: true });
  });

  it('falls back to summary fork on handshake timeout using fake timers', async () => {
    vi.useFakeTimers();
    const home = join(tmpdir(), `pan-handoff-fallback-timeout-${Date.now()}`);
    const source = await createSourceConversation(home);

    const resultPromise = Effect.runPromise(createSummaryFork(source, {
      forkMode: 'handoff',
      handoffAuthor: 'source',
      localSummaryOnly: true,
      handoffTimeoutMs: 0,
      handoffPollIntervalMs: 1,
    }));
    await vi.advanceTimersByTimeAsync(0);
    const result = await resultPromise;

    expect(result.forkMode).toBe('summary');
    expect(result.forkFallbackReason).toBe('handoff-timeout');
    expect(result.summary).toContain('## Conversation Summary Fork');
    expect(getConversationByName(result.conversation.name)?.forkFallbackReason).toBe('handoff-timeout');
    rmSync(home, { recursive: true, force: true });
  });

  it.each([
    ['doc without sentinel', async (outputPath: string, docText: string) => {
      await writeFile(outputPath, docText, 'utf-8');
    }],
    ['sentinel without doc', async (outputPath: string) => {
      await writeFile(`${outputPath}.done`, '', 'utf-8');
    }],
  ])('treats %s as incomplete until timeout', async (_label, writePartial) => {
    const home = join(tmpdir(), `pan-handoff-partial-${Date.now()}`);
    const source = await createSourceConversation(home);
    const docText = validDoc();

    vi.mocked(deliverAgentMessage).mockImplementation(async (_agentId, message) => {
      const outputPath = message.match(/`([^`]+\/handoffs\/[^`]+\.md)`/)?.[1];
      if (!outputPath) throw new Error('missing output path');
      await mkdir(dirname(outputPath), { recursive: true });
      await writePartial(outputPath, docText);
    });

    const result = await Effect.runPromise(createSummaryFork(source, {
      forkMode: 'handoff',
      handoffAuthor: 'source',
      localSummaryOnly: true,
      handoffTimeoutMs: 0,
      handoffPollIntervalMs: 1,
    }));

    expect(result.forkMode).toBe('summary');
    expect(result.forkFallbackReason).toBe('handoff-timeout');
    expect(result.summary).toContain('## Conversation Summary Fork');
    rmSync(home, { recursive: true, force: true });
  });

  it('falls back to summary fork when the handoff document fails validation', async () => {
    const home = join(tmpdir(), `pan-handoff-validation-fallback-${Date.now()}`);
    const source = await createSourceConversation(home);
    const docText = invalidLongDoc();

    vi.mocked(deliverAgentMessage).mockImplementation(async (_agentId, message) => {
      const outputPath = message.match(/`([^`]+\/handoffs\/[^`]+\.md)`/)?.[1];
      if (!outputPath) throw new Error('missing output path');
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, docText, 'utf-8');
      await writeFile(`${outputPath}.done`, '', 'utf-8');
    });

    const result = await Effect.runPromise(createSummaryFork(source, {
      forkMode: 'handoff',
      handoffAuthor: 'source',
      localSummaryOnly: true,
    }));

    expect(result.forkMode).toBe('summary');
    expect(result.forkFallbackReason).toBe('handoff-validation');
    expect(result.summary).toContain('## Conversation Summary Fork');
    expect(result.handoffDocPath).toBeNull();
    rmSync(home, { recursive: true, force: true });
  });

  it('times out distinctly when the document and sentinel do not both appear', async () => {
    vi.useFakeTimers();
    const home = join(tmpdir(), `pan-handoff-timeout-${Date.now()}`);
    process.env.OVERDECK_HOME = home;

    const result = requestHandoffFromAgent(sourceConversation(), undefined, {
      now: fixedNow,
      timeoutMs: 0,
      pollIntervalMs: 1_000,
    });

    await expect(result).rejects.toBeInstanceOf(HandoffStallError);
    rmSync(home, { recursive: true, force: true });
  });
});

describe('prependFallbackFocus', () => {
  it('returns the summary unchanged when no focus is provided', () => {
    const summary = '## Conversation Summary Fork\n\nstuff';
    expect(prependFallbackFocus(summary, undefined, 'handoff-validation')).toBe(summary);
    expect(prependFallbackFocus(summary, '   ', 'handoff-validation')).toBe(summary);
  });

  it('prepends a fallback notice + the focus when focus is provided', () => {
    const summary = '## Conversation Summary Fork\n\nstuff';
    const out = prependFallbackFocus(summary, 'wire the Stripe webhook', 'handoff-validation');
    expect(out).toContain('intended handoff fell back to a summary fork');
    expect(out).toContain('handoff-validation');
    expect(out).toContain('wire the Stripe webhook');
    expect(out.endsWith(summary)).toBe(true);
  });
});

describe('authorHandoffExternal', () => {
  // The new design: the authoring session uses its Write tool to create the
  // doc file directly. The model's stdout is just an acknowledgement string.
  // Tests mock runModelSummary to (a) extract the output path from the prompt
  // injection, (b) write the test doc to that path as the Write tool would,
  // (c) return a "done" acknowledgement on stdout.
  function mockAuthoringSessionThatWrites(docText: string) {
    vi.mocked(mockedRunModelSummary).mockImplementation((prompt: string) => {
      const pathMatch = prompt.match(/`([^`]+\/handoffs\/[^`]+\.md)`/);
      if (pathMatch?.[1]) {
        const outputPath = pathMatch[1];
        const { writeFileSync, mkdirSync } = require('node:fs');
        const { dirname } = require('node:path');
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, docText, 'utf-8');
      }
      return EffectMod.succeed('done');
    });
  }

  function mockAuthoringSessionThatRefusesToWrite(stdoutText: string) {
    vi.mocked(mockedRunModelSummary).mockImplementation(() => EffectMod.succeed(stdoutText));
  }

  it('writes the doc + sentinel from the authoring session and never touches the source agent', async () => {
    const home = join(tmpdir(), `pan-handoff-external-ok-${Date.now()}`);
    const source = await createSourceConversation(home);
    const cwd = source.cwd;
    const sessionId = source.claudeSessionId!;
    const sourceFile = sessionFilePath(cwd, sessionId);
    const docText = validDoc();

    mockAuthoringSessionThatWrites(docText);

    const result = await authorHandoffExternal(
      source,
      sourceFile,
      'just continue PAN-1351',
      'claude-haiku-4-5',
      'claude-code',
    );

    expect(result.docText).toBe(docText);
    expect(result.docPath).toContain('/handoffs/');
    expect(deliverAgentMessage).not.toHaveBeenCalled();
    expect(mockedRunModelSummary).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(mockedRunModelSummary).mock.calls[0];
    expect(callArgs?.[1]).toBe('claude-haiku-4-5');
    expect(callArgs?.[3]).toBe('claude-code');
    // PAN-1582: the headless authoring session must allowlist the Write tool,
    // otherwise `--permission-mode auto` stalls on a permission prompt it can
    // never answer and the fork silently degrades to a summary.
    expect(callArgs?.[4]).toEqual(['Write']);
    rmSync(home, { recursive: true, force: true });
  });

  it('uses the Pi-specific authoring template + write tool when the authoring harness is Pi (PAN-1541)', async () => {
    const home = join(tmpdir(), `pan-handoff-pi-author-${Date.now()}`);
    const source = await createSourceConversation(home);
    const sourceFile = sessionFilePath(source.cwd, source.claudeSessionId!);
    const docText = validDoc();

    mockAuthoringSessionThatWrites(docText);
    vi.mocked(mockedRunModelSummary).mockClear();

    const result = await authorHandoffExternal(source, sourceFile, 'continue PAN-1541', 'pi-model', 'pi');

    expect(result.docText).toBe(docText);
    expect(mockedRunModelSummary).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(mockedRunModelSummary).mock.calls[0];
    // The authoring harness is threaded to the LLM call so runPiModelSummary runs.
    expect(callArgs?.[3]).toBe('pi');
    const prompt = callArgs?.[0] as string;
    // Pi uses its lowercase `write` tool, not Claude Code's `Write` tool.
    expect(prompt).toContain('External-session handoff authoring (Pi)');
    expect(prompt).toContain('`write` tool');
    expect(prompt).not.toContain('**Write** tool');
    rmSync(home, { recursive: true, force: true });
  });

  it('uses the Claude Code authoring template when the authoring harness is claude-code (PAN-1541)', async () => {
    const home = join(tmpdir(), `pan-handoff-cc-author-${Date.now()}`);
    const source = await createSourceConversation(home);
    const sourceFile = sessionFilePath(source.cwd, source.claudeSessionId!);
    const docText = validDoc();

    mockAuthoringSessionThatWrites(docText);
    vi.mocked(mockedRunModelSummary).mockClear();

    await authorHandoffExternal(source, sourceFile, 'continue', 'claude-haiku-4-5', 'claude-code');

    const prompt = vi.mocked(mockedRunModelSummary).mock.calls[0]?.[0] as string;
    expect(prompt).toContain('**Write** tool');
    expect(prompt).not.toContain('(Pi)');
    rmSync(home, { recursive: true, force: true });
  });

  it('falls back to summary fork when the file content fails validation', async () => {
    const home = join(tmpdir(), `pan-handoff-external-invalid-${Date.now()}`);
    const source = await createSourceConversation(home);
    const invalid = invalidLongDoc();

    mockAuthoringSessionThatWrites(invalid);

    const result = await Effect.runPromise(createSummaryFork(source, {
      forkMode: 'handoff',
      handoffAuthor: 'external',
      handoffAuthorModel: 'claude-haiku-4-5',
      localSummaryOnly: true,
    }));

    expect(result.forkMode).toBe('summary');
    expect(result.forkFallbackReason).toBe('handoff-validation');
    expect(deliverAgentMessage).not.toHaveBeenCalled();
    rmSync(home, { recursive: true, force: true });
  });

  it('falls back to summary fork when the authoring session never calls Write', async () => {
    // Pretend the model emitted text to stdout instead of using the Write tool.
    // The new flow must surface this as a validation error, not a successful
    // handoff seeded with whatever the model emitted on stdout.
    const home = join(tmpdir(), `pan-handoff-external-stdout-${Date.now()}`);
    const source = await createSourceConversation(home);
    mockAuthoringSessionThatRefusesToWrite('Sure, here is the handoff document:\n\n# Handoff\n\n## Suggested skills\n- /foo');

    const result = await Effect.runPromise(createSummaryFork(source, {
      forkMode: 'handoff',
      handoffAuthor: 'external',
      handoffAuthorModel: 'claude-haiku-4-5',
      localSummaryOnly: true,
    }));

    expect(result.forkMode).toBe('summary');
    expect(result.forkFallbackReason).toBe('handoff-validation');
    expect(deliverAgentMessage).not.toHaveBeenCalled();
    rmSync(home, { recursive: true, force: true });
  });

  it('persists the file content to .rejected.md when validation fails', async () => {
    const home = join(tmpdir(), `pan-handoff-rejected-${Date.now()}`);
    const source = await createSourceConversation(home);
    const sourceFile = sessionFilePath(source.cwd, source.claudeSessionId!);
    const bad = invalidLongDoc();

    mockAuthoringSessionThatWrites(bad);

    await expect(
      authorHandoffExternal(source, sourceFile, 'PAN-1351 status', 'claude-haiku-4-5', 'claude-code'),
    ).rejects.toThrow(/Invalid handoff document/);

    const paths = createHandoffPaths(source.name, new Date().toISOString());
    const { readdir, readFile } = await import('node:fs/promises');
    const handoffDir = dirname(paths.docPath);
    const entries = await readdir(handoffDir);
    const rejected = entries.find((e) => e.endsWith('.rejected.md'));
    expect(rejected).toBeTruthy();
    const persisted = await readFile(join(handoffDir, rejected!), 'utf-8');
    expect(persisted).toBe(bad);
    rmSync(home, { recursive: true, force: true });
  });

  it('strips a markdown code fence wrapping if the authored file has one', async () => {
    const home = join(tmpdir(), `pan-handoff-fence-${Date.now()}`);
    const source = await createSourceConversation(home);
    const sourceFile = sessionFilePath(source.cwd, source.claudeSessionId!);
    const inner = validDoc();
    const fenced = `\`\`\`markdown\n${inner}\n\`\`\``;

    mockAuthoringSessionThatWrites(fenced);

    const result = await authorHandoffExternal(source, sourceFile, undefined, 'claude-haiku-4-5', 'claude-code');
    expect(result.docText).toBe(inner);
    const { readFile } = await import('node:fs/promises');
    const persisted = await readFile(result.docPath, 'utf-8');
    expect(persisted).toBe(inner);
    await expect(access(`${result.docPath}.done`)).resolves.toBeUndefined();
    rmSync(home, { recursive: true, force: true });
  });

  it('preserves the focus in the summary when external authoring falls back', async () => {
    const home = join(tmpdir(), `pan-handoff-focus-preserved-${Date.now()}`);
    const source = await createSourceConversation(home);
    vi.mocked(mockedRunModelSummary).mockImplementation(() => EffectMod.succeed(invalidLongDoc()));

    const result = await Effect.runPromise(createSummaryFork(source, {
      forkMode: 'handoff',
      handoffAuthor: 'external',
      handoffAuthorModel: 'claude-haiku-4-5',
      focus: 'implement Pi forking for PAN-XXXX',
      localSummaryOnly: true,
    }));

    expect(result.forkFallbackReason).toBe('handoff-validation');
    expect(result.summary).toContain('intended handoff fell back to a summary fork');
    expect(result.summary).toContain('implement Pi forking for PAN-XXXX');
    rmSync(home, { recursive: true, force: true });
  });
});
