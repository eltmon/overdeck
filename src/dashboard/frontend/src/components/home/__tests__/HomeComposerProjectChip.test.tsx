import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { HomeComposerProjectChip } from '../HomeComposerProjectChip';

const PROJECTS = [
  { key: 'overdeck', name: 'Overdeck', path: '/home/user/Projects/overdeck' },
  { key: 'myn', name: 'MYN', path: '/home/user/Projects/myn' },
];

describe('HomeComposerProjectChip', () => {
  it('lists every project, the no-project choice, and Add a project', () => {
    render(<HomeComposerProjectChip mode="advanced" projects={PROJECTS} value={undefined} onChange={() => {}} />);
    fireEvent.click(screen.getByTestId('home-composer-project'));

    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Overdeck', 'MYN', 'No project (home folder)', 'Add a project…']);
  });

  it('choosing no project reports undefined', () => {
    const onChange = vi.fn();
    render(<HomeComposerProjectChip mode="advanced" projects={PROJECTS} value="overdeck" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('home-composer-project'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'No project (home folder)' }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('simple mode uses the catalog copy', () => {
    render(<HomeComposerProjectChip mode="simple" projects={[]} value={undefined} onChange={() => {}} />);
    expect(screen.getByTestId('home-composer-project')).toHaveTextContent('Not in a project');
    fireEvent.click(screen.getByTestId('home-composer-project'));
    expect(screen.getByRole('menuitem', { name: 'Add a project…' })).toBeTruthy();
  });

  it('Add a project navigates to /projects/new', () => {
    const pushStateSpy = vi.spyOn(window.history, 'pushState');
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    render(<HomeComposerProjectChip mode="advanced" projects={PROJECTS} value={undefined} onChange={() => {}} />);
    fireEvent.click(screen.getByTestId('home-composer-project'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add a project…' }));

    expect(pushStateSpy).toHaveBeenCalledWith({ tab: 'project-new' }, '', '/projects/new');
    expect(dispatchSpy).toHaveBeenCalledWith(expect.any(PopStateEvent));
    pushStateSpy.mockRestore();
    dispatchSpy.mockRestore();
  });
});
