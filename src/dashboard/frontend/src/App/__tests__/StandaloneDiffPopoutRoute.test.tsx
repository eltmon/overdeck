// PAN-5338 WI-7: the pop-out diff window gets the explorer root from the
// `root` URL param and shows the same Diff/Preview switch as the inline panel.

import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../hooks/useCodexAutoRetry', () => ({ useCodexAutoRetry: () => undefined }));

// The shadow-DOM renderer and the diff worker pool are out of scope here.
vi.mock('@pierre/diffs/react', () => ({
  Virtualizer: ({ children }: { children: ReactNode }) => <div data-testid="virtualizer">{children}</div>,
  FileDiff: ({ fileDiff }: { fileDiff: { name: string } }) => <div data-testid="file-diff">{fileDiff.name}</div>,
  WorkerPoolContextProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useWorkerPool: () => undefined,
}));
vi.mock('@pierre/diffs/worker/worker.js?worker', () => ({ default: class {} }));

import { StandaloneDiffPopoutRoute } from '../StandaloneRoutes';

const NEW_FILE_PATCH = [
  'diff --git a/docs/a.md b/docs/a.md',
  'new file mode 100644',
  'index 0000000..1111111',
  '--- /dev/null',
  '+++ b/docs/a.md',
  '@@ -0,0 +1,1 @@',
  '+# Title',
  '',
].join('\n');

function renderRoute() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <StandaloneDiffPopoutRoute />
    </QueryClientProvider>,
  );
}

describe('StandaloneDiffPopoutRoute Markdown preview (PAN-5338)', () => {
  beforeEach(() => {
    window.history.pushState(
      {},
      '',
      '/popout/diff?diff=1&prefix=%2Fapi%2Fconversations%2Fc1%2Fdiffs&diffTurnId=t1&diffFilePath=docs%2Fa.md&root=issue%3APAN-1',
    );
    globalThis.fetch = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname === '/api/conversations/c1/diffs') {
        return {
          ok: true,
          json: async () => ({
            summaries: [
              {
                turnId: 't1',
                completedAt: '2024-01-01T00:00:00Z',
                status: 'completed',
                files: [{ path: 'docs/a.md', kind: 'A' }],
              },
            ],
          }),
        } as Response;
      }
      if (url.pathname === '/api/conversations/c1/diffs/t1') {
        return { ok: true, json: async () => ({ diff: NEW_FILE_PATCH }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('renders the Preview tab and the rendered heading once clicked', async () => {
    renderRoute();

    const previewTab = await screen.findByRole('tab', { name: 'Preview' });
    previewTab.click();

    expect(await screen.findByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument();
  });
});
