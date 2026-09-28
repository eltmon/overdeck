import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useDefaultDeckSelection } from '../useDefaultDeckSelection';
import { NO_PROJECT_KEY } from '../projectsData';

describe('useDefaultDeckSelection', () => {
  it('selects the no-project deck once when loaded with zero projects', () => {
    const onSelectProject = vi.fn();
    const { rerender } = renderHook(
      (props: { selectedProject: string | null }) =>
        useDefaultDeckSelection({ ...props, registeredProjects: [], loaded: true, onSelectProject }),
      { initialProps: { selectedProject: null } },
    );
    expect(onSelectProject).toHaveBeenCalledTimes(1);
    expect(onSelectProject).toHaveBeenCalledWith(NO_PROJECT_KEY);

    // A later re-render (e.g. registeredProjects array identity changes) does
    // not fire it again — the ref guard makes it a once-per-mount effect.
    rerender({ selectedProject: null });
    expect(onSelectProject).toHaveBeenCalledTimes(1);
  });

  it('does nothing while loading or when projects exist or a project is selected', () => {
    const notLoaded = vi.fn();
    renderHook(() => useDefaultDeckSelection({ selectedProject: null, registeredProjects: [], loaded: false, onSelectProject: notLoaded }));
    expect(notLoaded).not.toHaveBeenCalled();

    const withProjects = vi.fn();
    renderHook(() =>
      useDefaultDeckSelection({
        selectedProject: null,
        registeredProjects: [{ key: 'overdeck', path: '/home/user/Projects/overdeck' }],
        loaded: true,
        onSelectProject: withProjects,
      }),
    );
    expect(withProjects).not.toHaveBeenCalled();

    const alreadySelected = vi.fn();
    renderHook(() =>
      useDefaultDeckSelection({ selectedProject: 'overdeck', registeredProjects: [], loaded: true, onSelectProject: alreadySelected }),
    );
    expect(alreadySelected).not.toHaveBeenCalled();
  });

  it('does nothing while a conversation deep link is pending', () => {
    const onSelectProject = vi.fn();
    const { rerender } = renderHook(
      (props: { convId: string | null }) =>
        useDefaultDeckSelection({ selectedProject: null, registeredProjects: [], loaded: true, onSelectProject, ...props }),
      { initialProps: { convId: 'conv-1' } },
    );
    expect(onSelectProject).not.toHaveBeenCalled();

    // Once the deep-link effect resolves it sets selectedProject itself
    // (even to NO_PROJECT_KEY), so this hook still must not double-fire.
    rerender({ convId: 'conv-1' });
    expect(onSelectProject).not.toHaveBeenCalled();
  });
});
