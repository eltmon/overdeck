/**
 * PAN-3330 WI-3: the New Workspace dialog and its resolve-before-create
 * preview.
 *
 * The debounce is exercised with fake timers (repo rule: never real setTimeout
 * waits in delay-based tests) — advanceTimersByTimeAsync both fires the timer
 * and drains the fetch promise chain it starts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { NewWorkspaceModal, RESOLVE_DEBOUNCE_MS, type ResolvedWorkspaceIntent } from '../NewWorkspaceModal.js';

vi.mock('../../../lib/apiFetch.js', () => ({ fetchWithTimeout: vi.fn() }));

vi.mock('../../../lib/wsTransport.js', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({
    'Content-Type': 'application/json',
    'x-overdeck-csrf-token': 'test-csrf',
  })),
}));

vi.mock('../FolderPicker.js', () => ({
  FolderPicker: ({ onSelect }: { onSelect: (path: string) => void }) => (
    <button data-testid="mock-folder-picker" onClick={() => onSelect('/picked/dir')}>Pick</button>
  ),
}));

import { fetchWithTimeout } from '../../../lib/apiFetch.js';
const mockFetch = fetchWithTimeout as ReturnType<typeof vi.fn>;

function ok(data: unknown, status = 200): Response {
  return { ok: true, status, json: () => Promise.resolve(data) } as unknown as Response;
}

function err(status: number, body: unknown): Response {
  return { ok: false, status, json: () => Promise.resolve(body) } as unknown as Response;
}

function intent(overrides: Partial<ResolvedWorkspaceIntent> = {}): ResolvedWorkspaceIntent {
  return {
    projectId: 'overdeck',
    kind: 'scratch',
    name: 'lens',
    path: '/repo',
    branchName: null,
    parentBranch: 'main',
    parentBranchGuessed: true,
    isGitRepository: true,
    wouldCreateWorktree: false,
    unregisteredTargetPath: false,
    findings: [],
    ...overrides,
  };
}

const PROJECTS = [{ key: 'overdeck', name: 'Overdeck' }];
const TARGETS = { primaryPath: '/repo', targets: [{ path: '/repo/alt' }] };

/** Route every request the modal makes; `resolveWith` drives the preview. */
function wireFetch(resolveWith: () => Response, createWith?: () => Response) {
  mockFetch.mockImplementation((url: string, init?: { method?: string }) => {
    if (url === '/api/registered-projects') return Promise.resolve(ok(PROJECTS));
    // The dialog probes for an existing main workspace (D-7); a row present
    // means the bootstrap affordance stays hidden in the default fixture.
    if (url.startsWith('/api/workspace-registry?')) return Promise.resolve(ok({ workspaces: [{ id: 'ws-main' }] }));
    if (url.startsWith('/api/workspace-registry/project-targets')) return Promise.resolve(ok(TARGETS));
    if (url === '/api/workspace-registry/resolve') return Promise.resolve(resolveWith());
    if (url === '/api/workspace-registry' && init?.method === 'POST') {
      return Promise.resolve(createWith ? createWith() : ok({ id: 'ws-new' }, 201));
    }
    return Promise.resolve(ok({}));
  });
}

function resolveCalls(): Array<Record<string, unknown>> {
  return mockFetch.mock.calls
    .filter(([url]) => url === '/api/workspace-registry/resolve')
    .map(([, init]) => JSON.parse((init as { body: string }).body) as Record<string, unknown>);
}

/**
 * Drain the debounce plus the async cascade it can restart: the project list
 * lands and selects a project, which fetches that project's targets, which
 * seeds the target path — each step re-arming the debounce. Once the inputs
 * stop moving the effect no longer re-runs, so extra rounds fire no further
 * requests and the "one resolve per settle" count stays honest.
 */
async function settle(rounds = 4) {
  for (let round = 0; round < rounds; round++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(RESOLVE_DEBOUNCE_MS); });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  mockFetch.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('NewWorkspaceModal — sections and debounce (AC-1)', () => {
  it('renders the name, project, mode, target, advanced and preview sections', async () => {
    wireFetch(() => ok(intent()));
    render(<NewWorkspaceModal isOpen onClose={vi.fn()} onCreated={vi.fn()} />);
    await settle();

    expect(screen.getByTestId('new-workspace-name-input')).toBeDefined();
    expect(screen.getByTestId('new-workspace-project-select')).toBeDefined();
    expect(screen.getByTestId('new-workspace-mode-shared')).toBeDefined();
    expect(screen.getByTestId('new-workspace-mode-isolated')).toBeDefined();
    expect(screen.getByTestId('new-workspace-target-select')).toBeDefined();
    expect(screen.getByTestId('new-workspace-advanced-toggle')).toBeDefined();
    expect(screen.getByTestId('new-workspace-preview')).toBeDefined();
  });

  it('emits exactly one resolve per settle across rapid keystrokes', async () => {
    wireFetch(() => ok(intent()));
    render(<NewWorkspaceModal isOpen onClose={vi.fn()} onCreated={vi.fn()} />);
    await settle();
    const baseline = resolveCalls().length;

    const input = screen.getByTestId('new-workspace-name-input');
    fireEvent.change(input, { target: { value: 'l' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    fireEvent.change(input, { target: { value: 'le' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    fireEvent.change(input, { target: { value: 'lens' } });

    // Still inside the debounce window — nothing new has gone out yet.
    expect(resolveCalls().length).toBe(baseline);

    await settle();

    const calls = resolveCalls();
    expect(calls.length).toBe(baseline + 1);
    expect(calls[calls.length - 1]).toMatchObject({ name: 'lens' });
  });

  it('sends the operator intent — project, name, mode and parent branch', async () => {
    wireFetch(() => ok(intent()));
    render(<NewWorkspaceModal isOpen onClose={vi.fn()} onCreated={vi.fn()} />);
    await settle();

    fireEvent.change(screen.getByTestId('new-workspace-name-input'), { target: { value: 'lens' } });
    fireEvent.click(screen.getByTestId('new-workspace-advanced-toggle'));
    fireEvent.change(screen.getByTestId('new-workspace-parent-branch-input'), { target: { value: 'develop' } });
    await settle();

    expect(resolveCalls().at(-1)).toMatchObject({
      project: 'overdeck',
      name: 'lens',
      isolated: false,
      parentBranch: 'develop',
    });
  });

  it('renders the resolved path and parent branch, tagging an inferred parent', async () => {
    wireFetch(() => ok(intent({ path: '/repo/checkout' })));
    render(<NewWorkspaceModal isOpen onClose={vi.fn()} onCreated={vi.fn()} />);
    await settle();

    expect(screen.getByTestId('new-workspace-preview-path').textContent).toBe('/repo/checkout');
    expect(screen.getByTestId('new-workspace-preview-parent').textContent).toContain('(inferred)');
  });
});

describe('NewWorkspaceModal — findings block creation (AC-2)', () => {
  it('renders each finding against its field and disables Create', async () => {
    wireFetch(() => ok(intent({
      path: null,
      findings: [
        { field: 'name', code: 'invalid-name', message: 'Use letters, numbers, and hyphens only.' },
        { field: 'targetPath', code: 'target-not-a-directory', message: 'Not an existing directory: /nope' },
      ],
    })));
    render(<NewWorkspaceModal isOpen onClose={vi.fn()} onCreated={vi.fn()} />);
    await settle();

    expect(screen.getByTestId('new-workspace-finding-name').textContent).toContain('letters, numbers, and hyphens');
    expect(screen.getByTestId('new-workspace-finding-targetPath').textContent).toContain('Not an existing directory');
    expect((screen.getByTestId('new-workspace-create') as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps Create disabled while the preview is stale', async () => {
    wireFetch(() => ok(intent()));
    render(<NewWorkspaceModal isOpen onClose={vi.fn()} onCreated={vi.fn()} />);
    await settle();
    expect((screen.getByTestId('new-workspace-create') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.change(screen.getByTestId('new-workspace-name-input'), { target: { value: 'changed' } });

    // The field moved; the preview no longer describes the current intent.
    expect((screen.getByTestId('new-workspace-create') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('new-workspace-preview').textContent).toContain('Resolving…');
  });

  it('surfaces a 422 from create as findings against their fields', async () => {
    wireFetch(
      () => ok(intent()),
      () => err(422, { findings: [{ field: 'name', code: 'invalid-name', message: 'Use letters, numbers, and hyphens only.' }] }),
    );
    render(<NewWorkspaceModal isOpen onClose={vi.fn()} onCreated={vi.fn()} />);
    await settle();

    await act(async () => { fireEvent.click(screen.getByTestId('new-workspace-create')); });

    expect(screen.getByTestId('new-workspace-finding-name')).toBeDefined();
    expect(screen.getByTestId('new-workspace-error').textContent).toContain('letters, numbers, and hyphens');
  });
});

describe('NewWorkspaceModal — isolated mode (AC-3)', () => {
  it('disables the target field and previews the derived worktree path and branch', async () => {
    let current = intent();
    wireFetch(() => ok(current));
    render(<NewWorkspaceModal isOpen onClose={vi.fn()} onCreated={vi.fn()} />);
    await settle();

    current = intent({
      path: '/repo/workspaces/scratch-lens',
      branchName: 'scratch/lens',
      wouldCreateWorktree: true,
    });
    fireEvent.click(screen.getByTestId('new-workspace-mode-isolated'));
    await settle();

    expect((screen.getByTestId('new-workspace-target-select') as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByTestId('new-workspace-preview-path').textContent).toBe('/repo/workspaces/scratch-lens');
    expect(screen.getByTestId('new-workspace-preview-branch').textContent).toContain('scratch/lens');
    expect(screen.getByTestId('new-workspace-preview-git').textContent).toContain('creates a worktree');
  });

  it('drops the target path from the resolve request in isolated mode', async () => {
    wireFetch(() => ok(intent()));
    render(<NewWorkspaceModal isOpen onClose={vi.fn()} onCreated={vi.fn()} />);
    await settle();
    expect(resolveCalls().at(-1)).toMatchObject({ targetPath: '/repo' });

    fireEvent.click(screen.getByTestId('new-workspace-mode-isolated'));
    await settle();

    const last = resolveCalls().at(-1)!;
    expect(last.isolated).toBe(true);
    expect(last.targetPath).toBeUndefined();
  });

  it('lets Browse… pick an arbitrary directory in shared mode', async () => {
    wireFetch(() => ok(intent()));
    render(<NewWorkspaceModal isOpen onClose={vi.fn()} onCreated={vi.fn()} />);
    await settle();

    fireEvent.change(screen.getByTestId('new-workspace-target-select'), { target: { value: '__browse__' } });
    fireEvent.click(screen.getByTestId('mock-folder-picker'));
    await settle();

    expect(resolveCalls().at(-1)).toMatchObject({ targetPath: '/picked/dir' });
  });
});

describe('NewWorkspaceModal — successful create (AC-4)', () => {
  it('POSTs the intent, fires onCreated with the id, and closes', async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    wireFetch(() => ok(intent()), () => ok({ id: 'ws-42' }, 201));
    render(<NewWorkspaceModal isOpen onClose={onClose} onCreated={onCreated} />);
    await settle();

    fireEvent.change(screen.getByTestId('new-workspace-name-input'), { target: { value: 'lens' } });
    await settle();
    await act(async () => { fireEvent.click(screen.getByTestId('new-workspace-create')); });

    const createCall = mockFetch.mock.calls.find(
      ([url, init]) => url === '/api/workspace-registry' && (init as { method?: string })?.method === 'POST',
    );
    expect(createCall).toBeDefined();
    expect(JSON.parse((createCall![1] as { body: string }).body)).toMatchObject({
      project: 'overdeck',
      name: 'lens',
      isolated: false,
    });
    expect(onCreated).toHaveBeenCalledWith('ws-42');
    expect(onClose).toHaveBeenCalled();
  });

  it('reports a server error without firing onCreated', async () => {
    const onCreated = vi.fn();
    wireFetch(() => ok(intent()), () => err(500, { error: 'disk on fire' }));
    render(<NewWorkspaceModal isOpen onClose={vi.fn()} onCreated={onCreated} />);
    await settle();

    await act(async () => { fireEvent.click(screen.getByTestId('new-workspace-create')); });

    expect(screen.getByTestId('new-workspace-error').textContent).toContain('disk on fire');
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('preselects the project named by presetProjectKey', async () => {
    wireFetch(() => ok(intent()));
    render(<NewWorkspaceModal isOpen onClose={vi.fn()} onCreated={vi.fn()} presetProjectKey="overdeck" />);
    await settle();

    expect((screen.getByTestId('new-workspace-project-select') as HTMLSelectElement).value).toBe('overdeck');
    expect(resolveCalls().at(-1)).toMatchObject({ project: 'overdeck' });
  });

  it('renders nothing when closed', () => {
    wireFetch(() => ok(intent()));
    render(<NewWorkspaceModal isOpen={false} onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(screen.queryByTestId('new-workspace-modal')).toBeNull();
  });
});

describe('NewWorkspaceModal — reopening does not inherit the last project (review B2)', () => {
  const TWO_PROJECTS = [
    { key: 'project-a', name: 'Project A' },
    { key: 'project-b', name: 'Project B' },
  ];

  function wireTwoProjects() {
    mockFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === '/api/registered-projects') return Promise.resolve(ok(TWO_PROJECTS));
      if (url.startsWith('/api/workspace-registry?')) return Promise.resolve(ok({ workspaces: [{ id: 'ws-main' }] }));
      if (url.startsWith('/api/workspace-registry/project-targets')) return Promise.resolve(ok(TARGETS));
      if (url === '/api/workspace-registry/resolve') return Promise.resolve(ok(intent()));
      if (url === '/api/workspace-registry' && init?.method === 'POST') return Promise.resolve(ok({ id: 'ws-new' }, 201));
      return Promise.resolve(ok({}));
    });
  }

  it('honours a new preset over the project chosen during the previous open', async () => {
    wireTwoProjects();
    const { rerender } = render(
      <NewWorkspaceModal isOpen onClose={vi.fn()} onCreated={vi.fn()} presetProjectKey="project-a" />,
    );
    await settle();
    expect((screen.getByTestId('new-workspace-project-select') as HTMLSelectElement).value).toBe('project-a');

    // Close, then reopen pointed at the other project.
    rerender(<NewWorkspaceModal isOpen={false} onClose={vi.fn()} onCreated={vi.fn()} presetProjectKey="project-a" />);
    rerender(<NewWorkspaceModal isOpen onClose={vi.fn()} onCreated={vi.fn()} presetProjectKey="project-b" />);
    await settle();

    expect((screen.getByTestId('new-workspace-project-select') as HTMLSelectElement).value).toBe('project-b');
    expect(resolveCalls().at(-1)).toMatchObject({ project: 'project-b' });
  });

  it('clears the name typed during the previous open', async () => {
    wireTwoProjects();
    const { rerender } = render(<NewWorkspaceModal isOpen onClose={vi.fn()} onCreated={vi.fn()} />);
    await settle();
    fireEvent.change(screen.getByTestId('new-workspace-name-input'), { target: { value: 'leftover' } });
    await settle();

    rerender(<NewWorkspaceModal isOpen={false} onClose={vi.fn()} onCreated={vi.fn()} />);
    rerender(<NewWorkspaceModal isOpen onClose={vi.fn()} onCreated={vi.fn()} />);
    await settle();

    expect((screen.getByTestId('new-workspace-name-input') as HTMLInputElement).value).toBe('');
  });

  it('accepts a preset given as the project display name, not just its key', async () => {
    wireTwoProjects();
    render(<NewWorkspaceModal isOpen onClose={vi.fn()} onCreated={vi.fn()} presetProjectKey="Project B" />);
    await settle();

    expect((screen.getByTestId('new-workspace-project-select') as HTMLSelectElement).value).toBe('project-b');
  });
});

describe('NewWorkspaceModal — a failed resolve never enables Create (review B3)', () => {
  it('keeps Create disabled when the resolve request errors', async () => {
    wireFetch(() => err(500, { error: 'resolver exploded' }));
    render(<NewWorkspaceModal isOpen onClose={vi.fn()} onCreated={vi.fn()} />);
    await settle();

    expect((screen.getByTestId('new-workspace-create') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('new-workspace-error').textContent).toContain('Could not resolve');
  });

  it('drops a previously good preview as soon as a field changes', async () => {
    let response = ok(intent());
    mockFetch.mockImplementation((url: string) => {
      if (url === '/api/registered-projects') return Promise.resolve(ok(PROJECTS));
      if (url.startsWith('/api/workspace-registry?')) return Promise.resolve(ok({ workspaces: [{ id: 'ws-main' }] }));
      if (url.startsWith('/api/workspace-registry/project-targets')) return Promise.resolve(ok(TARGETS));
      if (url === '/api/workspace-registry/resolve') return Promise.resolve(response);
      return Promise.resolve(ok({}));
    });
    render(<NewWorkspaceModal isOpen onClose={vi.fn()} onCreated={vi.fn()} />);
    await settle();
    expect((screen.getByTestId('new-workspace-create') as HTMLButtonElement).disabled).toBe(false);

    // The next resolve fails; the stale-but-clean preview must not survive it.
    response = err(500, { error: 'resolver exploded' });
    fireEvent.change(screen.getByTestId('new-workspace-name-input'), { target: { value: 'changed' } });
    await settle();

    expect((screen.getByTestId('new-workspace-create') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId('new-workspace-preview-path')).toBeNull();
  });
});

describe('NewWorkspaceModal — main bootstrap (review B6, D-7/FR-4)', () => {
  function wireMain(mainRows: unknown[]) {
    mockFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === '/api/registered-projects') return Promise.resolve(ok(PROJECTS));
      if (url.startsWith('/api/workspace-registry?')) return Promise.resolve(ok({ workspaces: mainRows }));
      if (url.startsWith('/api/workspace-registry/project-targets')) return Promise.resolve(ok(TARGETS));
      if (url === '/api/workspace-registry/resolve') return Promise.resolve(ok(intent()));
      if (url === '/api/workspace-registry' && init?.method === 'POST') return Promise.resolve(ok({ id: 'ws-main-new' }, 201));
      return Promise.resolve(ok({}));
    });
  }

  it('offers the bootstrap affordance when the project has no main workspace', async () => {
    wireMain([]);
    render(<NewWorkspaceModal isOpen onClose={vi.fn()} onCreated={vi.fn()} />);
    await settle();

    expect(screen.getByTestId('new-workspace-bootstrap-main')).toBeDefined();
  });

  it('hides the affordance when a main workspace already exists', async () => {
    wireMain([{ id: 'ws-main' }]);
    render(<NewWorkspaceModal isOpen onClose={vi.fn()} onCreated={vi.fn()} />);
    await settle();

    expect(screen.queryByTestId('new-workspace-bootstrap-main')).toBeNull();
  });

  it('POSTs bootstrapMain and reports the new id through onCreated', async () => {
    const onCreated = vi.fn();
    wireMain([]);
    render(<NewWorkspaceModal isOpen onClose={vi.fn()} onCreated={onCreated} />);
    await settle();

    await act(async () => { fireEvent.click(screen.getByTestId('new-workspace-bootstrap-main-button')); });

    const createCall = mockFetch.mock.calls.find(
      ([url, init]) => url === '/api/workspace-registry' && (init as { method?: string })?.method === 'POST',
    );
    expect(JSON.parse((createCall![1] as { body: string }).body)).toEqual({ project: 'overdeck', bootstrapMain: true });
    expect(onCreated).toHaveBeenCalledWith('ws-main-new');
  });
});
