import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsSection } from '../SettingsSection';
import { SettingsRow } from '../SettingsRow';
import { SettingsSidebarNav } from '../SettingsSidebarNav';
import { SettingsLayout, SettingsHeader } from '../SettingsLayout';
import { SettingsRowStatus } from '../SettingsRowStatus';
import { SettingsCardSection } from '../SettingsCardSection';

describe('SettingsSection', () => {
  it('renders title and children', () => {
    render(
      <SettingsSection id="test" title="General">
        <div>Content</div>
      </SettingsSection>
    );
    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(
      <SettingsSection id="test" title="General" description="Configure basics">
        <div>Content</div>
      </SettingsSection>
    );
    expect(screen.getByText('— Configure basics')).toBeInTheDocument();
  });

  it('renders as collapsible with toggle', () => {
    render(
      <SettingsSection id="test" title="Advanced" collapsible defaultOpen>
        <div>Hidden content</div>
      </SettingsSection>
    );
    const toggle = screen.getByRole('button', { name: /Advanced/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Hidden content')).toBeInTheDocument();
  });

  it('hides content when collapsed', () => {
    render(
      <SettingsSection id="test" title="Advanced" collapsible defaultOpen={false}>
        <div>Hidden content</div>
      </SettingsSection>
    );
    expect(screen.queryByText('Hidden content')).not.toBeInTheDocument();
  });

  it('toggles open/closed on click', () => {
    render(
      <SettingsSection id="test" title="Advanced" collapsible defaultOpen>
        <div>Toggled content</div>
      </SettingsSection>
    );
    const toggle = screen.getByRole('button', { name: /Advanced/i });
    fireEvent.click(toggle);
    expect(screen.queryByText('Toggled content')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText('Toggled content')).toBeInTheDocument();
  });

  it('renders actions slot', () => {
    render(
      <SettingsSection id="test" title="Section" actions={<button>Reset</button>}>
        <div>Content</div>
      </SettingsSection>
    );
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
  });
});

describe('SettingsRow', () => {
  it('renders label and children', () => {
    render(
      <SettingsRow label="Theme">
        <select><option>Dark</option></select>
      </SettingsRow>
    );
    expect(screen.getByText('Theme')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders description', () => {
    render(
      <SettingsRow label="Auto-save" description="Save settings automatically">
        <input type="checkbox" />
      </SettingsRow>
    );
    expect(screen.getByText('Save settings automatically')).toBeInTheDocument();
  });

  it('renders status badge', () => {
    render(
      <SettingsRow label="Provider" status={<span>Active</span>}>
        <button>Configure</button>
      </SettingsRow>
    );
    expect(screen.getByText('Active')).toBeInTheDocument();
  });
});

describe('SettingsSidebarNav', () => {
  const items = [
    { id: 'model-routing', label: 'Model Routing' },
    { id: 'providers', label: 'Providers' },
    { id: 'conversations', label: 'Conversations' },
  ];

  it('renders all nav items', () => {
    render(
      <SettingsSidebarNav items={items} activeId="providers" onSelect={() => {}} />
    );
    expect(screen.getByText('Model Routing')).toBeInTheDocument();
    expect(screen.getByText('Providers')).toBeInTheDocument();
    expect(screen.getByText('Conversations')).toBeInTheDocument();
  });

  it('marks active item with aria-current', () => {
    render(
      <SettingsSidebarNav items={items} activeId="providers" onSelect={() => {}} />
    );
    const active = screen.getByText('Providers').closest('button');
    expect(active).toHaveAttribute('aria-current', 'true');
    const inactive = screen.getByText('Model Routing').closest('button');
    expect(inactive).not.toHaveAttribute('aria-current');
  });

  it('calls onSelect with section id on click', () => {
    const onSelect = vi.fn();
    render(
      <SettingsSidebarNav items={items} activeId="providers" onSelect={onSelect} />
    );
    fireEvent.click(screen.getByText('Conversations'));
    expect(onSelect).toHaveBeenCalledWith('conversations');
  });

  it('applies active styling to the selected item', () => {
    render(
      <SettingsSidebarNav items={items} activeId="model-routing" onSelect={() => {}} />
    );
    const activeBtn = screen.getByText('Model Routing').closest('button');
    expect(activeBtn?.className).toContain('text-primary');
  });
});

describe('SettingsLayout', () => {
  it('renders header, sidebar, and content', () => {
    render(
      <SettingsLayout
        header={<div>Header</div>}
        sidebar={<div>Sidebar</div>}
      >
        <div>Main Content</div>
      </SettingsLayout>
    );
    expect(screen.getByText('Header')).toBeInTheDocument();
    expect(screen.getByText('Sidebar')).toBeInTheDocument();
    expect(screen.getByText('Main Content')).toBeInTheDocument();
  });
});

describe('SettingsHeader', () => {
  it('renders title and save/reset buttons', () => {
    render(
      <SettingsHeader
        title="Settings"
        hasChanges={true}
        saving={false}
        saveSuccess={false}
        saveError={false}
        onSave={() => {}}
        onReset={() => {}}
      />
    );
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByText('Reset')).toBeInTheDocument();
  });

  it('disables save when no changes', () => {
    render(
      <SettingsHeader
        title="Settings"
        hasChanges={false}
        saving={false}
        saveSuccess={false}
        saveError={false}
        onSave={() => {}}
        onReset={() => {}}
      />
    );
    expect(screen.getByText('Save')).toBeDisabled();
    expect(screen.getByText('Reset')).toBeDisabled();
  });

  it('shows saving state', () => {
    render(
      <SettingsHeader
        title="Settings"
        hasChanges={true}
        saving={true}
        saveSuccess={false}
        saveError={false}
        onSave={() => {}}
        onReset={() => {}}
      />
    );
    expect(screen.getByText('Saving…')).toBeInTheDocument();
  });

  it('shows success indicator', () => {
    render(
      <SettingsHeader
        title="Settings"
        hasChanges={false}
        saving={false}
        saveSuccess={true}
        saveError={false}
        onSave={() => {}}
        onReset={() => {}}
      />
    );
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('shows error indicator', () => {
    render(
      <SettingsHeader
        title="Settings"
        hasChanges={false}
        saving={false}
        saveSuccess={false}
        saveError={true}
        onSave={() => {}}
        onReset={() => {}}
      />
    );
    expect(screen.getByText('Save failed')).toBeInTheDocument();
  });
});

describe('SettingsRowStatus', () => {
  it('renders with success variant', () => {
    render(<SettingsRowStatus variant="success" label="Connected" />);
    const el = screen.getByText('Connected');
    expect(el.className).toContain('text-success');
  });

  it('renders with error variant', () => {
    render(<SettingsRowStatus variant="error" label="Failed" />);
    const el = screen.getByText('Failed');
    expect(el.className).toContain('text-destructive');
  });
});

describe('SettingsCardSection', () => {
  it('renders children in a card container', () => {
    render(
      <SettingsCardSection>
        <div>Card content</div>
      </SettingsCardSection>
    );
    expect(screen.getByText('Card content')).toBeInTheDocument();
    const container = screen.getByText('Card content').parentElement;
    expect(container?.className).toContain('bg-card');
    expect(container?.className).toContain('border');
  });
});
