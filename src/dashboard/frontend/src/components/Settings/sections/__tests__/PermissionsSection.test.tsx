import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PermissionsSection } from '../PermissionsSection';
import type { SettingsConfig } from '../../types';

function renderSection(formData: Partial<SettingsConfig>, onClaudePermissionModeChange = vi.fn()) {
  render(
    <PermissionsSection
      formData={formData as SettingsConfig}
      onClaudePermissionModeChange={onClaudePermissionModeChange}
      onCodexPermissionModeChange={vi.fn()}
    />,
  );
  return onClaudePermissionModeChange;
}

describe('PermissionsSection Claude Code mode (PAN-5151)', () => {
  it('selects Auto when formData has no claude block', () => {
    renderSection({});

    expect(screen.getByTestId('permission-mode-auto')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('permission-mode-bypass')).toHaveAttribute('aria-checked', 'false');
  });

  it('selects Bypass when formData.claude.permissionMode is bypass', () => {
    renderSection({ claude: { permissionMode: 'bypass' } });

    expect(screen.getByTestId('permission-mode-bypass')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('permission-mode-auto')).toHaveAttribute('aria-checked', 'false');
  });

  it('renders Auto first, titled "Auto (recommended)", with no "recommended" on Bypass', () => {
    renderSection({});

    const radios = screen.getAllByRole('radio').filter((el) => el.getAttribute('data-testid')?.startsWith('permission-mode-'));
    expect(radios[0]).toHaveAttribute('data-testid', 'permission-mode-auto');
    expect(radios[0]).toHaveTextContent('Auto (recommended)');
    expect(screen.getByTestId('permission-mode-bypass')).not.toHaveTextContent(/recommended/i);
  });

  it('calls onClaudePermissionModeChange when Bypass is clicked', () => {
    const onClaudePermissionModeChange = renderSection({});

    screen.getByTestId('permission-mode-bypass').click();

    expect(onClaudePermissionModeChange).toHaveBeenCalledWith('bypass');
  });
});
