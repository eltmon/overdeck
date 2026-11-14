import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { HomeComposerProjectChip } from '../HomeComposerProjectChip';
import { useAddProjectDialog } from '../../project/new/addProjectDialogStore';

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

  it('renders the menu outside the chip so overflow cannot clip it, and pointerdown inside keeps it open', () => {
    const onChange = vi.fn();
    const { container } = render(
      <HomeComposerProjectChip mode="advanced" projects={PROJECTS} value={undefined} onChange={onChange} />,
    );
    fireEvent.click(screen.getByTestId('home-composer-project'));

    const menu = screen.getByRole('menu');
    expect(container.contains(menu)).toBe(false);
    expect(menu.style.position).toBe('fixed');

    const item = screen.getByRole('menuitem', { name: 'MYN' });
    fireEvent.pointerDown(item);
    fireEvent.click(item);
    expect(onChange).toHaveBeenCalledWith('myn');
  });

  it('pointerdown outside closes the menu', () => {
    render(<HomeComposerProjectChip mode="advanced" projects={PROJECTS} value={undefined} onChange={() => {}} />);
    fireEvent.click(screen.getByTestId('home-composer-project'));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
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

  it('Add a project opens the Add-project dialog without leaving Home (PAN-4281)', () => {
    useAddProjectDialog.getState().hide();
    const pushStateSpy = vi.spyOn(window.history, 'pushState');
    render(<HomeComposerProjectChip mode="advanced" projects={PROJECTS} value={undefined} onChange={() => {}} />);
    fireEvent.click(screen.getByTestId('home-composer-project'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add a project…' }));

    expect(useAddProjectDialog.getState().open).toBe(true);
    expect(pushStateSpy).not.toHaveBeenCalled();
    pushStateSpy.mockRestore();
    useAddProjectDialog.getState().hide();
  });
});
