/**
 * PAN-5293 WI-7: the left column's project switcher. Replaces the Sidebar's
 * owner-group and project/No-project cases.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectSwitcher, projectInitials, tildeHomePath } from '../ProjectSwitcher';
import { useDashboardStore } from '../../../lib/store';
import { COLLAPSED_OWNERS_KEY } from '../../sidebar/projectOwners';
import { NO_PROJECT_KEY, type ProjectData } from '../../CommandDeck/projectsData';

const working: Record<string, number> = {};
vi.mock('../../../lib/selectors/agentsWorking', () => ({
  useAgentsWorking: (opts?: { projectKey?: string }) => ({ count: working[opts?.projectKey ?? ''] ?? 0, byRole: {}, rows: [] }),
}));

const project = (name: string, githubRepo: string | null = null, features: string[] = []): ProjectData => ({
  key: name.toLowerCase(),
  name,
  path: `/home/u/Projects/${name.toLowerCase()}`,
  githubRepo,
  features: features.map((issueId) => ({ issueId }) as ProjectData['features'][number]),
});

let props: {
  onSelectProject: ReturnType<typeof vi.fn>;
  onNewProject: ReturnType<typeof vi.fn>;
  onNewWorkspace: ReturnType<typeof vi.fn>;
};

function renderSwitcher(projects: ProjectData[], selectedProject: string | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['command-deck-projects'], projects);
  const view = render(
    <QueryClientProvider client={client}>
      <ProjectSwitcher selectedProject={selectedProject} collapsed={false} {...props} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByTestId('project-switcher'));
  return view;
}

beforeEach(() => {
  localStorage.clear();
  for (const key of Object.keys(working)) delete working[key];
  props = { onSelectProject: vi.fn(), onNewProject: vi.fn(), onNewWorkspace: vi.fn() };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
  useDashboardStore.setState({
    issuesRaw: [],
    agentsById: {},
    derivedIssueStateByIssueId: {},
  } as Parameters<typeof useDashboardStore.setState>[0]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ProjectSwitcher (PAN-5293 F-D7)', () => {
  it('shows the selected project mark, name and home-shortened path', () => {
    renderSwitcher([project('Overdeck')], 'Overdeck');
    const trigger = screen.getByTestId('project-switcher');
    expect(trigger).toHaveTextContent('OV');
    expect(trigger).toHaveTextContent('Overdeck');
    expect(trigger).toHaveTextContent('~/Projects/overdeck');
  });

  it('reads "Choose a project" with no project selected', () => {
    renderSwitcher([project('Overdeck')]);
    expect(screen.getByTestId('project-switcher')).toHaveTextContent('Choose a project');
  });

  // PAN-5335 WI-9: every project row and the selected button carry a colored initials mark.
  it('shows a colored initials mark on the selected button and on every menu row', () => {
    renderSwitcher([project('Overdeck', 'eltmon/overdeck'), project('Krux', 'eltmon/krux')], 'Overdeck');
    const trigger = screen.getByTestId('project-switcher');
    const triggerMark = trigger.querySelector('[aria-hidden="true"]');
    expect(triggerMark).toHaveTextContent('OV');
    expect(triggerMark).toHaveStyle({ backgroundColor: '#4d7c0f' });

    const krux = screen.getByTestId('project-switcher-row-Krux');
    const kruxMark = krux.querySelector('[aria-hidden="true"]');
    expect(kruxMark).toHaveTextContent('KR');
    expect(kruxMark).toHaveStyle({ backgroundColor: '#0369a1' });
  });

  it('collapses an owner group and remembers it across remounts', () => {
    const projects = [project('MYN', 'mindyournow/myn-cli'), project('Overdeck', 'eltmon/overdeck')];
    const first = renderSwitcher(projects);
    const header = screen.getByTestId('sidebar-owner-mindyournow');
    fireEvent.click(header);
    expect(screen.queryByTestId('project-switcher-row-MYN')).not.toBeInTheDocument();
    expect(screen.getByTestId('project-switcher-row-Overdeck')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(COLLAPSED_OWNERS_KEY) ?? '[]')).toEqual(['mindyournow']);

    first.unmount();
    renderSwitcher(projects);
    expect(screen.getByTestId('sidebar-owner-mindyournow')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('project-switcher-row-MYN')).not.toBeInTheDocument();
  });

  it('renders no owner headers when every project has one owner', () => {
    renderSwitcher([project('Overdeck', 'eltmon/overdeck'), project('Krux', 'eltmon/krux')]);
    expect(screen.getByTestId('project-switcher-row-Overdeck')).toBeInTheDocument();
    expect(screen.queryByTestId(/^sidebar-owner-/)).not.toBeInTheDocument();
  });

  it('picks a project by name, and No project by NO_PROJECT_KEY', () => {
    renderSwitcher([project('Overdeck')]);
    fireEvent.click(screen.getByTestId('project-switcher-row-Overdeck'));
    expect(props.onSelectProject).toHaveBeenCalledWith('Overdeck');
    expect(screen.queryByTestId('project-switcher-menu')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('project-switcher'));
    fireEvent.click(screen.getByTestId('project-switcher-row-no-project'));
    expect(props.onSelectProject).toHaveBeenLastCalledWith(NO_PROJECT_KEY);
  });

  it('reads "2 working", "1 in review" and "idle" (F-D8)', () => {
    working.alpha = 2;
    useDashboardStore.setState({
      derivedIssueStateByIssueId: { 'BET-1': { state: 'in-review' } },
    } as unknown as Parameters<typeof useDashboardStore.setState>[0]);
    renderSwitcher([project('Alpha', null, ['ALP-1']), project('Beta', null, ['BET-1', 'BET-2']), project('Gamma', null, ['GAM-1'])]);
    expect(screen.getByTestId('project-status-Alpha')).toHaveTextContent('2 working');
    expect(screen.getByTestId('project-status-Beta')).toHaveTextContent('1 in review');
    expect(screen.getByTestId('project-status-Gamma')).toHaveTextContent('idle');
  });

  it('shows a filter input above 8 projects and filters by name', () => {
    const names = ['Alpha', 'Krux', 'Kraken', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India'];
    renderSwitcher(names.map((name) => project(name)));
    fireEvent.change(screen.getByTestId('project-switcher-filter'), { target: { value: 'kr' } });
    expect(screen.getByTestId('project-switcher-row-Krux')).toBeInTheDocument();
    expect(screen.getByTestId('project-switcher-row-Kraken')).toBeInTheDocument();
    expect(screen.queryByTestId('project-switcher-row-Alpha')).not.toBeInTheDocument();
    expect(screen.queryByTestId('project-switcher-row-India')).not.toBeInTheDocument();
  });

  it('shows no filter input with 8 projects or fewer', () => {
    renderSwitcher(['A1', 'B2'].map((name) => project(name)));
    expect(screen.queryByTestId('project-switcher-filter')).not.toBeInTheDocument();
  });

  it('Add a project and New workspace call their callbacks', () => {
    renderSwitcher([project('Overdeck')], 'Overdeck');
    fireEvent.click(screen.getByTestId('project-switcher-add-project'));
    expect(props.onNewProject).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('project-switcher'));
    const newWorkspace = screen.getByTestId('project-switcher-new-workspace');
    expect(newWorkspace).toHaveTextContent('New workspace in Overdeck…');
    fireEvent.click(newWorkspace);
    expect(props.onNewWorkspace).toHaveBeenCalledWith('overdeck');
  });
});

describe('ProjectSwitcher helpers', () => {
  it('projectInitials takes two words or two letters', () => {
    expect(projectInitials('mind-your-now')).toBe('MY');
    expect(projectInitials('overdeck')).toBe('OV');
  });

  it('tildeHomePath shortens /home/<user> and /Users/<user>', () => {
    expect(tildeHomePath('/home/u/Projects/x')).toBe('~/Projects/x');
    expect(tildeHomePath('/Users/u')).toBe('~');
    expect(tildeHomePath('/srv/x')).toBe('/srv/x');
  });
});
