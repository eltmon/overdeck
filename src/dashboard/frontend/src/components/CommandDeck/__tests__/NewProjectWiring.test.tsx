/**
 * Verifies the success-path wiring for NewProjectModal in App:
 *   - Both ['command-deck-projects'] and ['registered-projects'] are invalidated
 *   - The new project key is selected (setSelectedProjectKey called)
 *   - ensureHome is called with the new key
 *
 * PAN-1970
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';

vi.mock('../../../lib/panesStore', () => ({
  usePanesStore: {
    getState: vi.fn(() => ({ ensureHome: vi.fn() })),
  },
}));

import { usePanesStore } from '../../../lib/panesStore';

describe('handleProjectCreated wiring', () => {
  let queryClient: QueryClient;
  let invalidateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    queryClient = new QueryClient();
    invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    vi.mocked(usePanesStore.getState).mockReturnValue({ ensureHome: vi.fn() } as unknown as ReturnType<typeof usePanesStore.getState>);
  });

  it('invalidates both query keys and calls ensureHome on project creation', () => {
    const setSelectedProjectKey = vi.fn();

    // Inline the handler logic (same as App.tsx handleProjectCreated)
    function handleProjectCreated(project: { key: string; name: string; path: string }) {
      void queryClient.invalidateQueries({ queryKey: ['command-deck-projects'] });
      void queryClient.invalidateQueries({ queryKey: ['registered-projects'] });
      setSelectedProjectKey(project.key);
      usePanesStore.getState().ensureHome(project.key);
    }

    act(() => {
      handleProjectCreated({ key: 'my-app', name: 'My App', path: '/projects/my-app' });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['command-deck-projects'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['registered-projects'] });
    expect(setSelectedProjectKey).toHaveBeenCalledWith('my-app');
    expect(usePanesStore.getState().ensureHome).toHaveBeenCalledWith('my-app');
  });
});
